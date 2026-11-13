// SPDX-License-Identifier: MPL-2.0
import test from 'node:test';
import assert from 'node:assert/strict';
import { EmoteD3D9 } from '../src/emote/native-d3d.mjs';
import { StageRenderer } from '../src/render/stage.mjs';
import {
  createD3DContext,
  snapshotD3DContext,
  restoreD3DContext,
  resetD3DContext,
  getD3DSamplerState,
} from '../src/render/particles-gl.mjs';
import { EffekseerSharedDeviceView } from '../src/effekseer/shared-device-view.mjs';
import { NativeRenderer as ConsumerRenderer } from '../oracle/renderer-consumer-projection.mjs';
import { NativeRenderer as M2Renderer } from '../oracle/m2-renderer-original.mjs';
import { dataWorld } from './fixtures/data-world.mjs';

const PROFILE = 'nekopara-vol3-engine-2.6.1.76';
// Memory/COM-registration boundary only: no CPU emulator, PE image, device
// initialization or original instruction is loaded or executed by these tests.
class HostProcess {
  next = 4096;
  words = new Map();
  traps = new Map();
  allocate(size) {
    const pointer = this.next;
    this.next += Math.ceil(size / 4) * 4;
    return pointer;
  }
  free() {
    return true;
  }
  load(address) {
    return this.words.get(address) ?? 0;
  }
  store(address, value) {
    this.words.set(address, value >>> 0);
  }
  trap(_name, _args, handler) {
    const pointer = this.allocate(4);
    this.traps.set(pointer, handler);
    return pointer;
  }
  invoke(device, slot, ...args) {
    return this.traps.get(this.load(this.load(device) + slot * 4))([device, ...args]);
  }
}
function device(context) {
  const process = new HostProcess(),
    d3d = new EmoteD3D9(process, { width: 8, height: 8, ...(context && { context }) });
  return { process, d3d };
}
const set = (h, stage, id, value) => h.process.invoke(h.d3d.device, 69, stage, id, value);
function get(h, stage, id) {
  const output = h.process.allocate(4);
  h.process.store(output, 0x12345678);
  const result = h.process.invoke(h.d3d.device, 68, stage, id, output);
  return { result, value: h.process.load(output) };
}
function sharedView(context) {
  const unused = () => {
    throw new Error('Sampler test must not use physical bindings or GPU');
  };
  return new EffekseerSharedDeviceView({
    context,
    bindings: { get: unused, set: unused },
    gpu: { clear: unused },
    viewport: () => [0, 0, 8, 8, 0, 1],
  });
}
function maps(context) {
  return [context.states, context.samplers, context.samplerStages, context.stages];
}
function assertAliases(context, before, ...borrowers) {
  maps(context).forEach((map, i) => assert.equal(map, before[i]));
  assert.equal(context.samplerStages.get(0), context.samplers);
  for (const borrower of borrowers) {
    assert.equal(borrower.context, context);
    assert.equal(borrower.samplerStages, context.samplerStages);
  }
}

test('Stage context and actual Emote sampler handlers share one authority in both directions', () => {
  const stage = new StageRenderer(),
    context = stage.d3dContext,
    h = device(context),
    view = sharedView(context),
    before = maps(context);
  try {
    assert.equal(h.d3d.ownsContext, false);
    assert.deepEqual(get(h, 0, 5), { result: 0, value: 2 });
    assert.deepEqual(get(h, 1, 5), { result: 0, value: 1 });
    assert.equal(context.samplerStages.size, 1, 'a default read does not allocate a stage');
    for (let i = 1; i <= 3; i++) {
      view.setSampler(i, 'addressU', 'clamp');
      assert.deepEqual(get(h, i, 1), { result: 0, value: 3 });
      assert.equal(set(h, i, 6, 2), 0);
      assert.equal(getD3DSamplerState(context, i, 6), 2);
      assert.deepEqual(
        [...context.samplerStages.get(i)],
        [
          [1, 3],
          [2, 1],
          [3, 1],
          [4, 0],
          [5, 1],
          [6, 2],
          [7, 0],
          [8, 0],
          [9, 0],
          [10, 1],
          [11, 0],
          [12, 0],
          [13, 0],
        ],
      );
    }
    stage.d3dContext.samplers.set(10, 7);
    assert.deepEqual(get(h, 0, 10), { result: 0, value: 7 });
    assert.equal(set(h, 0, 4, 0x10203040), 0);
    assert.equal(stage.d3dContext.samplers.get(4), 0x10203040);
    assert.deepEqual(get(h, 1, 99), { result: 0x8876086c, value: 0x12345678 });
    assert.equal(set(h, 4, 99, 123), 0, 'the adapter retains its existing arbitrary-stage set');
    assert.deepEqual(get(h, 4, 99), { result: 0, value: 123 });
    assert.throws(() => view.setSampler(4, 'minFilter', 'point'), /original four/);
    assertAliases(context, before, h.d3d);
    const saved = snapshotD3DContext(context);
    h.d3d.close();
    assert.deepEqual(
      snapshotD3DContext(context),
      saved,
      'closing a borrower leaves its owner live',
    );
    assert.throws(() => get(h, 0, 5), /invalid object/);
    assertAliases(context, before, h.d3d);
  } finally {
    h.d3d.close();
    stage.dispose();
  }
});

test('standalone device saves context once; borrowed device saves none and cannot restore it', () => {
  const owner = device(),
    fresh = device(),
    context = owner.d3d.context,
    borrowed = device(context),
    before = maps(fresh.d3d.context);
  try {
    for (let stage = 0; stage <= 3; stage++) set(owner, stage, 4, 100 + stage);
    const saved = owner.d3d.snapshot(),
      borrowState = borrowed.d3d.snapshot();
    assert.equal(Object.hasOwn(saved, 'samplerStages'), false);
    assert.deepEqual(
      saved.context.samplerStages.map(([stage]) => stage),
      [1, 2, 3],
    );
    assert.equal(saved.context.samplers.find(([id]) => id === 4)[1], 100);
    assert.equal(borrowState.context, null);
    assert.equal(Object.hasOwn(borrowState, 'samplerStages'), false);
    fresh.d3d.restore(structuredClone(saved));
    assertAliases(fresh.d3d.context, before, fresh.d3d);
    for (let stage = 0; stage <= 3; stage++)
      assert.deepEqual(get(fresh, stage, 4), { result: 0, value: 100 + stage });
    set(owner, 1, 4, 999);
    borrowed.d3d.restore(borrowState);
    assert.equal(context.samplerStages.get(1).get(4), 999, 'borrower restore cannot rewind owner');
    assert.throws(() => fresh.d3d.restore(borrowState), /context ownership/);
    assert.throws(() => borrowed.d3d.restore(saved), /context ownership/);
    const invalid = structuredClone(saved.context);
    invalid.samplerStages.push([0, invalid.samplers]);
    assert.throws(() => restoreD3DContext(invalid, fresh.d3d.context), /sampler stage checkpoint/);
    assert.deepEqual(snapshotD3DContext(fresh.d3d.context), saved.context);
    const broken = createD3DContext();
    broken.samplerStages.set(0, new Map(broken.samplers));
    assert.throws(() => device(broken), /stage-zero alias/);
    assert.throws(() => snapshotD3DContext(broken), /stage-zero alias/);
  } finally {
    owner.d3d.close();
    borrowed.d3d.close();
    fresh.d3d.close();
  }
});

// Only external Win32 registration is replaced. The actual renderer constructor,
// Emote class, reset helper and snapshot/restore methods below remain in use.
function constructorBoundary(Renderer) {
  return class extends Renderer {
    installWindows() {}
  };
}
function engineBoundary(world, Renderer = ConsumerRenderer, events = []) {
  const process = new HostProcess(),
    Constructor = constructorBoundary(Renderer),
    engine = {
      profile: PROFILE,
      process,
      kernel: {},
      refs: {},
      features: new Map(),
      registerFeature(name, feature) {
        this.features.set(name, feature);
      },
      snapshot() {
        return { features: [...this.features].map(([name, f]) => [name, f.snapshot()]) };
      },
      restore(state) {
        events.push('engine.restore');
        for (const [name, featureState] of state.features)
          this.features.get(name).restore(featureState);
      },
      async close() {
        for (const feature of this.features.values()) await feature.close();
      },
    };
  // Explicit engine boundary: this does not initialize or execute a native view.
  world.ensureNativeEngine = async () => engine;
  world.nativeEngine = engine;
  world.nativeEngineLoading = Promise.resolve(engine);
  world.nativeFeatureFactories.set('renderer', () => {
    events.push('factory');
    return new Constructor(engine, world, { refs: {} });
  });
  return engine;
}

test('both real renderer constructors reset the owner without replacing context or Map aliases', async () => {
  for (const Renderer of [ConsumerRenderer, M2Renderer]) {
    const world = await dataWorld(PROFILE),
      context = world.graphics.d3dContext,
      h = device(context),
      before = maps(context);
    engineBoundary(world, Renderer);
    try {
      set(h, 0, 5, 1);
      set(h, 2, 4, 333);
      const renderer = await world.getNativeFeature('renderer');
      assertAliases(context, before, h.d3d, renderer.d3d);
      assert.equal(context.samplers.get(5), 2);
      assert.equal(context.samplerStages.size, 1);
      assert.equal(renderer.d3d.snapshot().context, null);
    } finally {
      h.d3d.close();
      await world.close({ flushFiles: false });
    }
  }
});

test('actual fresh World restores the shared owner once after feature construction and before borrowers', async () => {
  const world = await dataWorld(PROFILE),
    engine = engineBoundary(world),
    fresh = await dataWorld(PROFILE, {}, { initialize: false }),
    events = [],
    freshContext = fresh.graphics.d3dContext,
    before = maps(freshContext),
    earlyBorrower = device(freshContext);
  engineBoundary(fresh, ConsumerRenderer, events);
  let restores = 0;
  const restore = fresh.graphics.restoreD3DContext.bind(fresh.graphics);
  fresh.graphics.restoreD3DContext = (state) => {
    restores++;
    events.push('context.restore');
    return restore(state);
  };
  try {
    const renderer = await world.getNativeFeature('renderer'),
      h = { process: engine.process, d3d: renderer.d3d };
    for (let stage = 0; stage <= 3; stage++) set(h, stage, 4, 1000 + stage);
    const saved = world.snapshot();
    assert.equal(saved.nativeEngine.features[0][1].d3d.context, null);
    assert.deepEqual(
      saved.graphics.d3dContext.samplerStages.map(([stage]) => stage),
      [1, 2, 3],
    );
    await fresh.restore(structuredClone(saved));
    const restored = fresh.nativeEngine.features.get('renderer').d3d;
    assert.equal(restores, 1);
    assert.deepEqual(events, ['factory', 'context.restore', 'engine.restore']);
    assert.equal(fresh.graphics.d3dContext, freshContext);
    assertAliases(freshContext, before, earlyBorrower.d3d, restored);
    assert.deepEqual(snapshotD3DContext(freshContext), saved.graphics.d3dContext);
    const h2 = { process: fresh.nativeEngine.process, d3d: restored };
    for (let stage = 0; stage <= 3; stage++)
      assert.deepEqual(get(h2, stage, 4), { result: 0, value: 1000 + stage });
    assert.equal(set(h2, 3, 4, 4444), 0);
    assert.deepEqual(get(earlyBorrower, 3, 4), { result: 0, value: 4444 });
    assert.equal(
      world.graphics.d3dContext.samplerStages.get(3).get(4),
      1003,
      'fresh owner is independent',
    );
  } finally {
    earlyBorrower.d3d.close();
    await world.close({ flushFiles: false });
    await fresh.close({ flushFiles: false });
  }
});

test('JS-only fresh World restores once without requesting an engine and keeps existing views live', async () => {
  const world = await dataWorld(PROFILE),
    fresh = await dataWorld(PROFILE, {}, { initialize: false }),
    context = fresh.graphics.d3dContext,
    before = maps(context),
    view = sharedView(context);
  let restores = 0;
  const restore = fresh.graphics.restoreD3DContext.bind(fresh.graphics);
  fresh.graphics.restoreD3DContext = (state) => {
    restores++;
    return restore(state);
  };
  try {
    const h = device(world.graphics.d3dContext);
    set(h, 0, 4, 111);
    set(h, 3, 6, 2);
    h.d3d.close();
    const saved = world.snapshot();
    assert.equal(saved.nativeEngine, null);
    await fresh.restore(saved);
    assert.equal(restores, 1);
    assert.equal(fresh.nativeEngine, undefined);
    assertAliases(context, before);
    assert.equal(view.state.states, context.states);
    assert.equal(view.state.samplers, context.samplers);
    assert.equal(view.state.stages, context.stages);
    assert.equal(view.state.samplers.get(4), 111);
    view.setSampler(3, 'minFilter', 'point');
    assert.equal(context.samplerStages.get(3).get(6), 1);
    resetD3DContext(context);
    assertAliases(context, before);
    assert.equal(context.samplerStages.size, 1);
    assert.equal(view.state.samplers.get(4), 0);
  } finally {
    await world.close({ flushFiles: false });
    await fresh.close({ flushFiles: false });
  }
});
