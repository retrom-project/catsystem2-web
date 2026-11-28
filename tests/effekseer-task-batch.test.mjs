// SPDX-License-Identifier: MPL-2.0
// Default Task/current-state tests. The explicit backend below is only the
// existing Node GL command recorder; it is not a runtime GPU/D3D binding owner.
import test from 'node:test';
import assert from 'node:assert/strict';
import { open, step, task } from './fixtures/fes-effekseer-world.mjs';
import { batchEffect } from './fixtures/effekseer/batch-authored.mjs';
import { setup as commandRecorder } from './fixtures/effekseer/gpu-seam.mjs';
import { EffekseerRingCurrentState } from '../src/effekseer/ring-current-state.mjs';
import { EffekseerStandardBatch } from '../src/effekseer/standard-batch.mjs';
import { serializeCheckpoint, deserializeCheckpoint } from '../src/checkpoint.mjs';
const ringEffect = batchEffect({
  colorPaths: ['one.png'],
  nodes: [{ kind: 'ring', position: [0.25, 0, 0], textureIndex: 0 }],
});
const extra = { 'scene.efk': ringEffect };
const flags = { hasCurrentEffect: true, depthStencilEnabled: true };
const bits = (a) => Array.from(new Uint32Array(Float32Array.from(a).buffer));
function recordingBackend() {
  const d = commandRecorder(),
    packets = [],
    original = d.stage.drawEffekseer;
  let currentToken = null;
  d.stage.drawEffekseer = function (packet, frame, options) {
    packets.push({
      vertices: bits(packet.vertices.subarray(0, packet.vertexCount * 10)),
      indices: Array.from(packet.indices.subarray(0, packet.indexCount)),
      camera: bits(packet.camera),
      projection: bits(packet.projection),
      viewport: Array.from(packet.viewport),
      textureID: currentToken?.id ?? null,
      frame: frame && { width: frame.width, height: frame.height, rgba: Array.from(frame.rgba) },
    });
    return original.call(this, packet, frame, options);
  };
  return {
    packets,
    backend: {
      stage: d.stage,
      device: d.view,
      scope: d.scope,
      getViewport: () => d.viewport,
      bindNormalPipeline({ textureToken }) {
        currentToken = textureToken;
        d.scope.bindNormalPipeline();
      },
    },
    close: () => d.scope.close(),
  };
}

test('default FES Task owns a headless MeshBatch borrowing its sole Ring;missing backend is explicit', async () => {
  const h = await open({ extra }),
    w = h.world;
  let ring;
  try {
    const mt = w.random.snapshot();
    await step(h);
    const t = task(h),
      crt = w.effekseer.threads.snapshot(),
      manager = t.manager.snapshot();
    ring = t.ring;
    assert.equal(t.meshBatch.ring, ring);
    assert.equal(t.meshBatch.loads, w.effekseer.loads);
    assert.equal(t.meshBatch.backend, null);
    assert.equal(t.meshBatch.pipeline.device, null);
    assert.deepEqual(w.random.snapshot(), mt, 'no private or extra MT stream');
    assert.deepEqual(t.meshBatch.snapshot(), { batch: { ringCursor: 0 } });
    assert.throws(() => t.meshBatch.draw(t.manager, flags), /explicit current backend/);
    assert.deepEqual(t.manager.snapshot(), manager);
    assert.deepEqual(w.effekseer.threads.snapshot(), crt);
    assert.deepEqual(t.meshBatch.snapshot(), { batch: { ringCursor: 0 } });
    assert.equal(t.meshBatch.backend, null);
    assert.throws(() => t.plane.drawGPU(), /current World StageRenderer GPU/);
    t.meshBatch.close();
    assert.doesNotThrow(() => ring.assertOpen(), 'borrower close cannot retire the Task Ring');
  } finally {
    await w.close({ flushFiles: false });
  }
  assert.throws(() => ring.assertOpen(), /closed/);
});

test('true fresh default World saves and restores Task Ring and nonzero batch cursor once without replay', async () => {
  const h = await open({ extra }),
    w = h.world,
    a = recordingBackend(),
    b = recordingBackend();
  const methods = [
    [EffekseerRingCurrentState.prototype, 'snapshot'],
    [EffekseerRingCurrentState.prototype, 'restore'],
    [EffekseerRingCurrentState.prototype, 'close'],
    [EffekseerStandardBatch.prototype, 'snapshot'],
    [EffekseerStandardBatch.prototype, 'restore'],
  ];
  const counters = methods.map(() => new WeakMap());
  const originals = methods.map(([prototype, method]) => prototype[method]);
  methods.forEach(([prototype, method], i) => {
    prototype[method] = function (...args) {
      counters[i].set(this, (counters[i].get(this) ?? 0) + 1);
      return originals[i].apply(this, args);
    };
  });
  let fresh, t, restored;
  try {
    await step(h);
    await w.tick();
    await w.tick();
    t = task(h);
    const crt = w.effekseer.threads.snapshot(),
      mt = w.random.snapshot(),
      ages = [...t.manager.instances.values()].map((i) => [i.id, i.age]);
    const result = t.meshBatch.draw(t.manager, { ...flags, backend: a.backend });
    assert.ok(result.drawCalls > 0);
    assert.ok(a.packets.length > 0);
    assert.ok(t.meshBatch.batch.cursor > 0);
    assert.equal(t.meshBatch.ring, t.ring);
    assert.notEqual(t.ring.matrix[12], 0);
    assert.equal(t.meshBatch.backend, null);
    assert.equal(t.meshBatch.pipeline.device, null);
    assert.deepEqual(
      [...t.manager.instances.values()].map((i) => [i.id, i.age]),
      ages,
    );
    assert.deepEqual(w.effekseer.threads.snapshot(), crt);
    assert.deepEqual(w.random.snapshot(), mt);
    const ringWords = bits(t.ring.matrix),
      cursor = t.meshBatch.batch.cursor,
      ringBefore = counters[0].get(t.ring) ?? 0,
      cursorBefore = counters[3].get(t.meshBatch.batch) ?? 0,
      savedTask = t.snapshot();
    assert.equal(counters[0].get(t.ring), ringBefore + 1);
    assert.equal(counters[3].get(t.meshBatch.batch), cursorBefore + 1);
    assert.deepEqual(Object.keys(savedTask.meshBatch), ['batch']);
    assert.deepEqual(savedTask.meshBatch.batch, { ringCursor: cursor });
    assert.equal(savedTask.meshBatch.ring, undefined, 'Ring has one outer snapshot authority');
    const saved = await deserializeCheckpoint(await serializeCheckpoint(w.snapshot()));
    assert.equal(
      counters[0].get(t.ring),
      ringBefore + 2,
      'one further World snapshot visits Ring once',
    );
    assert.equal(counters[3].get(t.meshBatch.batch), cursorBefore + 2);
    fresh = (await open({ initialize: false, extra })).world;
    await fresh.restore(saved);
    restored = fresh.objects.objects.get(t.record.id).implementation;
    assert.equal(restored.meshBatch.ring, restored.ring);
    assert.equal(counters[1].get(restored.ring), 1);
    assert.equal(counters[4].get(restored.meshBatch.batch), 1);
    assert.deepEqual(bits(restored.ring.matrix), ringWords);
    assert.equal(restored.meshBatch.batch.cursor, cursor);
    assert.deepEqual(restored.manager.snapshot(), t.manager.snapshot());
    assert.equal(restored.manager.threads, fresh.effekseer.threads);
    assert.equal(restored.meshBatch.loads, fresh.effekseer.loads);
    assert.deepEqual(fresh.effekseer.snapshot(), w.effekseer.snapshot());
    assert.deepEqual(fresh.random.snapshot(), mt);
    assert.throws(() => restored.plane.drawGPU(), /current World StageRenderer GPU/);
    a.packets.length = 0;
    t.meshBatch.draw(t.manager, { ...flags, backend: a.backend });
    restored.meshBatch.draw(restored.manager, { ...flags, backend: b.backend });
    assert.deepEqual(b.packets, a.packets);
    assert.deepEqual(restored.meshBatch.snapshot(), t.meshBatch.snapshot());
    assert.deepEqual(bits(restored.ring.matrix), bits(t.ring.matrix));
    assert.deepEqual(fresh.effekseer.threads.snapshot(), crt);
    assert.deepEqual(w.effekseer.threads.snapshot(), crt);
    assert.deepEqual(fresh.random.snapshot(), mt);
    assert.deepEqual(w.random.snapshot(), mt);
    await fresh.close({ flushFiles: false });
    await w.close({ flushFiles: false });
    assert.equal(counters[2].get(t.ring), 1);
    assert.equal(counters[2].get(restored.ring), 1);
  } finally {
    await fresh?.close({ flushFiles: false });
    await w.close({ flushFiles: false });
    a.close();
    b.close();
    methods.forEach(([prototype, method], i) => {
      prototype[method] = originals[i];
    });
  }
});
