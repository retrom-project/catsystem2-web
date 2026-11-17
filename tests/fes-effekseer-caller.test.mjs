// SPDX-License-Identifier: MPL-2.0
import { fesLabelPayload } from './fixtures/default-fes-world.mjs';
import test from 'node:test';
import { ownsOriginalWorld } from '../oracle/world-operations.mjs';
import assert from 'node:assert/strict';
import { open, object, task, step, notify, observe } from './fixtures/fes-effekseer-world.mjs';

function visits(h) {
  const seen = [],
    fifo = h.instance.runtime.resources,
    visit = fifo.visit.bind(fifo);
  fifo.visit = async (entry, semantic, context) => {
    await Promise.resolve();
    seen.push(context.executorEntry);
    return visit(entry, semantic, context);
  };
  return seen;
}

test('actual333 and337 carry the same live forced executor through FIFO into real manager sampling', async () => {
  const h = await open(),
    w = h.world,
    forced = w.effekseer.createExecutor('forced-B'),
    calls = observe(h),
    entries = visits(h);
  try {
    let first;
    await w.withExecutor(forced, async (executorEntry) => {
      first = executorEntry;
      await w.sendEngine(h.id, w.main.id, 333, 0, 0, { executorEntry });
    });
    const t = task(h),
      a = w.effekseer.threads.forThread('frame'),
      b = w.effekseer.threads.forThread('forced-B'),
      before = b.calls;
    assert.equal(before, 1);
    assert.equal(a.calls, 0);
    assert.deepEqual(entries, [first]);
    assert.ok(calls.every((c) => c.entry === first));
    const sampling = [],
      original = t.manager.play.bind(t.manager);
    t.manager.play = (...args) => {
      sampling.push(args[2]);
      return original(...args);
    };
    await notify(h, 'PLAY', forced);
    assert.deepEqual(sampling, ['forced-B']);
    assert.equal(a.calls, 0);
    assert.deepEqual(b.snapshot(), { state: 3357800067, calls: 2, seedCalls: 0 });
    assert.equal(t.manager.sets.size, 2);
    assert.equal(calls.at(-1).entry, entries.at(-1));
    assert.notEqual(entries.at(-1), first, 'each actual invocation borrows its new live entry');
    assert.throws(() => w.effekseer.nextInt(first), /live explicit/);
    const entryState = h.instance.runtime.resources.snapshot();
    assert.equal(JSON.stringify(entryState).includes('executor'), false);
    assert.equal(JSON.stringify(h.instance.runtime.pendingRecords).includes('executor'), false);
    assert.equal(w.objects.queue.length, 0);
    assert.equal(w.nativeEngine, undefined);
  } finally {
    await w.close({ flushFiles: false });
  }
});

test('window queue forwards its real frame drain into default333 without retaining enqueue capability', async () => {
  const h = await open(),
    w = h.world,
    forced = w.effekseer.createExecutor('enqueue-B'),
    calls = observe(h),
    entries = visits(h);
  try {
    let enqueue, drained;
    w.host.nativeWindowMessage = async (message, world, context) => {
      assert.equal(message.message, 0x7777);
      await Promise.resolve();
      drained = context.executorEntry;
      return world.sendEngine(h.id, w.main.id, 333, 0, 0, context);
    };
    await w.withExecutor(forced, (executorEntry) => {
      enqueue = executorEntry;
      w.window.post(0x7777, 333, h.id);
    });
    assert.equal(w.effekseer.threads.forThread('enqueue-B').calls, 0);
    await w.tick();
    assert.equal(task(h).manager.sets.size, 1);
    assert.equal(task(h).manager.sets.get(0).global.updatedFrame, 1);
    assert.equal(task(h).manager.instances.size, 1, 'first Update keeps the root at age0');
    assert.equal(w.objects.queue.length, 0);
    assert.deepEqual(w.effekseer.threads.forThread('frame').snapshot(), {
      state: 2745024,
      calls: 1,
      seedCalls: 0,
    });
    assert.equal(w.effekseer.threads.forThread('enqueue-B').calls, 0);
    assert.ok(calls.every((c) => c.entry !== enqueue && c.entry === drained));
    assert.equal(calls.find((c) => c.id === 571).entry, entries[0]);
    await w.tick();
    assert.equal(
      task(h).manager.instances.size,
      2,
      'second real draw-phase Update produces the sprite',
    );
    assert.equal(task(h).manager.sets.get(0).global.updatedFrame, 2);
    assert.equal(w.effekseer.threads.forThread('frame').calls, 6);
    assert.equal(
      JSON.stringify(w.snapshot().objects, (_key, value) =>
        typeof value === 'bigint' ? String(value) : value,
      ).includes('executorEntry'),
      false,
    );
  } finally {
    await w.close({ flushFiles: false });
  }
});

test('unknown/closed and mixed-native raw36 sampling fail before any CRT word or manager Play', async () => {
  const h = await open(),
    w = h.world;
  try {
    const before = w.effekseer.threads.snapshot();
    await assert.rejects(w.sendEngine(h.id, w.main.id, 333), /live explicit/);
    const t = task(h);
    assert.equal(t.manager.sets.size, 0);
    assert.equal(object(h).playDirty, false, 'native pending getter consumes before a failed send');
    assert.deepEqual(w.effekseer.threads.snapshot(), before);
    let closed;
    w.withExecutor(w.effekseer.frameExecutor, (e) => {
      closed = e;
    });
    await assert.rejects(
      w.sendEngine(h.id, w.main.id, 337, 0, 0, {
        executorEntry: closed,
        payload: fesLabelPayload(() => 'PLAY'),
      }),
      /live explicit/,
    );
    assert.equal(t.manager.sets.size, 0);
    assert.deepEqual(w.effekseer.threads.snapshot(), before);
    w.transitionalExe = { ownsWorld: ownsOriginalWorld };
    w.nativeEngine = {};
    try {
      await assert.rejects(notify(h, 'PLAY'), /Mixed native CRT/);
      assert.equal(t.manager.sets.size, 0);
      assert.deepEqual(w.effekseer.threads.snapshot(), before);
    } finally {
      delete w.nativeEngine;
      w.transitionalExe = null;
    }
  } finally {
    await w.close({ flushFiles: false });
  }
});

test('sleep traversal borrows its actual message executor without storing it in pending records', async () => {
  const h = await open(),
    w = h.world,
    forced = w.effekseer.createExecutor('sleep-B');
  try {
    await step(h);
    const t = task(h),
      a = w.effekseer.threads.forThread('frame').calls,
      entries = visits(h),
      calls = observe(h);
    await w.withExecutor(forced, (executorEntry) =>
      w.sendEngine(h.id, w.main.id, 342, 0, 1, { executorEntry }),
    );
    assert.equal(t.manager.sets.size, 2);
    assert.ok(w.effekseer.threads.forThread('sleep-B').calls > 0);
    assert.equal(w.effekseer.threads.forThread('frame').calls, a);
    assert.equal(calls.find((c) => c.id === 571).entry, entries[0]);
    assert.equal(h.task.player.nativeInput.state.sleeping, true);
    assert.deepEqual(h.instance.runtime.pendingRecords, []);
  } finally {
    await w.close({ flushFiles: false });
  }
});

test('close during real async FILE releases the already-bound default child and late texture load', async () => {
  const h = await open(),
    w = h.world,
    gate = Promise.withResolvers(),
    entered = Promise.withResolvers();
  let running, closing;
  try {
    const read = w.game.read.bind(w.game);
    w.game.read = async (name) => {
      if (name === 'scene.efk') {
        entered.resolve();
        await gate.promise;
      }
      return read(name);
    };
    running = step(h);
    await entered.promise;
    const o = object(h),
      t = task(h),
      fifo = h.instance.runtime.resources,
      crt = w.effekseer.threads.snapshot();
    assert.equal(fifo.entries[0].previousTaskID, t.record.id);
    assert.equal(h.instance.runtime.ownedTaskIDs.has(t.record.id), true);
    assert.equal(o.resourcePending, false);
    closing = w.objects.release(h.id);
    gate.resolve();
    await Promise.all([running, closing]);
    assert.equal(t.closed, true);
    assert.equal(w.objects.objects.has(t.record.id), false);
    assert.equal(w.effekseer.loads.loads.size, 0);
    assert.equal(w.effekseer.loads.bindings.size, 0);
    assert.equal(w.effekseer.loads.resources.textures.size, 0);
    assert.deepEqual(w.effekseer.threads.snapshot(), crt);
    assert.equal(w.nativeEngine, undefined);
  } finally {
    gate.resolve();
    await running?.catch(() => {});
    await closing?.catch(() => {});
    await w.close({ flushFiles: false });
  }
});

test('render-only CPU queries do not advance manager/CRT and drawing requires a mounted shared GPU', async () => {
  const h = await open(),
    w = h.world;
  try {
    await step(h);
    await w.tick();
    await w.tick();
    const t = task(h),
      state = t.snapshot(),
      crt = w.effekseer.threads.snapshot();
    for (let i = 0; i < 3; i++) {
      assert.equal(t.queryDraw(), 1);
      assert.throws(() => t.drawGPU(), /current World StageRenderer GPU/);
    }
    assert.deepEqual(t.snapshot(), state);
    assert.deepEqual(w.effekseer.threads.snapshot(), crt);
    assert.equal(t.manager.instances.size, 2, 'the unsupported draw is not a blank fixture');
  } finally {
    await w.close({ flushFiles: false });
  }
});
