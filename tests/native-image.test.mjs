// SPDX-License-Identifier: MPL-2.0
import test from 'node:test';
import assert from 'node:assert/strict';
import { KCSMachine, readKCS } from '../src/kcs.mjs';
import { NativeBitmap, NativeImages, nativeImage, resampleBitmap } from '../src/native/image.mjs';
import { NativeHandles } from '../src/native/handles.mjs';
import { dataWorld } from './fixtures/data-world.mjs';
import { kcsProgram } from './helpers.mjs';

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
  return { world, images: world.graphics.images, events, handles, frame: frames[0] };
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

test('the first loaded bitmap, its decoded frame and the reusable asset retain independent pixels', async () => {
  const { images, frame, handles } = environment();
  frame.attributes = [{ id: 1, rect: [0, 0, 2, 1] }];
  const first = await images.load('authored', 0, 42),
    bitmap = images.get(first),
    original = frame.rgba.slice();
  bitmap.state.rgba[0] = 7;
  bitmap.state.attributes[0].rect[0] = 1;
  assert.deepEqual(frame.rgba, original);
  frame.rgba[0] = 9;
  frame.attributes[0].rect[0] = -1;
  assert.equal(bitmap.state.rgba[0], 7);
  assert.equal(bitmap.state.attributes[0].rect[0], 1);

  const restored = environment();
  restored.handles.restore(handles.snapshot());
  restored.images.restoreAssets(images.snapshotAssets());
  await images.releaseOwner(42);
  assert.equal(restored.images.get(first).state.rgba[0], 7);
  const second = await restored.images.load('authored', 0, 43),
    cached = restored.images.get(second);
  assert.deepEqual(cached.state.rgba, original);
  assert.equal(cached.state.attributes[0].rect[0], 0);
  assert.equal(restored.images.get(first).state.attributes[0].rect[0], 1);
});

test('a decoder supplying a raw buffer keeps the native bitmap and asset cache isolated', async () => {
  const { images, frame } = environment(),
    original = frame.rgba.slice();
  frame.rgba = frame.rgba.buffer;
  const first = images.get(await images.load('authored'));
  new Uint8ClampedArray(frame.rgba)[0] = 7;
  assert.deepEqual(await first.pixels(), original);
  (await first.pixels())[0] = 9;
  const cached = images.get(await images.load('authored'));
  assert.deepEqual(await cached.pixels(), original);
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

test('2.6.1.23 bitmap and collection tone honor native ownership and color order', async (t) => {
  const world = await dataWorld('grisaia-jp-engine-2.6.1.23'),
    images = world.graphics.images,
    canary = 0x375a86dc,
    invalid = 0xf0a16000;
  t.after(() => world.close({ flushFiles: false }));
  function create(pixels) {
    const handle = images.create(pixels.length / 4, 1, world.main.id);
    images.get(handle).state.rgba = Uint8ClampedArray.from(pixels);
    return handle;
  }
  async function invoke(id, args, error) {
    const program = await readKCS(
      kcsProgram([
        [37, canary],
        ...args.map((word) => [37, word]),
        [43, id, args.length * 4],
        [59],
      ]),
    );
    const task = { ...world.main, io: null };
    const machine = (task.machine = new KCSMachine(program, {
      native: (call, words, caller) => world.runtime.scheduler.native(task, call, words, caller),
    }));
    const start = machine.sp;
    const executed = world.runtime.scheduler.execute(task);
    if (error) return assert.rejects(executed, error);
    assert.equal((await executed).status, 'halted');
    assert.equal(machine.sp, start + 4);
    assert.equal(machine.pop(), canary);
  }
  for (const id of [121, 713]) {
    await invoke(id, [invalid, 100, 100, 100]);
    await invoke(id, [0, 50, 175, 0]);
    await invoke(
      id,
      [invalid, 100, 100, 101],
      /invalid or released native (bitmap|image-owner) handle/i,
    );
  }
  await invoke(121, [invalid, 100, 100], /four argument words/);
  const handle = create([72, 90, 160, 33, 255, 26, 15, 127]),
    direct = images.get(handle),
    empty = images.create(0, 3, world.main.id);
  await invoke(121, [empty, 100, 100, 255]);
  assert.equal(images.get(empty).state.revision, 0);
  await invoke(121, [handle, 175, 50, 0x80000000]);
  assert.deepEqual([...(await direct.pixels())], [126, 45, 0, 33, 255, 13, 255, 127]);
  const shared = create([160, 50, 5, 61]),
    animated = create([17, 62, 151, 81]),
    owner = world.imageOwners.add(shared, world.main.id, Array(11).fill(0)),
    collection = world.imageOwners.get(owner);
  await invoke(713, [owner, 100, 100, 100]);
  assert.equal(collection.info[9], 0);
  await invoke(713, [owner, 50, 170, 37], /requires loaded layers/);
  collection.layers = [
    { bitmap: shared },
    { bitmap: shared },
    { animation: { frames: [{ bitmap: animated }] } },
  ];
  await invoke(713, [owner, 50, 170, 37]);
  assert.equal(collection.info[9], 1);
  assert.equal(collection.revision, 1);
  assert.deepEqual([...(await images.get(shared).pixels())], [40, 144, 0, 61]);
  assert.deepEqual([...(await images.get(animated).pixels())], [8, 105, 55, 81]);
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
