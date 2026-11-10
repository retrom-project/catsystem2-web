// SPDX-License-Identifier: MPL-2.0
import test from 'node:test';
import assert from 'node:assert/strict';
import { imageCommandsFixture } from '../fixtures/image-commands-fixture.mjs';
import { dataWorld } from '../fixtures/data-world.mjs';
import { engineFixtureSet } from '../fixtures/oracle-fixtures.mjs';
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
    fixture.profile + ' JS transfers, clipping, attributes, lists and blur equal original pixels',
    { skip: fixture.available ? false : fixture.reason },
    async () => {
      const world = await dataWorld(fixture.profile),
        oracle = await imageCommandsFixture(fixture.bytes, fixture.profile),
        images = [world.graphics.images, oracle.images],
        machines = [world.main.machine, oracle.machine];
      const hs = images.map((i) => [i.create(4, 3), i.create(4, 3)]);
      oracle.machine.memory.set(world.main.machine.memory);
      try {
        for (let side = 0; side < 2; side++)
          for (let n = 0; n < 2; n++) {
            const image = images[side].get(hs[side][n]);
            await image.fill(0, 0, 4, 3, n ? 0x80102030 : 0xff998866);
            Object.assign(image.state, {
              canvasWidth: 8,
              canvasHeight: 7,
              offsetX: 1,
              offsetY: 2,
              baseX: 3,
              baseY: -1,
            });
            const rgba = await image.pixels();
            for (let at = 0; at < rgba.length; at++) rgba[at] = (at * 71 + 13 + n * 11) & 255;
            await image.changed();
          }
        async function run(id, args) {
          const results = [];
          for (let side = 0; side < 2; side++) {
            const words = args.map((v) =>
              v === 'dest' ? hs[side][0] : v === 'src' ? hs[side][1] : v,
            );
            results.push(
              side
                ? await oracle.commands.apply(id, words, machines[side], world.main)
                : await world.runtime.native('main', id, words, machines[side], world.main),
            );
          }
          assert.deepEqual(results[0], results[1], id.toString(16) + ' reply');
          assert.deepEqual(machines[0].memory, machines[1].memory, id.toString(16) + ' VM');
          for (let n = 0; n < 2; n++)
            assert.deepEqual(
              await state(images[0].get(hs[0][n])),
              await state(images[1].get(hs[1][n])),
              id.toString(16) + ' image ' + n,
            );
        }
        await run(0x73, ['dest', 0, 0, 3, 2, 'src', 0, 0, 3, 2]);
        await run(0x74, ['dest', 0, 0, 2, 2, 'src', 0, 0, 4, 3]);
        await run(0x1be, ['dest', 768]);
        await run(0x218, ['dest', 7, 768, 772, 776, 780, 784]);
        await run(0x219, ['dest', 'src']);
        for (const [x, y] of [
          [0, 0],
          [1, 0],
          [0, 1],
          [2, 2],
        ])
          await run(0x21a, ['dest', x, y]);
        assert.equal(world.nativeEngine, undefined);
      } finally {
        await world.close();
        await oracle.engine.close();
      }
    },
  );
