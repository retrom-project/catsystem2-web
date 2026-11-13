// SPDX-License-Identifier: MPL-2.0
// Physical scope/current CPU-state seam. The default Task callback is also
// mounted; these tests also pass its existing manager/batch an explicit backend.
import test from 'node:test';
import assert from 'node:assert/strict';
import { openPhysicalWorld, ages } from './fixtures/effekseer/physical-world.mjs';
import { batchEffect } from './fixtures/effekseer/batch-authored.mjs';
import { EffekseerDeviceScope, EFFEKSEER_RESTORED_STATES } from '../src/effekseer/materials.mjs';
import {
  EffekseerSharedDeviceView,
  isEffekseerDeviceInvalidation,
} from '../src/effekseer/shared-device-view.mjs';
const extra = {
  'scene.efk': batchEffect({ colorPaths: ['one.png'], nodes: [{ textureIndex: 0 }] }),
};
function backend(h, task = h.effectTask) {
  const viewport = new Float32Array(6),
    gpu = h.gpu;
  const device = new EffekseerSharedDeviceView({
      context: h.world.graphics.d3dContext,
      gpu,
      viewport: () => viewport,
    }),
    scope = new EffekseerDeviceScope(device),
    b = {
      stage: h.world.stageRenderer,
      device,
      scope,
      getViewport: () => viewport,
      bindNormalPipeline: () => scope.bindNormalPipeline(),
      draw() {
        scope.assertEntry();
        viewport.set(gpu.gl.getParameter(gpu.gl.VIEWPORT));
        viewport.set(gpu.gl.getParameter(gpu.gl.DEPTH_RANGE), 4);
        return task.meshBatch.draw(task.manager, {
          hasCurrentEffect: task.currentEffect !== null,
          depthStencilEnabled: h.world.graphics.d3dContext.depthStencilEnabled,
          backend: b,
        });
      },
    };
  return b;
}
const uniforms = (program) =>
  [...program.uniforms].map(([name, v]) => [
    name,
    ArrayBuffer.isView(v.value) ? v.value.slice() : v.value,
  ]);

test('C7 scope uses real physical operations, restores12states/bindings and submits through the default Task shared backend', async () => {
  const h = await openPhysicalWorld({ extra }),
    { world: w, gpu, effectTask: t, api } = h,
    b = backend(h);
  try {
    assert.equal(b.device.getBinding, undefined);
    assert.equal(b.device.setBinding, undefined);
    gpu.beginFrame();
    const states = EFFEKSEER_RESTORED_STATES.map((name) => b.device.getState(name)),
      beforeUniforms = uniforms(gpu.program),
      beforeArray = api.state.arrayBuffer,
      beforeVAO = api.state.vertexArray,
      beforeElements = api.vaos.get(beforeVAO).element,
      crt = w.effekseer.threads.snapshot(),
      mt = w.random.snapshot(),
      a = ages(t.manager),
      target = gpu.target,
      depth = gpu.target.depthStencil;
    const result = b.draw();
    assert.ok(result.drawCalls > 0 && result.vertexCount > 0 && result.indexCount > 0);
    assert.equal(t.meshBatch.ring, t.ring);
    assert.deepEqual(
      EFFEKSEER_RESTORED_STATES.map((name) => b.device.getState(name)),
      states,
    );
    assert.deepEqual(uniforms(gpu.program), beforeUniforms);
    assert.equal(api.state.arrayBuffer, beforeArray);
    assert.equal(api.state.vertexArray, beforeVAO);
    assert.equal(api.vaos.get(beforeVAO).element, beforeElements);
    assert.equal(gpu.target, target);
    assert.equal(gpu.target.depthStencil, depth);
    assert.equal(b.scope.active, false);
    assert.equal(b.scope.capture.active, false);
    assert.equal(b.scope.capture.program, null);
    assert.ok(b.scope.capture.textures.every((x) => x === null));
    assert.deepEqual(w.effekseer.threads.snapshot(), crt);
    assert.deepEqual(w.random.snapshot(), mt);
    assert.deepEqual(ages(t.manager), a);
    assert.equal(t.plane.drawGPU(gpu), 1);
    assert.equal(t.gpuBackend.gpu, gpu);
    assert.equal(t.gpuBackend.stage, w.stageRenderer);
    assert.equal(t.gpuBackend.scope.capture.active, false);
    assert.deepEqual(w.effekseer.threads.snapshot(), crt);
    assert.deepEqual(w.random.snapshot(), mt);
    assert.deepEqual(ages(t.manager), a);
    gpu.endNativeFrame();
  } finally {
    b.scope.close();
    await w.close({ flushFiles: false });
  }
});

test('branded loss keeps current CPU owners/cursor, supports fresh current-state restore and later same-owner drawing', async () => {
  const h = await openPhysicalWorld({ extra }),
    { world: w, gpu, effectTask: t, api } = h,
    b = backend(h);
  let fresh, freshBackend;
  try {
    gpu.beginFrame();
    const batch = t.meshBatch,
      ring = t.ring,
      crt = w.effekseer.threads.snapshot(),
      mt = w.random.snapshot(),
      beforeAges = ages(t.manager),
      original = w.stageRenderer.drawEffekseer;
    w.stageRenderer.drawEffekseer = function (...args) {
      const result = original.apply(this, args);
      api.state.lost = true;
      return result;
    };
    assert.throws(() => b.draw(), isEffekseerDeviceInvalidation);
    assert.equal(batch.fault, null);
    assert.equal(batch.backend, null);
    assert.equal(batch.batch.active, false);
    assert.ok(batch.batch.cursor > 0);
    assert.equal(t.meshBatch, batch);
    assert.equal(t.ring, ring);
    assert.deepEqual(w.effekseer.threads.snapshot(), crt);
    assert.deepEqual(w.random.snapshot(), mt);
    assert.deepEqual(ages(t.manager), beforeAges);
    const saved = t.snapshot(),
      resources = w.effekseer.snapshot(),
      cursor = batch.batch.cursor;
    fresh = await openPhysicalWorld({ initialize: false, extra });
    await fresh.world.effekseer.restore(structuredClone(resources));
    const id = await fresh.world.objects.create({ kind: 61, parent: null }),
      restored = fresh.world.objects.objects.get(id).implementation;
    restored.restore(structuredClone(saved));
    assert.deepEqual(restored.snapshot(), saved);
    assert.equal(restored.meshBatch.ring, restored.ring);
    assert.deepEqual(fresh.world.effekseer.threads.snapshot(), crt);
    assert.deepEqual(fresh.world.random.snapshot(), mt);
    freshBackend = backend(fresh, restored);
    fresh.gpu.beginFrame();
    assert.ok(freshBackend.draw().drawCalls > 0);
    assert.deepEqual(fresh.world.effekseer.threads.snapshot(), crt);
    assert.deepEqual(fresh.world.random.snapshot(), mt);
    fresh.gpu.endNativeFrame();
    t.onLostDevice();
    for (const object of api.objects) object.deleted = true;
    api.state.lost = false;
    gpu.devicePort.restored();
    await gpu.devicePort.rebuild();
    t.onResetDevice();
    w.stageRenderer.drawEffekseer = original;
    gpu.beginFrame();
    assert.ok(b.draw().drawCalls > 0);
    assert.equal(t.meshBatch, batch);
    assert.equal(t.ring, ring);
    assert.ok(batch.batch.cursor >= cursor);
    assert.deepEqual(w.effekseer.threads.snapshot(), crt);
    assert.deepEqual(w.random.snapshot(), mt);
    gpu.endNativeFrame();
  } finally {
    freshBackend?.scope.close();
    await fresh?.world.close({ flushFiles: false });
    b.scope.close();
    await w.close({ flushFiles: false });
  }
});

test('nonready entry rejects before a CPU pass while arbitrary and cleanup errors remain permanently faulted', async () => {
  for (const mode of ['entry', 'unknown-with-loss', 'cleanup']) {
    const h = await openPhysicalWorld({ extra }),
      { world: w, gpu, effectTask: t, api } = h,
      b = backend(h);
    try {
      const batch = t.meshBatch,
        ring = t.ring,
        saved = batch.snapshot(),
        wasFresh = batch.fresh,
        crt = w.effekseer.threads.snapshot();
      gpu.beginFrame();
      if (mode === 'entry') {
        api.state.lost = true;
        assert.throws(
          () =>
            batch.draw(t.manager, {
              hasCurrentEffect: t.currentEffect !== null,
              depthStencilEnabled: w.graphics.d3dContext.depthStencilEnabled,
              backend: b,
            }),
          /Graphics device is lost/,
        );
        assert.equal(batch.fault, null);
        assert.equal(batch.fresh, wasFresh);
        assert.equal(batch.drawing, false);
        assert.deepEqual(batch.snapshot(), saved);
      } else if (mode === 'unknown-with-loss') {
        w.stageRenderer.drawEffekseer = () => {
          api.state.lost = true;
          throw new Error('retained unknown draw failure');
        };
        assert.throws(
          () => b.draw(),
          (e) => e instanceof AggregateError && !isEffekseerDeviceInvalidation(e),
        );
      } else {
        const submit = w.stageRenderer.drawEffekseer;
        w.stageRenderer.drawEffekseer = function (...args) {
          const value = submit.apply(this, args);
          api.state.failRestore = true;
          return value;
        };
        assert.throws(() => b.draw(), /retained framebuffer restore failure/);
      }
      if (mode !== 'entry') {
        assert.ok(batch.fault);
        t.onResetDevice();
        assert.throws(() => batch.snapshot(), /faulted/);
      }
      assert.equal(t.meshBatch, batch);
      assert.equal(t.ring, ring);
      assert.equal(batch.backend, null);
      assert.equal(b.scope.capture.active, false);
      assert.equal(b.scope.capture.program, mode === 'entry' ? undefined : null);
      assert.deepEqual(w.effekseer.threads.snapshot(), crt);
      assert.equal(isEffekseerDeviceInvalidation(new AggregateError([])), false);
      const cyclic = new AggregateError([]);
      cyclic.errors.push(cyclic);
      assert.equal(isEffekseerDeviceInvalidation(cyclic), false);
      const sparse = new AggregateError([]);
      sparse.errors = new Array(1);
      assert.equal(isEffekseerDeviceInvalidation(sparse), false);
    } finally {
      api.state.failRestore = false;
      b.scope.close();
      await w.close({ flushFiles: false });
    }
  }
});

test('unknown abort cleanup survives a later real branded physical loss and permanently faults the same CPU owner', async () => {
  const h = await openPhysicalWorld({
      extra: {
        'scene.efk': batchEffect({
          colorPaths: ['one.png'],
          nodes: [{ textureIndex: 0 }, { textureIndex: 0, blend: 2 }],
        }),
      },
    }),
    { world: w, gpu, effectTask: t, api } = h,
    b = backend(h),
    batch = t.meshBatch,
    ring = t.ring,
    abortFailure = new Error('retained unknown abort cleanup'),
    abort = batch.batch.abort,
    end = b.scope.end,
    submit = w.stageRenderer.drawEffekseer,
    crt = w.effekseer.threads.snapshot(),
    mt = w.random.snapshot(),
    beforeAges = ages(t.manager);
  let abortCalls = 0,
    endCalls = 0,
    submissions = 0,
    submittedCursor = null,
    primary,
    endFailure,
    failure;
  batch.batch.abort = function () {
    abortCalls++;
    abort.call(this);
    assert.equal(this.active, false);
    assert.equal(this.byteLength, 0);
    throw abortFailure;
  };
  b.scope.end = function () {
    endCalls++;
    try {
      return end.call(this);
    } catch (error) {
      endFailure = error;
      throw error;
    }
  };
  w.stageRenderer.drawEffekseer = function (...args) {
    submit.apply(this, args);
    submissions++;
    submittedCursor = batch.batch.cursor;
    api.state.lost = true;
    try {
      // Actual active capture + actual shared-device loss produces the brand.
      // The following physical End also calls the real restoreBindings path.
      b.scope.bindNormalPipeline();
    } catch (error) {
      primary = error;
      throw error;
    }
  };
  try {
    gpu.beginFrame();
    try {
      b.draw();
    } catch (error) {
      failure = error;
    }
    assert.ok(isEffekseerDeviceInvalidation(primary));
    assert.ok(isEffekseerDeviceInvalidation(endFailure));
    assert.equal(abortCalls, 1);
    assert.equal(endCalls, 1);
    const leaves = (error) =>
      error instanceof AggregateError ? error.errors.flatMap(leaves) : [error];
    const retained = leaves(failure);
    assert.ok(retained.includes(primary), 'retain the primary draw failure');
    assert.ok(retained.includes(abortFailure), 'retain the unknown abort failure');
    assert.ok(retained.includes(endFailure), 'retain the later physical End failure');
    assert.equal(isEffekseerDeviceInvalidation(failure), false);
    assert.equal(batch.fault, failure);
    assert.equal(submissions, 1);
    assert.ok(submittedCursor > 0);
    assert.equal(batch.batch.cursor, submittedCursor);
    assert.equal(batch.batch.active, false);
    assert.equal(batch.batch.byteLength, 0);
    assert.equal(batch.backend, null);
    assert.equal(batch.pipeline.device, null);
    assert.equal(batch.drawing, false);
    assert.equal(b.scope.active, false);
    assert.equal(b.scope.capture.active, false);
    assert.equal(b.scope.capture.program, null);
    assert.equal(t.meshBatch, batch);
    assert.equal(t.ring, ring);
    assert.deepEqual(w.effekseer.threads.snapshot(), crt);
    assert.deepEqual(w.random.snapshot(), mt);
    assert.deepEqual(ages(t.manager), beforeAges);
    t.onResetDevice();
    assert.throws(() => batch.snapshot(), /faulted/);
    assert.throws(() => batch.draw(t.manager), /faulted/);
    assert.equal(batch.batch.cursor, submittedCursor);
  } finally {
    batch.batch.abort = abort;
    b.scope.end = end;
    b.scope.close();
    await w.close({ flushFiles: false });
  }
});
