// SPDX-License-Identifier: MPL-2.0
import test from 'node:test';
import assert from 'node:assert/strict';
import { open, source, step, task, observe } from './fixtures/fes-effekseer-world.mjs';

test('default FES POS survives the later camera message and fresh restoration of its real Play root', async () => {
  const text = source.replace('5,6,7 2,3,4', '0,0,0 0,0,0'),
    h = await open({ text }),
    w = h.world,
    calls = observe(h);
  let fresh;
  try {
    await step(h);
    const t = task(h),
      roots = [...t.manager.sets.values()].map((set) => t.manager.root(set).matrix.slice(9, 12));
    assert.deepEqual(
      calls.filter((call) => [51, 57, 571].includes(call.id)).map((call) => call.id),
      [51, 57, 571],
    );
    assert.deepEqual([...calls.find((call) => call.id === 51).floats], [0, 0, 0]);
    assert.deepEqual(
      t.position,
      new Float32Array(3),
      'camera message must preserve the authored POS',
    );
    assert.deepEqual(roots, [new Float32Array(3)], 'real Play must receive that same position');
    const current = t.snapshot(),
      worldState = structuredClone(w.snapshot()),
      crt = w.effekseer.threads.snapshot();
    fresh = (await open({ text, initialize: false })).world;
    await fresh.restore(worldState);
    const restored = fresh.objects.objects.get(t.record.id).implementation;
    assert.deepEqual(restored.snapshot(), current);
    assert.deepEqual(restored.position, new Float32Array(3));
    assert.deepEqual(
      [...restored.manager.sets.values()].map((set) =>
        restored.manager.root(set).matrix.slice(9, 12),
      ),
      roots,
    );
    assert.deepEqual(fresh.effekseer.threads.snapshot(), crt, 'fresh restore must not replay Play');
    assert.deepEqual(w.effekseer.threads.snapshot(), crt);
    assert.equal(w.nativeEngine, undefined);
    assert.equal(fresh.nativeEngine, undefined);
  } finally {
    await fresh?.close({ flushFiles: false });
    await w.close({ flushFiles: false });
  }
});
