// SPDX-License-Identifier: MPL-2.0
import test from 'node:test';
import assert from 'node:assert/strict';
import { NativeObjects } from '../src/native/objects.mjs';
import { installNativeGraphics, nativeGraphics } from '../src/native/graphics.mjs';
import { KCSMachine, floatBits } from '../src/kcs.mjs';
import { Binary } from '../src/binary.mjs';
import { MOTION_ABI, motionVector } from '../src/motion/abi.mjs';
import { NativeHandles } from '../src/native/handles.mjs';
import { dataWorld } from './fixtures/data-world.mjs';
import { kcsProgram } from './helpers.mjs';
import { nativeABI } from '../src/native/abi/index.mjs';
import { NativeGraphicsPacket } from '../src/native/graphics-task.mjs';

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
  assert.equal(scene.graphics.stage.planes[scene.graphics.get(h).stageKey].priority, 6000);
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

const rectangleProfiles = ['sdk-4.01-engine-2.6.1.74', 'nekopara-vol3-engine-2.6.1.76'];
const rectangleSentinel = 0x24681357;
const rectangleColor = 0x80112233;

function rectangleProgram(nullFirst = false) {
  const call = (target, width, height, color) => [
    [37, target],
    [37, floatBits(width)],
    [37, floatBits(height)],
    [37, color],
    [43, 79, 16],
  ];
  return kcsProgram([
    [37, rectangleSentinel],
    ...(nullFirst ? [...call(0, 111, 222, 0xffaabbcc), [37, 73], [38, [0x13, 512]]] : []),
    ...call(
      [0x13, 128],
      nullFirst ? 20.5 : 30.75,
      nullFirst ? 12.25 : 15.5,
      nullFirst ? rectangleColor : 0x40fedcba,
    ),
    [37, 89],
    [38, [0x13, 516]],
    [59],
  ]);
}

async function rectangleCaller(scene) {
  const id = await scene.objects.create({
      kind: 12,
      parent: scene.main.id,
      name: 'rectangle caller',
    }),
    record = scene.objects.objects.get(id);
  await record.implementation.loadScript('rectangle.kcs');
  const task = record.implementation.task;
  assert.strictEqual(scene.runtime.scheduler.tasks.get(id), task);
  return { record, task, machine: task.machine, initialSP: task.machine.sp };
}

function rectangleDeclaration(profile) {
  const entry = nativeABI(profile).tables.main.entries[79];
  assert.equal(entry.status, 'recovered');
  assert.equal(entry.signature.argumentWords, 4);
  assert.deepEqual(entry.controlCodes, [2]);
  assert.equal(entry.signature.result.kind, 'void');
  assert.equal(entry.signature.resultWritten, false);
  for (const id of [78, 104, 467])
    assert.equal(nativeABI(rectangleProfiles[0]).tables.main.entries[id].status, 'unknown');
  assert.equal(nativeABI(rectangleProfiles[1]).tables.main.entries[467].status, 'unknown');
}

function rectangleContinuation(caller) {
  const { machine, initialSP } = caller;
  assert.equal(machine.load(516), 89, 'The real guest continued after the void rectangle call');
  assert.equal(machine.halted, true);
  assert.equal(machine.pop(), rectangleSentinel, 'Control 2 does not push a native result');
  assert.equal(machine.sp, initialSP);
  assert.deepEqual([...machine.bytes(800, 8)], Array(8).fill(0xa5));
}

for (const profile of rectangleProfiles) {
  test(`${profile} main79 GCALL creates a colored rectangle and skips target zero`, async () => {
    const scene = await dataWorld(profile, {
      'case.kcs': kcsProgram([[59]]),
      'rectangle.kcs': rectangleProgram(true),
    });
    try {
      const id = await scene.objects.create({
          kind: 2,
          parent: scene.main.id,
          nativeID: 0x004f004f,
          name: 'colored rectangle',
        }),
        record = scene.objects.objects.get(id),
        target = scene.nativeTaskID(id),
        plane = record.implementation,
        caller = await rectangleCaller(scene),
        packets = [],
        calls = [],
        native = scene.runtime.native,
        send = scene.sendNativeEngine;
      assert.notEqual(target, id, 'A native target ID is distinct from its World record ID');
      assert.equal(target, 0x004f004f);
      const order = scene.graphics.renderSequence;
      caller.machine.store(128, target);
      caller.machine.bytes(800, 8).fill(0xa5);
      scene.runtime.native = function (table, number, ...args) {
        const reply = native.call(this, table, number, ...args);
        if (table === 'main' && number === 79) calls.push({ args: [...args[0]], reply });
        return reply;
      };
      scene.sendNativeEngine = function (receiver, sender, message, w, l, context) {
        if (message === 42) {
          assert.equal(caller.machine.load(512), 73, 'Target zero completed before the only send');
          packets.push({
            receiver,
            sender,
            message,
            w,
            l,
            flags: context.flags,
            scalars: [0, 4, 8, 12, 16].map((offset) => context.payload.load(offset)),
            argb: context.payload.load(28),
          });
        }
        return send.call(this, receiver, sender, message, w, l, context);
      };
      await scene.runtime.scheduler.execute(caller.task);
      assert.equal(plane.graph.type, 2);
      assert.equal(plane.graph.width, 20.5);
      assert.equal(plane.graph.height, 12.25);
      assert.deepEqual(plane.graph.colors, [rectangleColor]);
      assert.deepEqual(plane.state.rect, [0, 0, 20.5, 12.25]);
      assert.equal(plane.state.drawType, 2);
      assert.strictEqual(scene.graphics.graphs.get(target), plane.graph);
      assert.equal(scene.graphics.renderSequence, order + 1, 'Null target allocated no graph');
      assert.deepEqual(packets, [
        {
          receiver: target,
          sender: caller.task.id,
          message: 42,
          w: 0,
          l: 0,
          flags: 0,
          scalars: [0, 0, 0, floatBits(20.5), floatBits(12.25)],
          argb: rectangleColor,
        },
      ]);
      assert.deepEqual(
        calls.map((call) => call.args),
        [
          [0, floatBits(111), floatBits(222), 0xffaabbcc],
          [target, floatBits(20.5), floatBits(12.25), rectangleColor],
        ],
      );
      assert.deepEqual(await Promise.all(calls.map((call) => call.reply)), [
        { control: 2 },
        { control: 2 },
      ]);
      rectangleContinuation(caller);
      rectangleDeclaration(profile);
    } finally {
      await scene.close();
    }
  });

  test(`${profile} main79 GCALL removes the previous rectangle before rejecting modes zero and two`, async () => {
    const scene = await dataWorld(profile, {
      'case.kcs': kcsProgram([[59]]),
      'rectangle.kcs': rectangleProgram(),
    });
    try {
      const id = await scene.objects.create({
          kind: 2,
          parent: scene.main.id,
          nativeID: 0x004f0050,
          name: 'replace rectangle',
        }),
        target = scene.nativeTaskID(id),
        plane = scene.objects.objects.get(id).implementation;
      assert.notEqual(target, id);
      for (const mode of [0, 2]) {
        await scene.sendNativeEngine(target, scene.main.id, 84, 0, 1);
        await scene.sendNativeEngine(target, scene.main.id, 42, 0, 0, {
          payload: new NativeGraphicsPacket([
            0,
            0,
            0,
            floatBits(20.5),
            floatBits(12.25),
            0,
            0,
            rectangleColor,
          ]),
        });
        assert.equal(plane.graph.type, 2, 'A real old colored model exists before replacement');
        assert.deepEqual(plane.graph.colors, [rectangleColor]);
        await scene.sendNativeEngine(target, scene.main.id, 84, 0, mode);
        assert.equal(plane.state.vramType, mode);
        const retained = structuredClone({
            rect: plane.state.rect,
            drawType: plane.state.drawType,
            shapeWords: plane.state.shapeWords,
          }),
          old = plane.graph,
          order = scene.graphics.renderSequence,
          caller = await rectangleCaller(scene);
        caller.machine.store(128, target);
        caller.machine.bytes(800, 8).fill(0xa5);
        await scene.runtime.scheduler.execute(caller.task);
        assert.equal(plane.graph, null, `Mode ${mode} removes the old model without replacement`);
        assert.equal(scene.graphics.graphs.has(target), false);
        assert.equal(Object.hasOwn(scene.graphics.stage.planes, plane.stageKey), false);
        assert.equal(
          scene.graphics.renderSequence,
          order,
          'A rejected mode allocates no render order',
        );
        assert.deepEqual(
          {
            rect: plane.state.rect,
            drawType: plane.state.drawType,
            shapeWords: plane.state.shapeWords,
          },
          retained,
        );
        assert.equal(plane.state.vramType, mode);
        assert.notStrictEqual(plane.graph, old);
        rectangleContinuation(caller);
      }
      await scene.sendNativeEngine(target, scene.main.id, 84, 0, 1);
      const caller = await rectangleCaller(scene);
      caller.machine.store(128, target);
      caller.machine.bytes(800, 8).fill(0xa5);
      await scene.runtime.scheduler.execute(caller.task);
      assert.equal(plane.graph.type, 2, 'A later mode-one input creates a new real model');
      assert.equal(plane.graph.width, 30.75);
      assert.equal(plane.graph.height, 15.5);
      assert.deepEqual(plane.graph.colors, [0x40fedcba]);
      assert.deepEqual(plane.state.rect, [0, 0, 30.75, 15.5]);
      rectangleContinuation(caller);
      rectangleDeclaration(profile);
    } finally {
      await scene.close();
    }
  });
}

const priorityProgram = kcsProgram([
  [37, rectangleSentinel],
  [37, 0],
  [37, floatBits(-1234.5)],
  [43, 88, 8],
  [37, 73],
  [38, [0x13, 512]],
  [37, [0x13, 128]],
  [37, [0x13, 132]],
  [43, 88, 8],
  [37, 89],
  [38, [0x13, 516]],
  [59],
]);

for (const profile of rectangleProfiles)
  test(`${profile} main88 GCALL broadcasts priority through real Base children without a VM result`, async () => {
    const scene = await dataWorld(profile, {
      'case.kcs': kcsProgram([[59]]),
      'rectangle.kcs': priorityProgram,
    });
    try {
      const branch = await scene.objects.create({
          kind: 0,
          parent: scene.root,
          nativeID: 0x00580058,
          name: 'priority branch',
        }),
        aID = await scene.objects.create({
          kind: 2,
          parent: branch,
          nativeID: 0x00580101,
          name: 'priority plane A',
        }),
        bID = await scene.objects.create({
          kind: 2,
          parent: branch,
          nativeID: 0x00580102,
          name: 'priority plane B',
        }),
        a = scene.objects.objects.get(aID).implementation,
        b = scene.objects.objects.get(bID).implementation,
        branchNative = scene.nativeTaskID(branch),
        aNative = scene.nativeTaskID(aID),
        bNative = scene.nativeTaskID(bID),
        initialA = [10.5, 20.25, 5000],
        initialB = [30.5, -40.25, 6000],
        geometry = [];
      assert.notEqual(branchNative, branch);
      assert.notEqual(aNative, aID);
      assert.notEqual(bNative, bID);
      for (const [id, plane, vector, color] of [
        [aNative, a, initialA, 0x80112233],
        [bNative, b, initialB, 0x40445566],
      ]) {
        await scene.sendNativeEngine(id, scene.main.id, 42, 0, 0, {
          payload: new NativeGraphicsPacket([
            0,
            0,
            0,
            floatBits(20.5),
            floatBits(12.25),
            0,
            0,
            color,
          ]),
        });
        await scene.sendNativeEngine(id, scene.main.id, 49, 0, 0, {
          payload: new NativeGraphicsPacket(vector.map(floatBits)),
        });
        assert.deepEqual(motionVector(plane.graph.kx2, MOTION_ABI.base), vector);
        geometry.push({
          graph: plane.graph,
          rect: [...plane.state.rect],
          colors: [...plane.graph.colors],
        });
      }
      const order = scene.graphics.renderSequence,
        deliveries = [],
        queried = [],
        writes = [],
        outer = [],
        calls = [],
        observerErrors = [],
        native = scene.runtime.native,
        send = scene.sendNativeEngine;
      for (const id of [branch, aID, bID]) {
        const record = scene.objects.objects.get(id),
          implementation = record.implementation,
          original = implementation.message;
        implementation.message = function (words, context, ...rest) {
          if ([61, 49].includes(words[1])) {
            deliveries.push({
              receiver: record.nativeID,
              message: words[1],
              flags: context.flags,
              payload: context.payload,
            });
            if (words[1] === 49)
              writes.push({
                receiver: record.nativeID,
                words: [0, 4, 8].map((at) => context.payload.load(at)),
              });
          }
          const reply = original.call(this, words, context, ...rest);
          if (record.kind === 2 && words[1] === 61)
            reply.then(
              () =>
                queried.push({
                  receiver: record.nativeID,
                  words: [0, 4, 8].map((at) => context.payload.load(at)),
                }),
              () => observerErrors.push(record.nativeID),
            );
          return reply;
        };
      }
      scene.runtime.native = function (table, id, ...args) {
        const reply = native.call(this, table, id, ...args);
        if (table === 'main' && id === 88) calls.push({ args: [...args[0]], reply });
        return reply;
      };
      scene.sendNativeEngine = function (target, sender, message, w, l, context) {
        if ([61, 49].includes(message))
          outer.push({
            target,
            sender,
            message,
            w,
            l,
            flags: context.flags,
            afterNullMarker: scene.objects.machine(sender).load(512),
          });
        return send.call(this, target, sender, message, w, l, context);
      };
      const first = await rectangleCaller(scene),
        priority = 9000.75;
      first.machine.store(128, branchNative);
      first.machine.store(132, floatBits(priority));
      first.machine.bytes(800, 16).fill(0xa5);
      await scene.runtime.scheduler.execute(first.task);
      assert.equal(
        first.machine.load(512),
        73,
        'The zero-target request continued without dispatch',
      );
      assert.equal(first.machine.load(516), 89, 'The real priority GCALL completed');
      // Native flags1 reads A then B through the real unhandled Base. The same
      // vector packet is then written to both children with only z replaced.
      const expected = [30.5, -40.25, priority];
      assert.deepEqual(
        motionVector(a.graph.kx2, MOTION_ABI.base),
        expected,
        'The real earlier plane receives the last responding sibling x/y and the new priority',
      );
      assert.deepEqual(motionVector(b.graph.kx2, MOTION_ABI.base), expected);
      assert.equal(scene.graphics.stage.planes[a.stageKey].priority, priority);
      assert.equal(scene.graphics.stage.planes[b.stageKey].priority, priority);
      assert.deepEqual(queried, [
        { receiver: aNative, words: initialA.map(floatBits) },
        { receiver: bNative, words: initialB.map(floatBits) },
      ]);
      assert.deepEqual(
        deliveries.map(({ receiver, message, flags }) => [receiver, message, flags]),
        [
          [branchNative, 61, 1],
          [aNative, 61, 1],
          [bNative, 61, 1],
          [branchNative, 49, 1],
          [aNative, 49, 1],
          [bNative, 49, 1],
        ],
      );
      for (const delivery of deliveries)
        assert.strictEqual(delivery.payload, deliveries[0].payload);
      assert.deepEqual(
        writes,
        [branchNative, aNative, bNative].map((receiver) => ({
          receiver,
          words: expected.map(floatBits),
        })),
      );
      assert.equal(first.machine.load(128), branchNative);
      assert.equal(first.machine.load(132), floatBits(priority));
      assert.deepEqual([...first.machine.bytes(800, 16)], Array(16).fill(0xa5));
      rectangleContinuation(first);

      const direct = await rectangleCaller(scene),
        directPriority = -2000.5;
      direct.machine.store(128, aNative);
      direct.machine.store(132, floatBits(directPriority));
      direct.machine.bytes(800, 16).fill(0xa5);
      await scene.runtime.scheduler.execute(direct.task);
      assert.deepEqual(motionVector(a.graph.kx2, MOTION_ABI.base), [30.5, -40.25, directPriority]);
      assert.deepEqual(
        motionVector(b.graph.kx2, MOTION_ABI.base),
        expected,
        'A handled plane request does not broadcast to its sibling',
      );
      assert.equal(scene.graphics.stage.planes[a.stageKey].priority, directPriority);
      assert.equal(scene.graphics.stage.planes[b.stageKey].priority, priority);
      assert.deepEqual(
        deliveries.slice(6).map(({ receiver, message, flags }) => [receiver, message, flags]),
        [
          [aNative, 61, 1],
          [aNative, 49, 1],
        ],
      );
      assert.strictEqual(deliveries[6].payload, deliveries[7].payload);
      assert.deepEqual(
        outer,
        [first, direct].flatMap((caller, i) =>
          [61, 49].map((message) => ({
            target: i ? aNative : branchNative,
            sender: caller.task.id,
            message,
            w: 0,
            l: 0,
            flags: 1,
            afterNullMarker: 73,
          })),
        ),
      );
      assert.deepEqual(
        calls.map((call) => call.args),
        [
          [0, floatBits(-1234.5)],
          [branchNative, floatBits(priority)],
          [0, floatBits(-1234.5)],
          [aNative, floatBits(directPriority)],
        ],
      );
      assert.deepEqual(
        await Promise.all(calls.map((call) => call.reply)),
        Array.from({ length: 4 }, () => ({ control: 2 })),
      );
      assert.deepEqual([...direct.machine.bytes(800, 16)], Array(16).fill(0xa5));
      assert.equal(direct.machine.load(128), aNative);
      assert.equal(direct.machine.load(132), floatBits(directPriority));
      rectangleContinuation(direct);
      assert.deepEqual(observerErrors, []);
      assert.equal(
        scene.graphics.renderSequence,
        order,
        'Priority does not create or replace a graph',
      );
      for (const [plane, saved] of [
        [a, geometry[0]],
        [b, geometry[1]],
      ]) {
        assert.strictEqual(plane.graph, saved.graph);
        assert.deepEqual(plane.state.rect, saved.rect);
        assert.deepEqual(plane.graph.colors, saved.colors);
      }
      const entry = nativeABI(profile).tables.main.entries[88];
      assert.equal(entry.status, 'recovered');
      assert.equal(entry.signature.argumentWords, 2);
      assert.deepEqual(entry.controlCodes, [2]);
      assert.equal(entry.signature.parameters[1].type.kind, 'float');
      assert.equal(entry.signature.result.kind, 'void');
      assert.equal(entry.signature.resultWritten, false);
      for (const id of [104, 455, 467])
        assert.equal(nativeABI(rectangleProfiles[0]).tables.main.entries[id].status, 'unknown');
      assert.equal(nativeABI(rectangleProfiles[1]).tables.main.entries[467].status, 'unknown');
    } finally {
      await scene.close();
    }
  });
