// SPDX-License-Identifier: MPL-2.0
import test from 'node:test';
import assert from 'node:assert/strict';
import {
  NativeBitmap,
  snapshotBitmapCopyRows,
  bitmapCopySnapshotSource,
  materializeBitmapCopySource,
} from '../src/native/image.mjs';
import { NativeGraphics, outputBitmapCopySnapshot } from '../src/native/graphics.mjs';
import { NativeHandles } from '../src/native/handles.mjs';
import { NativeConfiguration } from '../src/native/config.mjs';
import { dataWorld } from './fixtures/data-world.mjs';

const width = 512,
  height = 512;
function pixels() {
  const bytes = new Uint8ClampedArray(width * height * 4);
  bytes.fill(97, width * 4 * 253, width * 4 * 256);
  // Transparent RGB is significant and must keep its row in the snapshot.
  bytes[width * 4 * 260 + 23] = 0;
  bytes[width * 4 * 260 + 20] = 173;
  return bytes;
}
const state = (rgba, w = width, h = height) => ({
  width: w,
  height: h,
  bpp: 4,
  rgba,
  revision: 0,
  source: null,
  clip: [0, 0, w, h],
});
function source(bytes, compact) {
  const frame = state(null);
  if (compact) return bitmapCopySnapshotSource(frame, snapshotBitmapCopyRows(bytes, width, height));
  const copy = new Uint8ClampedArray(bytes);
  frame.rgba = copy;
  return { state: frame, width, height, pixels: async () => copy, frame: async () => frame };
}
function fixture() {
  const profile = 'nekopara-vol3-engine-2.6.1.76',
    world = {
      profile,
      game: { width: 4, height: 3 },
      runtime: { handles: new NativeHandles() },
      configuration: new NativeConfiguration({ profile }),
      base: () => ({ message: () => 0 }),
    };
  const graphics = (world.graphics = new NativeGraphics(world));
  return { world, graphics };
}

test('copy snapshots keep exact zero borders, transparent RGB, offsets, dense and small fallback', async () => {
  const bytes = pixels(),
    snapshot = snapshotBitmapCopyRows(bytes, width, height);
  assert.deepEqual([snapshot.firstRow, snapshot.endRow], [253, 261]);
  assert.equal(snapshot.pixels.length, 8 * width * 4);
  const box = bitmapCopySnapshotSource(state(null), snapshot);
  bytes.fill(41);
  materializeBitmapCopySource(box);
  assert.deepEqual(await box.pixels(), pixels());
  assert.equal((await box.frame()).rgba, await box.pixels());
  assert.equal(snapshotBitmapCopyRows(new Uint8ClampedArray(64), 4, 4), null);
  const dense = pixels();
  dense[0] = dense[dense.length - 1] = 1;
  assert.equal(snapshotBitmapCopyRows(dense, width, height), null);
  const half = pixels();
  half.fill(1, 0, half.length / 2 + 4);
  assert.equal(snapshotBitmapCopyRows(half, width, height), null);
  const zero = snapshotBitmapCopyRows(new Uint8ClampedArray(width * height * 4), width, height);
  assert.equal(zero.pixels.length, 0);
  const backing = new Uint8ClampedArray(bytes.length + 20),
    view = backing.subarray(12, 12 + bytes.length);
  view.set(pixels());
  const offset = bitmapCopySnapshotSource(state(null), snapshotBitmapCopyRows(view, width, height));
  assert.deepEqual(await offset.pixels(), pixels());
  const unusual = pixels();
  Object.defineProperty(unusual, 'length', {
    get() {
      throw Error('qualification read a getter');
    },
  });
  assert.equal(snapshotBitmapCopyRows(unusual, width, height), null);
  const proxy = new Proxy(
    {},
    {
      get() {
        throw Error('qualification entered a proxy');
      },
    },
  );
  assert.equal(snapshotBitmapCopyRows(proxy, width, height), null);
  const originalWords = globalThis.Uint32Array;
  globalThis.Uint32Array = class {
    constructor() {
      throw Error('entered a replaced constructor');
    }
  };
  try {
    assert.equal(snapshotBitmapCopyRows(pixels(), width, height), null);
  } finally {
    globalThis.Uint32Array = originalWords;
  }
});

test('sparse blits preserve independent held aliases, flip and clipping with full revisions', async () => {
  for (const options of [
    { copy: true },
    { copy: true, flipY: true },
    { copy: true, flipY: true, dx: -5, dy: 9, sx: 2, sy: 4, width: 460, height: 480 },
    { copy: true, dx: 490, dy: -3, sx: 10, sy: 2, width: 100, height: 510 },
  ]) {
    const results = [];
    for (const compact of [false, true]) {
      const input = pixels(),
        box = source(input, compact),
        destination = new NativeBitmap(null, state(new Uint8ClampedArray(input.length).fill(38))),
        held = await destination.pixels(),
        promise = destination.blit(box, options);
      input.fill(239);
      await promise;
      assert.equal(await destination.pixels(), held);
      results.push({ bytes: held, revision: destination.state.revision });
    }
    assert.deepEqual(results[1], results[0]);
  }
});

test('late live copy callbacks get ordinary full source views and preserve reentry and throws', async () => {
  async function run(compact) {
    const bytes = pixels(),
      box = source(bytes, compact),
      destination = new NativeBitmap(null, state(new Uint8ClampedArray(bytes.length))),
      held = await destination.pixels(),
      events = [],
      nativeSet = held.set;
    let reads = 0;
    Object.defineProperty(destination, 'width', {
      get() {
        if (++reads === 7)
          held.set = function (row, at) {
            events.push([row.buffer.byteLength, row.byteOffset, at]);
            // A later source row sees this write through the retained snapshot alias.
            if (events.length === 1) new Uint8ClampedArray(row.buffer)[width * 4 * 10] = 111;
            return Reflect.apply(nativeSet, this, [row, at]);
          };
        return width;
      },
    });
    await destination.blit(box, { copy: true });
    return { events, reads, rgba: held.slice(), revision: destination.state.revision };
  }
  assert.deepEqual(await run(true), await run(false));
  async function changedBufferPort(compact) {
    const box = source(pixels(), compact),
      d = new NativeBitmap(null, state(pixels())),
      prototype = Object.getPrototypeOf(Uint8ClampedArray.prototype),
      original = Object.getOwnPropertyDescriptor(prototype, 'buffer');
    let reads = 0,
      callbacks = 0;
    Object.defineProperty(d, 'width', {
      get() {
        if (++reads === 7)
          Object.defineProperty(prototype, 'buffer', {
            ...original,
            get() {
              callbacks++;
              return Reflect.apply(original.get, this, []);
            },
          });
        return width;
      },
    });
    try {
      await d.blit(box, { copy: true });
    } finally {
      Object.defineProperty(prototype, 'buffer', original);
    }
    return { callbacks, reads, bytes: (await d.pixels()).slice() };
  }
  assert.deepEqual(await changedBufferPort(true), await changedBufferPort(false));
  for (const compact of [false, true]) {
    const box = source(pixels(), compact),
      d = new NativeBitmap(null, state(pixels())),
      opaque = new Proxy(
        {},
        {
          get() {
            throw Error('inspected thrown object');
          },
        },
      );
    d.pixels = () => {
      throw opaque;
    };
    let caught;
    try {
      await d.blit(box, { copy: true });
    } catch (error) {
      caught = error;
    }
    assert.equal(caught, opaque);
  }
});

test('replaced output and late blit receive the complete ordinary shape before callbacks', async () => {
  for (const port of ['output', 'blit']) {
    const results = [];
    for (const compact of [false, true]) {
      const { graphics } = fixture(),
        input = pixels(),
        box = source(input, compact),
        events = [];
      const inspect = async function (value) {
        events.push(Object.keys(value));
        assert(Object.hasOwn(Object.getOwnPropertyDescriptor(value.state, 'rgba'), 'value'));
        assert.equal(value.state.rgba.length, input.length);
        assert.equal((await value.frame()).rgba, await value.pixels());
        await Promise.resolve();
        input.fill(19);
        events.push((await value.pixels()).slice());
      };
      if (port === 'output') graphics.output = inspect;
      else {
        const ensure = graphics.ensureVRAM;
        graphics.ensureVRAM = async function (...args) {
          const vram = await Reflect.apply(ensure, this, args);
          vram.blit = inspect;
          return vram;
        };
      }
      await outputBitmapCopySnapshot(graphics, graphics.output, box, [0, 0], null, { flipY: true });
      results.push(events);
    }
    assert.deepEqual(results[1], results[0]);
  }
});

test('custom typed-array then sees the same snapshot receiver and completion order', async () => {
  async function run(compact) {
    const box = source(pixels(), compact),
      d = new NativeBitmap(null, state(pixels())),
      events = [];
    Object.defineProperty(Uint8ClampedArray.prototype, 'then', {
      configurable: true,
      get() {
        events.push([this.length, this[width * 4 * 253]]);
        return undefined;
      },
    });
    try {
      await d.blit(box, { copy: true });
    } finally {
      delete Uint8ClampedArray.prototype.then;
    }
    return { events, rgba: (await d.pixels()).slice(), revision: d.state.revision };
  }
  assert.deepEqual(await run(true), await run(false));
  async function species(compact) {
    const box = source(pixels(), compact),
      d = new NativeBitmap(null, state(pixels()));
    let reads = 0;
    Object.defineProperty(Uint8ClampedArray, Symbol.species, {
      configurable: true,
      get() {
        reads++;
        return Uint8ClampedArray;
      },
    });
    try {
      await d.blit(box, { copy: true });
    } finally {
      delete Uint8ClampedArray[Symbol.species];
    }
    return { reads, bytes: (await d.pixels()).slice(), revision: d.state.revision };
  }
  assert.deepEqual(await species(true), await species(false));
});

test('pending Draw retains pixel/alpha/page revisions, later writes and a fresh current-contract cold restore', async () => {
  const results = [];
  for (const compact of [false, true]) {
    const world = await dataWorld('nekopara-vol3-engine-2.6.1.76'),
      graphics = world.graphics;
    let fresh;
    try {
      const id = await world.objects.create({ kind: 15 }),
        draw = graphics.drawTasks.get(id),
        bitmap = graphics.images.create(width, height, id),
        b = graphics.images.get(bitmap);
      (await b.pixels()).set(pixels());
      draw.state.renderer = {
        bitmap,
        width,
        height,
        items: [],
        clearColor: 0,
        externalPaint: false,
        dirtyRects: [],
      };
      draw.state.offset = [0, 0];
      draw.state.pending = 1;
      const output = graphics.output;
      if (!compact)
        graphics.output = function (...args) {
          return Reflect.apply(output, this, args);
        };
      await world.retainedDraw.rasterize(draw, [], false);
      delete graphics.output;
      const vram = graphics.images.get(graphics.vramHandle),
        held = await vram.pixels();
      // Existing aliases and later writes keep the original destination buffer.
      held[13] = 201;
      await vram.fill(3, 4, 5, 6, 0x7f123456);
      await graphics.texturePages.upload(vram, [3, 4, 8, 10]);
      const saved = world.snapshot();
      fresh = await dataWorld(world.profile, {}, { initialize: false });
      await fresh.restore(saved);
      assert.deepEqual(fresh.snapshot(), saved);
      results.push({
        rgba: held.slice(),
        revision: vram.state.revision,
        pages: graphics.texturePages.snapshot(),
        draw: draw.snapshot(),
      });
    } finally {
      await fresh?.close({ flushFiles: false });
      await world.close({ flushFiles: false });
    }
  }
  assert.deepEqual(results[1], results[0]);
});
