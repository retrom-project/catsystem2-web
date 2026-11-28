// SPDX-License-Identifier: MPL-2.0
import test from 'node:test';
import assert from 'node:assert/strict';
import { openPhysicalWorld } from './fixtures/effekseer/physical-world.mjs';
import { notify } from './fixtures/fes-effekseer-world.mjs';

const source =
  '#DEFINE\nEFKPLANE fx\nCPLANE colored\n#OBJECT FILE SIZE POS BASE PRI DISP COLOR\nfx scene.efk 800,600 5,6,7 2,3,4 170 1 0x80abcdef\n#OBJECT SIZE POS BASE PRI DISP COLOR\ncolored 10,6 8,9,0 0,0 10 1 0xff112233\n#START\nfx play\nnext IDLE\n#IDLE\nbreak\nnext IDLE\n#MOVE\ncolored pos 24 12 0\nbreak\n';
async function open() {
  const h = await openPhysicalWorld({ text: source }),
    original = globalThis.OffscreenCanvas,
    ctx = { reset() {}, drawImage() {} };
  // The existing recorder supplies the GL API only; these are the canvas
  // presentation boundary methods, not pixels or invented frame/depth state.
  globalThis.OffscreenCanvas = class {
    constructor(width, height) {
      this.width = width;
      this.height = height;
    }
    getContext() {
      return ctx;
    }
  };
  h.world.stageRenderer.renderer.ctx = ctx;
  Object.assign(h.world.configuration.screen, { currentWidth: 80, currentHeight: 60 });
  h.world.graphics.view.configure({ clientWidth: 64, clientHeight: 48 });
  return {
    ...h,
    restoreCanvas() {
      if (original === undefined) delete globalThis.OffscreenCanvas;
      else globalThis.OffscreenCanvas = original;
    },
  };
}
async function close(h) {
  try {
    if (h.gpu.drawing) h.gpu.endNativeFrame();
    await h.world.close({ flushFiles: false });
  } finally {
    h.restoreCanvas();
  }
}

test('direct kind61 release queries after FILE clear and updates a real dirty CPLANE before graph erase', async () => {
  const h = await open(),
    w = h.world,
    t = h.effectTask,
    colored = w.graphics.get(h.instance.collection.lookup('colored', 0).nativeTaskID);
  try {
    await w.stageRenderer.render(w.graphics.stage);
    assert.deepEqual(colored.graph.cachedBounds, [8, 9, 19, 16]);
    assert.equal(colored.graph.boundsDirty, false);
    await notify(h, 'MOVE');
    assert.equal(colored.graph.boundsDirty, true);
    assert.deepEqual(colored.graph.cachedBounds, [8, 9, 19, 16]);
    const graph = t.plane.graph,
      query = t.queryDraw.bind(t),
      queries = [],
      rng = w.random.snapshot(),
      frame = w.frame;
    assert.equal(graph.registrationEnabled, true);
    assert.notEqual(t.currentEffect, null);
    t.queryDraw = () => {
      const observation = {
        graph: t.plane.graph,
        enabled: graph.registrationEnabled,
        registered: w.graphics.get(t.record.id),
        file: t.currentEffect,
        managerClosed: t.manager.closed,
        closing: t.closing,
        closed: t.closed,
      };
      const result = query();
      queries.push({ ...observation, result });
      return result;
    };
    assert.equal(await w.objects.release(t.record.id), true);
    assert.deepEqual(colored.graph.cachedBounds.slice(), [24, 12, 35, 19]);
    assert.deepEqual(queries, [
      {
        graph,
        enabled: true,
        registered: t.plane,
        file: null,
        managerClosed: true,
        closing: true,
        closed: false,
        result: 0,
      },
    ]);
    assert.equal(graph.registrationEnabled, false);
    assert.equal(t.plane.graph, null);
    assert.equal(w.graphics.get(t.record.id), null);
    assert.equal(w.objects.objects.has(t.record.id), false);
    assert.equal(t.closed, true);
    assert.equal(
      colored.graph.boundsDirty,
      true,
      'unregister does not present or retire the marker',
    );
    assert.deepEqual(w.random.snapshot(), rng);
    assert.equal(w.frame, frame);
    await t.close();
    assert.equal(await w.objects.release(t.record.id), false);
    assert.equal(queries.length, 1);
    assert.throws(query, /Effekseer task is closed/);
  } finally {
    await close(h);
  }
});

test('empty or disabled direct kind61 release and repeated close do not create a second unregister query', async () => {
  const h = await open(),
    w = h.world;
  try {
    const id = await w.objects.create({ kind: 61, parent: h.id }),
      empty = w.objects.objects.get(id).implementation,
      graph = empty.plane.graph,
      query = empty.queryDraw.bind(empty);
    let queries = 0;
    assert.equal(empty.currentEffect, null);
    assert.equal(graph.registrationEnabled, false);
    await w.sendEngine(id, h.id, 47, 0, 1);
    assert.equal(graph.registrationEnabled, true);
    empty.queryDraw = () => {
      queries++;
      assert.equal(empty.currentEffect, null);
      assert.equal(empty.manager.closed, true);
      assert.equal(empty.closing, true);
      assert.equal(empty.closed, false);
      return query();
    };
    assert.equal(await w.objects.release(id), true);
    assert.equal(queries, 1);
    assert.equal(graph.registrationEnabled, false);
    assert.equal(empty.plane.graph, null);
    await empty.close();
    assert.equal(await w.objects.release(id), false);
    assert.equal(queries, 1);
    assert.throws(query, /Effekseer task is closed/);

    const disabledID = await w.objects.create({ kind: 61, parent: h.id }),
      disabled = w.objects.objects.get(disabledID).implementation;
    await w.sendEngine(disabledID, h.id, 47, 0, 1);
    assert.equal(disabled.plane.graph.registrationEnabled, true);
    await w.sendEngine(disabledID, h.id, 47);
    assert.equal(disabled.plane.graph.registrationEnabled, false);
    disabled.queryDraw = () => assert.fail('a disabled registration was queried during close');
    assert.equal(await w.objects.release(disabledID), true);
    await disabled.close();
    assert.equal(await w.objects.release(disabledID), false);
    assert.equal(disabled.plane.graph, null);

    const t = h.effectTask,
      originalQuery = t.queryDraw.bind(t),
      oldGraph = t.plane.graph,
      failure = new Error('authored direct-close query failure');
    let failedQueries = 0;
    t.queryDraw = () => {
      failedQueries++;
      assert.equal(t.currentEffect, null);
      assert.equal(t.manager.closed, true);
      assert.equal(t.closing, true);
      assert.equal(t.closed, false);
      throw failure;
    };
    await assert.rejects(w.objects.release(t.record.id), (error) => {
      assert.ok(error instanceof AggregateError);
      assert.equal(error.errors.length, 1);
      const cleanup = error.errors[0];
      assert.ok(cleanup instanceof AggregateError);
      assert.deepEqual(cleanup.errors, [failure]);
      return true;
    });
    assert.equal(failedQueries, 1);
    assert.equal(t.closed, true);
    assert.equal(t.plane.graph, null);
    assert.equal(w.graphics.get(t.record.id), null);
    assert.equal(w.objects.objects.has(t.record.id), false);
    assert.equal(oldGraph.registrationEnabled, true, 'a failed query did not commit a flag write');
    await t.close();
    assert.equal(await w.objects.release(t.record.id), false);
    assert.equal(failedQueries, 1);
    assert.throws(originalQuery, /Effekseer task is closed/);
  } finally {
    await close(h);
  }
});
