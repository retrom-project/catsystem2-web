// SPDX-License-Identifier: MPL-2.0
import test from 'node:test';
import assert from 'node:assert/strict';
import { dataWorld } from './fixtures/data-world.mjs';
import { defaultFESWorld, loadDefaultFES, fesLabelPayload } from './fixtures/default-fes-world.mjs';
import { readEffekseerEffect } from '../src/effekseer/effect-reader.mjs';
import { authoredEffect } from './fixtures/effekseer/authored-effect.mjs';
import { createEffekseerInstanceOperations } from '../src/effekseer/instance-operations.mjs';
import { EffekseerManagerLifecycle } from '../src/effekseer/manager-lifecycle.mjs';
import { LogicalCRTThreads } from '../src/effekseer/crt-threads.mjs';
import { serializeCheckpoint, deserializeCheckpoint } from '../src/checkpoint.mjs';
const PROFILE = 'nekopara-vol3-engine-2.6.1.76';
const deferred = () => {
  let resolve;
  const promise = new Promise((yes) => {
    resolve = yes;
  });
  return { promise, resolve };
};
const sequence = (count) => {
  let state = 1;
  const values = [];
  for (let i = 0; i < count; i++) {
    state = (Math.imul(state, 214013) + 2531011) >>> 0;
    values.push((state >>> 16) & 32767);
  }
  return { state, values };
};
function managers(world) {
  const effect = readEffekseerEffect(authoredEffect()),
    asset = { effect, references: 1 },
    resources = {
      get(id) {
        assert.equal(id, 1);
        assert.ok(asset.references > 0);
        return asset;
      },
      retain(id) {
        this.get(id).references++;
      },
      release(id) {
        this.get(id).references--;
      },
    },
    make = () =>
      new EffekseerManagerLifecycle({
        resources,
        threads: world.effekseer.threads,
        instanceOperations: createEffekseerInstanceOperations(),
        capacity: 16,
      });
  return { a: make(), b: make(), asset };
}
function trace(world, id) {
  const stream = world.effekseer.threads.forThread(id),
    original = stream.nextInt.bind(stream),
    values = [];
  stream.nextInt = () => {
    const value = original();
    values.push(value);
    return value;
  };
  return { stream, values };
}
function exact(trace) {
  const expected = sequence(trace.stream.calls);
  assert.deepEqual(trace.values, expected.values);
  assert.equal(trace.stream.state, expected.state);
}
const guard = (world) => {
  let calls = 0;
  world.ensureNativeEngine = () => {
    calls++;
    throw Error('EXE guard');
  };
  return () => {
    assert.equal(calls, 0);
    assert.equal(world.nativeEngine, undefined);
  };
};

test('World births one frame CRT word at seed1 without consuming MT', async () => {
  const w = await dataWorld(PROFILE),
    noEXE = guard(w);
  try {
    const random = w.random.snapshot(),
      executor = w.effekseer.frameExecutor;
    assert.equal(w.effekseer.frameExecutor, executor);
    assert.deepEqual(w.effekseer.snapshot(), {
      crt: { threads: [{ id: 'frame', state: 1, calls: 0, seedCalls: 0 }] },
      resources: null,
      loads: null,
    });
    assert.throws(() => w.effekseer.createExecutor('frame'), /already exists/);
    assert.deepEqual(w.random.snapshot(), random);
    noEXE();
  } finally {
    await w.close({ flushFiles: false });
  }
});
test('two actual CPU managers dynamically share A and use forced B only for its invocation', async () => {
  const w = await dataWorld(PROFILE),
    noEXE = guard(w),
    m = managers(w),
    forced = w.effekseer.createExecutor('forced-B');
  const a = trace(w, 'frame'),
    b = trace(w, 'forced-B'),
    mt = w.random.snapshot();
  try {
    w.withExecutor(w.effekseer.frameExecutor, (e) => w.effekseer.play(e, m.a, 1, [0, 0, 0]));
    w.withExecutor(w.effekseer.frameExecutor, (e) => w.effekseer.play(e, m.b, 1, [1, 2, 3]));
    w.withExecutor(forced, (e) => w.effekseer.play(e, m.a, 1, [3, 2, 1]));
    const beforeB = b.stream.calls;
    for (let i = 0; i < 4; i++)
      w.withExecutor(w.effekseer.frameExecutor, (e) => {
        w.effekseer.update(e, m.a);
        w.effekseer.update(e, m.b);
      });
    assert.equal(b.stream.calls, beforeB);
    assert.ok(beforeB > 0);
    assert.ok(a.stream.calls > 2);
    assert.ok(m.a.instances.size > 2);
    assert.ok(m.b.instances.size > 1);
    exact(a);
    exact(b);
    assert.equal(m.a.threads, m.b.threads);
    assert.equal(m.a.threads, w.effekseer.threads);
    assert.deepEqual(w.random.snapshot(), mt);
    noEXE();
  } finally {
    m.a.close();
    m.b.close();
    await w.close({ flushFiles: false });
  }
});
test('unknown/closed entry fails before manager state, resources, callbacks or CRT sampling', async () => {
  const w = await dataWorld(PROFILE),
    m = managers(w),
    stream = w.effekseer.threads.forThread('frame');
  try {
    let closed;
    w.withExecutor(w.effekseer.frameExecutor, (e) => {
      closed = e;
    });
    const before = m.a.snapshot(),
      crt = stream.snapshot(),
      refs = m.asset.references;
    for (const e of [undefined, {}, closed]) {
      assert.throws(() => w.effekseer.play(e, m.a, 1, [0, 0, 0]), /live explicit/);
      assert.throws(() => w.effekseer.update(e, m.a), /live explicit/);
      assert.throws(() => w.effekseer.nextInt(e), /live explicit/);
    }
    assert.deepEqual(m.a.snapshot(), before);
    assert.deepEqual(stream.snapshot(), crt);
    assert.equal(m.asset.references, refs);
  } finally {
    m.a.close();
    m.b.close();
    await w.close({ flushFiles: false });
  }
});
test('private manager CRT registry is rejected instead of copied into World', async () => {
  const w = await dataWorld(PROFILE),
    m = managers(w),
    privateThreads = new LogicalCRTThreads();
  privateThreads.create('frame');
  m.a.threads = privateThreads;
  try {
    assert.throws(
      () =>
        w.withExecutor(w.effekseer.frameExecutor, (e) => w.effekseer.play(e, m.a, 1, [0, 0, 0])),
      /borrow this World/,
    );
    assert.equal(w.effekseer.threads.forThread('frame').calls, 0);
    assert.equal(privateThreads.forThread('frame').calls, 0);
  } finally {
    m.a.close();
    m.b.close();
    privateThreads.close();
    await w.close({ flushFiles: false });
  }
});
test('async A/B operations use explicit entry after await and reentry', async () => {
  const w = await dataWorld(PROFILE),
    forced = w.effekseer.createExecutor('forced-B'),
    ga = deferred(),
    gb = deferred(),
    seen = [];
  try {
    const pa = w.withExecutor(w.effekseer.frameExecutor, async (e) => {
      seen.push(['A', w.effekseer.nextInt(e)]);
      await ga.promise;
      w.dispatchContext.reenter(e, (child) => seen.push(['A', w.effekseer.nextInt(child)]));
    });
    const pb = w.withExecutor(forced, async (e) => {
      seen.push(['B', w.effekseer.nextInt(e)]);
      await gb.promise;
      seen.push(['B', w.effekseer.nextInt(e)]);
    });
    gb.resolve();
    await pb;
    ga.resolve();
    await pa;
    assert.deepEqual(seen, [
      ['A', 41],
      ['B', 41],
      ['B', 18467],
      ['A', 18467],
    ]);
    assert.throws(() => w.effekseer.nextInt(), /live explicit/);
  } finally {
    await w.close({ flushFiles: false });
  }
});
test('real World.tick carries its frame entry through logic and draw after awaits', async () => {
  const w = await dataWorld(PROFILE),
    noEXE = guard(w),
    seen = [];
  try {
    w.objects.register(9001, (record) => ({
      ...w.base(record),
      async tick(_frame, c) {
        await Promise.resolve();
        seen.push([
          'logic',
          w.dispatchContext.executorID(c.executorEntry),
          w.effekseer.nextInt(c.executorEntry),
        ]);
      },
      async drawTick(_frame, c) {
        await Promise.resolve();
        seen.push([
          'draw',
          w.dispatchContext.executorID(c.executorEntry),
          w.effekseer.nextInt(c.executorEntry),
        ]);
      },
      snapshot: () => ({}),
      restore: () => {},
    }));
    await w.objects.create({ kind: 9001, parent: w.main.id });
    await w.tick();
    assert.deepEqual(seen, [
      ['logic', 'frame', 41],
      ['draw', 'frame', 18467],
    ]);
    assert.equal(w.effekseer.threads.forThread('frame').seedCalls, 0);
    noEXE();
  } finally {
    await w.close({ flushFiles: false });
  }
});
test('existing object queue drains under frame A and never serializes enqueue B token', async () => {
  const w = await dataWorld(PROFILE),
    noEXE = guard(w),
    forced = w.effekseer.createExecutor('forced-B'),
    seen = [];
  try {
    w.objects.register(9002, (record) => {
      const base = w.base(record);
      return {
        ...base,
        message(words, c) {
          if (words[1] !== 571) return base.message(words, c);
          seen.push([
            words[0],
            w.dispatchContext.executorID(c.executorEntry),
            w.effekseer.nextInt(c.executorEntry),
          ]);
          return 7;
        },
        snapshot: () => ({}),
        restore: () => {},
      };
    });
    const id = await w.objects.create({ kind: 9002, parent: w.main.id });
    await w.withExecutor(forced, (e) =>
      w.objects.send(id, [98765, 571, 0, 0], { queued: true, executorEntry: e }),
    );
    assert.deepEqual(w.objects.queue, [{ sequence: 1, target: id, words: [98765, 571, 0, 0] }]);
    const queued = w.snapshot();
    assert.deepEqual(queued.objects.queue, w.objects.queue);
    await w.tick();
    assert.deepEqual(seen, [[98765, 'frame', 41]]);
    assert.equal(w.effekseer.threads.forThread('forced-B').calls, 0);
    noEXE();
  } finally {
    await w.close({ flushFiles: false });
  }
});
test('window queue host callback receives actual drain executor, not post provenance', async () => {
  const w = await dataWorld(PROFILE),
    noEXE = guard(w),
    forced = w.effekseer.createExecutor('forced-B'),
    seen = [];
  try {
    w.host.nativeWindowMessage = async (message, world, c) => {
      await Promise.resolve();
      seen.push([
        message.wParam,
        world.dispatchContext.executorID(c.executorEntry),
        world.effekseer.nextInt(c.executorEntry),
      ]);
    };
    w.withExecutor(forced, () => w.window.post(0x7777, 55, 0));
    await w.tick();
    assert.deepEqual(seen, [[55, 'frame', 41]]);
    assert.equal(w.effekseer.threads.forThread('forced-B').calls, 0);
    noEXE();
  } finally {
    await w.close({ flushFiles: false });
  }
});
test('engine message receiver carries explicit entry across awaits and ignores sender task identity', async () => {
  const w = await dataWorld(PROFILE),
    forced = w.effekseer.createExecutor('forced-B'),
    seen = [];
  try {
    w.objects.register(9003, () => ({
      async message(words, c) {
        await Promise.resolve();
        seen.push([
          c.nativeSenderWorldID,
          w.dispatchContext.executorID(c.executorEntry),
          w.effekseer.nextInt(c.executorEntry),
        ]);
        return 42;
      },
      snapshot: () => ({}),
      restore: () => {},
    }));
    const id = await w.objects.create({ kind: 9003, parent: w.main.id });
    await w.withExecutor(forced, (e) =>
      w.sendEngine(id, w.main.id, 571, 0, 0, { executorEntry: e }),
    );
    assert.deepEqual(seen, [[w.main.id, 'forced-B', 41]]);
    let old;
    w.withExecutor(forced, (e) => {
      old = e;
    });
    await assert.rejects(
      w.sendEngine(id, w.main.id, 571, 0, 0, { executorEntry: old }),
      /live explicit/,
    );
    assert.equal(seen.length, 1);
    assert.equal(w.effekseer.threads.forThread('frame').calls, 0);
  } finally {
    await w.close({ flushFiles: false });
  }
});
const fesSource = new TextEncoder().encode(
  '#START\nnext IDLE\n#IDLE\nbreak\nnext IDLE\n#PING\nbreak\n',
);
for (const message of [333, 337])
  test(
    'actual default FES ' + message + ' forwards forced B through its async sync boundary',
    async () => {
      const w = await defaultFESWorld(PROFILE, { 'screen.fes': fesSource }),
        noEXE = guard(w),
        forced = w.effekseer.createExecutor('forced-B');
      try {
        const h = await loadDefaultFES(w),
          original = w.graphics.syncFES.bind(w.graphics),
          seen = [];
        w.graphics.syncFES = async (record, player, options = {}) => {
          await Promise.resolve();
          seen.push([
            w.dispatchContext.executorID(options.executorEntry),
            w.effekseer.nextInt(options.executorEntry),
            options.resourcesOnly === true,
          ]);
          return original(record, player, options);
        };
        // This authored message maps PING at its unchanged lParam address 1.
        const memory = fesLabelPayload(() => 'PING'),
          payload = { bytes: (address, count) => memory.bytes(address - 1, count) };
        await w.withExecutor(forced, (e) =>
          w.sendEngine(h.id, w.main.id, message, 0, 1, { payload, executorEntry: e }),
        );
        assert.deepEqual(seen, [['forced-B', 41, message === 337]]);
        assert.equal(w.effekseer.threads.forThread('frame').calls, 0);
        noEXE();
      } finally {
        await w.close({ flushFiles: false });
      }
    },
  );
test('actual default FES frame path uses A after forced B, with no native process', async () => {
  const w = await defaultFESWorld(PROFILE, { 'screen.fes': fesSource }),
    noEXE = guard(w),
    forced = w.effekseer.createExecutor('forced-B');
  try {
    const h = await loadDefaultFES(w),
      original = w.graphics.syncFES.bind(w.graphics),
      seen = [];
    w.graphics.syncFES = async (record, player, options = {}) => {
      await Promise.resolve();
      seen.push([
        w.dispatchContext.executorID(options.executorEntry),
        w.effekseer.nextInt(options.executorEntry),
      ]);
      return original(record, player, options);
    };
    await w.withExecutor(forced, (e) =>
      w.sendEngine(h.id, w.main.id, 333, 0, 0, { executorEntry: e }),
    );
    await w.tick();
    assert.deepEqual(seen, [
      ['forced-B', 41],
      ['frame', 41],
    ]);
    noEXE();
  } finally {
    await w.close({ flushFiles: false });
  }
});
test('actual unknown FES caller fails at the gateway before any random draw', async () => {
  const w = await defaultFESWorld(PROFILE, { 'screen.fes': fesSource }),
    noEXE = guard(w);
  try {
    const h = await loadDefaultFES(w),
      before = w.effekseer.threads.snapshot();
    w.graphics.syncFES = async (_record, _player, options = {}) =>
      w.effekseer.nextInt(options.executorEntry);
    await assert.rejects(w.sendEngine(h.id, w.main.id, 333), /live explicit/);
    assert.deepEqual(w.effekseer.threads.snapshot(), before);
    noEXE();
  } finally {
    await w.close({ flushFiles: false });
  }
});
test('settled World checkpoint stores one CRT authority and fresh restore continues both words', async () => {
  const w = await dataWorld(PROFILE),
    forced = w.effekseer.createExecutor('forced-B'),
    noEXE = guard(w);
  let fresh;
  try {
    w.withExecutor(w.effekseer.frameExecutor, (e) => {
      w.effekseer.nextInt(e);
      w.effekseer.nextInt(e);
    });
    w.withExecutor(forced, (e) => w.effekseer.nextInt(e));
    const saved = await deserializeCheckpoint(await serializeCheckpoint(w.snapshot()));
    assert.deepEqual(Object.keys(saved.effekseer), ['crt', 'resources', 'loads']);
    assert.deepEqual(saved.effekseer.crt.threads, [
      { id: 'forced-B', state: 2745024, calls: 1, seedCalls: 0 },
      { id: 'frame', state: 3357800067, calls: 2, seedCalls: 0 },
    ]);
    fresh = await dataWorld(PROFILE, {}, { initialize: false });
    const freshGuard = guard(fresh);
    const oldExecutor = fresh.effekseer.frameExecutor;
    await fresh.restore(saved);
    assert.throws(() => fresh.withExecutor(oldExecutor, () => {}), /capability/);
    assert.deepEqual(fresh.effekseer.snapshot(), saved.effekseer);
    const a = fresh.withExecutor(fresh.effekseer.frameExecutor, (e) => fresh.effekseer.nextInt(e));
    const b = fresh.withExecutor(fresh.effekseer.executor('forced-B'), (e) =>
      fresh.effekseer.nextInt(e),
    );
    assert.deepEqual([a, b], [6334, 18467]);
    freshGuard();
    noEXE();
  } finally {
    if (fresh) await fresh.close({ flushFiles: false });
    await w.close({ flushFiles: false });
  }
});
test('pending external entry is never stored in checkpoint and must settle before close', async () => {
  const w = await dataWorld(PROFILE),
    gate = deferred();
  try {
    const pending = w.withExecutor(w.effekseer.frameExecutor, async (e) => {
      await gate.promise;
      w.effekseer.nextInt(e);
    });
    assert.throws(() => w.snapshot(), /entries must settle/);
    await assert.rejects(w.close({ flushFiles: false }), /entries must settle/);
    gate.resolve();
    await pending;
    assert.equal(w.snapshot().effekseer.crt.threads[0].calls, 1);
  } finally {
    await w.close({ flushFiles: false });
  }
});
test('mixed native placeholder blocks W1 before sampling and never opens a process', async () => {
  const w = await dataWorld(PROFILE),
    m = managers(w),
    noEXE = guard(w),
    before = w.effekseer.threads.snapshot();
  try {
    w.nativeEngine = { unbound: true };
    assert.throws(
      () =>
        w.withExecutor(w.effekseer.frameExecutor, (e) => w.effekseer.play(e, m.a, 1, [0, 0, 0])),
      /Mixed native CRT/,
    );
    assert.throws(
      () => w.withExecutor(w.effekseer.frameExecutor, (e) => w.effekseer.update(e, m.a)),
      /Mixed native CRT/,
    );
    assert.deepEqual(w.effekseer.threads.snapshot(), before);
    assert.equal(m.a.sets.size, 0);
    delete w.nativeEngine;
    noEXE();
  } finally {
    delete w.nativeEngine;
    m.a.close();
    m.b.close();
    await w.close({ flushFiles: false });
  }
});

for (const mode of ['fulfilled', 'logic-reject', 'draw-reject', 'flush-reject']) {
  test('captured frameSettled safe point: ' + mode, async (t) => {
    const world = await dataWorld(PROFILE),
      entered = deferred(),
      gate = deferred(),
      flushEntered = deferred(),
      flushGate = deferred(),
      failure = new Error('authored ' + mode);
    let entry,
      ticking,
      outcome,
      guardCalls = 0;
    world.ensureNativeEngine = () => {
      guardCalls++;
      throw new Error('EXE guard');
    };
    try {
      world.objects.register(9001, (record) => ({
        ...world.base(record),
        async tick(_frame, context = {}) {
          entry = context.executorEntry;
          entered.resolve();
          await gate.promise;
          if (mode === 'logic-reject') throw failure;
        },
        async drawTick() {
          await Promise.resolve();
          if (mode === 'draw-reject') throw failure;
        },
        snapshot: () => ({}),
        restore() {},
      }));
      await world.objects.create({ kind: 9001, parent: world.main.id });
      if (mode === 'flush-reject') {
        world.flushConfiguration = async () => {
          flushEntered.resolve();
          await flushGate.promise;
          throw failure;
        };
      }
      ticking = world.tick();
      // Attach rejection handling now, without awaiting the tick completion.
      outcome = ticking.then(
        () => null,
        (error) => error,
      );
      await entered.promise;
      const captured = world.frameSettled;
      assert.ok(captured instanceof Promise);
      assert.equal(world.running, true);
      assert.throws(() => world.snapshot(), /requires a settled frame/);
      gate.resolve();
      if (mode === 'flush-reject') {
        await flushEntered.promise;
        let signalPublished = false;
        captured.then(() => {
          signalPublished = true;
        });
        await Promise.resolve();
        assert.equal(signalPublished, false);
        assert.equal(world.running, false);
        assert.throws(() => world.snapshot(), /requires a settled frame/);
        if (world.dispatchContext) assert.equal(world.dispatchContext.executorID(entry), 'frame');
        flushGate.resolve();
      }
      // The only frame-completion wait: no tick await, attempt wrapper, extra
      // Promise turn or queue is inserted between this and snapshot/close.
      await captured;
      let snapshotError = null;
      try {
        world.snapshot();
      } catch (error) {
        snapshotError = error.message;
      }
      let entryInvalidBeforeClose = null;
      if (world.dispatchContext) {
        try {
          world.dispatchContext.executorID(entry);
          entryInvalidBeforeClose = false;
        } catch (error) {
          assert.match(error.message, /live explicit executor entry/);
          entryInvalidBeforeClose = true;
        }
      }
      const stateAtSignal = { running: world.running, frameSettled: world.frameSettled };
      // Async close executes its validation synchronously before returning.
      const closing = world.close({ flushFiles: false });
      const closeError = await closing.then(
        () => null,
        (error) => error.message,
      );
      const tickError = await outcome;
      t.diagnostic(
        JSON.stringify({
          mode,
          waitedOnlyFor: 'captured frameSettled',
          snapshotError,
          closeError,
          entryInvalidBeforeClose,
          runningAtSignal: stateAtSignal.running,
          frameSettledAtSignal: stateAtSignal.frameSettled,
          tickOutcome: tickError ? tickError.message : 'fulfilled',
          ensureNativeEngineCalls: guardCalls,
        }),
      );
      assert.equal(snapshotError, null, 'snapshot must accept the original safe point');
      assert.equal(closeError, null, 'close must accept the original safe point');
      if (world.dispatchContext) assert.equal(entryInvalidBeforeClose, true);
      assert.deepEqual(stateAtSignal, { running: false, frameSettled: null });
      assert.equal(tickError, mode === 'fulfilled' ? null : failure);
      assert.equal(guardCalls, 0);
      assert.equal(world.nativeEngine, undefined);
    } finally {
      gate.resolve();
      flushGate.resolve();
      if (outcome) await outcome;
      await world.close({ flushFiles: false });
    }
  });
}
