// SPDX-License-Identifier: MPL-2.0
import test from 'node:test';
import assert from 'node:assert/strict';
import { dataWorld } from '../fixtures/data-world.mjs';
import { engineFixtureSet } from '../fixtures/oracle-fixtures.mjs';
import {
  imageCompositeFixture,
  imageCompositeFiles,
} from '../fixtures/image-composite-fixture.mjs';
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
async function state(bitmap) {
  const rgba = await bitmap.pixels();
  return {
    fields: fields.map((k) => bitmap.state[k] ?? 0),
    clip: [...bitmap.state.clip],
    attrs: bitmap.state.attributes ?? [],
    rgba: [...rgba],
  };
}
for (const fixture of await engineFixtureSet())
  test(
    fixture.profile + ' independent JS selector factory preserves exact image composition',
    { skip: fixture.available ? false : fixture.reason },
    async () => {
      const { files } = imageCompositeFiles(),
        world = await dataWorld(fixture.profile, Object.fromEntries(files)),
        oracle = await imageCompositeFixture(fixture.bytes, fixture.profile);
      try {
        for (const file of [
          'single.hg3',
          'rgb.hg3',
          'missing.hg3',
          'broken.hg3',
          ...['x,1.hg3', 'x,1,2.hg3', 'x,,1,,,2.hg3', 'x,0,2.hg3', 'x,0,0.hg3', 'abc,1,2.hg3'],
        ]) {
          world.main.machine.writeString(file, 256);
          oracle.machine.writeString(file, 256);
          oracle.process.zero(oracle.process.stackTop - 0x6000, 0x6000);
          const a = await world.runtime.native(
              'main',
              0x1cc,
              [256],
              world.main.machine,
              world.main,
            ),
            b = await oracle.composites.apply(0x1cc, [256], oracle.machine, world.main);
          assert.equal(Boolean(a.value), Boolean(b.value), file + ' availability');
          assert.equal(a.control, b.control);
          if (a.value) {
            assert.deepEqual(
              await state(world.graphics.images.get(a.value)),
              await state(oracle.images.get(b.value)),
              file,
            );
            await world.graphics.images.release(a.value);
            await oracle.images.release(b.value);
          }
        }
        assert.equal(world.nativeEngine, undefined);
      } finally {
        await world.close();
        await oracle.engine.close();
      }
    },
  );
