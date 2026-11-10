// SPDX-License-Identifier: MPL-2.0
import test from 'node:test';
import assert from 'node:assert/strict';
import { NativeBitmap, NativeImages, nativeImage, resampleBitmap } from '../src/native/image.mjs';
import { NativeHandles } from '../src/native/handles.mjs';

const bitmap = (pixels, width, height) =>
  new NativeBitmap(null, {
    width,
    height,
    bpp: 4,
    canvasWidth: width,
    canvasHeight: height,
    offsetX: 0,
    offsetY: 0,
    baseX: 0,
    baseY: 0,
    clip: [0, 0, width, height],
    attributes: [],
    rgba: new Uint8ClampedArray(pixels),
    source: null,
  });

test('bulk bitmap copies preserve cropped flipped rows and forward overlapping-alias writes', async () => {
  const backing = new Uint8ClampedArray(80).fill(0xa5),
    source = bitmap([], 2, 2),
    destination = bitmap([], 3, 2);
  source.state.rgba = backing.subarray(4, 20);
  destination.state.rgba = backing.subarray(32, 56);
  source.state.rgba.set([1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16]);
  await destination.blit(source, { dx: 1, copy: true, flipY: true });
  assert.deepEqual(
    [...destination.state.rgba],
    [165, 165, 165, 165, 9, 10, 11, 12, 13, 14, 15, 16, 165, 165, 165, 165, 1, 2, 3, 4, 5, 6, 7, 8],
  );
  assert.equal(backing[31], 0xa5);
  assert.equal(backing[56], 0xa5);
  const pixels = Uint8ClampedArray.from({ length: 16 }, (_, i) => i + 1),
    a = bitmap([], 4, 1),
    b = bitmap([], 4, 1);
  a.state.rgba = pixels;
  b.state.rgba = pixels.subarray();
  await b.blit(a, { dx: 1, width: 3, copy: true });
  assert.deepEqual([...pixels], [1, 2, 3, 4, 1, 2, 3, 4, 1, 2, 3, 4, 1, 2, 3, 4]);
  const self = bitmap(
    Array.from({ length: 16 }, (_, i) => i + 1),
    4,
    1,
  );
  await self.blit(self, { dx: 1, width: 3, copy: true });
  assert.deepEqual([...self.state.rgba], [1, 2, 3, 4, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12]);
});
function environment() {
  const handles = new NativeHandles(),
    events = [];
  const frames = [
    {
      id: 0,
      width: 2,
      height: 1,
      canvasWidth: 5,
      canvasHeight: 3,
      offsetX: 1,
      offsetY: 2,
      baseX: -2,
      baseY: 1,
      rgba: new Uint8ClampedArray([20, 40, 60, 255, 100, 120, 140, 128]),
    },
  ];
  const world = {
    profile: 'nekopara-vol3-engine-2.6.1.76',
    game: {
      resolveCategory: (file, category) =>
        category === 'image' && file === 'authored' ? 'image.int/authored.hg3' : null,
    },
    images: {
      load: async () => ({
        frame: (id) => frames.find((f) => f.id === id),
        decode: async () => {},
      }),
    },
    imageLoaded: (request) => events.push(request),
    runtime: { handles, services: { format: () => 'authored:0' } },
    graphics: {},
  };
  world.graphics.images = new NativeImages(world);
  return { world, images: world.graphics.images, events, handles };
}

test('bitmap allocation is transparent, load retains cropped and logical geometry, and missing selectors return zero', async () => {
  const { images, events } = environment(),
    empty = images.get(images.create(2, 3, 99));
  assert.deepEqual([...(await empty.pixels())], new Array(24).fill(0));
  const handle = await images.load('authored', 0, 42),
    image = images.get(handle);
  assert.deepEqual(
    [
      image.width,
      image.height,
      image.state.canvasWidth,
      image.state.canvasHeight,
      image.state.offsetX,
      image.state.offsetY,
      image.state.baseX,
      image.state.baseY,
    ],
    [2, 1, 5, 3, 1, 2, -2, 1],
  );
  assert.equal(await images.load('authored', 999), 0);
  assert.equal(await images.load('absent', 0), 0);
  assert.deepEqual(events, [{ file: 'authored', frameID: 0, owner: 42, native: 'image' }]);
});

test('blank images retain zero dimensions and clones follow native metadata initialization after fresh restore', async () => {
  const { images, handles } = environment();
  for (const [width, height] of [
    [0, 0],
    [0, 9],
    [9, 0],
    [2, 3],
  ]) {
    const handle = images.create(width, height, 73),
      bitmap = images.get(handle);
    assert.deepEqual([bitmap.state.canvasWidth, bitmap.state.canvasHeight], [0, 0]);
    assert.equal((await bitmap.pixels()).length, width * height * 4);
    bitmap.state.offsetX = 17;
    bitmap.state.baseY = -9;
    bitmap.state.clip = [1, 2, 3, 4];
    const copy = images.add(bitmap.clone());
    if (width && height) {
      assert.deepEqual(
        [images.get(copy).state.canvasWidth, images.get(copy).state.canvasHeight],
        [width, height],
      );
      assert.equal(images.get(copy).state.offsetX, 17);
      assert.equal(images.get(copy).state.baseY, -9);
    } else {
      assert.deepEqual(
        [images.get(copy).state.canvasWidth, images.get(copy).state.canvasHeight],
        [0, 0],
      );
      assert.equal(images.get(copy).state.offsetX, 0);
      assert.equal(images.get(copy).state.baseY, 0);
    }
    assert.deepEqual(images.get(copy).state.clip, [0, 0, width, height]);
    const next = environment();
    next.handles.restore(handles.snapshot());
    await images.releaseOwner(73);
    assert.deepEqual([next.images.get(copy).width, next.images.get(copy).height], [width, height]);
    await next.images.releaseOwner(73);
    assert.equal(next.handles.records.size, 0);
  }
});

test('native bitmap fill clips signed rectangles and preserves packed ARGB alpha', async () => {
  const image = bitmap(new Array(24).fill(0), 3, 2);
  assert.equal(await image.fill(-1, 0, 3, 1, 0x80112233), true);
  assert.deepEqual(
    [...(await image.pixels())],
    [17, 34, 51, 128, 17, 34, 51, 128, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0],
  );
  assert.equal(await image.fill(5, 5, 2, 2, 0xffffffff), false);
});

test('native tone uses unsigned integer lookup tables and leaves alpha intact', async () => {
  const image = bitmap([100, 80, 60, 33, 255, 1, 0, 128], 2, 1);
  await image.tone(50, 200, -1);
  assert.deepEqual([...(await image.pixels())], [50, 160, 255, 33, 127, 2, 0, 128]);
});

test('native CPU alpha blending preserves original integer rounding and transparent edge colors', async () => {
  const destination = bitmap([60, 80, 100, 40], 1, 1),
    source = bitmap([120, 160, 200, 127], 1, 1);
  await destination.blit(source);
  assert.deepEqual([...(await destination.pixels())], [110, 147, 184, 147]);
  const transparent = bitmap(new Array(12).fill(0), 3, 1);
  await transparent.blit(source, { dx: 1, alpha: 128 });
  assert.deepEqual(
    [...(await transparent.pixels())],
    [120, 160, 200, 0, 120, 160, 200, 64, 120, 160, 200, 0],
  );
});

test('CPU clipping retains the native independent source and destination intersections', async () => {
  const destination = bitmap(new Array(12).fill(0), 3, 1),
    source = bitmap([10, 0, 0, 255, 20, 0, 0, 255, 30, 0, 0, 255], 3, 1);
  await destination.blit(source, { dx: -1, width: 3, height: 1, copy: true });
  assert.deepEqual([...(await destination.pixels())], [10, 0, 0, 255, 20, 0, 0, 255, 0, 0, 0, 0]);
});

test('resampling retains fixed-point weights and the native last-row/last-column sample choices', () => {
  const source = new Uint8ClampedArray([
    255, 0, 0, 255, 0, 255, 0, 255, 0, 0, 255, 255, 255, 255, 255, 255,
  ]);
  assert.deepEqual(
    [...resampleBitmap(source, 2, 2, 3, 3)],
    [
      255, 0, 0, 255, 85, 169, 0, 255, 0, 255, 0, 255, 85, 0, 169, 255, 141, 169, 169, 255, 113,
      254, 113, 255, 0, 0, 255, 255, 113, 113, 254, 255, 254, 254, 254, 255,
    ],
  );
  assert.deepEqual(
    [...resampleBitmap(new Uint8ClampedArray(6 * 6 * 4).fill(40), 6, 6, 1, 1)],
    [40, 40, 40, 40],
  );
});

test('bitmap native clone/size/release and checkpoints retain owner and independent mutable pixels', async () => {
  const { world, images, handles } = environment(),
    handle = await images.load('authored', 0, 42),
    writes = new Map();
  const machine = { store: (address, value) => writes.set(address, value) },
    clone = (await nativeImage(0x76, [handle], machine, { id: 99 }, world)).value;
  assert.equal(images.get(clone).owner, 99);
  await images.get(clone).fill(0, 0, 2, 1, 0xff000000);
  assert.deepEqual([...(await images.get(handle).pixels())], [20, 40, 60, 255, 100, 120, 140, 128]);
  await nativeImage(0x77, [clone, 0, 4], machine, { id: 99 }, world);
  assert.deepEqual(
    [...writes],
    [
      [0, 2],
      [4, 1],
    ],
  );
  const state = handles.snapshot(),
    fresh = environment();
  fresh.handles.restore(state);
  assert.deepEqual(fresh.images.get(clone).snapshot(), images.get(clone).snapshot());
  await fresh.images.get(clone).fill(0, 0, 1, 1, 0xffffffff);
  assert.notDeepEqual(await fresh.images.get(clone).pixels(), await images.get(clone).pixels());
  await fresh.images.releaseOwner(99);
  assert.throws(() => fresh.images.get(clone), /Invalid or released/);
  assert.equal(fresh.images.get(handle).owner, 42);
});

test('bitmap wrappers keep shared native pixel ownership through aliasing, release and checkpoints', async () => {
  const { images, handles } = environment(),
    original = images.create(2, 1, 11),
    alias = images.alias(original, 22);
  await images.get(original).fill(0, 0, 2, 1, 0xff112233);
  assert.equal(images.get(original).state, images.get(alias).state);
  const before = await images.get(alias).frame();
  await images.get(original).fill(0, 0, 1, 1, 0x80123456);
  assert.notEqual(await images.get(alias).frame(), before);
  const fresh = environment();
  fresh.handles.restore(handles.snapshot());
  assert.equal(fresh.images.get(original).state, fresh.images.get(alias).state);
  await fresh.images.releaseOwner(11);
  assert.throws(() => fresh.images.get(original), /Invalid or released/);
  assert.deepEqual(
    [...(await fresh.images.get(alias).pixels())],
    [18, 52, 86, 128, 17, 34, 51, 255],
  );
  await fresh.images.release(alias);
  assert.equal(
    [...fresh.handles.records.values()].filter((r) => r.type === 'bitmap-data').length,
    0,
  );
});
