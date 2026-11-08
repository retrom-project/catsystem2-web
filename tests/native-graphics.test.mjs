// SPDX-License-Identifier: MPL-2.0
import test from 'node:test';
import assert from 'node:assert/strict';
import { NativeObjects } from '../src/native/objects.mjs';
import { installNativeGraphics, nativeGraphics } from '../src/native/graphics.mjs';
import { KCSMachine, floatBits } from '../src/kcs.mjs';
import { Binary } from '../src/binary.mjs';
import { MOTION_ABI, motionVector } from '../src/motion/abi.mjs';
import { NativeHandles } from '../src/native/handles.mjs';

function world() {
  const objects = new NativeObjects(),
    handlers = new Map(),
    inputRegions = new Map();
  const world = {
    game: { width: 800, height: 600 },
    objects,
    runtime: {
      handles: new NativeHandles(),
      register: (_table, id, handler) => handlers.set(id, handler),
    },
    events: [],
    sendEngine(target, sender, message, w = 0, l = 0, context = {}) {
      const record = objects.objects.get(target);
      if (record) return record.implementation.message([sender, message, w, l], context);
      this.events.push([target, sender, message, w, l]);
      return 99;
    },
    sendNativeEngine(...args) {
      return this.sendEngine(...args);
    },
    base: (record) => ({
      message: ([_sender, message]) => {
        if (message === 3) {
          record.deleted = true;
          return 0;
        }
        throw new Error(`unimplemented engine message ${message}`);
      },
    }),
    input: {
      register: (region) => inputRegions.set(region.owner, structuredClone(region)),
      unregister: (owner) => inputRegions.delete(owner),
      get: (owner) => inputRegions.get(owner),
      get regions() {
        return [...inputRegions.values()];
      },
    },
  };
  world.inputFor = () => world.input;
  installNativeGraphics(world);
  const machine = new KCSMachine(
    {
      body: new Binary(new Uint8Array([59])),
      codeSize: 1,
      data: new Uint8Array(1024),
      stackSize: 128,
    },
    {},
  );
  return { world, handlers, inputRegions, machine };
}

test('rendering retained FES surfaces does not execute an interpreter or object driver', async () => {
  const { world: scene } = world(),
    id = await scene.objects.create({ kind: 6 }),
    player = { frameCount: 17, imageLoads: 3 },
    owner = scene.objects.objects.get(id);
  let draws = 0;
  scene.graphics.fesSurfaces.set(
    91,
    new Map([
      [id, player],
      [99999, {}],
    ]),
  );
  scene.graphics.drawTasks.set(91, {
    state: { renderer: {} },
    async render() {
      draws++;
    },
  });
  scene.graphics.syncFES = () => {
    throw new Error('Rendering must not enter FES frame execution');
  };
  await scene.graphics.prepareRender();
  await scene.graphics.prepareRender();
  assert.equal(draws, 2);
  assert.deepEqual(player, { frameCount: 17, imageLoads: 3 });
  assert.equal(scene.graphics.fesSurfaces.get(91).size, 1);
  assert.equal(scene.objects.objects.get(id), owner);
});

test('native plane construction retains an unloaded graph and fails unknown messages explicitly', async () => {
  const { world: scene } = world();
  const h = await scene.objects.create({ kind: 2 });
  const object = scene.graphics.get(h);
  assert.equal(object.graph, null);
  assert.equal(Object.hasOwn(scene.graphics.stage.planes, h), false);
  assert.equal(object.state.receiver, -1);
  await assert.rejects(() => object.message([0, 0x700, 0, 0]), /unimplemented engine message/);
});

test('plane input switches use active/enabled/source and forward engine events to the receiver', async () => {
  const { world: scene, inputRegions, machine } = world();
  await scene.objects.create({ kind: 2 });
  const h = await scene.objects.create({ kind: 6 }),
    task = { id: 42 };
  await nativeGraphics(0x68, [h, 10, 20, 40, 50, 10, 8], machine, task, scene);
  const region = inputRegions.get(h),
    plane = scene.graphics.get(h);
  await nativeGraphics(0x69, [h, 0], machine, task, scene);
  assert.equal(region.enabled, false);
  assert.equal(region.active, false);
  await nativeGraphics(0x69, [h, 1], machine, task, scene);
  await nativeGraphics(0x6a, [h, 1], machine, task, scene);
  assert.equal(region.active, true);
  scene.input.source = 16;
  assert.equal((await nativeGraphics(0x6d, [h], machine, task, scene)).value, 2);
  await nativeGraphics(0x350, [h, 0], machine, task, scene);
  await nativeGraphics(0x351, [h, 0], machine, task, scene);
  assert.equal(region.hoverEnabled, false);
  assert.equal(region.dragEnabled, false);
  await plane.message([1, 7, 10, 20]);
  assert.equal(await plane.message([1, 4, 3, 1]), 1);
  assert.equal(await plane.message([1, 4, 3, 0]), 0);
  await plane.message([1, 8, 10, 20]);
  assert.deepEqual(scene.events, [
    [42, h, 64, h, 1],
    [42, h, 9, h, 3],
    [42, h, 10, h, 3],
    [42, h, 64, h, 0],
  ]);
});

test('native colored rectangle wrappers preserve ARGB alpha, dimensions and 3-axis KX2 transforms', async () => {
  const { world: scene, machine } = world();
  await scene.objects.create({ kind: 6 });
  const h = await scene.objects.create({ kind: 2 }),
    task = { id: 99 };
  await nativeGraphics(0x4f, [h, floatBits(320), floatBits(200), 0x80112233], machine, task, scene);
  const object = scene.graphics.get(h);
  assert.equal(object.graph.width, 320);
  assert.equal(object.graph.height, 200);
  assert.deepEqual(object.graph.colors, [0x80112233]);
  await nativeGraphics(0x54, [h, ...[10, 20, 30].map(floatBits), 0], machine, task, scene);
  assert.deepEqual(motionVector(object.graph.kx2, MOTION_ABI.pos), [10, 20, 30]);
  await nativeGraphics(0x58, [h, floatBits(6000)], machine, task, scene);
  assert.equal(scene.graphics.stage.planes[h].priority, 6000);
  await nativeGraphics(0x57, [h, 0, 4, 8, 0], machine, task, scene);
  assert.deepEqual(
    [0, 4, 8].map((at) => machine.load(at)),
    [10, 20, 30].map(floatBits),
  );
  await nativeGraphics(0x5e, [h, 1000], machine, task, scene);
  assert.equal(new DataView(object.graph.kx2.buffer).getUint32(0x70, true) >>> 24, 255);
  await nativeGraphics(0x53, [h], machine, task, scene);
  assert.equal(object.graph, null);
});

test('base plane input registration keeps receiver, full-screen bounds and initialization state', async () => {
  const { world: scene, inputRegions, machine } = world();
  await scene.objects.create({ kind: 2 });
  const h = await scene.objects.create({ kind: 6 }),
    task = { id: 42 };
  await nativeGraphics(0x68, [h, 0, 0, 800, 600, 10000, 5], machine, task, scene);
  assert.deepEqual(inputRegions.get(h), {
    owner: h,
    receiver: 42,
    bounds: [-100000, -100000, 100000, 100000],
    priority: 10000,
    flags: 5,
    mask: 7,
    extra: 0,
  });
  const object = scene.graphics.get(h);
  assert.equal(object.state.receiver, 42);
  assert.equal(object.state.changed, 1);
  await nativeGraphics(0x68, [h, 1, 2, 3, 4, 100, 1], machine, task, scene);
  assert.equal(inputRegions.get(h).priority, 10000);
  await nativeGraphics(0x63, [h], machine, task, scene);
  assert.equal(inputRegions.has(h), false);
  assert.equal(object.state.receiver, -1);
});

test('native graph snapshots own their bytes and restore actual loaded geometry', async () => {
  const { world: scene, machine } = world();
  await scene.objects.create({ kind: 6 });
  const h = await scene.objects.create({ kind: 2 });
  await nativeGraphics(
    0x4f,
    [h, floatBits(300), floatBits(100), 0xffffffff],
    machine,
    { id: 22 },
    scene,
  );
  const state = scene.objects.snapshot(),
    second = world();
  await second.world.objects.restore(state);
  const a = scene.graphics.get(h),
    b = second.world.graphics.get(h);
  assert.deepEqual(a.graph, b.graph);
  assert.notEqual(a.graph.kx2, b.graph.kx2);
  assert.equal(second.world.graphics.attachment(h).display, true);
});
