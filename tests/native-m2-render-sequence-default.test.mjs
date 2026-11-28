// SPDX-License-Identifier: MPL-2.0
import test from 'node:test';
import assert from 'node:assert/strict';
import { dataWorld } from './fixtures/data-world.mjs';
import { kcsProgram } from './helpers.mjs';

test('fresh World M2 shells preserve render sequence and the next new graph order', async () => {
  const profile = 'nekopara-vol3-engine-2.6.1.76',
    files = { 'case.kcs': kcsProgram([[37, 240], [59]]) },
    original = await dataWorld(profile, files);
  let fresh;
  try {
    const before = original.graphics.renderSequence;
    for (let index = 0; index < 3; index++) {
      const id = await original.objects.create({
          kind: 54,
          parent: original.main.id,
          name: `Dormant M2 ${index}`,
        }),
        task = original.objects.objects.get(id).implementation;
      assert.ok(task.graph, 'normal M2 creation constructs its renderable graph');
      assert.equal(task.graph.renderOrder, before + index + 1);
    }
    const checkpoint = structuredClone(original.snapshot()),
      shells = checkpoint.objects.objects.filter((record) => record.kind === 54);
    fresh = await dataWorld(profile, files, { initialize: false });
    assert.equal(fresh.objects.objects.size, 0);
    assert.equal(fresh.runtime.scheduler.programs.size, 0);
    await fresh.restore(structuredClone(checkpoint));
    assert.equal(
      fresh.graphics.renderSequence,
      checkpoint.graphics.renderSequence,
      'restoring saved M2 graphs must not consume new render orders',
    );
    assert.equal(fresh.frame, checkpoint.frame, 'restore does not advance a frame');
    assert.equal(fresh.m2.tasks.size, shells.length);
    for (const saved of shells) {
      const task = fresh.objects.objects.get(saved.id).implementation;
      assert.equal(task.graph.renderOrder, saved.data.plane.graph.renderOrder);
      assert.equal(fresh.m2.tasks.get(saved.id), task);
      assert.equal(task.owner, fresh.m2);
      assert.equal(saved.data.model, null);
      assert.equal(saved.data.oldModel, null);
      assert.equal(task.model ?? null, null);
      assert.equal(task.oldModel ?? null, null);
    }
    assert.deepEqual(
      fresh.snapshot(),
      checkpoint,
      'complete current DTO matches before any warm frame',
    );
    const nextOrders = [];
    for (const world of [original, fresh]) {
      const id = await world.objects.create({ kind: 54, parent: world.main.id, name: 'Next M2' }),
        task = world.objects.objects.get(id).implementation;
      assert.ok(task.graph, 'normal construction still creates the next renderable');
      assert.equal(task.graph.renderOrder, checkpoint.graphics.renderSequence + 1);
      nextOrders.push(task.graph.renderOrder);
    }
    assert.equal(nextOrders[0], nextOrders[1]);
  } finally {
    try {
      await fresh?.close();
    } finally {
      await original.close();
    }
  }
});
