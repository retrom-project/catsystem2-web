// SPDX-License-Identifier: MPL-2.0
import test from 'node:test';
import assert from 'node:assert/strict';
import { open, task, step, notify, observe } from './fixtures/fes-effekseer-world.mjs';
import { serializeCheckpoint, deserializeCheckpoint } from '../src/checkpoint.mjs';

const viewport = [0, 0, 80, 60],
  empty = [0, 0, 0, 0];
async function loaded() {
  const h = await open();
  try {
    await step(h);
    Object.assign(h.world.configuration.screen, { currentWidth: 80, currentHeight: 60 });
    h.world.graphics.view.configure({ clientWidth: 64, clientHeight: 48 });
    assert.deepEqual([...h.world.screenEffects.rendering.dirtyCurrent], empty);
    assert.deepEqual([...h.world.screenEffects.rendering.dirtyPrevious], empty);
    return h;
  } catch (error) {
    await h.world.close({ flushFiles: false });
    throw error;
  }
}
function observeQuery(h, t) {
  const queries = [],
    original = t.queryDraw.bind(t);
  t.queryDraw = () => {
    assert.equal(t.closing, false, 'unregister must query before Task.closing');
    const graph = t.plane.graph;
    queries.push({
      graph,
      flag: graph.registrationEnabled,
      registration: h.world.graphics.get(t.record.id),
      currentEffect: t.currentEffect,
    });
    return original();
  };
  return queries;
}

test('real FES SIZE queries the enabled old D6 registration before erase and keeps its damage when the replacement is empty', async () => {
  const h = await loaded(),
    w = h.world,
    old = task(h),
    r = w.screenEffects.rendering;
  try {
    const graph = old.plane.graph,
      current = old.currentEffect,
      manager = old.manager.snapshot(),
      crt = w.effekseer.threads.snapshot(),
      mt = w.random.snapshot(),
      frame = w.frame,
      calls = observe(h),
      queries = observeQuery(h, old);
    await notify(h, 'SIZE');
    assert.equal(queries.length, 1);
    assert.deepEqual(queries[0], {
      graph,
      flag: true,
      registration: old.plane,
      currentEffect: current,
    });
    assert.equal(graph.registrationEnabled, false, 'disable occurs after the old-flag query');
    assert.equal(old.plane.graph, null);
    assert.equal(w.graphics.get(old.record.id), null);
    assert.equal(old.record.destroyRequested, true);
    assert.equal(old.closed, false, 'message3 leaves physical disposal to logic');
    assert.deepEqual([...r.dirtyCurrent], viewport);
    assert.deepEqual([...r.dirtyPrevious], empty);
    assert.deepEqual(old.manager.snapshot(), manager);
    assert.deepEqual(w.effekseer.threads.snapshot(), crt);
    assert.deepEqual(w.random.snapshot(), mt);
    assert.equal(w.frame, frame);
    const next = task(h);
    assert.notEqual(next.record.id, old.record.id);
    assert.equal(next.currentEffect, null);
    assert.equal(next.manager.sets.size, 0);
    assert.deepEqual(
      calls.map((call) => [call.target, call.id]),
      [[old.record.id, 3]],
      'SIZE does not replay FILE or Play',
    );
    await w.tick();
    assert.equal(old.closed, true);
    assert.equal(queries.length, 1, 'later disposal does not query a closing Task again');
    assert.deepEqual([...r.dirtyCurrent], viewport);
    assert.deepEqual([...r.dirtyPrevious], empty);
  } finally {
    await w.close({ flushFiles: false });
  }
});

test('message3 propagates callback query errors before flag/erase and real FES DELETE consumes the same unregister path', async () => {
  const h = await loaded(),
    w = h.world,
    t = task(h),
    r = w.screenEffects.rendering,
    original = t.queryDraw.bind(t),
    failure = new Error('authored unregister query failure');
  let failedQueries = 0;
  t.queryDraw = () => {
    failedQueries++;
    throw failure;
  };
  try {
    const graph = t.plane.graph,
      manager = t.manager.snapshot(),
      crt = w.effekseer.threads.snapshot(),
      mt = w.random.snapshot(),
      destroyRequested = t.record.destroyRequested,
      ownsDestroyRequested = Object.hasOwn(t.record, 'destroyRequested');
    await assert.rejects(w.objects.destroy(t.record.id, h.id), (error) => error === failure);
    assert.equal(failedQueries, 1);
    assert.equal(t.record.destroyRequested, destroyRequested);
    assert.equal(Object.hasOwn(t.record, 'destroyRequested'), ownsDestroyRequested);
    assert.equal(t.closing, false);
    assert.equal(t.plane.graph, graph);
    assert.equal(graph.registrationEnabled, true);
    assert.equal(w.graphics.get(t.record.id), t.plane);
    assert.deepEqual([...r.dirtyCurrent], empty);
    assert.deepEqual([...r.dirtyPrevious], empty);
    // Existing checkpoint registration states; none may acquire a query or
    // become enabled merely because its graph is being removed.
    for (const flag of [false, null, 'unverified']) {
      const id = await w.objects.create({ kind: 61, parent: h.id }),
        blank = w.objects.objects.get(id).implementation,
        blankGraph = blank.plane.graph;
      blankGraph.registrationEnabled = flag;
      blank.queryDraw = () => assert.fail('disabled/unknown registration was queried');
      await w.objects.destroy(id, h.id);
      assert.equal(blank.plane.graph, null);
      assert.equal(blankGraph.registrationEnabled, flag);
      assert.equal(failedQueries, 1, 'no full query was added for an unchanged or unknown flag');
    }
    t.queryDraw = original;
    const queries = observeQuery(h, t);
    await notify(h, 'DELETE');
    assert.equal(queries.length, 1);
    assert.equal(queries[0].graph, graph);
    assert.equal(queries[0].flag, true);
    assert.equal(queries[0].registration, t.plane);
    assert.equal(graph.registrationEnabled, false);
    assert.equal(t.record.destroyRequested, true);
    assert.equal(t.plane.graph, null);
    assert.equal(h.instance.runtime.resources.entries.length, 0);
    assert.deepEqual([...r.dirtyCurrent], viewport);
    assert.deepEqual([...r.dirtyPrevious], empty);
    assert.deepEqual(t.manager.snapshot(), manager);
    assert.deepEqual(w.effekseer.threads.snapshot(), crt);
    assert.deepEqual(w.random.snapshot(), mt);
    assert.equal(await w.objects.destroy(t.record.id, h.id), false);
    assert.equal(queries.length, 1);
    await w.tick();
    assert.equal(t.closed, true);
    assert.equal(queries.length, 1);
  } finally {
    t.queryDraw = original;
    await w.close({ flushFiles: false });
  }
});

test('a settled real post-delete checkpoint restores pending disposal and dirty history without recreating the callback registration', async () => {
  const h = await loaded(),
    w = h.world,
    t = task(h);
  let fresh;
  try {
    await notify(h, 'DELETE');
    const r = w.screenEffects.rendering,
      manager = t.manager.snapshot(),
      crt = w.effekseer.threads.snapshot(),
      mt = w.random.snapshot();
    assert.deepEqual([...r.dirtyCurrent], viewport);
    assert.equal(t.plane.graph, null);
    assert.equal(t.record.destroyRequested, true);
    assert.equal(t.closed, false);
    const saved = await deserializeCheckpoint(await serializeCheckpoint(w.snapshot())),
      record = saved.objects.objects.find((x) => x.id === t.record.id);
    assert.equal(record.state, 'active');
    assert.equal(record.destroyRequested, true);
    assert.equal(record.data.plane.graph, null);
    fresh = (await open({ initialize: false })).world;
    let queries = 0;
    const register = fresh.effekseer.registerTask.bind(fresh.effekseer),
      calls = [],
      send = fresh.sendEngine.bind(fresh);
    fresh.effekseer.registerTask = (restored) => {
      restored.queryDraw = () => {
        queries++;
        assert.fail('a deleted callback was queried');
      };
      return register(restored);
    };
    fresh.effekseer.play = () => assert.fail('restore/disposal replayed Play');
    fresh.effekseer.update = () => assert.fail('pending destruction advanced the manager');
    fresh.sendEngine = (...args) => {
      if ([569, 571].includes(args[2])) calls.push(args[2]);
      return send(...args);
    };
    await fresh.restore(saved);
    const restored = fresh.objects.objects.get(t.record.id).implementation,
      currentRenderer = fresh.screenEffects.rendering;
    assert.equal(restored.plane.graph, null);
    assert.equal(restored.record.destroyRequested, true);
    assert.equal(restored.closing, false);
    assert.equal(restored.closed, false);
    assert.deepEqual(restored.manager.snapshot(), manager);
    assert.deepEqual(fresh.effekseer.threads.snapshot(), crt);
    assert.deepEqual(fresh.random.snapshot(), mt);
    assert.deepEqual([...currentRenderer.dirtyCurrent], viewport);
    assert.deepEqual([...currentRenderer.dirtyPrevious], empty);
    assert.deepEqual(currentRenderer.collectCallbackDirty(), viewport);
    assert.equal(queries, 0);
    assert.deepEqual(calls, []);
    await fresh.tick();
    assert.equal(restored.closed, true);
    assert.equal(fresh.objects.objects.has(t.record.id), false);
    assert.equal(queries, 0);
    assert.deepEqual(calls, []);
    assert.deepEqual([...currentRenderer.dirtyCurrent], viewport);
    assert.deepEqual([...currentRenderer.dirtyPrevious], empty);
  } finally {
    await fresh?.close({ flushFiles: false });
    await w.close({ flushFiles: false });
  }
});
