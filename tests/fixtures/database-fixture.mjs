// SPDX-License-Identifier: MPL-2.0
// Authored compiled KCDB tables, independent of any game's database assets.
import { NativeEngineProcess } from '../../src/native/engine-process.mjs';
import { NativeEngineFiles } from '../../src/native/engine-files.mjs';
import { NativeDataBuffers } from '../../oracle/data-buffer.mjs';
import { NativeDatabases, nativeDatabaseCodec } from '../../oracle/database.mjs';
import { NativeHandles } from '../../src/native/handles.mjs';
import { KCSMachine, readKCS } from '../../src/kcs.mjs';
import { kcsProgram } from '../helpers.mjs';
export { DATABASE_COLUMNS, compiledDatabase, DATABASE_ROWS } from './compiled-database-data.mjs';
import { compiledDatabase, DATABASE_ROWS } from './compiled-database-data.mjs';

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
