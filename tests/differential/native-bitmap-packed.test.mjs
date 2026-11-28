// SPDX-License-Identifier: MPL-2.0
import test from 'node:test';
import assert from 'node:assert/strict';
import { dataWorld } from '../fixtures/data-world.mjs';
import { engineFixtureSet } from '../fixtures/oracle-fixtures.mjs';
import { imageCommandsFixture } from '../fixtures/image-commands-fixture.mjs';
const fields = [
  'width',
  'height',
  'canvasWidth',
  'canvasHeight',
  'offsetX',
  'offsetY',
  'baseX',
  'baseY',
  'bpp',
  'alphaHint',
  'mask',
];
async function state(image) {
  const rgba = await image.pixels();
  return {
    fields: fields.map((k) => image.state[k] ?? 0),
    clip: [...image.state.clip],
    attrs: image.state.attributes ?? [],
    rgba: [...rgba],
  };
}
for (const fixture of await engineFixtureSet())
  test(
    fixture.profile + ' packed RGB24/RGBA4444 and initialized blur retain exact bytes',
    { skip: fixture.available ? false : fixture.reason },
    async () => {
      const world = await dataWorld(fixture.profile),
        oracle = await imageCommandsFixture(fixture.bytes, fixture.profile),
        p = oracle.process;
      try {
        const allocate = oracle.engine.kernel.heapAllocate.bind(oracle.engine.kernel);
        oracle.engine.kernel.heapAllocate = (heap, flags, size, ...rest) => {
          const ptr = allocate(heap, flags, size, ...rest);
          if (ptr && !(flags & 8)) p.write(ptr, new Uint8Array(size));
          return ptr;
        };
        for (const bpp of [2, 3]) {
          const handles = [world.graphics.images.create(4, 4), oracle.images.create(4, 4)],
            images = [world.graphics.images, oracle.images];
          const ptr = await oracle.memory.pointer(handles[1]);
          oracle.buffers.releaseData(p.load(ptr + 12));
          p.store(ptr + 12, 0);
          p.store(ptr + 16, 0);
          await oracle.memory.call(oracle.memory.layout.configure, [4, 4, bpp], ptr);
          for (let side = 0; side < 2; side++) {
            const image = images[side].get(handles[side]);
            Object.assign(image.state, {
              bpp,
              canvasWidth: 8,
              canvasHeight: 8,
              offsetX: 1,
              offsetY: 1,
              baseX: 1,
              baseY: -2,
              alphaHint: 0,
            });
            const rgba = await image.pixels();
            for (let at = 0; at < rgba.length; at++)
              rgba[at] =
                bpp === 2 ? ((at * 7 + 3) % 16) * 17 : at % 4 === 3 ? 255 : (at * 31 + 3) & 255;
            await image.changed();
          }
          for (const [id, args] of [
            [0x171, [0x80804020]],
            [0x178, [1]],
            [0x281, [50]],
            [0x172, [1, 1]],
            [0x179, []],
            [0x22e, [1]],
            [0x1d4, [90]],
            [0x7a, [16, 16]],
            ...(bpp === 3
              ? [
                  [0x21a, [1, 0]],
                  [0x21a, [0, 1]],
                ]
              : []),
          ]) {
            const actual = await world.runtime.native(
                'main',
                id,
                [handles[0], ...args],
                world.main.machine,
                world.main,
              ),
              expected = await (id === 0x21a ? oracle.commands : oracle.operations).apply(
                id,
                [handles[1], ...args],
                oracle.machine,
                world.main,
              );
            assert.deepEqual(actual, expected, bpp + '/' + id.toString(16) + ' reply');
            assert.deepEqual(
              await state(images[0].get(handles[0])),
              await state(images[1].get(handles[1])),
              bpp + '/' + id.toString(16),
            );
          }
        }
      } finally {
        await world.close();
        await oracle.engine.close();
      }
    },
  );
