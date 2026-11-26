// SPDX-License-Identifier: MPL-2.0
import test from 'node:test';
import assert from 'node:assert/strict';
import {
  StageSurfaces,
  nativeStageSurface,
  registerNativeSurfaceRead,
} from '../src/render/surfaces.mjs';
import { StageRenderer } from '../src/render/stage.mjs';

function surface(surfaces) {
  return surfaces.create({ width: 1, height: 1, pitch: 4, format: 'rgba8' });
}
function watch(surfaces, id) {
  const state = { pending: true, borrowed: false };
  registerNativeSurfaceRead(
    surfaces,
    id,
    () => {
      state.pending = false;
    },
    () => {
      assert.equal(state.pending, false);
      state.borrowed = true;
    },
  );
  return state;
}
test('public record maps fence before lending and cover future entries and restored storage', () => {
  const surfaces = new StageSurfaces(),
    first = surface(surfaces),
    a = watch(surfaces, first);
  const held = surfaces.records;
  assert.equal(a.pending, false);
  assert.equal(a.borrowed, true);
  assert.equal(held, surfaces.records);
  const second = surface(surfaces),
    b = watch(surfaces, second);
  assert.equal(b.borrowed, true);
  assert.equal(held.get(second), nativeStageSurface(surfaces, second));
  const saved = surfaces.snapshot();
  surfaces.restore(saved);
  const restored = watch(surfaces, first);
  assert.equal(restored.borrowed, true);
  surfaces.clear();
});
test('public get lends its ID and CPU bytes while independent copy snapshots keep other IDs owned', () => {
  const surfaces = new StageSurfaces(),
    first = surface(surfaces),
    second = surface(surfaces),
    a = watch(surfaces, first),
    b = watch(surfaces, second);
  const held = surfaces.get(first);
  assert.equal(a.borrowed, true);
  assert.equal(b.borrowed, false);
  held.bytes[0] = 173;
  assert.equal(nativeStageSurface(surfaces, first).bytes[0], 173);
  const copy = surfaces.snapshot();
  assert.equal(b.borrowed, false);
  const restored = new StageSurfaces();
  restored.restore(copy);
  assert.equal(restored.get(first).bytes[0], 173);
  surfaces.clear();
  restored.clear();
});
test('a replaced record-map/get port sees settled data on its first callback', () => {
  const surfaces = new StageSurfaces(),
    id = surface(surfaces),
    state = watch(surfaces, id),
    map = surfaces.records;
  state.pending = true;
  let calls = 0;
  Object.defineProperty(surfaces, 'records', {
    configurable: true,
    get() {
      calls++;
      assert.equal(state.pending, false);
      return map;
    },
  });
  assert(nativeStageSurface(surfaces, id));
  assert.equal(calls, 1);
  assert.equal(state.borrowed, true);
  delete surfaces.records;
  surfaces.clear();
});
test('Stage public frame/pixels lend backing bytes while its copy snapshot retains ownership', () => {
  const stage = new StageRenderer(),
    id = stage.createSurface(1, 1),
    state = watch(stage.surfaces, id);
  stage.snapshotSurfaces([id]);
  assert.equal(state.borrowed, false);
  const bytes = stage.surfacePixels(id);
  assert.equal(state.borrowed, true);
  assert.equal(bytes, stage.surfaceFrame(id).rgba);
  stage.dispose();
});

test('a replaced Stage surface port runs after its original producer fence', () => {
  const stage = new StageRenderer(),
    id = stage.createSurface(1, 1),
    surfaces = stage.surfaces,
    state = watch(surfaces, id);
  let calls = 0;
  Object.defineProperty(stage, 'surfaces', {
    configurable: true,
    get() {
      calls++;
      assert.equal(state.pending, false);
      assert.equal(state.borrowed, true);
      return surfaces;
    },
  });
  assert(stage.surfaceFrame(id));
  assert(calls > 0);
  assert.equal(state.borrowed, true);
  Object.defineProperty(stage, 'surfaces', { configurable: true, writable: true, value: surfaces });
  stage.dispose();
});

test('copy snapshot and restore settle before caller iterators or resource option getters', () => {
  const surfaces = new StageSurfaces(),
    id = surface(surfaces),
    state = watch(surfaces, id);
  const ids = {
    *[Symbol.iterator]() {
      assert.equal(state.pending, false);
      yield id;
    },
  };
  const copy = surfaces.snapshot(ids);
  assert.equal(state.borrowed, false);
  state.pending = true;
  surfaces.restore({
    *[Symbol.iterator]() {
      assert.equal(state.pending, false);
      yield copy[0];
    },
  });
  state.pending = true;
  surfaces.create({
    get width() {
      assert.equal(state.pending, false);
      return 1;
    },
    height: 1,
    pitch: 4,
    format: 'rgba8',
  });
  surfaces.clear();
});

test('Stage disposal settles producers before device retirement observers', () => {
  const stage = new StageRenderer(),
    id = stage.createSurface(1, 1),
    state = watch(stage.surfaces, id);
  let notified = false;
  stage.graphicsDevice = {
    close() {
      assert.equal(state.pending, false);
      notified = true;
    },
  };
  stage.dispose();
  assert.equal(notified, true);
});
