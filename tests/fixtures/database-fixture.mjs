// SPDX-License-Identifier: MPL-2.0
// Authored compiled KCDB tables, independent of any game's database assets.
import { deflateSync } from 'node:zlib';
import { encodeCP932 } from '../../src/kcs/strings.mjs';
import { NativeEngineProcess } from '../../src/native/engine-process.mjs';
import { NativeEngineFiles } from '../../src/native/engine-files.mjs';
import { NativeDataBuffers } from '../../oracle/data-buffer.mjs';
import { NativeDatabases, nativeDatabaseCodec } from '../../oracle/database.mjs';
import { NativeHandles } from '../../src/native/handles.mjs';
import { KCSMachine, readKCS } from '../../src/kcs.mjs';
import { kcsProgram } from '../helpers.mjs';
export const DATABASE_COLUMNS = Object.freeze([
  ['ID', 4],
  ['TITLE_S', 64],
  ['TITLE', 256],
  ['IND1', 128],
  ['IND24', 128],
  ['INDEX', 256],
]);
export function compiledDatabase(rows, columns = DATABASE_COLUMNS) {
  const stride = columns.reduce((sum, [, size]) => sum + size, 0),
    body = new Uint8Array(4 + columns.length * 24 + 8 + stride * rows.length),
    view = new DataView(body.buffer);
  view.setUint32(0, columns.length, true);
  columns.forEach(([name, size], i) => {
    body.set(encodeCP932(name), 4 + i * 24);
    view.setUint32(4 + i * 24 + 16, name === 'ID' ? 1 : 0, true);
    view.setUint32(4 + i * 24 + 20, size, true);
  });
  const data = 4 + columns.length * 24;
  view.setUint32(data, rows.length, true);
  view.setUint32(data + 4, stride, true);
  rows.forEach((row, index) => {
    let at = data + 8 + index * stride;
    for (const [name, size] of columns) {
      if (name === 'ID') view.setUint32(at, row[name] >>> 0, true);
      else {
        const bytes = row[name] instanceof Uint8Array ? row[name] : encodeCP932(row[name] ?? '');
        if (bytes.length > size || (!(row[name] instanceof Uint8Array) && bytes.length === size))
          throw new Error(`Authored database ${name} exceeds its field`);
        body.set(bytes, at);
      }
      at += size;
    }
  });
  const compressed = deflateSync(body),
    file = new Uint8Array(12 + compressed.length),
    header = new DataView(file.buffer);
  header.setUint32(0, 0x4244434b, true);
  header.setUint32(4, compressed.length, true);
  header.setUint32(8, body.length, true);
  file.set(compressed, 12);
  return file;
}
export const DATABASE_ROWS = Object.freeze([
  {
    ID: 1,
    TITLE_S: 'First',
    TITLE: 'First authored entry',
    IND1: 'text\\nline',
    IND24: 'last',
    INDEX: 'zeta',
  },
  { ID: 2, TITLE_S: '日本語', TITLE: '日本語の項目', IND1: 'あいうえお', INDEX: '猫' },
  { ID: 3, TITLE_S: 'Long title', TITLE: 'another entry', INDEX: 'alpha' },
]);

export async function databaseFixture(
  bytes,
  profile,
  files = new Map([['authored', compiledDatabase(DATABASE_ROWS)]]),
) {
  const engine = await NativeEngineProcess.open({ bytes, profile, readFile: async () => null }),
    handles = new NativeHandles(),
    world = {
      profile,
      runtime: { handles },
      objects: { machine: () => null },
      game: {
        read: async () => null,
        readCategory: async (name, category) =>
          category === 'database' ? (files.get(name) ?? null) : null,
      },
    };
  handles.registerType('database', nativeDatabaseCodec);
  world.getNativeFeature = async (name) => {
    const existing = engine.features.get(name);
    if (existing) return existing;
    if (name === 'data-buffers') return new NativeDataBuffers(engine, { handles });
    throw new Error(`Authored database fixture has no feature ${name}`);
  };
  new NativeEngineFiles(engine, world);
  const database = new NativeDatabases(engine, world),
    machine = new KCSMachine(await readKCS(kcsProgram([[59]])), {}, new Uint8Array(1024));
  return { engine, handles, world, database, machine, files };
}

export function databaseState(p, pointer) {
  const string = (at) => {
      const size = p.load(at + 16),
        capacity = p.load(at + 20),
        data = capacity < 16 ? at : p.load(at);
      return { size, capacity, bytes: p.read(data, size + 1) };
    },
    tree = p.load(pointer),
    head = p.load(tree),
    rows = [],
    visit = (node) => {
      if (node === head) return;
      visit(p.load(node));
      rows.push({
        key: string(node + 16),
        id: p.load(node + 40),
        titleShort: string(p.load(node + 44)),
        title: string(p.load(node + 48)),
        indices: Array.from({ length: 24 }, (_, i) => {
          const at = p.load(node + 52 + i * 4);
          return at ? string(at) : null;
        }),
        flags: [148, 152, 156].map((at) => p.load(node + at)),
        color: p.read(node + 12, 2),
      });
      visit(p.load(node + 8));
    };
  visit(p.load(head + 4));
  return {
    count: p.load(tree + 4),
    dirty: p.load(pointer + 76),
    options: [4, 28, 52].map((at) => string(pointer + at)),
    rows,
  };
}
