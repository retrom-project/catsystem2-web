// SPDX-License-Identifier: MPL-2.0
// Decode containers and instructions without running a script or native handler.
import { readFile, stat, writeFile } from 'node:fs/promises';
import { basename, extname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { KIFArchive } from '../src/files.mjs';
import { readKCS, KCSMachine } from '../src/kcs.mjs';
import { readFES, readScene } from '../src/formats/scene.mjs';
import { parseProgram } from '../src/fes/program.mjs';
import { replaceFESMacros } from '../src/fes/source.mjs';
import { NodeFile } from './node-files.mjs';
import { commandBody } from './fes-audit.mjs';
import { cstCommandBody } from '../src/cst-syntax.mjs';

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

export function inspectFES({ text, prepared }, include) {
  const program = parseProgram(text, { prepared, include }),
    macros = new Map(program.macros);
  const commands = [],
    objectCommands = [];
  for (const source of Object.values(program.blocks).flat()) {
    const line = commandBody(replaceFESMacros(source, macros));
    if (!line || /^(?:(?:\+\+|--))?[$\\]/.test(line)) continue;
    const [head, verb] = line.split(/\s+/);
    const object = program.definitions.find(
      (definition) => head === definition.name || head.startsWith(`${definition.name}[`),
    );
    if (object || head === '@')
      objectCommands.push({ type: object?.type ?? 'current-object', command: verb ?? null });
    else commands.push(head);
  }
  return {
    commands,
    objectCommands,
    objects: program.definitions.map(({ type, name }) => ({ type, name })),
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
    commandErrors = [];
  for (const [index, record] of scene.lines.entries()) {
    if (record.kind !== 0x30) continue;
    try {
      const line = cstCommandBody(record.text);
      if (line && !/^[\d#(]/.test(line)) commands.push(line.split(/\s+/)[0]);
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
  let archive;
  try {
    archive = await KIFArchive.open(new NodeFile(input.path, info.size), input.path);
  } catch (error) {
    return {
      ...row,
      status: 'unavailable',
      reason: error.message || `Decoder failed without a message (${error.name})`,
    };
  }
  row.memberCount = archive.entries.length;
  const texts = new Map();
  for (const member of archive.entries.filter(
    (entry) => extname(entry.name).toLowerCase() === '.fes',
  )) {
    try {
      texts.set(member.name.toLowerCase(), await readFES(await archive.read(member)));
    } catch (error) {
      row.entries.push({
        name: member.name,
        kind: 'fes',
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
      const bytes = await archive.read(member);
      let parsed;
      if (kind === 'kcs') parsed = await inspectKCS(bytes, input.path);
      else if (kind === 'fes')
        parsed = inspectFES(texts.get(member.name.toLowerCase()), (name) =>
          texts.get(name.toLowerCase()),
        );
      else if (kind === 'cst') parsed = await inspectCST(bytes);
      else
        parsed = {
          header: Buffer.from(bytes.subarray(0, 32)).toString('hex'),
          review: 'needs-review',
        };
      row.entries.push({ name: member.name, kind, status: 'parsed', ...parsed });
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
