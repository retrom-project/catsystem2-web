// SPDX-License-Identifier: MPL-2.0
// Decode containers and instructions without running a script or native handler.
import { createHash } from 'node:crypto';
import { readFile, stat, writeFile } from 'node:fs/promises';
import { basename, extname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { BlobFile, KIFArchive } from '../src/files.mjs';
import { readKCS, KCSMachine } from '../src/kcs.mjs';
import { readFES, readScene } from '../src/formats/scene.mjs';
import { parseProgram } from '../src/fes/program.mjs';
import { parseBareFESDefinition } from '../src/fes/instance.mjs';
import { replaceFESMacros } from '../src/fes/source.mjs';
import { NodeFile } from './node-files.mjs';
import { commandBody } from './fes-audit.mjs';
import { cstCommandBody } from '../src/cst-syntax.mjs';
import { fesByteView, fesViewBytes, tokenizeFESByteLine } from '../src/fes/tokens.mjs';

const sha256 = (bytes) => createHash('sha256').update(bytes).digest('hex');

export async function inspectKCS(bytes, container) {
  const script = await readKCS(bytes),
    decoder = Object.create(KCSMachine.prototype);
  decoder.script = script;
  const calls = [];
  for (let pc = 0; pc < script.codeSize; ) {
    const instruction = decoder.instruction(pc);
    if (instruction.op === 43) {
      const [id, count] = instruction.args;
      const constantID = !(id.mode & 0x50),
        constantCount = !(count.mode & 0x50);
      calls.push({
        pc,
        id: constantID ? id.value : null,
        idMode: id.mode,
        countMode: count.mode,
        argumentWords: constantCount && count.value % 4 === 0 ? count.value / 4 : null,
      });
    }
    pc += instruction.size;
  }
  const name = basename(container).toLowerCase();
  const table =
    name === 'mot.int'
      ? 'generic'
      : name === 'ptcl.int'
        ? script.scriptVersion === 0x10000
          ? 'particle-v1'
          : script.scriptVersion === 0x20000
            ? 'particle-v2'
            : 'particle-unknown'
        : name === 'kcs.int'
          ? 'main'
          : 'needs-review';
  return {
    table,
    formatVersion: script.formatVersion,
    scriptVersion: script.scriptVersion,
    debugBytes: script.debugSize,
    codeBytes: script.codeSize,
    calls,
    strings: [...script.strings.values()],
  };
}

export function inspectFES({ bytes, text, prepared }, include) {
  const program = parseProgram(bytes, { prepared, include }),
    macros = new Map(
      program.macros
        .filter((row) => row.length > 1)
        .map(([name, value]) => [fesByteView(name), value]),
    );
  // These are literal standalone declarations, not runtime-native results.
  // Keep rows that need a bank or cannot be read by that grammar unresolved.
  const objects = [],
    unresolvedDefinitions = [];
  for (const row of program.definitions) {
    const declaration = parseBareFESDefinition(row);
    if (declaration === null) continue;
    if (declaration === undefined || fesByteView(row).includes('$str')) {
      unresolvedDefinitions.push({
        raw: fesByteView(row),
        reason: 'Declaration requires runtime expansion or is outside the static bare grammar',
      });
    } else objects.push({ type: declaration.type, name: declaration.name });
  }
  const commands = [],
    objectCommands = [],
    callShapes = [];
  for (const [block, sources] of Object.entries(program.blocks)) {
    for (const [position, source] of sources.entries()) {
      const line = commandBody(replaceFESMacros(source, macros));
      if (!line || /^(?:(?:\+\+|--))?[$\\]/.test(line)) continue;
      const [head, verb] = line.split(/\s+/);
      const object = objects.find(
        (definition) => head === definition.name || head.startsWith(`${definition.name}[`),
      );
      const type = object?.type ?? (head === '@' ? 'current-object' : null),
        [objectToken, ...tokens] = tokenizeFESByteLine(fesViewBytes(line), { quoted: true });
      if (type) objectCommands.push({ type, command: verb ?? null });
      else commands.push(head);
      callShapes.push({
        block,
        position,
        type,
        command: type ? (verb ?? null) : head,
        argumentTokens:
          objectToken === undefined ? null : Math.max(0, tokens.length - Number(Boolean(type))),
      });
    }
  }
  return {
    callShapes,
    commands,
    objectCommands,
    objects,
    unresolvedDefinitions,
    pluginReferences: text
      .split(/\r?\n/)
      .flatMap((line, index) =>
        /\.ppi|particle3|openjtalk/i.test(line) ? [{ line: index + 1, text: line.trim() }] : [],
      ),
  };
}

export async function inspectCST(bytes) {
  const scene = await readScene(bytes),
    commands = [],
    commandSites = [],
    commandErrors = [];
  for (const [index, record] of scene.lines.entries()) {
    if (record.kind !== 0x30) continue;
    try {
      const line = cstCommandBody(record.text);
      if (line && !/^[\d#(]/.test(line)) {
        const command = line.split(/\s+/)[0];
        commands.push(command);
        commandSites.push({ line: index + 1, command });
      }
    } catch (error) {
      commandErrors.push({
        line: index + 1,
        text: record.text,
        reason: error.message || `Decoder failed without a message (${error.name})`,
      });
    }
  }
  return {
    lines: scene.lines.length,
    commands,
    commandSites,
    commandErrors,
    pluginReferences: scene.lines.flatMap((line, index) =>
      line.kind === 0x30 && /particle3|\.ppi|openjtalk/i.test(line.text)
        ? [{ line: index + 1, text: line.text }]
        : [],
    ),
  };
}

export async function surveyContainer(input) {
  const info = await stat(input.path),
    row = { ...input, bytes: info.size, entries: [], status: 'parsed' };
  let file = new NodeFile(input.path, info.size);
  if (input.sha256) {
    const bytes = await readFile(input.path);
    if (sha256(bytes) !== input.sha256)
      throw new Error(`Archive SHA-256 mismatch for ${input.path}`);
    row.bytes = bytes.length;
    file = new BlobFile(new Blob([bytes]));
  }
  let archive;
  try {
    archive = await KIFArchive.open(file, input.logicalPath ?? input.path);
  } catch (error) {
    return {
      ...row,
      status: 'unavailable',
      reason: error.message || `Decoder failed without a message (${error.name})`,
    };
  }
  row.memberCount = archive.entries.length;
  const texts = new Map();
  for (const member of archive.entries.filter((entry) =>
    ['.fes', '.h'].includes(extname(entry.name).toLowerCase()),
  )) {
    try {
      const bytes = await archive.read(member);
      texts.set(member.name.toLowerCase(), { sha256: sha256(bytes), source: await readFES(bytes) });
    } catch (error) {
      row.entries.push({
        name: member.name,
        kind: extname(member.name).toLowerCase().slice(1),
        status: 'needs-review',
        reason: error.message || `Decoder failed without a message (${error.name})`,
      });
    }
  }
  for (const member of archive.entries) {
    const kind = extname(member.name).slice(1).toLowerCase();
    if (!['kcs', 'fes', 'cst', 'psb', 'psz'].includes(kind)) continue;
    if (row.entries.some((entry) => entry.name === member.name)) continue;
    try {
      const fes = texts.get(member.name.toLowerCase());
      let parsed, memberSHA256;
      if (kind === 'fes') {
        const includes = new Map();
        parsed = inspectFES(fes.source, (name) => {
          const key = name.toLowerCase(),
            included = texts.get(key);
          includes.set(key, included?.sha256 ?? null);
          return included?.source;
        });
        parsed.includes = Object.fromEntries(
          [...includes.entries()].sort(([a], [b]) => a.localeCompare(b)),
        );
        memberSHA256 = fes.sha256;
      } else {
        const bytes = await archive.read(member);
        memberSHA256 = sha256(bytes);
        if (kind === 'kcs') parsed = await inspectKCS(bytes, input.logicalPath ?? input.path);
        else if (kind === 'cst') parsed = await inspectCST(bytes);
        else
          parsed = {
            header: Buffer.from(bytes.subarray(0, 32)).toString('hex'),
            review: 'needs-review',
          };
      }
      row.entries.push({
        name: member.name,
        kind,
        status: 'parsed',
        sha256: memberSHA256,
        ...parsed,
      });
    } catch (error) {
      row.entries.push({
        name: member.name,
        kind,
        status: 'needs-review',
        reason: error.message || `Decoder failed without a message (${error.name})`,
      });
    }
  }
  return row;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const [manifest, output] = process.argv.slice(2);
  if (!manifest || !output)
    throw new Error('Usage: node scripts/survey-native-corpus.mjs CONTAINER_MANIFEST OUTPUT_JSON');
  const inputs = JSON.parse(await readFile(manifest, 'utf8')),
    results = [];
  for (const input of inputs) results.push(await surveyContainer(input));
  await writeFile(output, `${JSON.stringify(results, null, 2)}\n`);
}
