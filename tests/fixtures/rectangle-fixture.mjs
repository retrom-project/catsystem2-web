// SPDX-License-Identifier: MPL-2.0
import { NativeEngineProcess } from '../../src/native/engine-process.mjs';
import { NativeRectangles } from '../../oracle/rectangles.mjs';
import { NativeKCSMemory } from '../../src/native/kcs-memory.mjs';
import { configurationQueryMachine } from './configuration-query-fixture.mjs';

export const RECTANGLE_INPUTS = Object.freeze([
  [0, 0, 0, 0],
  [0, 0, 1, 1],
  [-9, -7, 5, 8],
  [10, 20, -10, 50],
  [0, 10, 20, -10],
  [-2147483648, -2147483648, 2147483647, 2147483647],
  [2147483647, 2147483647, -2147483648, -2147483648],
  [0, 0, -1, -1],
  [-1, -1, 0, 0],
  [1, 0, 1, 17],
  [0, 9, 12, 9],
]);
export async function rectangleFixture(bytes, profile) {
  const engine = await NativeEngineProcess.open({ bytes, profile }),
    p = engine.process,
    bitmaps = new Map(),
    world = {
      objects: { machine: () => null },
      getNativeFeature: async (name) => {
        if (name !== 'bitmap-memory') throw new Error('Unexpected rectangle fixture feature');
        return {
          wrapper: async (handle) => {
            if (!bitmaps.has(handle)) throw new Error('Unknown authored rectangle bitmap handle');
            return bitmaps.get(handle).wrapper;
          },
        };
      },
    },
    feature = new NativeRectangles(engine, world),
    machine = configurationQueryMachine();
  return {
    engine,
    process: p,
    feature,
    machine,
    bitmaps,
    bitmap(
      handle,
      width,
      height,
      { empty = false, canvasWidth = width + 31, canvasHeight = height + 19, offset = -27 } = {},
    ) {
      let record = bitmaps.get(handle);
      if (!record) {
        record = { wrapper: p.allocate(4, true), bitmap: p.allocate(92, true) };
        bitmaps.set(handle, record);
      }
      p.store(record.wrapper, empty ? 0 : record.bitmap);
      p.store(record.bitmap + 4, width);
      p.store(record.bitmap + 8, height);
      p.store(record.bitmap + 28, canvasWidth);
      p.store(record.bitmap + 32, canvasHeight);
      p.store(record.bitmap + 36, offset);
      p.store(record.bitmap + 40, -offset);
      return record.wrapper;
    },
    async original(spec, args) {
      const words = [...args];
      while (words.length < spec.words) words.push(machine.nativeArgument(words.length));
      if (spec.id === 0xd8 && words[1]) words[1] = bitmaps.get(words[1]).wrapper;
      const bridge = new NativeKCSMemory(p, machine),
        argv = p.allocate(words.length * 4),
        out = p.allocate(12);
      try {
        words.forEach((word, i) => p.store(argv + i * 4, word));
        p.write(out, new Uint8Array(12).fill(0xcc));
        const control = await engine.call(spec.handlers[Number(profile.startsWith('sdk-'))], [
          bridge.pointer,
          0,
          argv,
          out + 4,
        ]);
        return { control, result: p.read(out, 12) };
      } finally {
        bridge.close();
        p.free(out);
        p.free(argv);
      }
    },
  };
}
