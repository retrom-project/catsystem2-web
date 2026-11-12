// SPDX-License-Identifier: MPL-2.0
import { nativeABI } from '../../src/native/abi/index.mjs';
import test from 'node:test';
import assert from 'node:assert/strict';
import { bitmapMemoryFixture } from '../fixtures/bitmap-memory-fixture.mjs';
import { dataWorld } from '../fixtures/data-world.mjs';
import { engineFixtureSet } from '../fixtures/oracle-fixtures.mjs';
import { NATIVE_EXE_PROFILES } from '../../src/native/catalog.mjs';
import { NATIVE_BITMAP_OPERATION_CONTRACTS } from '../../oracle/bitmap-operations.mjs';
const fields = [
  'width',
  'height',
  'bpp',
  'canvasWidth',
  'canvasHeight',
  'offsetX',
  'offsetY',
  'baseX',
  'baseY',
  'alphaHint',
  'mask',
  'blendType',
];
async function state(image) {
  const rgba = await image.pixels();
  return {
    fields: fields.map((k) => image.state[k] ?? 0),
    clip: [...image.state.clip],
    attributes: image.state.attributes ?? [],
    rgba: [...rgba],
  };
}
for (const fixture of await engineFixtureSet())
  test(
    fixture.profile +
      ' JS pixel and metadata command sequences equal the independent original table',
    { skip: fixture.available ? false : fixture.reason },
    async () => {
      const world = await dataWorld(fixture.profile),
        oracle = await bitmapMemoryFixture(fixture.bytes, fixture.profile);
      const images = [world.graphics.images, oracle.images],
        machines = [world.main.machine, oracle.machine];
      const hs = images.map((i) => i.create(4, 3, world.main.id));
      oracle.machine.memory.set(world.main.machine.memory);
      try {
        for (const spec of NATIVE_BITMAP_OPERATION_CONTRACTS)
          if (spec.handlers[Number(fixture.profile.startsWith('sdk-'))])
            assert.equal(
              oracle.process.load(
                NATIVE_EXE_PROFILES[fixture.profile].tables.main.va + spec.id * 4,
              ),
              spec.handlers[Number(fixture.profile.startsWith('sdk-'))],
            );
        for (let side = 0; side < 2; side++) {
          const image = images[side].get(hs[side]);
          await image.fill(0, 0, 4, 3, 0xff102030);
          const rgba = await image.pixels();
          for (let i = 0; i < rgba.length; i++) rgba[i] = (i * 71 + 13) & 255;
          image.state.attributes = [{ id: 7, rect: [10, -20, 30, -40], color: 0xff800123 }];
          await image.changed();
        }
        async function call(id, args) {
          const results = [];
          for (let side = 0; side < 2; side++) {
            const words = [hs[side], ...args];
            results.push(
              side
                ? await oracle.operations.apply(id, words, machines[side], world.main)
                : await world.runtime.native('main', id, words, machines[side], world.main),
            );
          }
          assert.deepEqual(results[0], results[1], id.toString(16) + ' reply');
          assert.deepEqual(machines[0].memory, machines[1].memory, id.toString(16) + ' VM');
          assert.deepEqual(
            await state(images[0].get(hs[0])),
            await state(images[1].get(hs[1])),
            id.toString(16) + ' image',
          );
        }
        for (const [id, args] of [
          [0x174, [7, 9]],
          [0x175, [-1, 2]],
          [0x176, [-3, 5]],
          [0x16a, [768, 772]],
          [0x16b, [768, 772]],
          [0x173, [768, 772]],
          [0x171, [0x8080fe41]],
          [0x178, [1]],
          [0x178, [2]],
          [0x178, [3]],
          [0x281, [128]],
          [0x172, [-1, 2]],
          [0x172, [50, 50]],
          [0x179, []],
          [0x17a, [0]],
          [0x179, []],
          [0x234, [17]],
          [0x22e, [1]],
          [0x22e, [0]],
          [0x1d4, [90]],
          [0x1d4, [180]],
          [0x1d4, [270]],
          [0x7a, [14, 18]],
        ])
          await call(id, args);
        if (nativeABI(world.profile).capabilities.bitmapColorQuery) await call(0x402, [0, 0]);
        assert.equal(world.nativeEngine, undefined);
      } finally {
        await world.close();
        await oracle.engine.close();
      }
    },
  );
