// SPDX-License-Identifier: MPL-2.0
import test from 'node:test';
import assert from 'node:assert/strict';
import { open, object, task, step } from './fixtures/fes-effekseer-world.mjs';
import { MOTION_ABI } from '../src/motion/abi.mjs';
import { NativeGraphicsPacket } from '../src/native/graphics-task.mjs';
import { kcsProgram } from './helpers.mjs';
import { serializeCheckpoint, deserializeCheckpoint } from '../src/checkpoint.mjs';

const shared = (offset) => [0x13, (0x80000000 + offset) >>> 0],
  hidden = kcsProgram([[21, shared(MOTION_ABI.display), 0], [59]]);
const query = (h, minimum = 170, maximum = 171) =>
  h.world.screenEffects.rendering.queryRange(minimum, maximum);
const send = (h, id, l = 0, payload) =>
  h.world.sendEngine(task(h).record.id, h.id, id, 0, l, payload ? { payload } : {});
const packet = (values) =>
  new NativeGraphicsPacket(values.map((n) => new Uint32Array(new Float32Array([n]).buffer)[0]));
async function loaded(options) {
  const h = await open(options);
  try {
    await step(h);
    return h;
  } catch (error) {
    await h.world.close({ flushFiles: false });
    throw error;
  }
}

test('real registered kind61 callback honors47/48 without an extra model display gate', async () => {
  const h = await loaded(),
    w = h.world;
  try {
    const t = task(h),
      plane = t.plane;
    assert.equal(plane.graph.callback, true);
    assert.equal(plane.graph.registrationEnabled, true);
    assert.equal(query(h), true);
    await assert.rejects(async () => plane.drawGPU(), /current World StageRenderer GPU/);
    await send(h, 47, 0);
    assert.equal(plane.graph.registrationEnabled, false);
    assert.equal(query(h), false);
    assert.equal(await plane.drawGPU(), 0);
    await send(h, 48, 1);
    assert.equal(plane.graph.registrationEnabled, false, 'external47 remains the producer gate');
    await send(h, 47, 1);
    assert.equal(plane.graph.registrationEnabled, true);
    await send(h, 48, 0);
    assert.equal(plane.graph.registrationEnabled, false);
    await send(h, 48, 1);
    assert.equal(plane.graph.registrationEnabled, true);
    // A data-only model-word change is not another registration writer.
    new DataView(plane.graph.kx2.buffer).setInt32(MOTION_ABI.display, 0, true);
    plane.sync();
    assert.equal(plane.graph.registrationEnabled, true);
    assert.equal(query(h), true);
    await assert.rejects(async () => plane.drawGPU(), /current World StageRenderer GPU/);
    assert.equal(w.nativeEngine, undefined);
  } finally {
    await w.close({ flushFiles: false });
  }
});

test('callback query and actual draw use their distinct priority gates and preserve state', async () => {
  const h = await loaded(),
    w = h.world;
  try {
    const t = task(h),
      plane = t.plane,
      before = t.manager.snapshot(),
      crt = w.effekseer.threads.snapshot();
    assert.equal(query(h, 170, 171), true);
    assert.equal(query(h, 169, 170), false);
    assert.equal(query(h, 171, 172), false);
    for (const [minimum, maximum] of [
      [169, 170],
      [171, 172],
      [0, 0],
      [-10, -1],
    ])
      assert.equal(await plane.drawGPU(undefined, { minimum, maximum }), 0);
    await assert.rejects(
      async () => plane.drawGPU(undefined, { minimum: 170, maximum: 171 }),
      /current World StageRenderer GPU/,
    );
    await send(h, 49, 0, packet([0, 0, -5]));
    assert.equal(plane.queryDraw(), 1, 'the original callback query has no priority interval');
    assert.equal(query(h, -10, 0), true);
    assert.equal(
      await plane.drawGPU(undefined, { minimum: -10, maximum: 0 }),
      0,
      'draw maximum<=0 exits before callback',
    );
    await assert.rejects(
      async () => plane.drawGPU(undefined, { minimum: -10, maximum: 1 }),
      /current World StageRenderer GPU/,
    );
    assert.deepEqual(t.manager.snapshot(), before);
    assert.deepEqual(w.effekseer.threads.snapshot(), crt);
  } finally {
    await w.close({ flushFiles: false });
  }
});

test('D6 callback ignores ordinary plane clip/color/transform while retaining its own query conditions', async () => {
  const h = await loaded(),
    w = h.world;
  try {
    const t = task(h),
      plane = t.plane,
      before = t.manager.snapshot(),
      crt = w.effekseer.threads.snapshot();
    await send(h, 61, 0, packet([0, 0, 0]));
    await send(h, 81, 4);
    await send(h, 59, 0);
    await send(h, 63, 0);
    new DataView(plane.graph.kx2.buffer).setUint32(MOTION_ABI.color, 0, true);
    plane.graph.kx2.fill(0, MOTION_ABI.matrix, MOTION_ABI.matrix + 64);
    plane.sync();
    assert.equal(query(h), true);
    await assert.rejects(async () => plane.drawGPU(), /current World StageRenderer GPU/);
    assert.deepEqual(t.manager.snapshot(), before);
    assert.deepEqual(w.effekseer.threads.snapshot(), crt);
  } finally {
    await w.close({ flushFiles: false });
  }
});

test('query and draw stop on currentFILE NULL/pending even with retained live drawsets', async () => {
  const h = await loaded(),
    w = h.world;
  try {
    const t = task(h),
      manager = t.manager.snapshot(),
      crt = w.effekseer.threads.snapshot();
    assert.equal(t.manager.sets.size, 1);
    await send(h, 570);
    assert.equal(t.currentEffect, null);
    assert.equal(query(h), false);
    assert.equal(await t.plane.drawGPU(), 0);
    assert.deepEqual(t.manager.snapshot(), manager);
    await send(h, 569, 0, { string: () => 'scene.efk' });
    t.pendingReset = true;
    assert.equal(query(h), false);
    assert.equal(await t.plane.drawGPU(), 0);
    t.pendingReset = false;
    assert.equal(query(h), true);
    await assert.rejects(async () => t.plane.drawGPU(), /current World StageRenderer GPU/);
    assert.deepEqual(t.manager.snapshot(), manager);
    assert.deepEqual(w.effekseer.threads.snapshot(), crt);
    w.effekseer.validateReferences();
  } finally {
    await w.close({ flushFiles: false });
  }
});

test('real FES MOT output reaches47 registration; query/render-only never advances the motion or manager', async () => {
  const h = await loaded({ extra: { 'hidden.kcs': hidden } }),
    w = h.world;
  try {
    const o = object(h),
      t = task(h),
      runtime = h.instance.runtime,
      sent = [],
      original = w.sendEngine.bind(w);
    w.sendEngine = (...args) => {
      if (args[0] === t.record.id && args[2] === 47) sent.push(args[4]);
      return original(...args);
    };
    await runtime.motions.add(o, 'hidden');
    await step(h);
    assert.equal(o.displayValue, 0);
    assert.deepEqual(sent, [0]);
    assert.equal(t.plane.graph.registrationEnabled, false);
    const state = runtime.snapshot(),
      manager = t.manager.snapshot(),
      crt = w.effekseer.threads.snapshot();
    for (let i = 0; i < 3; i++) {
      assert.equal(query(h), false);
      assert.equal(await t.plane.drawGPU(), 0);
    }
    assert.deepEqual(runtime.snapshot(), state);
    assert.deepEqual(t.manager.snapshot(), manager);
    assert.deepEqual(w.effekseer.threads.snapshot(), crt);
    await h.instance.applyObjects('#OBJECT DISP', 'fx 1');
    await step(h);
    assert.equal(
      t.plane.graph.registrationEnabled,
      true,
      'same-frame forced sync does not rerun the MOT',
    );
    await w.tick();
    assert.equal(
      t.plane.graph.registrationEnabled,
      false,
      'the next real frame consumes the MOT display',
    );
    assert.deepEqual(sent, [0, 1, 0]);
  } finally {
    await w.close({ flushFiles: false });
  }
});

test('true fresh World retains callback registration/current aliases without replay or draw', async () => {
  const h = await loaded(),
    w = h.world;
  let fresh;
  try {
    await send(h, 47, 0);
    const t = task(h),
      manager = t.manager.snapshot(),
      saved = await deserializeCheckpoint(await serializeCheckpoint(w.snapshot()));
    fresh = (await open({ initialize: false })).world;
    await fresh.restore(saved);
    const p = fresh.objects.objects.get(t.record.id).implementation;
    assert.equal(p.plane.graph.callback, true);
    assert.equal(p.plane.graph.registrationEnabled, false);
    assert.equal(fresh.screenEffects.rendering.queryRange(170, 171), false);
    assert.equal(await p.plane.drawGPU(), 0);
    assert.deepEqual(p.manager.snapshot(), manager);
    assert.deepEqual(fresh.effekseer.snapshot(), w.effekseer.snapshot());
    await fresh.sendEngine(p.record.id, h.id, 47, 0, 1);
    assert.equal(fresh.screenEffects.rendering.queryRange(170, 171), true);
    await assert.rejects(async () => p.plane.drawGPU(), /current World StageRenderer GPU/);
    assert.deepEqual(p.manager.snapshot(), manager);
    assert.equal(fresh.nativeEngine, undefined);
  } finally {
    await fresh?.close({ flushFiles: false });
    await w.close({ flushFiles: false });
  }
});

test('range traversal keeps existing priority/order and forwards range to the real callback gate', async () => {
  const h = await loaded(),
    w = h.world;
  try {
    const first = task(h),
      secondID = await w.objects.create({ kind: 61, parent: h.id }),
      second = w.objects.objects.get(secondID).implementation;
    await w.sendEngine(secondID, h.id, 569, 0, 0, { payload: { string: () => 'scene.efk' } });
    await w.sendEngine(secondID, h.id, 49, 0, 0, { payload: packet([0, 0, 170]) });
    assert.equal(second.plane.graph.registrationEnabled, false);
    await w.sendEngine(secondID, h.id, 47, 0, 1);
    const items = w.screenEffects.rendering
      .currentFrame()
      .items.filter((x) => x.p?.nativeGraph?.callback);
    assert.deepEqual(
      items.map((x) => x.p.nativeTaskWorldID),
      [first.record.id, secondID],
    );
    const queries = [],
      a = first.queryDraw.bind(first),
      b = second.queryDraw.bind(second);
    first.queryDraw = () => {
      queries.push(first.record.id);
      return a();
    };
    second.queryDraw = () => {
      queries.push(secondID);
      return b();
    };
    assert.equal(query(h), true);
    assert.deepEqual(queries, [first.record.id, secondID]);
    await w.objects.release(secondID);
    assert.equal(w.graphics.get(secondID), null);
    assert.equal(query(h), true);
  } finally {
    await w.close({ flushFiles: false });
  }
});

test('inherited47 reads real parent registration, preserves misses and restores the single current flag', async () => {
  const h = await loaded(),
    w = h.world,
    crt = w.effekseer.threads.snapshot(),
    to = (target, id, l = 0, payload) =>
      w.sendEngine(target, h.id, id, 0, l, payload ? { payload } : {}),
    display = (graph, value) => {
      const view = new DataView(graph.kx2.buffer);
      if (value !== undefined) view.setInt32(MOTION_ABI.display, value, true);
      return view.getInt32(MOTION_ABI.display, true);
    },
    rectangle = () => {
      const p = packet([0, 0, 0, 32, 16, 0, 0, 0]);
      p.store(28, 0xffffffff);
      return p;
    },
    createCallback = async (parent) => {
      const id = await w.objects.create({ kind: 61, parent }),
        t = w.objects.objects.get(id).implementation;
      assert.equal(t.plane.graph.callback, true);
      assert.equal(t.plane.graph.registrationEnabled, false, 'before the first47');
      assert.equal(display(t.plane.graph), 1, 'the model word has a different initial value');
      assert.equal(Object.hasOwn(t.plane.graph, 'renderEnabled'), false);
      assert.equal(Object.hasOwn(t.plane.state, 'registrationEnabled'), false);
      await to(id, 569, 0, { string: () => 'scene.efk' });
      assert.equal(t.plane.queryDraw(), 0, 'loading does not enable the registration');
      return t;
    };
  let fresh;
  try {
    const ordinaryID = await w.objects.create({ kind: 2, parent: h.id }),
      ordinary = w.graphics.get(ordinaryID);
    await to(ordinaryID, 42, 0, rectangle());
    assert.equal(ordinary.graph.registrationEnabled, false, 'normal42 starts disabled');
    assert.equal(display(ordinary.graph), 1);
    assert.equal(Object.hasOwn(ordinary.graph, 'renderEnabled'), false);
    const child = await createCallback(ordinaryID),
      childID = child.record.id;
    await to(childID, 53, 0, packet([0, 0, 0]));
    await to(childID, 47, 1);
    assert.equal(child.plane.graph.registrationEnabled, false, 'registration0 beats parent MOT1');
    assert.equal(child.plane.queryDraw(), 0);

    await to(ordinaryID, 47, 1);
    assert.equal(ordinary.graph.registrationEnabled, true);
    await to(ordinaryID, 48, 0);
    assert.equal(ordinary.graph.registrationEnabled, false, '48 is a registration producer');
    assert.equal(display(ordinary.graph), 0);
    await to(ordinaryID, 47, 1);
    assert.equal(ordinary.graph.registrationEnabled, true);
    assert.equal(display(ordinary.graph), 0, '47 does not rewrite the MOT word');
    await to(childID, 47, 1);
    assert.equal(child.plane.graph.registrationEnabled, true, 'registration1 beats parent MOT0');
    assert.equal(child.plane.queryDraw(), 1);

    await to(ordinaryID, 47, 0);
    await to(ordinaryID, 48, 1);
    assert.equal(ordinary.graph.registrationEnabled, false, '48 retains the external47 gate');
    assert.equal(display(ordinary.graph), 1);
    await to(childID, 47, 1);
    assert.equal(child.plane.graph.registrationEnabled, false);
    await to(ordinaryID, 68);
    await to(childID, 47, 1);
    assert.equal(child.plane.graph.registrationEnabled, false, 'missing lookup retains zero');
    assert.equal(child.plane.state.shown, true);

    await to(ordinaryID, 41, 0, rectangle());
    assert.equal(ordinary.graph.registrationEnabled, false, 'normal41 also starts disabled');
    assert.equal(display(ordinary.graph), 1);
    await to(ordinaryID, 47, 1);
    display(ordinary.graph, 0);
    await to(childID, 47, 1);
    assert.equal(child.plane.graph.registrationEnabled, true);
    await to(ordinaryID, 68);
    await to(childID, 47, 0);
    assert.equal(child.plane.state.shown, false);
    assert.equal(child.plane.graph.registrationEnabled, true, 'missing lookup retains one');
    assert.equal(child.plane.queryDraw(), 1, 'shown is not a missing-parent fallback');
    await assert.rejects(async () => child.plane.drawGPU(), /current World StageRenderer GPU/);

    const parent = await createCallback(h.id),
      parentID = parent.record.id,
      nested = await createCallback(parentID),
      nestedID = nested.record.id;
    await to(nestedID, 53, 0, packet([0, 0, 0]));
    await to(nestedID, 47, 1);
    assert.equal(nested.plane.graph.registrationEnabled, false, 'callback parent starts at zero');
    await to(parentID, 47, 1);
    display(parent.plane.graph, 0);
    await to(nestedID, 47, 1);
    assert.equal(nested.plane.graph.registrationEnabled, true, 'callback registration1 beats MOT0');
    await to(parentID, 53, 0, packet([0, 0, 0]));
    await to(parentID, 47, 0);
    assert.equal(parent.plane.state.shown, false);
    assert.equal(
      parent.plane.graph.registrationEnabled,
      true,
      'its FES parent has no registration',
    );
    await to(nestedID, 47, 1);
    assert.equal(
      nested.plane.graph.registrationEnabled,
      true,
      'parent shown0 does not replace registration1',
    );
    assert.equal(nested.plane.queryDraw(), 1);

    const before = w.effekseer.snapshot(),
      managers = new Map([child, parent, nested].map((t) => [t.record.id, t.manager.snapshot()])),
      saved = await deserializeCheckpoint(await serializeCheckpoint(w.snapshot()));
    assert.deepEqual(
      w.effekseer.threads.snapshot(),
      crt,
      'no Play/Update/RNG in this registration sequence',
    );
    fresh = (await open({ initialize: false })).world;
    await fresh.restore(saved);
    assert.equal(fresh.graphics.get(ordinaryID).graph, null);
    for (const id of [childID, parentID, nestedID]) {
      const restored = fresh.objects.objects.get(id).implementation;
      assert.equal(restored.plane.graph.registrationEnabled, true);
      assert.equal(Object.hasOwn(restored.plane.graph, 'renderEnabled'), false);
      assert.equal(Object.hasOwn(restored.plane.state, 'registrationEnabled'), false);
      assert.deepEqual(restored.manager.snapshot(), managers.get(id));
      assert.equal(restored.plane.queryDraw(), 1);
    }
    const restoredParent = fresh.objects.objects.get(parentID).implementation;
    assert.equal(restoredParent.plane.state.shown, false);
    assert.equal(display(restoredParent.plane.graph), 0);
    await fresh.sendEngine(nestedID, h.id, 47, 0, 1);
    assert.equal(
      fresh.objects.objects.get(nestedID).implementation.plane.graph.registrationEnabled,
      true,
    );
    assert.deepEqual(fresh.effekseer.snapshot(), before, 'fresh restore and query never replay');
    assert.deepEqual(fresh.effekseer.threads.snapshot(), crt);
    assert.equal(fresh.nativeEngine, undefined);
    assert.equal(w.nativeEngine, undefined);
  } finally {
    await fresh?.close({ flushFiles: false });
    await w.close({ flushFiles: false });
  }
});

test('ordinary inherited47 accepts a real45 parent without a D6 metadata error', async () => {
  const h = await open(),
    w = h.world,
    to = (target, id, l = 0, payload) =>
      w.sendEngine(target, h.id, id, 0, l, payload ? { payload } : {});
  try {
    const parentID = await w.objects.create({ kind: 2, parent: h.id }),
      childID = await w.objects.create({ kind: 2, parent: parentID }),
      parent = w.graphics.get(parentID),
      child = w.graphics.get(childID);
    await to(parentID, 45);
    const shape = packet([0, 0, 0, 16, 8, 0, 0, 0]);
    shape.store(28, 0xffffffff);
    await to(childID, 42, 0, shape);
    assert.equal(parent.graph.type, 5);
    assert.equal(child.graph.type, 2);
    await to(childID, 53, 0, packet([0, 0, 0]));
    for (const value of [1, 0, 1]) {
      await assert.doesNotReject(() => to(childID, 47, value));
      assert.equal(child.state.shown, Boolean(value));
      assert.equal(new DataView(child.graph.kx2.buffer).getInt32(MOTION_ABI.display, true), 1);
    }
    assert.equal(w.nativeEngine, undefined);
  } finally {
    await w.close({ flushFiles: false });
  }
});

test('D6 diagnoses unknown registration without changing ordinary messages or fabricating48 presence', async () => {
  const h = await loaded(),
    w = h.world,
    crt = w.effekseer.threads.snapshot(),
    to = (target, id, l = 0, payload, word = 0) =>
      w.sendEngine(target, h.id, id, word, l, payload ? { payload } : {});
  let fresh;
  try {
    const parentID = await w.objects.create({ kind: 2, parent: h.id }),
      parent = w.graphics.get(parentID),
      mesh = packet([0, 0, 0, 0, 0, 0, 0, 0, 16, 0, 0, 0, 0, 0, 0, 8, 0, 0, 0, 0]);
    mesh.store(4, 0xffffffff);
    for (let i = 0; i < 3; i++) mesh.store(20 + i * 24, 0xffffffff);
    await to(parentID, 45);
    assert.equal(parent.graph.registrationEnabled, false, 'verified45 starts disabled');
    await to(parentID, 48, 1);
    assert.equal(parent.graph.registrationEnabled, true);
    await to(parentID, 46, 0, new NativeGraphicsPacket(new Array(10).fill(0)));
    assert.equal(parent.graph.registrationEnabled, false, 'verified46 creates a new registration');
    // Existing83 creates a real, nonempty authored ordinary mesh. This leaf
    // makes no new claim about that creator's native registration presence.
    await to(parentID, 83, 0, mesh, 1);
    assert.equal(parent.graph.type, 3);
    assert.equal(parent.graph.mesh.length, 1);
    assert.equal(parent.graph.registrationEnabled, 'unverified');
    for (const [id, value] of [
      [47, 0],
      [47, 1],
      [48, 1],
    ]) {
      await assert.doesNotReject(() => to(parentID, id, value));
      assert.equal(parent.graph.registrationEnabled, 'unverified', 'no fabricated record presence');
    }
    const ordinaryID = await w.objects.create({ kind: 2, parent: parentID }),
      ordinary = w.graphics.get(ordinaryID),
      shape = packet([0, 0, 0, 16, 8, 0, 0, 0]);
    shape.store(28, 0xffffffff);
    await to(ordinaryID, 42, 0, shape);
    await to(ordinaryID, 53, 0, packet([0, 0, 0]));
    await assert.doesNotReject(() => to(ordinaryID, 47, 1));
    assert.equal(
      ordinary.graph.registrationEnabled,
      null,
      'own record is known; inherited result is not',
    );
    assert.equal(ordinary.state.shown, true);
    assert.equal(w.graphics.stage.planes[ordinary.stageKey].visible, true);
    assert.equal(Object.hasOwn(ordinary.graph, 'renderEnabled'), false);
    await to(ordinaryID, 48, 1);
    assert.equal(
      ordinary.graph.registrationEnabled,
      true,
      '48 can establish its verified own record',
    );
    assert.equal(parent.graph.registrationEnabled, 'unverified');

    const id = await w.objects.create({ kind: 61, parent: parentID }),
      t = w.objects.objects.get(id).implementation,
      plane = t.plane;
    await to(id, 569, 0, { string: () => 'scene.efk' });
    assert.notEqual(t.currentEffect, null);
    assert.equal(plane.graph.registrationEnabled, false);
    await to(id, 53, 0, packet([0, 0, 0]));
    await to(id, 48, 1);
    assert.equal(plane.graph.registrationEnabled, true);
    assert.equal(plane.queryDraw(), 1);
    await to(id, 47, 0);
    assert.equal(
      plane.graph.registrationEnabled,
      null,
      'lookup may fail, so47 zero cannot assume success',
    );
    assert.equal(plane.state.shown, false);
    assert.throws(() => plane.queryDraw(), /callback registration is unknown/);
    assert.equal(await plane.drawGPU(undefined, { minimum: 0, maximum: 0 }), 0);
    await assert.rejects(async () => plane.drawGPU(), /callback registration is unknown/);
    await to(id, 48, 1);
    assert.equal(
      plane.graph.registrationEnabled,
      false,
      'a verified own48 respects external47 zero',
    );
    assert.equal(plane.queryDraw(), 0);
    await to(id, 47, 1);
    assert.equal(plane.graph.registrationEnabled, null);
    assert.throws(() => plane.queryDraw(), /callback registration is unknown/);
    await to(id, 48, 1);
    assert.equal(plane.graph.registrationEnabled, true);
    assert.equal(plane.queryDraw(), 1);
    await assert.rejects(async () => plane.drawGPU(), /current World StageRenderer GPU/);
    assert.equal(
      parent.graph.registrationEnabled,
      'unverified',
      'child48 did not invent a parent record',
    );
    await to(id, 47, 1);
    assert.equal(plane.graph.registrationEnabled, null);

    const manager = t.manager.snapshot(),
      resources = w.effekseer.loads.snapshot(),
      saved = await deserializeCheckpoint(await serializeCheckpoint(w.snapshot()));
    assert.deepEqual(w.effekseer.threads.snapshot(), crt);
    fresh = (await open({ initialize: false })).world;
    await fresh.restore(saved);
    const restored = fresh.objects.objects.get(id).implementation;
    assert.equal(fresh.graphics.get(parentID).graph.registrationEnabled, 'unverified');
    assert.equal(fresh.graphics.get(ordinaryID).graph.registrationEnabled, true);
    assert.equal(restored.plane.graph.registrationEnabled, null);
    assert.equal(Object.hasOwn(restored.plane.state, 'registrationEnabled'), false);
    assert.equal(Object.hasOwn(restored.plane.graph, 'renderEnabled'), false);
    assert.throws(() => restored.plane.queryDraw(), /callback registration is unknown/);
    await assert.rejects(async () => restored.plane.drawGPU(), /callback registration is unknown/);
    await fresh.sendEngine(parentID, h.id, 47, 0, 1);
    assert.equal(fresh.graphics.get(parentID).graph.registrationEnabled, 'unverified');
    await fresh.sendEngine(id, h.id, 47, 0, 1);
    assert.equal(restored.plane.graph.registrationEnabled, null);
    await fresh.sendEngine(id, h.id, 48, 0, 1);
    assert.equal(restored.plane.graph.registrationEnabled, true);
    assert.equal(restored.plane.queryDraw(), 1);
    await assert.rejects(async () => restored.plane.drawGPU(), /current World StageRenderer GPU/);
    assert.deepEqual(restored.manager.snapshot(), manager);
    assert.deepEqual(fresh.effekseer.loads.snapshot(), resources);
    assert.deepEqual(fresh.effekseer.threads.snapshot(), crt);
    assert.equal(fresh.nativeEngine, undefined);
    assert.equal(w.nativeEngine, undefined);
  } finally {
    await fresh?.close({ flushFiles: false });
    await w.close({ flushFiles: false });
  }
});
