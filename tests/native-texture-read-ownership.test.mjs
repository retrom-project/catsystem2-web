// SPDX-License-Identifier: MPL-2.0
import test from 'node:test';
import assert from 'node:assert/strict';
import {
  NativeTexturePages,
  nativeTexturePagesOwned,
  nativeTexturePageFrame,
  nativeTexturePageFrames,
  nativeTexturePageStorage,
} from '../src/native/texture-layout.mjs';
import {
  ParticlesGL,
  nativeTextureConsumer,
  nativeTextureReadOwned,
  registerNativeTextureRead,
  createD3DContext,
  nativeD3DContextReadOwned,
} from '../src/render/particles-gl.mjs';
import {
  NativeGraphicsDevice,
  nativeGraphicsDeviceReadOwned,
} from '../src/native/graphics-device.mjs';

// These controls exercise the read fences, not native WebGL qualification.
// Positive native-port and default-render ownership are checked in a browser.
test('a managed texture cache hit settles before its first frame or revision read', () => {
  const frame = { width: 1, height: 1, rgba: new Uint8ClampedArray(4), revision: 0 },
    texture = {},
    reads = [],
    gpu = Object.create(ParticlesGL.prototype);
  let pending = true;
  registerNativeTextureRead(
    frame,
    () => {
      reads.push('settle');
      if (pending) frame.revision++;
      pending = false;
    },
    () => reads.push('borrow'),
  );
  Object.assign(gpu, {
    textures: new Map([[frame, texture]]),
    textureRevisions: new WeakMap([[frame, 1]]),
  });
  assert.equal(nativeTextureConsumer(gpu), false);
  reads.length = 0; // Public cache assignment already fenced and lent its keys.
  assert.equal(gpu.managedTexture(frame), texture);
  assert.deepEqual(reads, ['settle']);
  assert.equal(pending, false);
  assert.equal(frame.revision, 1);
  assert.equal(nativeTextureReadOwned(frame), false);
});

test('device validate and rebuild settle before calling a replaced backend method', () => {
  const frame = { rgba: new Uint8ClampedArray(4) },
    gpu = Object.create(ParticlesGL.prototype);
  let pending = false,
    callbacks,
    seen = 0;
  registerNativeTextureRead(
    frame,
    () => {
      pending = false;
    },
    () => {},
  );
  gpu.textures = new Map([[frame, {}]]);
  const device = {
    attach(value) {
      callbacks = value;
      return {};
    },
  };
  Reflect.apply(ParticlesGL.prototype.attachGraphicsDevice, gpu, [device]);
  gpu.resourcesReady = gpu.rebuildResources = () => {
    assert.equal(pending, false);
    seen++;
  };
  pending = true;
  callbacks.validate();
  pending = true;
  callbacks.rebuild();
  assert.equal(seen, 2);
});

test('foreign frame cache keys and foreign GPU objects retain their ordinary paths', () => {
  const frame = { width: 1, height: 1, rgba: new Uint8ClampedArray(4), revision: 0 },
    texture = {},
    gpu = Object.assign(Object.create(ParticlesGL.prototype), {
      textures: new Map([[frame, texture]]),
      textureRevisions: new WeakMap([[frame, 0]]),
    });
  assert.equal(nativeTextureReadOwned(frame), false);
  assert.equal(gpu.managedTexture(frame), texture);
  assert.equal(nativeTextureConsumer({}), false);
});

test('a lent page frame stays borrowed after its rgba storage is replaced', () => {
  const owner = {},
    settle = () => {},
    pages = new NativeTexturePages(
      { size: [1, 1], grid: [1, 1], areas: [[0, 0, 1, 1]], bppY: [0, 1], bpp: 32 },
      { owner, readBarrier: settle, beforeMutation: settle },
    );
  try {
    const frame = nativeTexturePageStorage(pages).pages.get(0).frame;
    assert(nativeTextureReadOwned(frame));
    assert.equal(pages.frame(0), frame);
    frame.rgba = new Uint8ClampedArray(4);
    assert.equal(nativeTextureReadOwned(frame), false);
  } finally {
    pages.close();
  }
});

test('a replaced page-frame provider runs only after its original owner barrier', () => {
  let pending = true,
    calls = 0;
  const owner = {},
    settle = () => {
      pending = false;
    },
    pages = new NativeTexturePages(
      { size: [1, 1], grid: [1, 1], areas: [[0, 0, 1, 1]], bppY: [0, 1], bpp: 32 },
      { owner, readBarrier: settle, beforeMutation: settle },
    );
  try {
    pending = true;
    const original = pages.frame;
    pages.frame = function (...args) {
      assert.equal(pending, false);
      calls++;
      return Reflect.apply(original, this, args);
    };
    assert.equal(nativeTexturePagesOwned(pages, owner), false);
    nativeTexturePageFrame(pages, 0, {}, owner);
    assert.equal(calls, 1);
  } finally {
    pages.close();
  }
});

test('a synchronous page acquisition settles before inspecting indices and preserves their order', () => {
  let pending = true;
  const owner = {},
    settle = () => {
      pending = false;
    },
    pages = new NativeTexturePages(
      { size: [1, 1], grid: [2, 1], areas: [[0, 0, 2, 1]], bppY: [0, 1], bpp: 32 },
      { owner, readBarrier: settle, beforeMutation: settle },
    );
  try {
    pending = true;
    const indices = {
      *[Symbol.iterator]() {
        assert.equal(pending, false);
        yield 1;
        yield 0;
      },
    };
    const frames = nativeTexturePageFrames(pages, indices, {}, owner);
    assert.equal(frames[0], pages.pages.get(1).frame);
    assert.equal(frames[1], pages.pages.get(0).frame);
    assert(frames.every((frame) => !nativeTextureReadOwned(frame)));
  } finally {
    pages.close();
  }
});

test('a replaced page Map port fails qualification and runs after settlement', () => {
  let pending = true,
    reads = 0;
  const owner = {},
    settle = () => {
      pending = false;
    },
    pages = new NativeTexturePages(
      { size: [1, 1], grid: [2, 1], areas: [[0, 0, 2, 1]], bppY: [0, 1], bpp: 32 },
      { owner, readBarrier: settle, beforeMutation: settle },
    );
  try {
    assert(nativeTexturePagesOwned(pages, owner));
    const get = pages.pages.get;
    pages.pages.get = function (...args) {
      assert.equal(pending, false);
      reads++;
      return Reflect.apply(get, this, args);
    };
    assert.equal(nativeTexturePagesOwned(pages, owner), false);
    pending = true;
    const frames = nativeTexturePageFrames(pages, [0, 1], {}, owner);
    assert.equal(reads, 2);
    assert(frames.every((frame) => !nativeTextureReadOwned(frame)));
  } finally {
    delete pages.pages.get;
    pages.close();
  }
});

test('D3D read qualification rejects replacement context ports without calling them', () => {
  const context = createD3DContext();
  assert(nativeD3DContextReadOwned(context));
  assert.equal(nativeD3DContextReadOwned({ ...context }), false);
  let calls = 0;
  const get = context.states.get;
  context.states.get = function (...args) {
    calls++;
    return Reflect.apply(get, this, args);
  };
  assert.equal(nativeD3DContextReadOwned(context), false);
  assert.equal(calls, 0);
  delete context.states.get;
  Object.defineProperty(context, 'minFilter', {
    configurable: true,
    get() {
      calls++;
      return 2;
    },
  });
  assert.equal(nativeD3DContextReadOwned(context), false);
  assert.equal(calls, 0);
});

test('device read qualification follows the actual attachment and public observers', () => {
  const device = new NativeGraphicsDevice(),
    source = { kind: 'webgl', validate: () => true, rebuild: () => {} };
  assert.equal(nativeGraphicsDeviceReadOwned(device, source), false);
  const port = device.attach(source);
  assert(nativeGraphicsDeviceReadOwned(device, source));
  const unobserve = device.observe(() => {});
  assert.equal(nativeGraphicsDeviceReadOwned(device, source), false);
  unobserve();
  assert(nativeGraphicsDeviceReadOwned(device, source));
  port.retire();
  assert.equal(nativeGraphicsDeviceReadOwned(device, source), false);
  device.close();
});

test('foreign frame proxies keep ordinary getters and cache ordering', () => {
  const events = [],
    bytes = new Uint8ClampedArray(4),
    texture = {},
    other = {};
  let gpu, frame;
  frame = new Proxy(
    { rgba: bytes, revision: 0 },
    {
      get(target, key) {
        if (key === 'rgba' || key === 'revision') {
          events.push(key);
          assert.equal([...gpu.textures.keys()].at(-1), frame);
        }
        return target[key];
      },
      getOwnPropertyDescriptor() {
        throw new Error('Foreign frame qualification must not inspect descriptors');
      },
    },
  );
  gpu = Object.assign(Object.create(ParticlesGL.prototype), {
    textures: new Map([
      [frame, texture],
      [other, {}],
    ]),
    textureRevisions: new WeakMap([[frame, 0]]),
  });
  registerNativeTextureRead(
    frame,
    () => events.push('settle'),
    () => events.push('borrow'),
  );
  assert.equal(nativeTextureReadOwned(frame), false);
  assert.equal(gpu.managedTexture(frame), texture);
  assert.deepEqual(
    events.filter((event) => event !== 'settle'),
    ['borrow', 'rgba', 'revision'],
  );
  assert.equal(events[0], 'settle');
});

test('an intrinsic frame accessor keeps ordinary cache order and permanently loses ownership', () => {
  const owner = {},
    pages = new NativeTexturePages(
      { size: [1, 1], grid: [1, 1], areas: [[0, 0, 1, 1]], bppY: [0, 1], bpp: 32 },
      { owner, readBarrier: () => {}, beforeMutation: null },
    );
  const frame = pages.pages.get(0).frame,
    bytes = frame.rgba,
    other = {},
    texture = {};
  const gpu = Object.assign(Object.create(ParticlesGL.prototype), {
    textures: new Map([
      [frame, texture],
      [other, {}],
    ]),
    textureRevisions: new WeakMap([[frame, 0]]),
  });
  let reads = 0;
  try {
    Object.defineProperty(frame, 'rgba', {
      configurable: true,
      get() {
        reads++;
        assert.equal([...gpu.textures.keys()].at(-1), frame);
        return bytes;
      },
    });
    assert.equal(gpu.managedTexture(frame), texture);
    assert.equal(reads, 1);
    Object.defineProperty(frame, 'rgba', {
      configurable: true,
      writable: true,
      enumerable: true,
      value: bytes,
    });
    assert.equal(nativeTextureReadOwned(frame), false);
  } finally {
    pages.close();
  }
});

for (const field of ['pages', 'dirtyFlags', 'layout'])
  test(`public ${field} storage lends current and restored/future page frames`, () => {
    let pending = false;
    const owner = {},
      barrier = () => {
        pending = false;
      },
      pages = new NativeTexturePages(
        { size: [1, 1], grid: [2, 1], areas: [[0, 0, 1, 1]], bppY: [0, 1], bpp: 32 },
        { owner, beforeMutation: barrier, readBarrier: barrier, trackDirty: true },
      );
    try {
      const first = nativeTexturePageStorage(pages).pages.get(0).frame;
      assert(nativeTextureReadOwned(first));
      pending = true;
      const publicValue = pages[field];
      assert.equal(pending, false);
      assert.equal(publicValue, pages[field]);
      assert.equal(nativeTexturePagesOwned(pages, owner), false);
      assert.equal(nativeTextureReadOwned(first), false);
      pages.allocateMissing({ areas: [[1, 0, 1, 1]], bppY: [0, 1] });
      const second = nativeTexturePageStorage(pages).pages.get(1).frame;
      assert.equal(nativeTextureReadOwned(second), false);
      const saved = pages.snapshot();
      pages.restore(saved);
      assert(
        [...nativeTexturePageStorage(pages).pages.values()].every(
          (p) => !nativeTextureReadOwned(p.frame),
        ),
      );
    } finally {
      pages.close();
    }
  });

test('GPU close settles cached producers before retirement or replacement cleanup callbacks', () => {
  const frame = { rgba: new Uint8ClampedArray(4) },
    gpu = Object.create(ParticlesGL.prototype);
  gpu.textures = new Map([[frame, {}]]);
  let pending = true,
    retired = false,
    released = false;
  registerNativeTextureRead(
    frame,
    () => {
      pending = false;
    },
    () => {},
  );
  Object.assign(gpu, {
    canvas: {
      removeEventListener() {
        assert.equal(pending, false);
      },
    },
    devicePort: {
      retire() {
        assert.equal(pending, false);
        retired = true;
      },
    },
    releaseResources() {
      assert.equal(pending, false);
      released = true;
    },
    gl: {
      getExtension() {
        return null;
      },
    },
  });
  gpu.close();
  assert(retired && released);
});

test('public cache replacement lends newly assigned native keys before returning', () => {
  const gpu = Object.create(ParticlesGL.prototype),
    frame = { rgba: new Uint8ClampedArray(4), revision: 0 };
  let pending = true;
  registerNativeTextureRead(
    frame,
    () => {
      pending = false;
    },
    () => {
      assert.equal(pending, false);
    },
    true,
  );
  assert(nativeTextureReadOwned(frame));
  gpu.textures = new Map([[frame, {}]]);
  assert.equal(pending, false);
  assert.equal(nativeTextureReadOwned(frame), false);
});
