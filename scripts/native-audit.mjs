// SPDX-License-Identifier: MPL-2.0
// Static inventory only: this script never executes an engine or a KCS program.
import { readFile, mkdir, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { nodeGame } from './node-files.mjs';
import { readKCS } from '../src/kcs.mjs';

export const sources = [
  {
    id: 'sdk-4.01-engine-2.6.1.74',
    path: 'catsystem2-4.01/sdk/system/cs2_open.exe',
    sha256: '0e1dde51e86e9152d8e1d27b82efb15916cb9f82d23dd30990212fafd96c8b9f',
    tables: { main: 0xb3c900, generic: 0xc2dae8, 'particle-v1': 0xb50e20, 'particle-v2': 0xb50ed8 },
    counts: { main: 1009, generic: 45, 'particle-v1': 44, 'particle-v2': 51 },
    scriptRoot: 'catsystem2-4.01/sdk/system',
  },
  {
    id: 'nekopara-vol3-engine-2.6.1.76',
    path: 'nekopara-vol3/analysis/game/NEKOPARAvol3.exe',
    sha256: 'ee6bf5cbb84191f3e998d033cdcd774763a78cd06912f7da053b329038bc8be0',
    tables: { main: 0xa2dd38, generic: 0xb229a0, 'particle-v1': 0xa406c0, 'particle-v2': 0xa40778 },
    counts: { main: 1055, generic: 45, 'particle-v1': 44, 'particle-v2': 51 },
    scriptRoot: 'nekopara-vol3/analysis/game',
  },
];

const hex = (n) => `0x${n.toString(16).toUpperCase().padStart(8, '0')}`;
const hash = (bytes) => createHash('sha256').update(bytes).digest('hex');

export function readPE(bytes) {
  if (bytes.readUInt16LE(0) !== 0x5a4d) throw new Error('Expected MZ image');
  const nt = bytes.readUInt32LE(60);
  if (bytes.readUInt32LE(nt) !== 0x4550 || bytes.readUInt16LE(nt + 24) !== 0x10b)
    throw new Error('Expected PE32 image');
  const count = bytes.readUInt16LE(nt + 6),
    optionalSize = bytes.readUInt16LE(nt + 20),
    imageBase = bytes.readUInt32LE(nt + 52),
    sections = [];
  for (let i = 0; i < count; i++) {
    const at = nt + 24 + optionalSize + i * 40;
    sections.push({
      name: bytes
        .subarray(at, at + 8)
        .toString('ascii')
        .replace(/\0.*$/, ''),
      va: imageBase + bytes.readUInt32LE(at + 12),
      virtualSize: bytes.readUInt32LE(at + 8),
      rawSize: bytes.readUInt32LE(at + 16),
      rawOffset: bytes.readUInt32LE(at + 20),
      executable: !!(bytes.readUInt32LE(at + 36) & 0x20000000),
    });
  }
  return {
    imageBase,
    sections,
    offset(va, size = 1) {
      const section = sections.find((s) => va >= s.va && va + size <= s.va + s.rawSize);
      if (!section) throw new Error(`VA ${hex(va)} has no file-backed range`);
      return section.rawOffset + va - section.va;
    },
    executable(va) {
      return sections.some((s) => s.executable && va >= s.va && va < s.va + s.virtualSize);
    },
  };
}

export function readPointerTable(bytes, pe, name, va, count) {
  const offset = pe.offset(va, (count + 1) * 4),
    entries = [],
    aliases = new Map();
  for (let id = 0; id < count; id++) {
    const pointer = bytes.readUInt32LE(offset + id * 4);
    if (!pe.executable(pointer)) throw new Error(`${name}[${id}] is not executable`);
    const handlerVA = hex(pointer);
    entries.push({ id, handlerVA });
    if (!aliases.has(handlerVA)) aliases.set(handlerVA, []);
    aliases.get(handlerVA).push(id);
  }
  if (bytes.readUInt32LE(offset + count * 4) !== 0)
    throw new Error(`${name} expected NULL terminator after ${count} entries`);
  return {
    name,
    tableVA: hex(va),
    count,
    terminator: 0,
    distinctHandlers: aliases.size,
    aliases: [...aliases]
      .filter(([, ids]) => ids.length > 1)
      .map(([handlerVA, ids]) => ({ handlerVA, ids })),
    entries,
  };
}

// Instruction widths are part of the bytecode format; no VM state is read.
const unary = new Set([
  8, 12, 22, 23, 24, 25, 26, 37, 38, 39, 40, 41, 46, 47, 49, 50, 54, 55, 56, 57, 61, 66, 68,
]);
const nullary = new Set([0, 45, 51, 58, 59, 60]);

export async function readNativeCorpus(root) {
  const game = await nodeGame(root),
    scripts = [],
    calls = new Map();
  for (const name of game.names('kcs')) {
    const bytes = await game.require(name),
      script = await readKCS(bytes);
    const sourcePath = game.index.get(name).path,
      header = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength),
      scriptVersion = ((header.getUint16(8, true) << 16) | header.getUint16(10, true)) >>> 0,
      bindingHint = /(^|\/)mot\.int$/i.test(sourcePath)
        ? 'generic'
        : /(^|\/)(ptcl(?:\.int|\/))/i.test(sourcePath)
          ? scriptVersion === 0x20000
            ? 'particle-v2'
            : 'particle-v1'
          : 'main';
    let pc = 0,
      callCount = 0;
    while (pc < script.codeSize) {
      const op = script.body.u8(pc);
      if (op > 68 || op === 63 || op === 64)
        throw new Error(`${name}:${hex(pc)} invalid opcode ${op}`);
      const count = nullary.has(op) ? 0 : unary.has(op) ? 1 : op === 53 ? 3 : 2,
        size = 1 + count * 5;
      if (pc + size > script.codeSize) throw new Error(`${name}:${hex(pc)} truncated instruction`);
      if (op === 43) {
        const idMode = script.body.u8(pc + 1),
          byteMode = script.body.u8(pc + 6);
        if (idMode !== 3 || byteMode !== 3)
          throw new Error(`${name}:${hex(pc)} dynamic native operands need separate analysis`);
        const id = script.body.u32(pc + 2),
          argumentBytes = script.body.u32(pc + 7);
        if (argumentBytes % 4) throw new Error(`${name}:${hex(pc)} unaligned native arguments`);
        const key = `${bindingHint}:${id}`;
        if (!calls.has(key)) calls.set(key, { table: bindingHint, id, sites: [] });
        calls.get(key).sites.push({ script: name, pc: hex(pc), argumentWords: argumentBytes / 4 });
        callCount++;
      }
      pc += size;
    }
    scripts.push({
      name,
      sourcePath,
      bindingHint,
      scriptVersion: hex(scriptVersion),
      sha256: hash(bytes),
      codeBytes: script.codeSize,
      nativeCallSites: callCount,
    });
  }
  return {
    scriptCount: scripts.length,
    scripts,
    nativeIds: [...calls.values()]
      .sort((a, b) => a.table.localeCompare(b.table) || a.id - b.id)
      .map(({ table, id, sites }) => ({
        table,
        id,
        argumentCounts: [...new Set(sites.map((s) => s.argumentWords))].sort((a, b) => a - b),
        sites,
      })),
  };
}

async function main() {
  const args = process.argv.slice(2),
    value = (name) => {
      const i = args.indexOf(name);
      if (i < 0 || !args[i + 1]) throw new Error(`Required argument: ${name} <path>`);
      return resolve(args[i + 1]);
    };
  const fixtureRoot = value('--fixture-root'),
    output = value('--output'),
    includeCorpus = args.includes('--corpus');
  const inventories = [];
  for (const source of sources) {
    const path = resolve(fixtureRoot, source.path),
      bytes = await readFile(path),
      sha256 = hash(bytes);
    if (sha256 !== source.sha256) throw new Error(`${source.id}: source SHA-256 mismatch`);
    const pe = readPE(bytes),
      tables = Object.entries(source.tables).map(([name, va]) =>
        readPointerTable(bytes, pe, name, va, source.counts[name]),
      );
    inventories.push({
      id: source.id,
      path,
      sha256,
      imageBase: hex(pe.imageBase),
      tables,
      ...(includeCorpus
        ? { corpus: await readNativeCorpus(resolve(fixtureRoot, source.scriptRoot)) }
        : {}),
    });
  }
  await mkdir(dirname(output), { recursive: true });
  await writeFile(
    output,
    `${JSON.stringify({ kind: 'CatSystem2 static native inventory', inventories }, null, 2)}\n`,
  );
  process.stdout.write(
    `${JSON.stringify(
      inventories.map((s) => ({
        source: s.id,
        tables: s.tables.map((t) => ({
          name: t.name,
          slots: t.count,
          handlers: t.distinctHandlers,
        })),
        ...(s.corpus
          ? { scripts: s.corpus.scriptCount, referencedNatives: s.corpus.nativeIds.length }
          : {}),
      })),
      null,
      2,
    )}\n`,
  );
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) await main();
