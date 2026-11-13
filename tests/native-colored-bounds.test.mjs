// SPDX-License-Identifier: MPL-2.0
import test from 'node:test';
import assert from 'node:assert/strict';
import * as geometry from '../src/render/native-geometry.mjs';
import { openPhysicalWorld } from './fixtures/effekseer/physical-world.mjs';
import { notify, step } from './fixtures/fes-effekseer-world.mjs';
import { NativeGraphicsPacket } from '../src/native/graphics-task.mjs';
import { MOTION_ABI, motionVector } from '../src/motion/abi.mjs';
import { floatBits } from '../src/kcs.mjs';
import { kcsProgram } from './helpers.mjs';
import { serializeCheckpoint, deserializeCheckpoint } from '../src/checkpoint.mjs';

const empty = [0, 0, 0, 0];
const source = `#DEFINE
CPLANE fx
#OBJECT SIZE POS BASE PRI DISP COLOR
fx 10,6 8,9,0 0,0 10 1 0xff112233
#START
next IDLE
#IDLE
break
next IDLE
#MOVE
fx pos 24 12 0
break
#MOVE2
fx pos 40 5 0
break
#SIZE
fx size 4 3
break
#DELETE
fx delete
break
`;
const parentSource = `#DEFINE
CPLANE parent
CPLANE fx
#OBJECT SIZE POS BASE PRI DISP COLOR
parent 1,1 0,0,0 0,0 1 1 0xffffffff
fx 10,6 10,0,0 2,1 10 1 0xff112233
#OBJECT PARENT
fx parent
#START
next IDLE
#IDLE
break
next IDLE
`;
const packet = (values) => new NativeGraphicsPacket(values.map(floatBits));
const send = (h, t, id, l = 0, payload, w = 0) =>
  h.world.sendEngine(t.record.id, h.id, id, w, l, payload ? { payload } : {});
function presentation(world) {
  const stage = world.stageRenderer,
    originalCanvas = globalThis.OffscreenCanvas,
    present = stage.presentNative.bind(stage),
    draw = stage.drawItem.bind(stage),
    requests = [],
    draws = [];
  globalThis.OffscreenCanvas = class {
    constructor(width, height) {
      this.width = width;
      this.height = height;
    }
    getContext() {
      return { reset() {}, drawImage() {} };
    }
  };
  stage.renderer.ctx = { reset() {}, drawImage() {} };
  let status = 0;
  stage.presentNative = (request) => {
    requests.push({ ...request, dirtyRectangle: request.dirtyRectangle?.slice() });
    assert.equal(present(request), 0);
    return status;
  };
  stage.drawItem = (...args) => {
    if (args[2].p?.nativeGraph?.type === 2) draws.push(args[2].p.nativeTaskWorldID);
    return draw(...args);
  };
  return {
    requests,
    draws,
    status(value) {
      status = value;
    },
    render: () => stage.render(world.graphics.stage),
    restoreCanvas() {
      if (originalCanvas === undefined) delete globalThis.OffscreenCanvas;
      else globalThis.OffscreenCanvas = originalCanvas;
    },
  };
}
async function open(options = {}) {
  const h = await openPhysicalWorld({ text: source, ...options });
  Object.assign(h.world.configuration.screen, { currentWidth: 80, currentHeight: 60 });
  h.world.graphics.view.configure({ clientWidth: 64, clientHeight: 48 });
  h.present = presentation(h.world);
  return h;
}
const plane = (h, name = 'fx') =>
  h.world.graphics.get(h.instance.collection.lookup(name, 0).nativeTaskID);
async function close(h) {
  try {
    if (h.gpu.drawing) h.gpu.endNativeFrame();
    await h.world.close({ flushFiles: false });
  } finally {
    h.present.restoreCanvas();
  }
}
function checkpointState(h) {
  const gl = h.gpu.gl,
    reads = [];
  // The strict API recorder has no rasterizer. Supply authored readback bytes
  // only at the GL boundary; the real GPU/World checkpoint paths remain live.
  h.gpu.gl = new Proxy(gl, {
    get(target, key) {
      if (key !== 'readPixels') return Reflect.get(target, key);
      return (x, y, width, height, format, type, bytes) => {
        assert.equal(x, 0);
        assert.equal(y, 0);
        assert.equal(format, gl.RGBA);
        assert.equal(type, gl.UNSIGNED_BYTE);
        assert.ok(bytes instanceof Uint8Array);
        assert.equal(bytes.length, width * height * 4);
        bytes.fill(0);
        reads.push([x, y, width, height, format, type]);
      };
    },
  });
  try {
    const state = h.world.snapshot();
    assert.ok(reads.length > 0, 'the real checkpoint crossed the readback boundary');
    return state;
  } finally {
    h.gpu.gl = gl;
  }
}
async function restoreCheckpoint(h, state) {
  const gl = h.gpu.gl,
    uploads = [];
  // Validate the counterpart upload boundary without replacing World restore.
  h.gpu.gl = new Proxy(gl, {
    get(target, key) {
      if (key !== 'texSubImage2D') return Reflect.get(target, key);
      return (textureTarget, level, x, y, width, height, format, type, bytes, offset) => {
        assert.equal(textureTarget, gl.TEXTURE_2D);
        assert.equal(level, 0);
        assert.equal(x, 0);
        assert.equal(y, 0);
        assert.equal(width, h.gpu.primaryTarget.width);
        assert.equal(height, h.gpu.primaryTarget.height);
        assert.equal(format, gl.RGBA);
        assert.equal(type, gl.UNSIGNED_BYTE);
        assert.ok(bytes instanceof Uint8Array);
        assert.equal(bytes.length, width * height * 4);
        assert.equal(offset, 0);
        assert.equal(h.api.state.textures[h.api.state.activeUnit], h.gpu.primaryTarget.texture);
        uploads.push(bytes.slice());
      };
    },
  });
  try {
    await h.world.restore(state);
    assert.equal(uploads.length, 1);
    assert.ok(uploads[0].every((value) => value === 0));
  } finally {
    h.gpu.gl = gl;
  }
}

test('real CPLANE old FC/new bounds reach normal presentation and only success retires F8', async () => {
  const h = await open(),
    w = h.world,
    t = plane(h),
    r = w.screenEffects.rendering,
    p = h.present;
  try {
    assert.equal(t.graph.boundsDirty, true);
    assert.deepEqual(t.graph.cachedBounds, empty);
    await p.render();
    assert.deepEqual(t.graph.cachedBounds, [8, 9, 19, 16]);
    assert.deepEqual(p.requests.at(-1).dirtyRectangle, [8, 9, 19, 16]);
    assert.equal(t.graph.boundsDirty, false);
    assert.deepEqual([...r.dirtyPrevious], [8, 9, 19, 16]);
    assert.deepEqual([...r.dirtyCurrent], empty);
    await notify(h, 'MOVE');
    assert.equal(t.graph.boundsDirty, true);
    assert.deepEqual(t.graph.cachedBounds, [8, 9, 19, 16]);
    p.status(-1);
    await p.render();
    assert.deepEqual(t.graph.cachedBounds, [24, 12, 35, 19]);
    assert.deepEqual(p.requests.at(-1).dirtyRectangle, [8, 9, 35, 19]);
    assert.deepEqual([...r.dirtyCurrent], [8, 9, 35, 19]);
    assert.deepEqual([...r.dirtyPrevious], [8, 9, 19, 16]);
    assert.equal(t.graph.boundsDirty, true);
    await notify(h, 'MOVE2');
    const motion = h.instance.runtime.snapshot(),
      crt = w.effekseer.threads.snapshot(),
      mt = w.random.snapshot(),
      frame = w.frame;
    await p.render();
    assert.deepEqual(t.graph.cachedBounds, [40, 5, 51, 12]);
    assert.deepEqual(p.requests.at(-1).dirtyRectangle, [8, 5, 51, 19]);
    assert.equal(t.graph.boundsDirty, true);
    w.graphics.view.configure({ paused: true });
    const pending = p.requests.length;
    await p.render();
    assert.equal(p.requests.length, pending);
    assert.equal(t.graph.boundsDirty, true);
    assert.deepEqual([...r.dirtyCurrent], [8, 5, 51, 19]);
    w.graphics.view.configure({ paused: false });
    p.status(0);
    await p.render();
    assert.equal(t.graph.boundsDirty, false);
    assert.deepEqual([...r.dirtyPrevious], [8, 5, 51, 19]);
    assert.deepEqual([...r.dirtyCurrent], empty);
    await p.render();
    assert.deepEqual(p.requests.at(-1).dirtyRectangle, [8, 5, 51, 19]);
    await p.render();
    assert.deepEqual(p.requests.at(-1).dirtyRectangle, empty);
    assert.equal(
      p.draws.length,
      p.requests.length,
      'clean/empty damage still draws the real plane',
    );
    assert.deepEqual(h.instance.runtime.snapshot(), motion);
    assert.deepEqual(w.effekseer.threads.snapshot(), crt);
    assert.deepEqual(w.random.snapshot(), mt);
    assert.equal(w.frame, frame);
    // Identity survives a temporary unsupported calculation domain.
    const cache = t.graph.cachedBounds.slice();
    await send(h, t, 51, 0, packet([40, 5, 1]));
    assert.equal(t.graph.boundsDirty, true);
    assert.throws(
      () => geometry.nativeColoredBounds(t.graph, t.state, w.graphics.projection()),
      /Unsupported/,
    );
    await p.render();
    assert.deepEqual(t.graph.cachedBounds, cache);
    assert.equal(t.graph.boundsDirty, false, 'success clears registered F8 while retaining FC');
    assert.ok(Object.hasOwn(t.snapshot().graph, 'cachedBounds'));
    await send(h, t, 51, 0, packet([40, 5, 0]));
    await p.render();
    assert.deepEqual(t.graph.cachedBounds, cache);
    assert.deepEqual(p.requests.at(-1).dirtyRectangle, cache);
    const points = (x, y) => [{ vertices: Array.from({ length: 3 }, () => ({ x, y })) }];
    assert.deepEqual(geometry.nativeVertexBounds(points(-0.75, -1.75)), [0, -1, 1, 0]);
    assert.deepEqual(
      geometry.nativeVertexBounds(points(0x80000000, Infinity)),
      [-2147483648, -2147483648, -2147483647, -2147483647],
    );
  } finally {
    await close(h);
  }
});

test('real CPLANE47/48, color, getters and normal SIZE/delete retain their original dirty order', async () => {
  const h = await open(),
    w = h.world,
    r = w.screenEffects.rendering,
    p = h.present;
  try {
    const t = plane(h);
    await p.render();
    assert.equal(t.graph.boundsDirty, false);
    await send(h, t, 49, 0, packet([0, 0, 10]));
    assert.equal(t.graph.boundsDirty, true, 'transform setters mark even unchanged values');
    await p.render();
    await send(h, t, 59, 0xff112233, undefined, 1);
    assert.equal(t.graph.boundsDirty, false, 'same override bool/color word does not mark');
    await send(h, t, 63, 255);
    assert.equal(t.graph.boundsDirty, false);
    await send(h, t, 59, 0xff445566, undefined, 1);
    assert.equal(t.graph.boundsDirty, true);
    await p.render();
    const buffer = new NativeGraphicsPacket();
    for (const id of [61, 62, 75, 76]) await send(h, t, id, 0, buffer);
    assert.equal(t.graph.boundsDirty, false);
    const before = r.collectDirty.bind(r),
      calls = [];
    r.collectDirty = () => {
      calls.push({
        flag: t.graph?.registrationEnabled,
        shown: t.state.shown,
        dirty: t.graph?.boundsDirty,
      });
      return before();
    };
    await send(h, t, 47, 0);
    assert.deepEqual(calls, [{ flag: true, shown: false, dirty: true }]);
    assert.deepEqual(
      [...r.dirtyCurrent],
      [8, 9, 19, 16],
      'new shown=false cannot suppress old damage',
    );
    await send(h, t, 47, 0);
    assert.equal(calls.length, 1);
    await p.render();
    assert.equal(t.graph.boundsDirty, false);
    await send(h, t, 47, 1);
    assert.equal(calls.at(-1).flag, false);
    assert.equal(t.graph.boundsDirty, true);
    await p.render();
    calls.length = 0;
    await send(h, t, 48, 0);
    assert.equal(calls[0].flag, true);
    assert.equal(calls[0].dirty, true);
    await send(h, t, 48, 0);
    assert.equal(calls.length, 1);
    await send(h, t, 48, 1);
    assert.equal(calls.at(-1).flag, false);
    r.collectDirty = before;
    await p.render();
    const old = t.graph;
    await notify(h, 'SIZE');
    assert.equal(old.registrationEnabled, false);
    assert.equal(t.graph, null);
    assert.deepEqual([...r.dirtyCurrent], [8, 9, 19, 16]);
    const next = plane(h);
    assert.equal(next.graph.registrationEnabled, false);
    assert.equal(next.graph.boundsDirty, false);
    assert.deepEqual(next.graph.cachedBounds, empty);
    await p.render();
    assert.deepEqual([...r.dirtyCurrent], empty);
    assert.deepEqual([...r.dirtyPrevious], [8, 9, 19, 16]);
    await notify(h, 'DELETE');
    assert.equal(next.graph, null);
    assert.deepEqual([...r.dirtyCurrent], empty);
    assert.deepEqual([...r.dirtyPrevious], [8, 9, 19, 16]);
    // A separate normal FES entity also exercises enabled, nonempty-FC erase.
    const active = await open();
    try {
      const task = plane(active),
        graph = task.graph,
        renderer = active.world.screenEffects.rendering,
        collect = renderer.collectDirty.bind(renderer),
        erasing = [];
      await active.present.render();
      assert.equal(graph.registrationEnabled, true);
      assert.deepEqual(graph.cachedBounds, [8, 9, 19, 16]);
      renderer.collectDirty = () => {
        erasing.push({
          enabled: graph.registrationEnabled,
          dirty: graph.boundsDirty,
          registered: task.graph === graph,
        });
        return collect();
      };
      await notify(active, 'DELETE');
      assert.deepEqual(erasing, [{ enabled: true, dirty: true, registered: true }]);
      assert.equal(graph.registrationEnabled, false);
      assert.equal(task.graph, null);
      assert.deepEqual([...renderer.dirtyCurrent], [8, 9, 19, 16]);
      assert.deepEqual([...renderer.dirtyPrevious], [8, 9, 19, 16]);
      await active.world.tick();
      assert.equal(task.nativeClosed, true);
      assert.equal(erasing.length, 1, 'deferred close cannot query an erased model');
    } finally {
      await close(active);
    }
    // Unsupported-domain metadata still belongs to the colored model.
    const altered = { ...old, vertexEffectID: 999 };
    assert.equal(geometry.isNativeColoredModel(altered), true);
    assert.equal(
      geometry.supportsNativeColoredBounds(altered, t.state, w.graphics.projection()),
      false,
    );
    assert.throws(
      () => geometry.nativeColoredBounds(altered, t.state, w.graphics.projection()),
      /Unsupported/,
    );
    assert.deepEqual(altered.cachedBounds, old.cachedBounds);
  } finally {
    await close(h);
  }
});

test('real CPLANE parent MOT and failed-presentation checkpoint preserve raw FC, current/previous and F8 in a fresh World', async () => {
  const shared = (offset) => [0x13, (0x80000000 + offset) >>> 0],
    move = kcsProgram([
      [21, shared(MOTION_ABI.pos), [7, floatBits(1)]],
      [21, shared(MOTION_ABI.pos + 4), [7, floatBits(2)]],
      [43, 38, 0],
      [59],
    ]),
    fractional = kcsProgram([
      [21, shared(MOTION_ABI.pos), [7, floatBits(10.5)]],
      [21, shared(MOTION_ABI.pos + 4), [7, floatBits(-0.75)]],
      [21, shared(MOTION_ABI.scale), [7, floatBits(2)]],
      [43, 38, 0],
      [59],
    ]),
    h = await open({
      text: parentSource,
      extra: { 'move.kcs': move, 'fractional.kcs': fractional },
    }),
    w = h.world;
  let fresh;
  try {
    const child = plane(h),
      parent = plane(h, 'parent'),
      r = w.screenEffects.rendering,
      childObject = h.instance.collection.lookup('fx', 0);
    await h.instance.runtime.motions.add(childObject, 'fractional');
    await step(h);
    assert.deepEqual(motionVector(child.graph.kx2, MOTION_ABI.pos), [10.5, -0.75, 0]);
    assert.deepEqual(motionVector(child.graph.kx2, MOTION_ABI.scale), [2, 1, 1]);
    assert.equal(
      h.instance.runtime.motions.busy(childObject),
      false,
      'the real finite child MOT completed before parent motion',
    );
    await h.present.render();
    assert.deepEqual(child.graph.cachedBounds, [6, -1, 27, 5]);
    assert.deepEqual(parent.graph.cachedBounds, [0, 0, 2, 2]);
    assert.deepEqual(h.present.requests.at(-1).dirtyRectangle, [0, 0, 27, 5]);
    const parentObject = h.instance.collection.lookup('parent', 0);
    await h.instance.runtime.motions.add(parentObject, 'move');
    await step(h);
    assert.deepEqual(motionVector(parent.graph.kx2, MOTION_ABI.pos), [1, 2, 0]);
    assert.equal(h.instance.runtime.motions.busy(parentObject), false);
    assert.equal(child.graph.boundsDirty, true);
    h.present.status(-1);
    await h.present.render();
    assert.deepEqual(child.graph.cachedBounds, [7, 0, 28, 7]);
    assert.deepEqual(parent.graph.cachedBounds, [1, 2, 3, 4]);
    assert.deepEqual([...r.dirtyCurrent], [0, -1, 28, 7]);
    assert.deepEqual([...r.dirtyPrevious], [0, -1, 27, 5]);
    assert.equal(child.graph.boundsDirty, true);
    const saved = await deserializeCheckpoint(await serializeCheckpoint(checkpointState(h))),
      state = child.snapshot(),
      crt = w.effekseer.threads.snapshot(),
      mt = w.random.snapshot();
    fresh = await open({
      initialize: false,
      text: parentSource,
      extra: { 'move.kcs': move, 'fractional.kcs': fractional },
    });
    const currentRenderer = fresh.world.screenEffects.rendering,
      collect = currentRenderer.collectDirty.bind(currentRenderer);
    currentRenderer.collectDirty = () => assert.fail('restore queried damage');
    await restoreCheckpoint(fresh, saved);
    currentRenderer.collectDirty = collect;
    const restored = fresh.world.graphics.get(child.record.id),
      restoredInstance = fresh.world.objects.objects.get(h.id).implementation.player.root;
    assert.deepEqual(restored.snapshot(), state);
    assert.equal(restored.graph.textureTransform, restored.graph.kx2);
    assert.deepEqual([...currentRenderer.dirtyCurrent], [0, -1, 28, 7]);
    assert.deepEqual([...currentRenderer.dirtyPrevious], [0, -1, 27, 5]);
    assert.deepEqual(fresh.world.effekseer.threads.snapshot(), crt);
    assert.deepEqual(fresh.world.random.snapshot(), mt);
    const motion = restoredInstance.runtime.snapshot();
    await fresh.present.render();
    assert.equal(restored.graph.boundsDirty, false);
    assert.deepEqual(restored.graph.cachedBounds, [7, 0, 28, 7]);
    assert.deepEqual([...currentRenderer.dirtyCurrent], empty);
    assert.deepEqual([...currentRenderer.dirtyPrevious], [0, -1, 28, 7]);
    assert.deepEqual(restoredInstance.runtime.snapshot(), motion);
    const invalid = restored.snapshot();
    delete invalid.graph.cachedBounds;
    assert.throws(() => restored.restore(invalid), /dirty bounds|damage checkpoint/i);
  } finally {
    if (fresh) await close(fresh);
    await close(h);
  }
});
