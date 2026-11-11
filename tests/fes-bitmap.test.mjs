// SPDX-License-Identifier: MPL-2.0
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { copyFESBitmapRectangle } from '../src/native/fes-bitmap.mjs';
import { dataWorld } from './fixtures/data-world.mjs';
const fixture = JSON.parse(
  await readFile(new URL('./fixtures/fes-bitmap.json', import.meta.url), 'utf8'),
);

test('FES snapshot copies match both original physical-row copies for RGB24/ARGB32 and partial source clipping', async () => {
  for (const expected of fixture.outputs)
    for (const profile of expected.profiles) {
      const world = await dataWorld(profile, {}, { initialize: false }),
        images = world.graphics.images,
        sourceHandle = images.create(...fixture.sourceSize),
        source = images.get(sourceHandle),
        pixels = await source.pixels();
      source.state.bpp = expected.bpp;
      for (let y = 0; y < source.height; y++)
        for (let x = 0; x < source.width; x++)
          pixels.set([120 + x * 4, y * 8, x + y, 255], (y * source.width + x) * 4);
      await source.changed();
      try {
        const handle = await copyFESBitmapRectangle(images, sourceHandle, expected.rectangle, 91),
          output = images.get(handle);
        assert.equal(output.owner, 91);
        assert.equal(output.state.bpp, expected.bpp);
        assert.deepEqual([output.width, output.height], [expected.width, expected.height]);
        assert.deepEqual([...(await output.pixels())], expected.rgba);
        await source.fill(0, 0, source.width, source.height, 0xffffffff);
        assert.deepEqual(
          [...(await output.pixels())],
          expected.rgba,
          'the snapshot owns independent pixels',
        );
        await images.release(handle);
        await images.release(sourceHandle);
        assert.equal(
          [...world.runtime.handles.records.values()].filter((record) => record.type === 'bitmap')
            .length,
          0,
        );
      } finally {
        await world.close();
      }
    }
});
