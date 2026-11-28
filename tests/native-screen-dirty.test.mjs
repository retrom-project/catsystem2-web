// SPDX-License-Identifier: MPL-2.0
import test from 'node:test';
import assert from 'node:assert/strict';
import { open, object, task, step } from './fixtures/fes-effekseer-world.mjs';
import { openPhysicalWorld } from './fixtures/effekseer/physical-world.mjs';
import { NativeGraphicsPacket } from '../src/native/graphics-task.mjs';
import { MOTION_ABI } from '../src/motion/abi.mjs';
import { kcsProgram } from './helpers.mjs';

const send = (h, target, id, l = 0, payload) =>
  h.world.sendEngine(target, h.id, id, 0, l, payload ? { payload } : {});
const viewport = [0, 0, 80, 60];
const configure = (world) => {
  Object.assign(world.configuration.screen, { currentWidth: 80, currentHeight: 60 });
  world.graphics.view.configure({ clientWidth: 64, clientHeight: 48 });
};
async function loaded(options) {
  const h = await open(options);
  await step(h);
  configure(h.world);
  return h;
}

test('real FES47/48 and MOT collect every known enabled callback under its old flag only on boolean changes', async () => {
  const hidden = kcsProgram([[21, [0x13, (0x80000000 + MOTION_ABI.display) >>> 0], 0], [59]]),
    h = await loaded({ extra: { 'hidden.kcs': hidden } }),
    w = h.world,
    t = task(h),
    r = w.screenEffects.rendering,
    observed = [],
    query = t.queryDraw.bind(t);
  t.queryDraw = () => {
    assert.equal(t.closing, false, 'closing Task must not be queried');
    observed.push({
      id: t.record.id,
      flag: t.plane.graph.registrationEnabled,
      shown: t.plane.state.shown,
    });
    return query();
  };
  try {
    const manager = t.manager.snapshot(),
      crt = w.effekseer.threads.snapshot(),
      mt = w.random.snapshot(),
      frame = w.frame;
    await send(h, t.record.id, 47, 0);
    assert.deepEqual(observed, [{ id: t.record.id, flag: true, shown: false }]);
    assert.deepEqual([...r.dirtyCurrent], viewport);
    observed.length = 0;
    await send(h, t.record.id, 47, 0);
    await send(h, t.record.id, 48, 1);
    assert.deepEqual(observed, [], 'same registration boolean has no extra query');
    assert.deepEqual(t.manager.snapshot(), manager);
    assert.deepEqual(w.effekseer.threads.snapshot(), crt);
    assert.deepEqual(w.random.snapshot(), mt);
    assert.equal(w.frame, frame);

    const id = await w.objects.create({ kind: 61, parent: h.id }),
      other = w.objects.objects.get(id).implementation;
    await send(h, id, 569, 0, { string: () => 'scene.efk' });
    await send(
      h,
      id,
      49,
      0,
      new NativeGraphicsPacket([0, 0, new Uint32Array(new Float32Array([-5]).buffer)[0]]),
    );
    await send(h, id, 47, 1);
    const otherQuery = other.queryDraw.bind(other);
    other.queryDraw = () => {
      assert.equal(other.closing, false, 'closing Task must not be queried');
      observed.push({ id, firstFlag: t.plane.graph.registrationEnabled });
      return otherQuery();
    };
    await send(h, t.record.id, 47, 1);
    assert.deepEqual(
      observed,
      [{ id, firstFlag: false }],
      'enable prequery excludes the still-disabled registration',
    );
    observed.length = 0;
    assert.equal(r.queryRange(170, 171), true);
    assert.deepEqual(
      observed.map((x) => x.id),
      [t.record.id],
      'range query retains its own interval',
    );
    observed.length = 0;
    await send(h, t.record.id, 48, 0);
    assert.deepEqual(
      observed.map((x) => x.id),
      [t.record.id, id],
      'global dirty contribution retains callbacks outside that range',
    );
    assert.equal(observed[0].flag, true);
    assert.equal(observed[1].firstFlag, true);
    observed.length = 0;
    await send(h, t.record.id, 48, 0);
    assert.deepEqual(observed, []);
    await send(h, t.record.id, 48, 1);
    assert.deepEqual(observed, [{ id, firstFlag: false }]);
    observed.length = 0;
    await h.instance.runtime.motions.add(object(h), 'hidden');
    await step(h);
    assert.equal(t.plane.graph.registrationEnabled, false);
    assert.ok(observed.some((x) => x.id === t.record.id && x.flag === true && x.shown === false));

    observed.length = 0;
    // Normal destroy removes the graph before the later Task.closing phase.
    await w.objects.destroy(id, h.id);
    assert.equal(w.graphics.get(id), null);
    assert.deepEqual(
      observed,
      [{ id, firstFlag: false }],
      'normal message3 queries the old enabled callback before erase',
    );
    observed.length = 0;
    r.collectDirty();
    await w.objects.release(id);
    assert.equal(other.closed, true);
    assert.deepEqual(observed, [], 'close/destroy did not introduce a teardown query');
    await w.close({ flushFiles: false });
    assert.equal(t.closed, true);
    assert.deepEqual(observed, [], 'normal World close did not query a closing Task');
  } finally {
    await w.close({ flushFiles: false });
  }
});

test('normal Stage presentation carries callback damage and retires history only for successful signed32 HRESULTs', async () => {
  const h = await openPhysicalWorld(),
    { world: w, gpu, effectTask: t } = h,
    r = w.screenEffects.rendering,
    stage = w.stageRenderer,
    requests = [],
    presented = [],
    ordinaryDraws = [],
    nativeDraw = stage.drawItem.bind(stage),
    nativePresent = stage.presentNative.bind(stage),
    originalCanvas = globalThis.OffscreenCanvas;
  globalThis.OffscreenCanvas = class {
    constructor(width, height) {
      this.width = width;
      this.height = height;
    }
    getContext() {
      return { reset() {}, drawImage() {} };
    }
  };
  configure(w);
  const ordinaryID = await w.objects.create({ kind: 2, parent: h.id }),
    rectangle = new NativeGraphicsPacket([0, 0, 0, 0x42000000, 0x41800000, 0, 0, 0xffffffff]);
  await send(h, ordinaryID, 42, 0, rectangle);
  await send(h, ordinaryID, 47, 1);
  stage.drawItem = (...args) => {
    if (args[2].p?.nativeTaskWorldID === ordinaryID) ordinaryDraws.push(args[2]);
    return nativeDraw(...args);
  };
  stage.renderer.ctx = {
    reset() {},
    drawImage(...args) {
      presented.push(args);
    },
  };
  let status = 0,
    failure = null;
  stage.presentNative = (request) => {
    requests.push({ ...request, dirtyRectangle: request.dirtyRectangle?.slice() });
    assert.equal(nativePresent(request), 0, 'the real Stage bridge returns HRESULT zero');
    if (failure) throw failure;
    request.dirtyRectangle?.fill(7);
    return status;
  };
  try {
    const managerAges = [...t.manager.instances.values()].map((x) => [x.id, x.age]),
      crt = w.effekseer.threads.snapshot(),
      mt = w.random.snapshot(),
      frame = w.frame;
    await stage.render(w.graphics.stage);
    assert.deepEqual(requests[0].dirtyRectangle, viewport);
    assert.equal(requests[0].stageTarget, gpu.primaryTarget);
    assert.deepEqual([...r.dirtyPrevious], viewport);
    assert.deepEqual([...r.dirtyCurrent], [0, 0, 0, 0]);
    assert.equal(presented.length, 1);
    assert.equal(ordinaryDraws.length, 1);
    await send(h, t.record.id, 48, 0);
    r.dirtyCurrent.set([12, 8, 22, 18]);
    r.dirtyPrevious.set([30, 5, 40, 10]);
    await stage.render(w.graphics.stage);
    assert.deepEqual(requests.at(-1).dirtyRectangle, [12, 5, 40, 18]);
    assert.equal(
      ordinaryDraws.length,
      2,
      'partial dirty data does not crop or skip the ordinary plane',
    );
    assert.deepEqual([...r.dirtyPrevious], [12, 8, 22, 18], 'retire current, not the union output');
    r.dirtyPrevious.fill(0);
    await stage.render(w.graphics.stage);
    assert.deepEqual(requests.at(-1).dirtyRectangle, [0, 0, 0, 0]);
    assert.equal(ordinaryDraws.length, 3, 'empty callback damage still draws ordinary content');
    assert.equal(presented.length, 3);
    await send(h, t.record.id, 48, 1);
    gpu.beginFrame();
    await r.render(
      [],
      () => assert.fail('the supplied subset is empty'),
      (request) => {
        assert.deepEqual(
          request.dirtyRectangle,
          viewport,
          'global contribution does not depend on the supplied frame subset',
        );
        return -1;
      },
    );
    gpu.endNativeFrame();
    for (const value of [1, 0x7fffffff, -1, -2147483648, 0x80000000, 0xffffffff]) {
      r.dirtyPrevious.set([30, 5, 40, 10]);
      r.dirtyCurrent.set([12, 8, 22, 18]);
      status = value;
      await stage.render(w.graphics.stage);
      assert.deepEqual(requests.at(-1).dirtyRectangle, viewport);
      assert.deepEqual([...r.dirtyPrevious], (value | 0) >= 0 ? viewport : [30, 5, 40, 10]);
      assert.deepEqual([...r.dirtyCurrent], (value | 0) >= 0 ? [0, 0, 0, 0] : viewport);
    }
    status = undefined;
    await assert.rejects(stage.render(w.graphics.stage), /HRESULT/);
    assert.deepEqual([...r.dirtyPrevious], [30, 5, 40, 10]);
    assert.deepEqual([...r.dirtyCurrent], viewport);
    if (gpu.drawing) gpu.endNativeFrame();
    failure = new Error('authored presentation failure');
    await assert.rejects(stage.render(w.graphics.stage), (error) => error === failure);
    assert.deepEqual([...r.dirtyPrevious], [30, 5, 40, 10]);
    assert.deepEqual([...r.dirtyCurrent], viewport);
    failure = null;
    if (gpu.drawing) gpu.endNativeFrame();
    const count = requests.length;
    for (const settings of [{ paused: true }, { paused: false, active: false }]) {
      w.graphics.view.configure(settings);
      await stage.render(w.graphics.stage);
      assert.equal(requests.length, count);
      assert.deepEqual([...r.dirtyPrevious], [30, 5, 40, 10]);
      assert.deepEqual([...r.dirtyCurrent], viewport);
    }
    w.graphics.view.configure({ active: true });
    gpu.beginFrame();
    await assert.rejects(
      r.render(
        [{ p: { nativeGraph: {} }, priority: 1 }],
        () => {
          throw new Error('draw before presentation');
        },
        () => {
          throw new Error('unreachable');
        },
      ),
      /draw before presentation/,
    );
    assert.equal(requests.length, count);
    assert.deepEqual([...r.dirtyPrevious], [30, 5, 40, 10]);
    assert.deepEqual([...r.dirtyCurrent], viewport);
    gpu.endNativeFrame();
    const originalQuery = t.queryDraw,
      callbackFailure = new Error('authored callback query failure');
    t.queryDraw = () => {
      throw callbackFailure;
    };
    await assert.rejects(stage.render(w.graphics.stage), (error) => error === callbackFailure);
    t.queryDraw = originalQuery;
    assert.equal(requests.length, count);
    assert.deepEqual([...r.dirtyPrevious], [30, 5, 40, 10]);
    assert.deepEqual([...r.dirtyCurrent], viewport);
    assert.deepEqual(
      [...t.manager.instances.values()].map((x) => [x.id, x.age]),
      managerAges,
    );
    assert.deepEqual(w.effekseer.threads.snapshot(), crt);
    assert.deepEqual(w.random.snapshot(), mt);
    assert.equal(w.frame, frame);
  } finally {
    if (gpu.drawing) gpu.endNativeFrame();
    if (originalCanvas === undefined) delete globalThis.OffscreenCanvas;
    else globalThis.OffscreenCanvas = originalCanvas;
    await w.close({ flushFiles: false });
  }
});

test('the same renderer restores current RECTs in place and computes clipped old/current union without replay', async () => {
  const h = await loaded(),
    w = h.world,
    t = task(h),
    r = w.screenEffects.rendering;
  try {
    await send(h, t.record.id, 47, 0);
    const saved = r.snapshot();
    assert.deepEqual(saved.dirtyPrevious, [0, 0, 0, 0]);
    const current = r.dirtyCurrent,
      previous = r.dirtyPrevious,
      manager = t.manager.snapshot(),
      crt = w.effekseer.threads.snapshot(),
      mt = w.random.snapshot();
    saved.dirtyCurrent = [12, 8, 22, 18];
    saved.dirtyPrevious = [30, 5, 40, 10];
    r.restore(saved);
    assert.equal(r.dirtyCurrent, current);
    assert.equal(r.dirtyPrevious, previous);
    assert.deepEqual(r.collectDirty(), [12, 5, 40, 18]);
    saved.dirtyCurrent[0] = 99;
    assert.equal(r.dirtyCurrent[0], 12);
    r.dirtyCurrent.set([75, 55, 90, 70]);
    r.dirtyPrevious.fill(0);
    assert.deepEqual(r.collectDirty(), [75, 55, 80, 60]);
    r.dirtyCurrent.set([12, 8, 22, 18]);
    t.pendingReset = true;
    await send(h, t.record.id, 47, 1);
    assert.deepEqual([...r.dirtyCurrent], [12, 8, 22, 18], 'enable queried the old disabled flag');
    assert.equal(t.queryDraw(), 0);
    assert.deepEqual(
      r.collectDirty(),
      viewport,
      'a present callback expands nonempty damage even when its query returns zero',
    );
    r.dirtyCurrent.fill(0);
    r.dirtyPrevious.set([30, 5, 40, 10]);
    assert.deepEqual(
      r.collectDirty(),
      [30, 5, 40, 10],
      'previous damage does not become current before presentation',
    );
    const query = t.queryDraw;
    t.queryDraw = () => {
      throw new Error('unknown flag must not be queried');
    };
    for (const unknown of [null, 'unverified']) {
      t.plane.graph.registrationEnabled = unknown;
      assert.deepEqual(r.collectDirty(), [30, 5, 40, 10]);
      assert.equal(t.plane.graph.registrationEnabled, unknown);
    }
    t.queryDraw = query;
    t.plane.graph.registrationEnabled = false;
    t.pendingReset = false;
    const exact = r.snapshot();
    r.restore(structuredClone(exact));
    assert.deepEqual(r.snapshot(), exact);
    assert.throws(() => r.restore({ ...exact, dirtyCurrent: undefined }), /RECT/);
    assert.throws(() => r.restore({ ...exact, dirtyPrevious: [0, 0, 0x80000000, 1] }), /RECT/);
    assert.deepEqual(t.manager.snapshot(), manager);
    assert.deepEqual(w.effekseer.threads.snapshot(), crt);
    assert.deepEqual(w.random.snapshot(), mt);
  } finally {
    await w.close({ flushFiles: false });
  }
});
