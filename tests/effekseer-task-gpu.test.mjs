// SPDX-License-Identifier: MPL-2.0
import test from 'node:test';
import assert from 'node:assert/strict';
import { openPhysicalWorld as openTaskGPU, ages } from './fixtures/effekseer/physical-world.mjs';
import { notify, source } from './fixtures/fes-effekseer-world.mjs';
import { MOTION_ABI } from '../src/motion/abi.mjs';
import { isEffekseerDeviceInvalidation } from '../src/effekseer/shared-device-view.mjs';
import { batchEffect } from './fixtures/effekseer/batch-authored.mjs';
const extra = {
  'scene.efk': batchEffect({ colorPaths: ['one.png'], nodes: [{ textureIndex: 0 }] }),
};
function observe(h) {
  const t = h.effectTask,
    packets = [],
    original = h.world.stageRenderer.drawEffekseer;
  h.world.stageRenderer.drawEffekseer = function (packet, frame, options) {
    packets.push({
      vertexCount: packet.vertexCount,
      indexCount: packet.indexCount,
      camera: Array.from(packet.camera),
      projection: Array.from(packet.projection),
      positions: Array.from({ length: packet.vertexCount }, (_, i) =>
        Array.from(packet.vertices.slice(i * 10, i * 10 + 3)),
      ),
      frame,
      target: h.gpu.target,
      depth: h.gpu.target.depthStencil,
      context: options.context,
    });
    return original.call(this, packet, frame, options);
  };
  return { t, packets };
}

test('real default FES callback submits its current manager, loaded texture and camera to the one shared backend without Update/RNG/read', async () => {
  const h = await openTaskGPU({ extra }),
    { world: w, gpu } = h,
    { t, packets } = observe(h);
  try {
    assert.equal(t.meshBatch.ring, t.ring);
    assert.equal(gpu.graphicsDevice, w.graphics.device);
    assert.equal(w.stageRenderer.graphicsDevice, w.graphics.device);
    assert.equal(t.gpuBackend, null);
    const crt = w.effekseer.threads.snapshot(),
      mt = w.random.snapshot(),
      beforeAges = ages(t.manager),
      frame = w.frame,
      original = w.game.read;
    w.game.read = () => {
      throw new Error('render tried to reread a mounted resource');
    };
    gpu.beginFrame();
    const target = gpu.target,
      depth = target.depthStencil;
    const callbackItem = w.screenEffects.rendering
      .currentFrame()
      .items.find((item) => item.p?.nativeTaskWorldID === t.record.id);
    assert.equal(callbackItem.p.nativeGraph, t.plane.graph);
    new DataView(t.plane.graph.kx2.buffer).setUint32(MOTION_ABI.color, 0, true);
    t.plane.graph.kx2.fill(0, MOTION_ABI.matrix, MOTION_ABI.matrix + 64);
    await w.screenEffects.rendering.drawRange(170, 171);
    assert.ok(packets.length > 0);
    assert.ok(packets.some((p) => p.vertexCount > 0 && p.indexCount > 0));
    assert.ok(packets.every((p) => p.target === target && p.depth === depth));
    assert.ok(packets.every((p) => p.context === w.graphics.d3dContext));
    assert.ok(packets.every((p) => p.camera.every((x, i) => Object.is(x, t.camera[i]))));
    assert.ok(packets.every((p) => p.projection.every((x, i) => Object.is(x, t.projection[i]))));
    const load = t.loads.get(t.currentEffect),
      binding = load.textures.color[0];
    assert.ok(binding.token);
    assert.equal(packets[0].frame, t.loads.bindingFor(binding.token).frame);
    assert.equal(t.gpuBackend.scope.active, false);
    assert.equal(t.gpuBackend.scope.capture.active, false);
    assert.equal(t.gpuBackend.scope.capture.program, null);
    assert.equal(t.plane.drawGPU(gpu), 1);
    assert.deepEqual(w.effekseer.threads.snapshot(), crt);
    assert.deepEqual(w.random.snapshot(), mt);
    assert.deepEqual(ages(t.manager), beforeAges);
    assert.equal(w.frame, frame);
    w.game.read = original;
    gpu.endNativeFrame();
  } finally {
    await w.close({ flushFiles: false });
  }
});

test('known captured device loss aborts transient bytes but preserves the same Task batch/Ring/cursor and can draw after reset', async () => {
  const h = await openTaskGPU({ extra }),
    { world: w, gpu, effectTask: t, api } = h;
  try {
    const batch = t.meshBatch,
      ring = t.ring,
      crt = w.effekseer.threads.snapshot(),
      beforeAges = ages(t.manager);
    gpu.beginFrame();
    const submit = w.stageRenderer.drawEffekseer;
    w.stageRenderer.drawEffekseer = function (...args) {
      const result = originalSubmit(...args);
      api.state.lost = true; // Explicit driver-lifecycle boundary after actual submission.
      return result;
    };
    const originalSubmit = submit.bind(w.stageRenderer);
    let error;
    try {
      t.plane.drawGPU(gpu);
    } catch (e) {
      error = e;
    }
    assert.ok(isEffekseerDeviceInvalidation(error));
    assert.equal(batch.fault, null);
    assert.equal(batch.backend, null);
    assert.equal(batch.batch.active, false);
    assert.ok(batch.batch.cursor > 0);
    const cursor = batch.batch.cursor;
    const saved = t.snapshot();
    assert.equal(saved.meshBatch.batch.ringCursor, cursor);
    assert.deepEqual(w.effekseer.threads.snapshot(), crt);
    assert.deepEqual(ages(t.manager), beforeAges);
    assert.equal(t.meshBatch, batch);
    assert.equal(t.ring, ring);
    t.onLostDevice();
    for (const object of api.objects) object.deleted = true;
    api.state.lost = false;
    gpu.devicePort.restored();
    await gpu.devicePort.rebuild();
    t.onResetDevice();
    w.stageRenderer.drawEffekseer = submit;
    gpu.beginFrame();
    assert.equal(t.plane.drawGPU(gpu), 1);
    assert.equal(t.meshBatch, batch);
    assert.equal(t.ring, ring);
    assert.ok(batch.batch.cursor >= cursor);
    assert.deepEqual(w.effekseer.threads.snapshot(), crt);
    assert.deepEqual(ages(t.manager), beforeAges);
    gpu.endNativeFrame();
  } finally {
    await w.close({ flushFiles: false });
  }
});

test('unknown submission/cleanup errors stay permanently faulted even alongside a proven device loss', async () => {
  const h = await openTaskGPU({ extra }),
    { world: w, gpu, effectTask: t, api } = h;
  try {
    gpu.beginFrame();
    w.stageRenderer.drawEffekseer = () => {
      api.state.lost = true;
      throw new Error('retained unknown GPU error');
    };
    assert.throws(
      () => t.plane.drawGPU(gpu),
      (e) => e instanceof AggregateError && !isEffekseerDeviceInvalidation(e),
    );
    assert.ok(t.meshBatch.fault);
    t.onLostDevice();
    t.onResetDevice();
    assert.throws(() => t.meshBatch.snapshot(), /faulted/);
    assert.equal(isEffekseerDeviceInvalidation(new AggregateError([])), false);
    assert.equal(t.meshBatch.backend, null);
    assert.equal(t.gpuBackend.scope.capture.active, false);
  } finally {
    await w.close({ flushFiles: false });
  }
});

test('fresh default factory rebinds current resources and Task state to its own GPU without Play or random sampling', async () => {
  const h = await openTaskGPU({ extra }),
    { world: w, gpu, effectTask: t } = h;
  let fresh;
  try {
    gpu.beginFrame();
    t.plane.drawGPU(gpu);
    gpu.endNativeFrame();
    const cpu = t.snapshot(),
      resources = w.effekseer.snapshot(),
      crt = w.effekseer.threads.snapshot(),
      mt = w.random.snapshot();
    fresh = await openTaskGPU({ initialize: false, extra });
    await fresh.world.effekseer.restore(structuredClone(resources));
    const id = await fresh.world.objects.create({ kind: 61, parent: null }),
      restored = fresh.world.objects.objects.get(id).implementation;
    restored.restore(structuredClone(cpu));
    assert.equal(restored.gpuBackend, null);
    assert.equal(restored.meshBatch.ring, restored.ring);
    assert.deepEqual(restored.snapshot(), cpu);
    assert.deepEqual(fresh.world.effekseer.threads.snapshot(), crt);
    assert.deepEqual(fresh.world.random.snapshot(), mt);
    fresh.gpu.beginFrame();
    assert.equal(restored.plane.drawGPU(fresh.gpu), 1);
    assert.equal(restored.gpuBackend.stage, fresh.world.stageRenderer);
    assert.equal(restored.gpuBackend.gpu, fresh.gpu);
    assert.notEqual(restored.gpuBackend.gpu, gpu);
    assert.deepEqual(fresh.world.effekseer.threads.snapshot(), crt);
    assert.deepEqual(fresh.world.random.snapshot(), mt);
    fresh.gpu.endNativeFrame();
  } finally {
    await fresh?.world.close({ flushFiles: false });
    await w.close({ flushFiles: false });
  }
});

test('nonready or foreign entry is rejected before manager draw and a closed Task stays closed', async () => {
  const h = await openTaskGPU({ extra }),
    { world: w, gpu, effectTask: t, api } = h;
  const batch = t.meshBatch,
    ring = t.ring;
  try {
    const cpu = t.snapshot(),
      crt = w.effekseer.threads.snapshot();
    assert.throws(() => t.drawGPU({}), /current World StageRenderer GPU/);
    api.state.lost = true;
    assert.throws(() => t.drawGPU(gpu), /Graphics device is lost/);
    assert.deepEqual(t.snapshot(), cpu);
    assert.deepEqual(w.effekseer.threads.snapshot(), crt);
    assert.equal(t.gpuBackend, null);
    assert.equal(batch.fault, null);
    assert.equal(t.meshBatch, batch);
    assert.equal(t.ring, ring);
    await notify(h, 'DELETE');
    assert.equal(t.record.destroyRequested, true);
    assert.equal(t.closed, false);
    await w.tick();
    assert.equal(w.objects.objects.has(t.record.id), false);
    assert.equal(t.gpuBackend, null);
    assert.throws(() => t.drawGPU(gpu), /closed/);
  } finally {
    await w.close({ flushFiles: false });
  }
});

test('arbitrary physical cleanup throws cannot be branded as transient device loss', async () => {
  const h = await openTaskGPU({ extra }),
    { world: w, gpu, effectTask: t, api } = h;
  try {
    gpu.beginFrame();
    const submit = w.stageRenderer.drawEffekseer;
    w.stageRenderer.drawEffekseer = function (...args) {
      const result = submit.apply(this, args);
      api.state.failRestore = true;
      return result;
    };
    assert.throws(() => t.plane.drawGPU(gpu), /retained framebuffer restore failure/);
    assert.ok(t.meshBatch.fault);
    assert.equal(isEffekseerDeviceInvalidation(t.meshBatch.fault), false);
    assert.equal(t.gpuBackend.scope.capture.active, false);
    assert.equal(t.gpuBackend.scope.capture.program, null);
    t.onResetDevice();
    assert.throws(() => t.meshBatch.snapshot(), /faulted/);
    api.state.failRestore = false;
    gpu.endNativeFrame();
  } finally {
    api.state.failRestore = false;
    await w.close({ flushFiles: false });
  }
});

test('eligible loaded Effect with an empty manager returns one without fabricating a mesh submission', async () => {
  const h = await openTaskGPU({ initialize: false, extra }),
    { world: w, gpu } = h;
  try {
    const id = await w.objects.create({ kind: 61, parent: null }),
      t = w.objects.objects.get(id).implementation;
    await w.sendEngine(id, id, 569, 0, 0, { payload: { string: () => 'scene.efk' } });
    await w.sendEngine(id, id, 47, 0, 1);
    const crt = w.effekseer.threads.snapshot(),
      mt = w.random.snapshot();
    assert.equal(t.manager.sets.size, 0);
    gpu.beginFrame();
    const before = h.api.calls.filter(([name]) => name === 'drawElements').length;
    assert.equal(t.plane.drawGPU(gpu), 1);
    assert.equal(h.api.calls.filter(([name]) => name === 'drawElements').length, before);
    assert.equal(t.meshBatch.result.drawCalls, 0);
    assert.deepEqual(w.effekseer.threads.snapshot(), crt);
    assert.deepEqual(w.random.snapshot(), mt);
    gpu.endNativeFrame();
  } finally {
    await w.close({ flushFiles: false });
  }
});

test('default FES authored origin survives camera sync into the real Task backend packed vertices', async () => {
  const h = await openTaskGPU({
      text: source.replace('5,6,7 2,3,4', '0,0,0 0,0,0'),
      extra: {
        'scene.efk': batchEffect({
          colorPaths: ['one.png'],
          nodes: [{ textureIndex: 0, corners: [-2, -2, 2, -2, -2, 2, 2, 2] }],
        }),
      },
    }),
    { world: w, gpu } = h,
    { t, packets } = observe(h);
  try {
    assert.deepEqual(t.position, new Float32Array(3));
    const cpu = t.manager.snapshot(),
      crt = w.effekseer.threads.snapshot(),
      mt = w.random.snapshot(),
      frame = w.frame;
    gpu.beginFrame();
    await w.screenEffects.rendering.drawRange(170, 171);
    assert.ok(packets.length > 0);
    for (const packet of packets)
      assert.deepEqual(packet.positions, [
        [-2, -2, 0],
        [2, -2, 0],
        [-2, 2, 0],
        [2, 2, 0],
      ]);
    assert.equal(t.gpuBackend.gpu, gpu);
    assert.equal(t.gpuBackend.stage, w.stageRenderer);
    assert.equal(t.meshBatch.ring, t.ring);
    assert.deepEqual(t.manager.snapshot(), cpu);
    assert.deepEqual(w.effekseer.threads.snapshot(), crt);
    assert.deepEqual(w.random.snapshot(), mt);
    assert.equal(w.frame, frame);
    gpu.endNativeFrame();
  } finally {
    await w.close({ flushFiles: false });
  }
});
