// SPDX-License-Identifier: MPL-2.0
// The registry is reviewed data, not a list inferred from switch-case spellings.
import { readFile, writeFile, readdir, mkdir } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { format, resolveConfig } from 'prettier';
import { parseProgram } from '../src/fes/program.mjs';
import { FESInstance } from '../src/fes/instance.mjs';
import { readFES, readScene } from '../src/formats/scene.mjs';
import { condition } from '../src/fes/expression.mjs';
import { cstCommandBody } from '../src/cst-syntax.mjs';
import { fesByteView, fesNarrowText } from '../src/fes/tokens.mjs';

const root = fileURLToPath(new URL('../', import.meta.url));
export const registry = JSON.parse(
  await readFile(new URL('./fes-audit.contracts.json', import.meta.url), 'utf8'),
);
const statuses = ['implemented', 'partial', 'missing', 'platform-substitution'];

export async function validateRegistry() {
  const ids = new Set();
  for (const row of registry.contracts) {
    if (ids.has(row.id)) throw new Error(`Duplicate contract ${row.id}`);
    ids.add(row.id);
    if (!statuses.includes(row.status) || !row.names.length || !row.note || !row.implementation)
      throw new Error(`Incomplete contract ${row.id}`);
    if (new URL(row.source).hostname !== 'cs2.suki.jp')
      throw new Error(`Non-primary source ${row.id}`);
    if (row.status === 'implemented' && !row.evidence.length)
      throw new Error(`Implemented without evidence ${row.id}`);
    for (const evidence of row.evidence) await readFile(path.join(root, evidence));
  }
}

export function summary() {
  const result = {};
  for (const row of registry.contracts) {
    result[row.domain] ||= Object.fromEntries(statuses.map((s) => [s, 0]));
    result[row.domain][row.status]++;
  }
  return result;
}

const escape = (s) => s.replaceAll('|', '\\|').replaceAll('\n', ' ');
export function document() {
  const lines = [
    '# FES / CST contract coverage',
    '',
    'This file is generated from `scripts/fes-audit.contracts.json` by `node scripts/fes-audit.mjs --write`.',
    'The inventory follows the official alphabetical, normal/object-command, object-type and CST reference indexes, including commands linked only by individual object pages. It also records the frozen SDK 4.01 object variants and SUBCOMMAND mechanism.',
    '',
    '`implemented` means the stated documented behavior has a public fixture. `partial` retains a material semantic, host or rendering gap. `missing` includes recognized tokens and diagnostic-only stubs. `platform-substitution` requires an explicit, tested browser behavior; an unsupported command does not qualify. Passing one game is not a completeness criterion.',
    '',
    'The official web manual is not a versioned specification. SDK 4.01 is the fixed additional reference. Raw captures, private scripts and SDK probe output belong in ignored `.local/fes-audit/`, never in distributed fixtures.',
    '',
    'Source identities: [official FES reference](https://cs2.suki.jp/manual/fes/reference/ref_abc.html), [official object command reference](https://cs2.suki.jp/manual/fes/reference/ref_obj.html), [official object types](https://cs2.suki.jp/manual/fes/code/object.html), [official CST reference](https://cs2.suki.jp/manual/scene/reference/contents.html). CatSystemKit is an incomplete implementation reference; FelineSystem2 code is not used.',
    '',
    'Unsupported FES verbs and initialization columns are located diagnostics. Undeclared object targets are not synthesized as IMAGE objects. Unknown expression identifiers are errors, rather than fabricated zero values. Native arithmetic exceptions, input edge cases and full KX2/custom SUBCOMMAND execution still need native differential evidence.',
    '',
    '## Counts',
    '',
    '| Domain | Implemented | Partial | Missing | Browser substitution |',
    '| --- | ---: | ---: | ---: | ---: |',
    ...Object.entries(summary()).map(
      ([domain, counts]) => `| ${domain} | ${statuses.map((s) => counts[s]).join(' | ')} |`,
    ),
    '',
  ];
  for (const domain of Object.keys(summary())) {
    lines.push(
      `## ${domain}`,
      '',
      '| Contract / primary reference | Documented signatures | Status | Evidence | Remaining behavior |',
      '| --- | --- | --- | --- | --- |',
    );
    for (const row of registry.contracts.filter((r) => r.domain === domain)) {
      const evidence = row.evidence.map((file) => `[${file}](../${file})`).join(', ') || '—';
      const signatures = (row.signatures || []).map((s) => `\`${escape(s)}\``).join('<br>') || '—';
      lines.push(
        `| [${escape(row.names.join(', '))}](${row.source}) | ${signatures} | ${row.status} | ${evidence} | ${escape(row.note)} |`,
      );
    }
    lines.push('');
  }
  lines.push(
    '## Reproduction',
    '',
    '```sh',
    'node --test tests/fes-contracts.test.mjs tests/scene-contracts.test.mjs',
    'node scripts/fes-audit.mjs --check',
    'node scripts/fes-audit.mjs --sdk /absolute/path/to/frozen/sdk/system/fes',
    'node scripts/fes-audit.mjs --cst /absolute/path/to/frozen/sdk/system/scene',
    '```',
    '',
    'The SDK probe parses every compiled FES and initializes declared objects without rendering or executing native scripts. It reports unsupported columns, unresolved targets and syntax errors. A clean parse is not behavioral acceptance. New command implementations must update their registry status, evidence and remaining gap together.',
    '',
  );
  return lines.join('\n');
}

export function commandBody(source) {
  if (source instanceof Uint8Array) source = fesByteView(source);
  while (/^if *\(/.test(source)) source = condition(source)[1];
  return source;
}

async function probeSDK(directory, filename = 'sdk-fes-parse.json') {
  const reports = [];
  const includes = new Map();
  for (const name of await readdir(directory))
    if (/\.h$/i.test(name))
      includes.set(name, await readFES(new Uint8Array(await readFile(path.join(directory, name)))));
  for (const name of (await readdir(directory)).filter((n) => /\.fes(?:\.txt)?$/i.test(n)).sort()) {
    try {
      const source = await readFES(new Uint8Array(await readFile(path.join(directory, name))));
      const program = parseProgram(source.bytes, {
        prepared: source.prepared,
        include: (file) => includes.get(file),
      });
      const diagnostics = [];
      const player = {
        frameCount: 0,
        globals: {},
        strings: {},
        host: {},
        unresolvedTargets: new Set(),
        picture: () => null,
        unsupported: (message) => diagnostics.push(message),
      };
      const instance = new FESInstance(name, program, player);
      const commands = {},
        objectCommands = {},
        columns = new Set();
      for (const table of program.tables)
        for (const column of table.columns) columns.add(fesNarrowText(column));
      for (const lines of Object.values(program.blocks))
        for (const source of lines) {
          const line = commandBody(instance.expandMacros(source));
          if (!line || /^(?:(?:\+\+|--))?[$\\]/.test(line)) continue;
          const [head, verb] = line.split(/\s+/);
          const object =
            head === '@' ||
            program.definitions.some((d) => head === d.name || head.startsWith(`${d.name}[`));
          const inventory = object ? objectCommands : commands,
            key = object ? verb : head;
          inventory[key] = (inventory[key] || 0) + 1;
        }
      reports.push({
        name,
        lines: source.text.split('\n').length,
        objects: instance.objects.length,
        blocks: Object.keys(program.blocks).length,
        diagnostics,
        unresolvedTargets: [...player.unresolvedTargets],
        commands,
        objectCommands,
        columns: [...columns],
      });
    } catch (error) {
      reports.push({ name, error: error.message });
    }
  }
  const target = path.join(root, '.local/fes-audit', filename);
  await mkdir(path.dirname(target), { recursive: true });
  await writeFile(target, `${JSON.stringify(reports, null, 2)}\n`);
  return {
    target,
    scripts: reports.length,
    errors: reports.filter((r) => r.error).length,
    diagnostics: reports.reduce((sum, r) => sum + (r.diagnostics?.length || 0), 0),
    unresolvedTargets: reports.reduce((sum, r) => sum + (r.unresolvedTargets?.length || 0), 0),
  };
}

async function probeCST(directory) {
  const reports = [],
    kinds = {},
    commands = {},
    nested = {};
  for (const name of (await readdir(directory)).filter((n) => /\.cst$/i.test(n)).sort()) {
    try {
      const script = await readScene(new Uint8Array(await readFile(path.join(directory, name))));
      for (const line of script.lines) {
        kinds[line.kind] = (kinds[line.kind] || 0) + 1;
        if (line.kind !== 0x30) continue;
        const source = cstCommandBody(line.text);
        if (!source || /^[\d#(]/.test(source)) continue;
        const [head, bank, verb] = source.split(/\s+/);
        commands[head] = (commands[head] || 0) + 1;
        if (
          ['bg', 'cg', 'eg', 'fg', 'fw', 'pl', 'bgm', 'se', 'pcm'].includes(head) &&
          /^\d+$/.test(bank || '') &&
          verb
        ) {
          const key = `${head}.${verb}`;
          nested[key] = (nested[key] || 0) + 1;
        }
      }
      reports.push({ name, lines: script.lines.length, blocks: script.blocks.length });
    } catch (error) {
      reports.push({ name, error: error.message });
    }
  }
  const target = path.join(root, '.local/fes-audit/cst-inventory.json');
  await mkdir(path.dirname(target), { recursive: true });
  await writeFile(
    target,
    `${JSON.stringify({ kinds, commands, nested, scripts: reports }, null, 2)}\n`,
  );
  return {
    target,
    scripts: reports.length,
    errors: reports.filter((r) => r.error).length,
    kinds,
    commands,
  };
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  await validateRegistry();
  const output = path.join(root, 'docs/fes-cst-compatibility.md');
  const generated = await format(document(), {
    ...(await resolveConfig(output)),
    filepath: output,
  });
  if (process.argv.includes('--write')) await writeFile(output, generated);
  if (process.argv.includes('--check')) {
    const saved = await readFile(output, 'utf8');
    if (saved !== generated) throw new Error('Contract matrix is stale; run --write');
  }
  const sdkIndex = process.argv.indexOf('--sdk');
  const fesIndex = process.argv.indexOf('--fes'),
    cstIndex = process.argv.indexOf('--cst');
  const result =
    sdkIndex >= 0
      ? await probeSDK(process.argv[sdkIndex + 1])
      : fesIndex >= 0
        ? await probeSDK(process.argv[fesIndex + 1], 'fes-inventory.json')
        : cstIndex >= 0
          ? await probeCST(process.argv[cstIndex + 1])
          : summary();
  console.log(JSON.stringify(result, null, 2));
}
