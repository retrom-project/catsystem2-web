// SPDX-License-Identifier: MPL-2.0
import test from 'node:test';
import assert from 'node:assert/strict';
import {
  NativeTexturePages,
  nativeTexturePagesOwned,
  nativeTexturePageFrame,
} from '../src/native/texture-layout.mjs';
import {
  ParticlesGL,
  nativeTextureConsumer,
  nativeTextureReadOwned,
  registerNativeTextureRead,
} from '../src/render/particles-gl.mjs';

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
  assert.equal(gpu.managedTexture(frame), texture);
  assert.deepEqual(reads, ['settle', 'borrow']);
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
    const frame = pages.pages.get(0).frame;
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
