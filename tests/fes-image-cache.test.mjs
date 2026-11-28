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
    assert.equal(fresh.runtime.imageDataBuffers.words(first)[3], 2);
    assert.deepEqual(fresh.runtime.imageDataBuffers.data(first), bytes);
    fresh.runtime.imageDataBuffers.releasePointer(first);
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

for (const result of ['null', 'bytes']) {
  test(`FES lazy miss ${result} keeps its read result when a resident is inserted during I/O`, async () => {
    const bytes = Uint8Array.of(11, 22, 33, 44, 55, 66, 77, 88, 99),
      residentBytes = Uint8Array.of(240, 241, 242),
      world = await dataWorld(profiles[0], {}, { initialize: false }),
      cache = new FESImageCache(world, 12),
      buffers = world.runtime.imageDataBuffers;
    let results = [];
    try {
      let entered;
      const started = new Promise((resolve) => {
          entered = resolve;
        }),
        settle = [];
      world.game.readCategory = () =>
        new Promise((resolve) => {
          settle.push(resolve);
          if (settle.length === 2) entered();
        });
      const first = cache.data('key'),
        second = cache.data('key');
      assert.throws(() => cache.snapshot(), /settled resource I\/O/);
      assert.throws(() => cache.close(), /settled resource I\/O/);
      await started;
      assert.equal(settle.length, 2);
      const inserted = buffers.createPointer(residentBytes);
      cache.insert('key', inserted);
      buffers.releasePointer(inserted);
      assert.equal(buffers.words(inserted)[3], 1);
      for (const resolve of settle) resolve(result === 'null' ? null : bytes);
      results = await Promise.all([first, second]);
      if (result === 'null') {
        assert.deepEqual(results, [0, 0], 'an entry-time miss cannot acquire a late resident');
        assert.equal(buffers.pointers.size, 1);
      } else {
        assert.notEqual(
          results[0],
          inserted,
          'read bytes own a new descriptor, not the late resident',
        );
        assert.notEqual(results[1], inserted);
        assert.notEqual(results[0], results[1], 'independent reads own distinct descriptors');
        for (const pointer of results) {
          assert.equal(buffers.words(pointer)[3], 1);
          assert.equal(buffers.words(pointer)[1], 16);
          assert.deepEqual(buffers.data(pointer).subarray(0, bytes.length), bytes);
        }
        assert.equal(buffers.pointers.size, 3);
        buffers.releasePointer(results[0]);
        assert.equal(buffers.owns(results[0]), false);
        assert.equal(buffers.words(results[1])[3], 1);
        assert.equal(buffers.words(inserted)[3], 1);
        buffers.releasePointer(results[1]);
        assert.equal(buffers.owns(results[1]), false);
        assert.equal(buffers.words(inserted)[3], 1);
        results = [];
      }
      assert.deepEqual(cache.snapshot(), [['key', inserted]]);
      assert.deepEqual(buffers.data(inserted), residentBytes);
      assert.equal(
        buffers.words(inserted)[3],
        1,
        'miss results never change the late map reference',
      );
      const hit = await cache.data('key');
      assert.equal(hit, inserted, 'a later entry-time resident hit still retains normally');
      assert.equal(buffers.words(inserted)[3], 2);
      buffers.releasePointer(hit);
      assert.equal(buffers.words(inserted)[3], 1);
      assert.equal(settle.length, 2, 'the actual resident hit performs no third I/O');
      cache.close();
      assert.equal(buffers.owns(inserted), false);
    } finally {
      for (const pointer of results) buffers.releasePointer(pointer);
      cache.close();
      await world.close();
    }
  });
}
