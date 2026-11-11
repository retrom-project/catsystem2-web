// SPDX-License-Identifier: MPL-2.0
import test from 'node:test';
import assert from 'node:assert/strict';
import { FESImageCache } from '../src/native/fes-image-cache.mjs';
import { dataWorld } from './fixtures/data-world.mjs';
import { hg3 } from './helpers.mjs';
import { encodeHG2 } from '../src/formats/hg2.mjs';
const profiles = ['sdk-4.01-engine-2.6.1.74', 'nekopara-vol3-engine-2.6.1.76'];
function authored() {
  const pixels = Uint8Array.from([20, 40, 60, 255, 70, 80, 90, 255]),
    bytes = hg3(2, 1, pixels),
    view = new DataView(bytes.buffer);
  for (const [offset, value] of [
    [12, 3],
    [16, 4],
    [20, 10],
    [24, 12],
    [32, 7],
    [36, 11],
  ])
    view.setInt32(36 + offset, value, true);
  return { bytes, pixels };
}
test('FES encoded-byte cache decodes exact selectors and complete metadata into independent owned bitmaps without an EXE', async () => {
  const { bytes, pixels } = authored();
  for (const profile of profiles) {
    const world = await dataWorld(profile, { 'image.hg3': bytes }, { initialize: false }),
      cache = new FESImageCache(world, 73);
    try {
      const first = await cache.load('image.hg3'),
        second = await cache.load('image.hg3'),
        images = world.graphics.images,
        a = images.get(first),
        b = images.get(second);
      assert.notEqual(first, second);
      assert.notEqual(a.dataHandle, b.dataHandle);
      assert.equal(a.owner, 73);
      assert.deepEqual(
        [
          a.state.offsetX,
          a.state.offsetY,
          a.state.canvasWidth,
          a.state.canvasHeight,
          a.state.baseX,
          a.state.baseY,
        ],
        [3, 4, 10, 12, 7, 11],
      );
      assert.deepEqual(await a.pixels(), new Uint8ClampedArray(pixels));
      await a.fill(0, 0, 1, 1, 0xff123456);
      assert.deepEqual(await b.pixels(), new Uint8ClampedArray(pixels));
      assert.equal(
        await cache.load('image.hg3', 5),
        0,
        'missing frame must not fall back to the first frame',
      );
      assert.equal(await cache.load('missing.hg3'), 0);
      const frame24 = await encodeHG2(
          { width: 2, height: 1, rgba: pixels, bpp: 3 },
          { crop: false },
        ),
        pointer = world.runtime.imageDataBuffers.createPointer(frame24);
      cache.insert('inserted.hg2', pointer);
      world.runtime.imageDataBuffers.releasePointer(pointer);
      const rgb = images.get(await cache.load('inserted.hg2'));
      assert.equal(rgb.state.bpp, 3);
      assert.deepEqual(await rgb.pixels(), new Uint8ClampedArray(pixels));
    } finally {
      cache.close();
      await world.close();
    }
  }
});

test('FES cache retains only its first inserted descriptor and reconstructs through a fresh World', async () => {
  const { bytes } = authored(),
    world = await dataWorld(profiles[0]),
    cache = new FESImageCache(world, world.main.id);
  let fresh, restored;
  try {
    const buffers = world.runtime.imageDataBuffers,
      first = buffers.createPointer(bytes),
      unused = buffers.createPointer(bytes);
    cache.insert('key', first);
    cache.insert('key', unused);
    assert.equal(buffers.words(first)[3], 2);
    assert.equal(buffers.words(unused)[3], 1);
    buffers.releasePointer(first);
    buffers.releasePointer(unused);
    const saved = structuredClone(world.snapshot()),
      entries = cache.snapshot();
    fresh = await dataWorld(profiles[0], {}, { initialize: false });
    await fresh.restore(saved);
    restored = new FESImageCache(fresh, 12, entries);
    assert.equal(await restored.data('key'), first);
    assert.deepEqual(fresh.runtime.imageDataBuffers.data(first), bytes);
    assert.deepEqual(
      await fresh.graphics.images.get(await restored.load('key')).pixels(),
      await world.graphics.images.get(await cache.load('key')).pixels(),
    );
    restored.close();
    assert.equal(fresh.runtime.imageDataBuffers.owns(first), false);
  } finally {
    if (restored?.entries.size) restored.close();
    cache.close();
    await fresh?.close();
    await world.close();
  }
});

test('FES cache coalesces pending reads and preserves insertion during I/O without retaining a second descriptor', async () => {
  const { bytes } = authored(),
    world = await dataWorld(profiles[0], {}, { initialize: false }),
    cache = new FESImageCache(world, 12);
  try {
    let settle,
      reads = 0;
    world.game.readCategory = () => {
      reads++;
      return new Promise((resolve) => {
        settle = resolve;
      });
    };
    const first = cache.data('key'),
      second = cache.data('key');
    assert.equal(reads, 1);
    assert.throws(() => cache.snapshot(), /settled resource I\/O/);
    const inserted = world.runtime.imageDataBuffers.createPointer(bytes);
    cache.insert('key', inserted);
    world.runtime.imageDataBuffers.releasePointer(inserted);
    settle(null);
    assert.equal(await first, inserted);
    assert.equal(await second, inserted);
    assert.deepEqual(cache.snapshot(), [['key', inserted]]);
    assert.equal(world.runtime.imageDataBuffers.pointers.size, 1);
  } finally {
    cache.close();
    await world.close();
  }
});
