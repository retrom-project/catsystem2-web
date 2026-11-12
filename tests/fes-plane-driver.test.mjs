// SPDX-License-Identifier: MPL-2.0
import test from 'node:test';
import assert from 'node:assert/strict';
import { FESPlaneDriver, fesPlaneRenderingState } from '../src/native/fes-plane-driver.mjs';
import { FESImageCache } from '../src/native/fes-image-cache.mjs';
import { setFESGraphicalPosition, setFESGraphicalSize } from '../src/native/fes-common-model.mjs';
import { identity } from '../src/motion/matrix.mjs';
import { MOTION_ABI, motionVector } from '../src/motion/abi.mjs';
import { dataWorld } from './fixtures/data-world.mjs';
import { hg3 } from './helpers.mjs';

const profiles = ['sdk-4.01-engine-2.6.1.74', 'nekopara-vol3-engine-2.6.1.76'];
function plane(key, nativeType = 4, extra = {}) {
  return {
    key,
    baseName: key,
    index: null,
    handle: 0x1001,
    nativeType,
    x: 0,
    y: 0,
    z: 0,
    baseX: 0,
    baseY: 0,
    baseZ: 0,
    scaleX: 1,
    scaleY: 1,
    scaleZ: 1,
    motionMatrix: Float32Array.from(identity()),
    vramX: 0,
    vramY: 0,
    vramZ: 0,
    width: 800,
    height: 600,
    color: 0xffffffff,
    pri: 5000,
    planeType: 1,
    blendMode: 0,
    disp: false,
    dirty: false,
    sizeDirty: false,
    ...extra,
  };
}
async function fixture(
  profile,
  objects = [plane('plane')],
  { resources = true, initialize = true } = {},
) {
  const world = await dataWorld(
    profile,
    resources
      ? {
          'geometry.hg3': hg3(
            2,
            2,
            Uint8Array.from([255, 0, 0, 255, 0, 255, 0, 255, 0, 0, 255, 255, 255, 255, 255, 128]),
          ),
        }
      : {},
    { initialize },
  );
  const cache = new FESImageCache(world, world.main?.id ?? 1),
    player = { nativeInput: { state: { sleeping: false } }, nativeDraw: { offset: [2, -3] } },
    instance = {
      runtimeID: world.main?.id,
      objects,
      byKey: new Map(objects.map((o) => [o.key, o])),
      player,
    },
    driver = new FESPlaneDriver(world, { cacheFor: () => cache });
  return { world, cache, instance, driver, object: objects[0] };
}
function graphState(world, id) {
  const task = world.graphics.get(id),
    graph = task.graph;
  return {
    id,
    order: graph.renderOrder,
    handle: graph.handle,
    shape: [...task.state.shapeWords],
    shown: task.state.shown,
    pos: motionVector(graph.kx2, MOTION_ABI.pos),
    base: motionVector(graph.kx2, MOTION_ABI.base),
    scale: motionVector(graph.kx2, MOTION_ABI.scale),
    texture: motionVector(graph.textureTransform, MOTION_ABI.pos),
    matrix: [...new Float32Array(graph.kx2.buffer, MOTION_ABI.matrix, 16)],
    color: new DataView(graph.kx2.buffer).getUint32(MOTION_ABI.color, true),
  };
}

test('plane rendering uses distinct eligible parent chains and reuses all transform buffers', () => {
  const top = plane('top', 3, { x: 100, y: -100, baseX: 1000, scaleX: 100 }),
    parent = plane('parent', 4, {
      x: 20,
      y: 30,
      z: 40,
      baseX: 4,
      baseY: 5,
      baseZ: 6,
      scaleX: 2,
      scaleY: 3,
      scaleZ: 4,
      parent: 'top',
    }),
    child = plane('child', 3, {
      x: 2,
      y: 3,
      z: 4,
      baseX: 1.5,
      baseY: 2.5,
      baseZ: 3.5,
      scaleX: 5,
      scaleY: 6,
      scaleZ: 7,
      parent: 'parent',
    }),
    instance = {
      objects: [top, parent, child],
      byKey: new Map([top, parent, child].map((o) => [o.key, o])),
    };
  parent.motionMatrix[12] = 20;
  child.motionMatrix[13] = 7;
  const state = fesPlaneRenderingState(instance, child);
  assert.deepEqual([...state.position], [122, -67, 44]);
  assert.deepEqual([...state.base], [5.5, 7.5, 9.5]);
  assert.deepEqual([...state.scale], [10, 18, 28]);
  assert.deepEqual([...state.matrix].slice(12), [20, 7, 0, 1]);
  const buffers = [
    state.position,
    state.base,
    state.scale,
    state.matrix,
    state.product,
    state.packet,
    state.metadata,
  ];
  assert.strictEqual(fesPlaneRenderingState(instance, child), state);
  const reused = [
    state.position,
    state.base,
    state.scale,
    state.matrix,
    state.product,
    state.packet,
    state.metadata,
  ];
  for (let at = 0; at < buffers.length; at++) assert.strictEqual(reused[at], buffers[at]);
  top.parent = 'child';
  assert.throws(() => fesPlaneRenderingState(instance, child), /parent cycle/);
});

for (const profile of profiles) {
  test(`${profile} real plane graphs obey size recreation, separate texture origin, typed state and sleep masks`, async () => {
    const f = await fixture(profile),
      { world, object: o, instance, driver } = f;
    try {
      driver.initialize(instance, o);
      await driver.update(instance, o);
      assert.equal(o.nativeTaskID, undefined, 'an unmodified declaration creates no graph');
      o.x = 7;
      o.y = 8;
      o.z = 9;
      o.vramX = -4.75;
      o.vramY = 6.75;
      o.baseX = 1.5;
      o.baseY = -2.5;
      o.scaleX = 2;
      o.scaleY = 3;
      o.pri = 123;
      o.disp = true;
      o.color = 0x80123456;
      o.dirty = true;
      setFESGraphicalSize(o, 5, 4);
      await driver.update(instance, o);
      const before = graphState(world, o.nativeTaskID),
        id = o.nativeTaskID;
      assert.deepEqual(before.pos, [7, 8, 9]);
      assert.deepEqual(before.base, [1.5, -2.5, 123]);
      assert.deepEqual(before.scale, [2, 3, 1]);
      assert.deepEqual(before.texture, [-2, 3, 0]);
      assert.equal(before.shape[5], 4);
      assert.equal(before.color, 0x80123456);
      assert.equal(before.shown, true);
      await driver.update(instance, o);
      assert.deepEqual(
        graphState(world, id),
        before,
        'clean sync does not rebuild or reorder the graph',
      );
      instance.player.nativeInput.state.sleeping = true;
      await driver.update(instance, o);
      assert.equal(world.graphics.get(id).state.shown, false);
      assert.equal(o.disp, true, 'sleep retains authored display');
      instance.player.nativeInput.state.sleeping = false;
      await driver.update(instance, o);
      assert.equal(world.graphics.get(id).state.shown, true);
      setFESGraphicalPosition(instance, o, [12, 13, 14]);
      await driver.update(instance, o);
      assert.equal(o.nativeTaskID, id);
      assert.equal(world.graphics.get(id).graph.renderOrder, before.order);
      setFESGraphicalSize(o, 6, 4);
      await driver.update(instance, o);
      assert.notEqual(o.nativeTaskID, id);
      assert.equal(world.objects.objects.get(id).destroyRequested, true);
      await driver.close(o);
      assert.equal(o.nativeTaskID, null);
    } finally {
      f.cache.close();
      await world.close();
    }
  });

  test(`${profile} POS2/SIZE2 metadata and current World restoration keep cached resources and stable graph identity`, async () => {
    const f = await fixture(profile),
      { world, object: o, instance, driver } = f;
    let fresh;
    try {
      Object.assign(o, {
        positionReference: { name: 'geometry.hg3', index: 0 },
        positionPending: true,
        sizeReference: { name: 'geometry.hg3', index: 0 },
        sizePending: true,
        sizeDirty: true,
        dirty: true,
        x: 99,
        y: 88,
        z: 7,
        disp: true,
      });
      await driver.update(instance, o);
      assert.deepEqual([o.x, o.y, o.z, o.width, o.height], [0, 0, 7, 2, 2]);
      assert.equal(o.positionPending, false);
      assert.equal(o.sizePending, true, 'SIZE2 remains active across later size rebuilds');
      instance.player.nativeInput.state.sleeping = true;
      await driver.update(instance, o);
      const saved = await world.snapshot(),
        objects = structuredClone(instance.objects),
        cacheState = f.cache.snapshot(),
        graph = graphState(world, o.nativeTaskID);
      fresh = await dataWorld(profile, {}, { initialize: false });
      await fresh.restore(saved);
      const restoredCache = new FESImageCache(fresh, instance.runtimeID, cacheState),
        r = {
          ...instance,
          objects,
          byKey: new Map(objects.map((o) => [o.key, o])),
          player: structuredClone(instance.player),
        },
        newDriver = new FESPlaneDriver(fresh, { cacheFor: () => restoredCache });
      await newDriver.update(r, objects[0], { restoring: true });
      await newDriver.update(r, objects[0]);
      assert.deepEqual(graphState(fresh, objects[0].nativeTaskID), graph);
      assert.deepEqual(restoredCache.snapshot(), cacheState);
      assert.equal(fresh.graphics.get(objects[0].nativeTaskID).state.shown, false);
      r.player.nativeInput.state.sleeping = false;
      await newDriver.update(r, objects[0]);
      assert.equal(fresh.graphics.get(objects[0].nativeTaskID).state.shown, true);
      objects[0].sizeDirty = true;
      await newDriver.update(r, objects[0]);
      assert.deepEqual(
        [objects[0].width, objects[0].height],
        [2, 2],
        'later rebuild uses cached bytes without source files',
      );
      restoredCache.close();
    } finally {
      f.cache.close();
      await fresh?.close();
      await world.close();
    }
  });

  test(`${profile} CPLANE physical dimensions, color shape and missing metadata remain explicit state`, async () => {
    const o = plane('color', 3, {
        width: 4,
        height: 3,
        sizeDirty: true,
        dirty: true,
        disp: true,
        color: 0x80402010,
        sizePending: true,
        sizeReference: { name: 'missing.hg3', index: 0 },
      }),
      f = await fixture(profile, [o]);
    try {
      await f.driver.update(f.instance, o);
      assert.deepEqual([o.width, o.height], [0, 0]);
      const task = f.world.graphics.get(o.nativeTaskID);
      assert.equal(task.graph.type, 2);
      assert.equal(task.state.shapeWords[5], 32);
      assert.equal(task.state.shapeWords[7], 0x80402010);
      assert.equal(task.state.shown, true);
    } finally {
      f.cache.close();
      await f.world.close();
    }
  });
}

for (const profile of profiles)
  test(`${profile} an entry previous child is independent of the current plane getter`, async () => {
    const h = await fixture(profile, [
      plane('p', 4, { sizeDirty: true, dirty: true, width: 4, height: 3 }),
    ]);
    try {
      const { world, driver, instance, object } = h;
      await driver.update(instance, object, { previousTaskID: null });
      const previous = object.nativeTaskID;
      const other = await world.objects.create({
        kind: 2,
        parent: instance.runtimeID,
        creator: instance.runtimeID,
        name: 'another entry child',
      });
      object.nativeTaskID = other;
      object.x = 27;
      object.dirty = true;
      await driver.update(instance, object, { previousTaskID: previous });
      assert.equal(graphState(world, previous).pos[0], 27);
      assert.equal(world.graphics.get(other).graph, null);
      assert.equal(object.nativeTaskID, other);
      object.sizeDirty = object.dirty = true;
      await driver.update(instance, object, { previousTaskID: previous });
      assert.equal(world.objects.objects.get(previous).destroyRequested, true);
      assert.equal(world.objects.objects.get(other).destroyRequested, undefined);
      assert.notEqual(object.nativeTaskID, previous);
      assert.notEqual(object.nativeTaskID, other);
      assert.equal(graphState(world, object.nativeTaskID).pos[0], 27);
    } finally {
      await h.world.close();
    }
  });
