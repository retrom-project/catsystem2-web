// SPDX-License-Identifier: MPL-2.0
import { NativeEngineProcess } from '../../src/native/engine-process.mjs';
import { NativeDataBuffers } from '../../src/native/data-buffer.mjs';
import { NativeEngineFiles } from '../../src/native/engine-files.mjs';
import { NativeImageFiles } from '../../src/native/image-file.mjs';
import { configurationQueryMachine } from './configuration-query-fixture.mjs';
import { encodeCP932 } from '../../src/kcs/strings.mjs';

export const IMAGE_FILE_LAYOUTS = Object.freeze({
  'nekopara-vol3-engine-2.6.1.76': Object.freeze({
    handler: 0x644570,
    predicate: 0x6767f0,
    mapOffset: 268,
    mapConstruct: 0x726f40,
    mapLoad: 0x727010,
    mapDestroy: 0x726fd0,
  }),
  'sdk-4.01-engine-2.6.1.74': Object.freeze({
    handler: 0x51cc20,
    predicate: 0x54d8d0,
    mapOffset: 204,
    mapConstruct: 0x5d75c0,
    mapLoad: 0x5d7690,
    mapDestroy: 0x5d7650,
  }),
});
export function imageFilePath(path) {
  return path
    .replaceAll('\\', '/')
    .replace(/^@cat\/image\//, '')
    .toLowerCase();
}
export async function imageFileFixture(bytes, profile) {
  const requests = [],
    files = new Map(),
    engine = await NativeEngineProcess.open({ bytes, profile }),
    p = engine.process,
    layout = IMAGE_FILE_LAYOUTS[profile],
    view = p.allocate(0x118, true),
    buffers = new NativeDataBuffers(engine),
    world = {
      objects: { machine: () => null },
      game: {
        nativeResources: {
          resolve: (name, category) => (name === 'no-category' ? null : `@cat/${category}/${name}`),
        },
        async read(name) {
          requests.push(name);
          await Promise.resolve();
          return files.get(imageFilePath(name)) ?? null;
        },
      },
      getNativeFeature: async (name) =>
        name === 'graphics-platform'
          ? { refs: { view }, ensureRenderer: async () => {} }
          : name === 'data-buffers'
            ? buffers
            : engine.features.get(name),
    },
    engineFiles = new NativeEngineFiles(engine, world),
    feature = new NativeImageFiles(engine, world),
    machine = configurationQueryMachine();
  let map = 0;
  return {
    engine,
    process: p,
    world,
    files,
    requests,
    view,
    feature,
    machine,
    buffers,
    engineFiles,
    layout,
    async table(source) {
      if (map) {
        await engine.call(layout.mapDestroy, [], map);
        p.free(map);
        map = 0;
      }
      p.store(view + layout.mapOffset, 0);
      if (source === null) return;
      map = p.allocate(4, true);
      await engine.call(layout.mapConstruct, [], map);
      const bytes = encodeCP932(source),
        input = p.allocate(bytes.length + 1, true);
      try {
        p.write(input, bytes);
        const result = await engine.call(layout.mapLoad, [input, bytes.length], map);
        if (result !== 1) throw new Error('Authored ANM table was rejected by its original parser');
      } finally {
        p.free(input);
      }
      p.store(view + layout.mapOffset, map);
    },
    async close() {
      if (map) {
        await engine.call(layout.mapDestroy, [], map);
        p.free(map);
        map = 0;
      }
      await engine.close();
    },
  };
}
