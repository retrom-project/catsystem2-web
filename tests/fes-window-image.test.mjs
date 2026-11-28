// SPDX-License-Identifier: MPL-2.0
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { composeFESWindow } from '../src/native/fes-window-image.mjs';
import { FESImageCache } from '../src/native/fes-image-cache.mjs';
import { dataWorld } from './fixtures/data-world.mjs';
import { hg3 } from './helpers.mjs';
const fixture = JSON.parse(
  await readFile(new URL('./fixtures/fes-window-image.json', import.meta.url), 'utf8'),
);
function encoded(missing) {
  const selected = fixture.inputs.filter(({ id }) => !missing.includes(id)),
    frames = selected.map(({ width, height, rgba }) => hg3(width, height, Uint8Array.from(rgba))),
    bytes = new Uint8Array(12 + frames.reduce((size, frame) => size + frame.length - 12, 0));
  bytes.set(frames[0].subarray(0, 12));
  let at = 12;
  for (const [index, frame] of frames.entries()) {
    const body = frame.slice(12),
      view = new DataView(body.buffer);
    view.setUint32(0, index + 1 < frames.length ? body.length : 0, true);
    view.setUint32(4, selected[index].id, true);
    bytes.set(body, at);
    at += body.length;
  }
  return bytes;
}

test('IMGWND matches both originals for asymmetric unequal tiles, partial repeats and absent frames without an EXE', async () => {
  for (const expected of fixture.outputs)
    for (const profile of expected.profiles) {
      const world = await dataWorld(
          profile,
          { 'window.hg3': encoded(expected.missing) },
          { initialize: false },
        ),
        images = world.graphics.images,
        cache = new FESImageCache(world, 71),
        seen = [];
      try {
        const handle = await composeFESWindow(
            images,
            expected.width,
            expected.height,
            (id) => {
              seen.push(id);
              return cache.load('window.hg3', id);
            },
            71,
          ),
          bitmap = images.get(handle);
        assert.equal(bitmap.owner, 71);
        assert.equal(bitmap.state.bpp, 4);
        assert.equal(Buffer.from(await bitmap.pixels()).toString('hex'), expected.rgbaHex);
        assert.deepEqual(seen, [0, 1, 2, 3, 4, 5, 6, 7, 8]);
        assert.equal(
          [...world.runtime.handles.records.values()].filter((record) => record.type === 'bitmap')
            .length,
          1,
        );
        await images.release(handle);
      } finally {
        cache.close();
        await world.close();
      }
    }
});

test('an owned window bitmap survives a fresh World without reconstructing tiles or advancing the cache', async () => {
  const expected = fixture.outputs[0],
    profile = expected.profiles[0],
    world = await dataWorld(profile, { 'window.hg3': encoded([]) }),
    cache = new FESImageCache(world, world.main.id);
  let fresh, restored;
  try {
    const handle = await composeFESWindow(
        world.graphics.images,
        13,
        11,
        (id) => cache.load('window.hg3', id),
        world.main.id,
      ),
      entries = cache.snapshot(),
      saved = structuredClone(world.snapshot());
    fresh = await dataWorld(profile, {}, { initialize: false });
    await fresh.restore(saved);
    restored = new FESImageCache(fresh, fresh.main.id, entries);
    const image = fresh.graphics.images.get(handle);
    assert.equal(Buffer.from(await image.pixels()).toString('hex'), expected.rgbaHex);
    assert.deepEqual(restored.snapshot(), entries);
    assert.deepEqual(image.snapshot(), world.graphics.images.get(handle).snapshot());
  } finally {
    restored?.close();
    cache.close();
    await fresh?.close();
    await world.close();
  }
});

test('tile I/O failure and undefined nonprogressing tile geometry release all partial bitmap ownership', async () => {
  const world = await dataWorld(fixture.outputs[0].profiles[0], {}, { initialize: false }),
    images = world.graphics.images,
    count = () =>
      [...world.runtime.handles.records.values()].filter((record) => record.type === 'bitmap')
        .length;
  try {
    await assert.rejects(
      composeFESWindow(images, 5, 5, async (id) => {
        if (id === 2) throw new Error('Read failed');
        return images.create(1, 1);
      }),
      /Read failed/,
    );
    assert.equal(count(), 0);
    await assert.rejects(
      composeFESWindow(images, 5, 5, async (id) => (id === 4 ? images.create(1, 6) : 0)),
      /exceeds its target/,
    );
    assert.equal(count(), 0);
    await assert.rejects(
      composeFESWindow(images, 5, 5, async () => images.create(0, 1)),
      /zero extent/,
    );
    assert.equal(count(), 0);
  } finally {
    await world.close();
  }
});
