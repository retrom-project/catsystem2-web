// SPDX-License-Identifier: MPL-2.0
import test from 'node:test';
import assert from 'node:assert/strict';
import { defaultFESWorld, loadDefaultFES } from './fixtures/default-fes-world.mjs';
import {
  PROFILE,
  SDK,
  open,
  files,
  object,
  task,
  step,
  notify,
  observe,
} from './fixtures/fes-effekseer-world.mjs';
import { EffekseerManagerLifecycle } from '../src/effekseer/manager-lifecycle.mjs';
import { FESCoordinator } from '../src/native/fes-coordinator.mjs';
import { createFESTypedObject } from '../src/native/fes-object-factory.mjs';
import { serializeCheckpoint, deserializeCheckpoint } from '../src/checkpoint.mjs';

test('default76 FES raw36 drives its real2000 manager, loaded texture and ordered messages', async () => {
  const h = await open(),
    w = h.world,
    calls = observe(h);
  try {
    const o = object(h),
      runtime = h.instance.runtime;
    assert.ok(runtime instanceof FESCoordinator);
    assert.equal(o.sizeDirty, true);
    assert.equal(o.nativeTaskID, undefined);
    assert.equal(w.effekseer.threads.forThread('frame').calls, 0);
    await step(h);
    const t = task(h),
      load = w.effekseer.loads.get(t.currentEffect);
    assert.ok(t.manager instanceof EffekseerManagerLifecycle);
    assert.equal(t.record.kind, 61);
    assert.equal(t.record.parent, h.id);
    assert.equal(t.manager.capacity, 2000);
    assert.equal(t.manager.resources, w.effekseer.loads);
    assert.equal(t.manager.threads, w.effekseer.threads);
    assert.ok(load.effect.nodes.some((n) => n.type === 'sprite'));
    assert.ok(load.textures.color[0].token.id > 0);
    assert.equal(load.textures.color[0].frame.format, 21);
    assert.deepEqual(
      calls.map((c) => c.id),
      [569, 51, 49, 66, 57, 59, 47, 571],
    );
    assert.deepEqual(
      calls.map((c) => c.flags),
      [0, 1, 1, 1, 1, 1, 1, 1],
    );
    assert.equal(calls[0].pendingFile, false);
    assert.equal(calls.at(-1).pendingPlay, false);
    assert.ok(calls.every((c) => c.entry === calls[0].entry));
    assert.ok(calls.every((c) => c.sender === h.id && c.target === t.record.id));
    assert.deepEqual([...calls[1].floats], [5, 6, 7]);
    assert.deepEqual([...calls[2].floats], [2, 3, 170]);
    assert.deepEqual([...calls[3].floats], [1, 1, 1]);
    assert.equal(calls[5].w, 1);
    assert.equal(calls[5].l, 0x80abcdef);
    assert.equal(t.manager.sets.size, 1);
    assert.equal(t.manager.sets.get(0).global.count, 1);
    assert.equal(t.manager.freeSlots.length, 2000);
    assert.equal(t.manager.instances.size, 1);
    const root = t.manager.root(t.manager.sets.get(0));
    assert.deepEqual(root.matrix.slice(9, 12), t.position);
    assert.notDeepEqual([...t.position], [5, 6, 7], 'later57 writes the shared camera/play vector');
    assert.deepEqual(w.effekseer.threads.forThread('frame').snapshot(), {
      state: 2745024,
      calls: 1,
      seedCalls: 0,
    });
    assert.equal(o.dirty, false);
    assert.equal(o.playDirty, false);
    assert.equal(runtime.resources.entries[0].previousTaskID, t.record.id);
    w.effekseer.validateReferences();
    assert.equal(w.nativeEngine, undefined);
  } finally {
    await w.close({ flushFiles: false });
  }
});

test('default FES repeat play and stop both dispatch571 and retain old instances and logical tokens', async () => {
  const h = await open(),
    w = h.world;
  try {
    await step(h);
    const t = task(h),
      first = t.currentEffect,
      load = w.effekseer.loads.get(first),
      token = load.textures.color[0].token,
      cursor = w.effekseer.loads.nextTextureID,
      calls = observe(h);
    await notify(h, 'PLAY');
    await notify(h, 'STOP');
    assert.deepEqual(
      calls.map((c) => c.id),
      [571, 571],
    );
    assert.equal(t.manager.sets.size, 3);
    assert.ok([...t.manager.sets.values()].every((s) => !s.stop));
    assert.equal(load.references, 4);
    assert.equal(w.effekseer.loads.nextTextureID, cursor);
    assert.equal(w.effekseer.loads.get(first).textures.color[0].token, token);
    await notify(h, 'CASE');
    assert.equal(t.currentEffect, first);
    assert.equal(object(h).resourceFile, 'scene.efk');
    assert.equal(calls.length, 2, 'ASCII case-only FILE keeps the successful load');
    await notify(h, 'FILE');
    assert.notEqual(t.currentEffect, first);
    const second = w.effekseer.loads.get(t.currentEffect);
    assert.equal(load.references, 3);
    assert.equal(second.references, 1);
    assert.notEqual(second.textures.color[0].token, token);
    assert.ok([...t.manager.sets.values()].every((s) => s.assetID === first));
    w.effekseer.validateReferences();
    await w.objects.release(h.id);
    assert.equal(t.closed, true);
    assert.equal(w.effekseer.loads.loads.size, 0);
    assert.equal(w.effekseer.loads.bindings.size, 0);
    assert.equal(w.effekseer.loads.resources.textures.size, 0);
    assert.equal(w.graphics.tasks.has(t.record.id), false);
  } finally {
    await w.close({ flushFiles: false });
  }
});

test('SIZE destroys previousID and recreates an empty real task without replaying FILE or Play', async () => {
  const h = await open(),
    w = h.world;
  try {
    await step(h);
    const old = task(h),
      oldID = old.record.id,
      calls = observe(h),
      crt = w.effekseer.threads.snapshot();
    await notify(h, 'SIZE');
    const next = task(h),
      entry = h.instance.runtime.resources.entries[0];
    assert.notEqual(next, old);
    assert.equal(old.record.destroyRequested, true);
    assert.equal(old.closed, false, 'message3 defers physical destruction to logic');
    assert.equal(entry.previousTaskID, next.record.id);
    assert.equal(next.currentEffect, null);
    assert.equal(next.manager.sets.size, 0);
    assert.deepEqual(
      calls.map((c) => [c.target, c.id]),
      [[oldID, 3]],
    );
    assert.deepEqual(w.effekseer.threads.snapshot(), crt);
    await w.tick();
    assert.equal(old.closed, true);
    assert.equal(w.objects.objects.has(oldID), false);
    await notify(h, 'DELETE');
    assert.equal(next.record.destroyRequested, true);
    assert.equal(h.instance.runtime.resources.entries.length, 0);
    await w.tick();
    assert.equal(next.closed, true);
    assert.equal(w.effekseer.loads.loads.size, 0);
  } finally {
    await w.close({ flushFiles: false });
  }
});

test('invalid FILE consumes pending before failing, retires current ref and closes all real resources', async () => {
  const h = await open(),
    w = h.world;
  try {
    await step(h);
    const t = task(h),
      first = t.currentEffect,
      calls = observe(h),
      crt = w.effekseer.threads.snapshot();
    await assert.rejects(notify(h, 'BAD'), /SKFE|Effect|magic|effect/);
    assert.equal(calls.at(-1).id, 569);
    assert.equal(calls.at(-1).pendingFile, false);
    assert.equal(object(h).resourcePending, false);
    assert.equal(t.currentEffect, null);
    assert.equal(w.effekseer.loads.get(first).references, 1);
    assert.equal(t.manager.sets.size, 1);
    assert.deepEqual(w.effekseer.threads.snapshot(), crt);
    await w.objects.release(h.id);
    assert.equal(t.closed, true);
    assert.equal(w.effekseer.loads.loads.size, 0);
    assert.equal(w.effekseer.loads.resources.textures.size, 0);
  } finally {
    await w.close({ flushFiles: false });
  }
});

test('default FES close exposes host texture disposal failure and still retires child/load owners', async () => {
  const h = await open(),
    w = h.world,
    failure = Error('authored host texture release failure');
  try {
    await step(h);
    const t = task(h),
      contains = (error) =>
        error === failure || (error instanceof AggregateError && error.errors.some(contains));
    let calls = 0;
    // Observe a real host disposal failure; keep the actual manager/resources.
    w.getNativeGPU = () => ({
      releaseTextureFrame() {
        calls++;
        throw failure;
      },
    });
    await assert.rejects(w.objects.release(h.id), contains);
    assert.equal(calls, 1);
    assert.equal(t.closed, true);
    assert.equal(w.objects.objects.has(t.record.id), false);
    assert.equal(w.objects.objects.has(h.id), false);
    assert.equal(w.effekseer.loads.loads.size, 0);
    assert.equal(w.effekseer.loads.bindings.size, 0);
    assert.equal(w.effekseer.loads.resources.textures.size, 0);
  } finally {
    await w.close({ flushFiles: false });
  }
});

test('settled default FES/current manager fresh restores without FILE, Play, token allocation or RNG', async () => {
  const h = await open(),
    w = h.world;
  let fresh;
  try {
    await step(h);
    await notify(h, 'PLAY');
    await w.tick();
    const t = task(h),
      o = object(h),
      before = t.snapshot(),
      saved = await deserializeCheckpoint(await serializeCheckpoint(w.snapshot()));
    fresh = (await open({ initialize: false })).world;
    const reads = [];
    const read = fresh.game.read.bind(fresh.game);
    fresh.game.read = async (...args) => {
      reads.push(args[0]);
      return read(...args);
    };
    await fresh.restore(saved);
    const restored = fresh.objects.objects.get(h.id).implementation,
      restoredObject = restored.player.root.collection.lookup('fx', 0),
      restoredTask = fresh.objects.objects.get(restoredObject.nativeTaskID).implementation;
    assert.deepEqual(restoredTask.snapshot(), before);
    assert.deepEqual(restoredObject.efkFileBytes, o.efkFileBytes);
    assert.equal(restoredObject.resourceFile, 'scene.efk');
    assert.equal(restored.player.root.runtime.resources.entries[0].previousTaskID, t.record.id);
    assert.deepEqual(fresh.effekseer.snapshot(), w.effekseer.snapshot());
    assert.deepEqual(
      reads.sort(),
      ['case.kcs', 'one.png', 'scene.efk'],
      'fresh validates mounted resource identity without replaying Play',
    );
    assert.equal(Object.hasOwn(saved.effekseer, 'executorEntry'), false);
    assert.equal(
      Object.hasOwn(restored.player.root.runtime.resources.entries[0], 'executorEntry'),
      false,
    );
    fresh.effekseer.validateReferences();
    await Promise.all([w.tick(), fresh.tick()]);
    assert.deepEqual(restoredTask.snapshot(), t.snapshot());
    assert.deepEqual(fresh.effekseer.snapshot(), w.effekseer.snapshot());
    assert.equal(fresh.nativeEngine, undefined);
  } finally {
    await fresh?.close({ flushFiles: false });
    await w.close({ flushFiles: false });
  }
});

test('typed raw36 requires explicit registered capability; SDK default FES fails before resources or RNG', async () => {
  const identity = { type: 'EFKPLANE', nativeType: 36, baseName: 'fx', index: 0 };
  assert.throws(() => createFESTypedObject(identity), /no registered/);
  assert.throws(() => createFESTypedObject(identity, { profile: SDK }), /no registered/);
  assert.throws(
    () => createFESTypedObject(identity, { profile: 'unknown-2.6.1.76' }),
    /Unregistered/,
  );
  const allowed = createFESTypedObject(identity, { profile: PROFILE });
  assert.equal(allowed.nativeType, 36);
  assert.equal(allowed.sizeDirty, true);
  const w = await defaultFESWorld(SDK, files());
  try {
    const crt = w.effekseer.snapshot();
    await assert.rejects(loadDefaultFES(w), /no registered JavaScript implementation/);
    assert.deepEqual(w.effekseer.snapshot(), crt);
    assert.equal(
      [...w.objects.objects.values()].some((r) => r.kind === 61),
      false,
    );
    assert.equal(w.nativeEngine, undefined);
  } finally {
    await w.close({ flushFiles: false });
  }
});

test('default raw36 array reads each load argument once and keeps independent task/load identities', async () => {
  const h = await open({
      text: `#DEFINE
EFKPLANE fx[2]
#OBJECT FILE PRI DISP
fx scene.efk 170 1
#START
fx load scene.efk ++$10
fx play
next IDLE
#IDLE
break
next IDLE
`,
    }),
    w = h.world;
  try {
    await step(h);
    const objects = [0, 1].map((i) => h.instance.collection.lookup('fx', i)),
      children = objects.map((o) => w.objects.objects.get(o.nativeTaskID).implementation),
      loads = children.map((t) => w.effekseer.loads.get(t.currentEffect));
    assert.equal(h.instance.global(10), 2);
    assert.notEqual(children[0], children[1]);
    assert.ok(children.every((t) => t.manager.capacity === 2000 && t.manager.sets.size === 1));
    assert.equal(children[0].manager.threads, children[1].manager.threads);
    assert.notEqual(loads[0].id, loads[1].id);
    assert.notEqual(loads[0].textures.color[0].token, loads[1].textures.color[0].token);
    assert.equal(loads[0].textures.color[0].frame, loads[1].textures.color[0].frame);
    assert.deepEqual(
      h.instance.runtime.resources.entries.map((e) => e.previousTaskID),
      children.map((t) => t.record.id),
    );
    assert.deepEqual(w.effekseer.threads.forThread('frame').snapshot(), {
      state: 3357800067,
      calls: 2,
      seedCalls: 0,
    });
    w.effekseer.validateReferences();
  } finally {
    await w.close({ flushFiles: false });
  }
});
