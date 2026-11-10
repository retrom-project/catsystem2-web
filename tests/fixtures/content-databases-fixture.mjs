// SPDX-License-Identifier: MPL-2.0
// Authored KCDB question/selection/mission tables and independent native fixtures.
import { NativeEngineProcess } from '../../src/native/engine-process.mjs';
import { NativeEngineFiles } from '../../src/native/engine-files.mjs';
import { NativeDataBuffers } from '../../oracle/data-buffer.mjs';
import {
  NativeContentDatabases,
  nativeContentDatabaseCodec,
} from '../../oracle/content-databases.mjs';
import { NativeHandles } from '../../src/native/handles.mjs';
import { ParticleRandom } from '../../src/ppi/random.mjs';
import { NativeRandomMemory } from '../../src/native/random-memory.mjs';
import { KCSMachine, readKCS } from '../../src/kcs.mjs';
import { kcsProgram } from '../helpers.mjs';
export * from './content-database-data.mjs';
import { contentFiles } from './content-database-data.mjs';

export async function contentFixture(bytes, profile, files = contentFiles()) {
  const random = new ParticleRandom(),
    engine = await NativeEngineProcess.open({ bytes, profile, readFile: async () => null }),
    handles = new NativeHandles(),
    world = {
      profile,
      random,
      runtime: { handles },
      objects: { machine: () => null },
      game: {
        read: async () => null,
        readCategory: async (name, category) =>
          category === 'database' ? (files.get(name) ?? null) : null,
      },
    };
  handles.registerType('content-database', nativeContentDatabaseCodec);
  world.getNativeFeature = async (name) => {
    const existing = engine.features.get(name);
    if (existing) return existing;
    if (name === 'data-buffers') return new NativeDataBuffers(engine, { handles });
    throw new Error('Authored content fixture has no feature ' + name);
  };
  new NativeEngineFiles(engine, world);
  new NativeRandomMemory(engine, random);
  const content = new NativeContentDatabases(engine, world),
    machine = new KCSMachine(await readKCS(kcsProgram([[59]])), {}, new Uint8Array(1024));
  return { engine, handles, world, content, machine, files, random };
}
export function contentAllocations(process) {
  return [...process.allocations]
    .sort(([a], [b]) => a - b)
    .map(([pointer, size]) => ({ pointer, size, bytes: process.read(pointer, size) }));
}
