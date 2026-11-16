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
import { NativeInput } from '../src/native/input.mjs';
import { serializeCheckpoint, deserializeCheckpoint } from '../src/checkpoint.mjs';

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
  const { world: scene, machine } = world();
  scene.input = new NativeInput();
  await scene.objects.create({ kind: 2 });
  const h = await scene.objects.create({ kind: 6 }),
    task = { id: 42 };
  await nativeGraphics(0x68, [h, 10, 20, 40, 50, 10, 8], machine, task, scene);
  const region = scene.input.get(h),
    plane = scene.graphics.get(h);
  await nativeGraphics(0x69, [h, 0], machine, task, scene);
  assert.equal(region.enabled, 0);
  assert.equal(region.active, 0);
  await nativeGraphics(0x69, [h, 1], machine, task, scene);
  await nativeGraphics(0x6a, [h, 1], machine, task, scene);
  assert.equal(region.active, 1);
  scene.input.source = 16;
  assert.equal((await nativeGraphics(0x6d, [h], machine, task, scene)).value, 2);
  await nativeGraphics(0x350, [h, 0], machine, task, scene);
  await nativeGraphics(0x351, [h, 0], machine, task, scene);
  assert.equal(region.hoverEnabled, 0);
  assert.equal(region.dragEnabled, 0);
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
  for (const id of [109, 455, 467])
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
      for (const id of [109, 455, 467])
        assert.equal(nativeABI(rectangleProfiles[0]).tables.main.entries[id].status, 'unknown');
      assert.equal(nativeABI(rectangleProfiles[1]).tables.main.entries[467].status, 'unknown');
    } finally {
      await scene.close();
    }
  });

const visibilityProgram = kcsProgram([
  [37, rectangleSentinel],
  [37, 0],
  [37, 0],
  [43, 92, 8],
  [37, 73],
  [38, [0x13, 512]],
  [37, [0x13, 128]],
  [37, [0x13, 132]],
  [43, 92, 8],
  [37, 89],
  [38, [0x13, 516]],
  [59],
]);

for (const profile of rectangleProfiles)
  test(`${profile} main92 GCALL broadcasts visibility through real Base children without a VM result`, async () => {
    const scene = await dataWorld(profile, {
      'case.kcs': kcsProgram([[59]]),
      'rectangle.kcs': visibilityProgram,
    });
    try {
      const branch = await scene.objects.create({
          kind: 0,
          parent: scene.root,
          nativeID: 0x005c005c,
          name: 'visibility branch',
        }),
        aID = await scene.objects.create({
          kind: 2,
          parent: branch,
          nativeID: 0x005c0101,
          name: 'visibility plane A',
        }),
        bID = await scene.objects.create({
          kind: 2,
          parent: branch,
          nativeID: 0x005c0102,
          name: 'visibility plane B',
        }),
        a = scene.objects.objects.get(aID).implementation,
        b = scene.objects.objects.get(bID).implementation,
        branchNative = scene.nativeTaskID(branch),
        aNative = scene.nativeTaskID(aID),
        bNative = scene.nativeTaskID(bID),
        saved = [];
      assert.notEqual(branchNative, branch);
      assert.notEqual(aNative, aID);
      assert.notEqual(bNative, bID);
      for (const [id, plane, color] of [
        [aNative, a, 0x80112233],
        [bNative, b, 0x40445566],
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
        // Loading preserves the native paused/unregistered initial state.
        // Establish display through the actual public receiver before GCALL92.
        await scene.sendNativeEngine(id, scene.main.id, 47, 0, 1);
        assert.equal(plane.graph.registrationEnabled, true);
        assert.equal(plane.state.renderPaused, false);
        assert.equal(plane.state.shown, true);
        saved.push({
          graph: plane.graph,
          rect: [...plane.state.rect],
          colors: [...plane.graph.colors],
          base: motionVector(plane.graph.kx2, MOTION_ABI.base),
        });
      }
      const order = scene.graphics.renderSequence,
        deliveries = [],
        outer = [],
        calls = [],
        native = scene.runtime.native,
        send = scene.sendNativeEngine;
      for (const id of [branch, aID, bID]) {
        const record = scene.objects.objects.get(id),
          implementation = record.implementation,
          original = implementation.message;
        implementation.message = function (words, context, ...rest) {
          if (words[1] === 47)
            deliveries.push([record.nativeID, words[1], words[2], words[3], context.flags]);
          return original.call(this, words, context, ...rest);
        };
      }
      scene.runtime.native = function (table, id, ...args) {
        const reply = native.call(this, table, id, ...args);
        if (table === 'main' && id === 92) calls.push({ args: [...args[0]], reply });
        return reply;
      };
      scene.sendNativeEngine = function (target, sender, message, w, l, context) {
        if (message === 47)
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
      const hide = await rectangleCaller(scene);
      hide.machine.store(128, branchNative);
      hide.machine.store(132, 0);
      hide.machine.bytes(800, 16).fill(0xa5);
      await scene.runtime.scheduler.execute(hide.task);
      assert.equal(hide.machine.load(512), 73, 'The zero target continued without dispatch');
      assert.equal(hide.machine.load(516), 89, 'The visibility GCALL continued');
      // Own flags1 on an unhandled Base reaches both actual loaded Plane children.
      assert.equal(a.state.shown, false, 'The earlier child is hidden by the real Base GCALL');
      assert.equal(b.state.shown, false);
      for (const plane of [a, b]) {
        assert.equal(plane.state.renderPaused, true);
        assert.equal(plane.graph.registrationEnabled, false);
      }
      rectangleContinuation(hide);
      const show = await rectangleCaller(scene),
        shownWord = 0x80000000;
      show.machine.store(128, branchNative);
      show.machine.store(132, shownWord);
      show.machine.bytes(800, 16).fill(0xa5);
      await scene.runtime.scheduler.execute(show.task);
      for (const plane of [a, b]) {
        assert.equal(plane.state.shown, true, 'A nonzero word restores visibility');
        assert.equal(plane.state.renderPaused, false);
        assert.equal(plane.graph.registrationEnabled, true);
      }
      rectangleContinuation(show);
      const direct = await rectangleCaller(scene);
      direct.machine.store(128, aNative);
      direct.machine.store(132, 0);
      direct.machine.bytes(800, 16).fill(0xa5);
      await scene.runtime.scheduler.execute(direct.task);
      assert.equal(a.state.shown, false);
      assert.equal(a.state.renderPaused, true);
      assert.equal(a.graph.registrationEnabled, false);
      assert.equal(b.state.shown, true, 'A handled Plane request does not reach its sibling');
      assert.equal(b.state.renderPaused, false);
      assert.equal(b.graph.registrationEnabled, true);
      rectangleContinuation(direct);
      assert.deepEqual(deliveries, [
        ...[branchNative, aNative, bNative].map((receiver) => [receiver, 47, 0, 0, 1]),
        ...[branchNative, aNative, bNative].map((receiver) => [receiver, 47, 0, shownWord, 1]),
        [aNative, 47, 0, 0, 1],
      ]);
      assert.deepEqual(
        outer,
        [hide, show, direct].map((caller, i) => ({
          target: i === 2 ? aNative : branchNative,
          sender: caller.task.id,
          message: 47,
          w: 0,
          l: i === 1 ? shownWord : 0,
          flags: 1,
          afterNullMarker: 73,
        })),
      );
      assert.deepEqual(
        calls.map((call) => call.args),
        [
          [0, 0],
          [branchNative, 0],
          [0, 0],
          [branchNative, shownWord],
          [0, 0],
          [aNative, 0],
        ],
      );
      assert.deepEqual(
        await Promise.all(calls.map((call) => call.reply)),
        Array.from({ length: 6 }, () => ({ control: 2 })),
      );
      for (const [caller, target, visible] of [
        [hide, branchNative, 0],
        [show, branchNative, shownWord],
        [direct, aNative, 0],
      ]) {
        assert.equal(caller.machine.load(128), target);
        assert.equal(caller.machine.load(132), visible);
        assert.deepEqual([...caller.machine.bytes(800, 16)], Array(16).fill(0xa5));
      }
      assert.equal(scene.graphics.renderSequence, order, 'Visibility does not allocate a graph');
      for (const [plane, before] of [
        [a, saved[0]],
        [b, saved[1]],
      ]) {
        assert.strictEqual(plane.graph, before.graph);
        assert.deepEqual(plane.state.rect, before.rect);
        assert.deepEqual(plane.graph.colors, before.colors);
        assert.deepEqual(motionVector(plane.graph.kx2, MOTION_ABI.base), before.base);
      }
      const entry = nativeABI(profile).tables.main.entries[92];
      assert.equal(entry.status, 'recovered');
      assert.equal(entry.name, 'plane.setVisible');
      assert.equal(entry.signature.argumentWords, 2);
      assert.deepEqual(entry.controlCodes, [2]);
      assert.equal(entry.signature.parameters[1].type.bits, 32);
      assert.equal(entry.signature.result.kind, 'void');
      assert.equal(entry.signature.resultWritten, false);
      for (const id of [109, 455, 467])
        assert.equal(nativeABI(rectangleProfiles[0]).tables.main.entries[id].status, 'unknown');
      assert.equal(nativeABI(rectangleProfiles[1]).tables.main.entries[467].status, 'unknown');
    } finally {
      await scene.close();
    }
  });

const inputBindingProgram = kcsProgram([
  [37, rectangleSentinel],
  ...[0, 1, 2, 3, 4, 5, 6].map((word) => [37, word]),
  [43, 104, 28],
  [37, 73],
  [38, [0x13, 512]],
  ...Array.from({ length: 7 }, (_, i) => [37, [0x13, 128 + i * 4]]),
  [43, 104, 28],
  [37, 89],
  [38, [0x13, 516]],
  [59],
]);

for (const profile of rectangleProfiles)
  test(`${profile} main104 GCALL binds actual Base and SimplePlane input regions without a VM result`, async () => {
    const scene = await dataWorld(profile, {
      'case.kcs': kcsProgram([[59]]),
      'rectangle.kcs': inputBindingProgram,
    });
    let input, ownedIDs;
    try {
      const root = scene.objects.objects.get(scene.root),
        simpleID = await scene.objects.create({
          kind: 2,
          parent: scene.root,
          nativeID: 0x00680104,
          name: 'input simple plane',
        }),
        baseID = await scene.objects.create({
          kind: 6,
          parent: scene.root,
          nativeID: 0x00680204,
          name: 'input base plane',
        }),
        fullID = await scene.objects.create({
          kind: 6,
          parent: scene.root,
          nativeID: 0x00680304,
          name: 'input fullscreen base',
        }),
        emptyID = await scene.objects.create({
          kind: 2,
          parent: scene.root,
          nativeID: 0x00680404,
          name: 'unloaded input simple plane',
        }),
        simple = scene.objects.objects.get(simpleID).implementation,
        base = scene.objects.objects.get(baseID).implementation,
        full = scene.objects.objects.get(fullID).implementation,
        empty = scene.objects.objects.get(emptyID).implementation,
        simpleNative = scene.nativeTaskID(simpleID),
        baseNative = scene.nativeTaskID(baseID),
        fullNative = scene.nativeTaskID(fullID),
        emptyNative = scene.nativeTaskID(emptyID);
      ownedIDs = [simpleID, baseID, fullID, emptyID];
      input = scene.inputFor(simpleID);
      assert.strictEqual(scene.inputFor(baseID), input);
      assert.strictEqual(scene.inputFor(fullID), input);
      assert.equal(root.nativeID, 0, 'The ordinary fixture uses its real Top0 namespace');
      assert.equal(scene.game.width, 640);
      assert.equal(scene.game.height, 480);
      await scene.sendNativeEngine(simpleNative, scene.main.id, 42, 0, 0, {
        payload: new NativeGraphicsPacket([
          0,
          0,
          0,
          floatBits(20.5),
          floatBits(12.25),
          0,
          0,
          0x80445566,
        ]),
      });
      await scene.sendNativeEngine(simpleNative, scene.main.id, 49, 0, 0, {
        payload: new NativeGraphicsPacket([10.75, -3.25, 123.75].map(floatBits)),
      });
      await scene.sendNativeEngine(simpleNative, scene.main.id, 51, 0, 0, {
        payload: new NativeGraphicsPacket([17.5, 8.125, 0].map(floatBits)),
      });
      assert.deepEqual(motionVector(simple.graph.kx2, MOTION_ABI.base), [10.75, -3.25, 123.75]);
      assert.deepEqual(motionVector(simple.graph.kx2, MOTION_ABI.pos), [17.5, 8.125, 0]);
      const graph = simple.graph,
        order = scene.graphics.renderSequence,
        frame = scene.frame,
        outer = [],
        deliveries = [],
        calls = [],
        callers = [],
        native = scene.runtime.native,
        send = scene.sendNativeEngine;
      for (const id of [scene.root, simpleID, baseID, fullID, emptyID]) {
        const record = scene.objects.objects.get(id),
          original = record.implementation.message;
        record.implementation.message = function (words, context, ...rest) {
          if (words[1] === 89)
            deliveries.push({
              owner: id,
              senderNative: words[0],
              senderWorld: context.nativeSenderWorldID,
              flags: context.flags,
            });
          return original.call(this, words, context, ...rest);
        };
      }
      scene.runtime.native = function (table, id, ...args) {
        const reply = native.call(this, table, id, ...args);
        if (table === 'main' && id === 104) calls.push({ args: [...args[0]], reply });
        return reply;
      };
      scene.sendNativeEngine = function (target, sender, message, w, l, context) {
        if (message === 89)
          outer.push({
            target,
            sender,
            w,
            l,
            flags: context.flags,
            words: [0, 4, 8, 12, 16, 20].map((at) => context.payload.load(at)),
          });
        return send.call(this, target, sender, message, w, l, context);
      };
      async function invoke(words) {
        const caller = await rectangleCaller(scene);
        assert.strictEqual(scene.engineMessages.closestTop(caller.task.id), root);
        assert.equal(scene.resolveTaskID(0, caller.task.id), scene.root);
        words.forEach((word, i) => caller.machine.store(128 + i * 4, word));
        caller.machine.bytes(800, 16).fill(0xa5);
        await scene.runtime.scheduler.execute(caller.task);
        assert.equal(
          caller.machine.load(512),
          73,
          'The real zero-ID call completed before binding',
        );
        rectangleContinuation(caller);
        assert.deepEqual(
          Array.from({ length: 7 }, (_, i) => caller.machine.load(128 + i * 4)),
          words.map((word) => word >>> 0),
        );
        assert.deepEqual([...caller.machine.bytes(800, 16)], Array(16).fill(0xa5));
        callers.push(caller);
        return caller;
      }
      const simpleWords = [simpleNative, 1000, 2000, 3, 4, 700, 17],
        simpleCaller = await invoke(simpleWords),
        simpleRegion = input.get(simpleID);
      // Independent own-SSE oracle: position-base=(6.75,11.375), size=(20.5,12.25).
      // These values deliberately disagree with the wrapper's explicit rectangle.
      assert.deepEqual(
        simpleRegion.bounds,
        [6, 11, 27, 23],
        'SimplePlane uses actual graph input geometry',
      );
      assert.equal(
        simpleRegion.priority,
        123,
        'SimplePlane priority is trunc(base.z), not explicit700',
      );
      assert.deepEqual(simple.state.bindArea, [6, 11, 27, 23]);
      assert.equal(simple.state.inputTracksGraph, true);
      assert.equal(
        simple.state.bindFlags,
        0,
        'Retain the owned packet logical address, not explicit arg6',
      );
      assert.equal(simple.state.receiver, simpleCaller.record.nativeID);
      assert.equal(simpleRegion.receiver, simpleCaller.record.nativeID);
      assert.equal(simpleRegion.owner, simpleID);
      assert.equal(simpleRegion.mask, 7);
      assert.equal(simpleRegion.extra, 0);
      const baseWords = [baseNative, -12, 9, 40, 35, 700, 0x80000001],
        baseCaller = await invoke(baseWords),
        baseRegion = input.get(baseID);
      assert.deepEqual(baseRegion.bounds, [-12, 9, 28, 44]);
      assert.deepEqual(base.state.bindArea, [-12, 9, 28, 44]);
      assert.equal(baseRegion.priority, 700);
      assert.equal(baseRegion.flags, 0x80000001);
      assert.equal(base.state.bindFlags, 0x80000001);
      assert.equal(base.state.receiver, baseCaller.record.nativeID);
      assert.equal(baseRegion.receiver, baseCaller.record.nativeID);
      assert.equal(base.state.inputTracksGraph, false);
      const savedBase = structuredClone(baseRegion),
        duplicateWords = [baseNative, 1, 2, 3, 4, 10, 0];
      await invoke(duplicateWords);
      assert.strictEqual(input.get(baseID), baseRegion);
      assert.deepEqual(
        baseRegion,
        savedBase,
        'An already-bound Base does not replace its registration',
      );
      assert.equal(base.state.receiver, baseCaller.record.nativeID);
      assert.equal(base.state.bindFlags, 0x80000001);
      const fullWords = [fullNative, 0, 0, 640, 480, 5, 3],
        fullCaller = await invoke(fullWords),
        fullRegion = input.get(fullID),
        fullBounds = [-100000, -100000, 100000, 100000];
      assert.deepEqual(fullRegion.bounds, fullBounds);
      assert.deepEqual(
        full.state.bindArea,
        fullBounds,
        'The own literal is retained as well as registered',
      );
      assert.equal(fullRegion.priority, 5);
      assert.equal(full.state.bindFlags, 3);
      assert.equal(full.state.receiver, fullCaller.record.nativeID);
      assert.deepEqual(
        outer.map(({ target, w, l, flags }) => [target, w, l, flags]),
        callers.flatMap((_caller, i) => [
          [0, 0, 0, 0],
          [[simpleNative, baseNative, baseNative, fullNative][i], 0, 0, 0],
        ]),
      );
      assert.deepEqual(
        outer.map((x) => x.words),
        [
          [1, 2, 4, 6, 5, 6],
          [1000, 2000, 1003, 2004, 700, 17],
          [1, 2, 4, 6, 5, 6],
          [0xfffffff4, 9, 28, 44, 700, 0x80000001],
          [1, 2, 4, 6, 5, 6],
          [1, 2, 4, 6, 10, 0],
          [1, 2, 4, 6, 5, 6],
          [0, 0, 640, 480, 5, 3],
        ],
      );
      assert.deepEqual(
        deliveries.map(({ owner, senderNative, senderWorld, flags }) => [
          owner,
          senderNative,
          senderWorld,
          flags,
        ]),
        callers.flatMap((caller, i) =>
          [scene.root, [simpleID, baseID, baseID, fullID][i]].map((owner) => [
            owner,
            caller.record.nativeID,
            caller.task.id,
            0,
          ]),
        ),
      );
      assert.deepEqual(
        calls.map((call) => call.args),
        [simpleWords, baseWords, duplicateWords, fullWords].flatMap((words) => [
          [0, 1, 2, 3, 4, 5, 6],
          words.map((word) => word >>> 0),
        ]),
      );
      assert.deepEqual(
        await Promise.all(calls.map((call) => call.reply)),
        Array.from({ length: 8 }, () => ({ control: 2 })),
      );
      const unbound = await rectangleCaller(scene),
        emptyWords = [emptyNative, 1, 2, 3, 4, 1, 0],
        regionCount = input.regions.length;
      emptyWords.forEach((word, i) => unbound.machine.store(128 + i * 4, word));
      unbound.machine.bytes(800, 16).fill(0xa5);
      await assert.rejects(
        () => scene.runtime.scheduler.execute(unbound.task),
        /Native plane input geometry is unreviewed/,
      );
      assert.equal(
        input.get(emptyID),
        null,
        'Do not invent a zero rectangle for an unloaded SimplePlane',
      );
      assert.equal(input.regions.length, regionCount);
      assert.equal(empty.state.receiver, -1);
      assert.equal(empty.state.inputTracksGraph, false);
      assert.equal(unbound.machine.load(512), 73);
      assert.equal(unbound.machine.load(516), 0);
      assert.deepEqual([...unbound.machine.bytes(800, 16)], Array(16).fill(0xa5));
      assert.strictEqual(simple.graph, graph);
      assert.equal(scene.graphics.renderSequence, order);
      assert.equal(
        scene.frame,
        frame,
        'Only actual public Script execution was used; no World warmup',
      );
      const entry = nativeABI(profile).tables.main.entries[104];
      assert.equal(entry.status, 'recovered');
      assert.equal(entry.name, 'plane.bindInputRegion');
      assert.equal(entry.signature.argumentWords, 7);
      assert.deepEqual(entry.controlCodes, [2]);
      assert.equal(entry.signature.parameters[5].name, 'priority');
      assert.equal(entry.signature.parameters[6].name, 'bindingWord');
      assert.equal(entry.signature.result.kind, 'void');
      assert.equal(entry.signature.resultWritten, false);
      for (const id of [109, 455, 467])
        assert.equal(nativeABI(rectangleProfiles[0]).tables.main.entries[id].status, 'unknown');
      assert.equal(nativeABI(rectangleProfiles[1]).tables.main.entries[467].status, 'unknown');
    } finally {
      await scene.close();
    }
    for (const id of ownedIDs)
      assert.equal(input.get(id), null, 'Closing releases each actual input owner');
  });

function inputEnableProgram(id, count) {
  return kcsProgram([
    [37, rectangleSentinel],
    ...Array.from({ length: count }, (_, i) => [37, [0x13, 128 + i * 4]]),
    [43, id, count * 4],
    [37, 89],
    [38, [0x13, 516]],
    [59],
  ]);
}

async function inputEnableInvoke(scene, file, words) {
  const id = await scene.objects.create({ kind: 12, parent: scene.main.id, name: file }),
    record = scene.objects.objects.get(id);
  await record.implementation.loadScript(file);
  const task = record.implementation.task,
    caller = { record, task, machine: task.machine, initialSP: task.machine.sp };
  assert.strictEqual(scene.runtime.scheduler.tasks.get(id), task);
  words.forEach((word, i) => caller.machine.store(128 + i * 4, word));
  caller.machine.bytes(800, 16).fill(0xa5);
  await scene.runtime.scheduler.execute(task);
  rectangleContinuation(caller);
  assert.deepEqual(
    words.map((_, i) => caller.machine.load(128 + i * 4)),
    words.map((word) => word >>> 0),
  );
  assert.deepEqual([...caller.machine.bytes(800, 16)], Array(16).fill(0xa5));
  return caller;
}

for (const profile of rectangleProfiles)
  test(`${profile} main105 GCALL retains raw input enable words and clears only its owned active regions`, async () => {
    const files = {
        'case.kcs': kcsProgram([[59]]),
        'bind-input.kcs': inputEnableProgram(104, 7),
        'enable-input.kcs': inputEnableProgram(105, 2),
      },
      scene = await dataWorld(profile, files);
    let fresh, input, freshInput, baseID, simpleID;
    try {
      baseID = await scene.objects.create({
        kind: 6,
        parent: scene.root,
        nativeID: 0x00690105,
        name: 'enabled Base',
      });
      simpleID = await scene.objects.create({
        kind: 2,
        parent: scene.root,
        nativeID: 0x00690205,
        name: 'enabled SimplePlane',
      });
      const unboundID = await scene.objects.create({
          kind: 6,
          parent: scene.root,
          nativeID: 0x00690305,
          name: 'unbound Base',
        }),
        base = scene.objects.objects.get(baseID).implementation,
        simple = scene.objects.objects.get(simpleID).implementation,
        baseNative = scene.nativeTaskID(baseID),
        simpleNative = scene.nativeTaskID(simpleID),
        high = 0x80000005;
      assert.notEqual(baseNative, baseID);
      assert.notEqual(simpleNative, simpleID);
      assert.equal(scene.objects.objects.get(scene.root).nativeID, 0);
      await scene.sendNativeEngine(simpleNative, scene.main.id, 42, 0, 0, {
        payload: new NativeGraphicsPacket([
          0,
          0,
          0,
          floatBits(20.5),
          floatBits(12.25),
          0,
          0,
          0x80445566,
        ]),
      });
      await inputEnableInvoke(scene, 'bind-input.kcs', [baseNative, 3, 4, 30, 20, 700, 0]);
      await inputEnableInvoke(scene, 'bind-input.kcs', [simpleNative, 1, 2, 3, 4, 500, 0]);
      input = scene.inputFor(baseID);
      assert.strictEqual(input, scene.inputFor(simpleID));
      const baseRegion = input.get(baseID),
        simpleRegion = input.get(simpleID),
        graph = simple.graph,
        geometry = structuredClone({ rect: simple.state.rect, colors: graph.colors }),
        frame = scene.frame,
        order = scene.graphics.renderSequence,
        outer = [],
        received = [],
        inner = [],
        calls = [],
        send = scene.sendNativeEngine,
        native = scene.runtime.native,
        message = input.message;
      assert.equal(baseRegion.enabled, 1);
      assert.equal(simpleRegion.enabled, 1);
      assert.equal(input.changed, false);
      scene.sendNativeEngine = function (target, sender, number, w, l, context) {
        if (number === 92) outer.push([target, sender, number, w, l, context.flags]);
        return send.call(this, target, sender, number, w, l, context);
      };
      scene.runtime.native = function (table, id, ...args) {
        const reply = native.call(this, table, id, ...args);
        if (table === 'main' && id === 105) calls.push({ args: [...args[0]], reply });
        return reply;
      };
      Object.defineProperty(input, 'message', {
        configurable: true,
        value: function (number, w, l, context) {
          if ([132, 134].includes(number)) inner.push([number, w, l, context?.flags]);
          return message.call(this, number, w, l, context);
        },
      });
      for (const id of [scene.root, baseID, simpleID, unboundID]) {
        const record = scene.objects.objects.get(id),
          original = record.implementation.message;
        record.implementation.message = function (words, context, ...rest) {
          if (words[1] === 92)
            received.push([id, ...words, context.nativeSenderWorldID, context.flags]);
          return original.call(this, words, context, ...rest);
        };
      }
      const first = await inputEnableInvoke(scene, 'enable-input.kcs', [baseNative, high]);
      assert.equal(baseRegion.enabled, high, 'Main105 stores the whole raw enabled DWORD');
      assert.equal(baseRegion.active, 0);
      assert.equal(input.changed, true);
      assert.deepEqual(inner, [[134, baseID, high, 0]]);
      const inputRecord = scene.objects.objects.get(
        scene.engineMessages.closestTop(first.task.id).implementation.input,
      );
      async function active(owner, word) {
        await scene.sendNativeEngine(
          scene.nativeTaskID(inputRecord.id),
          first.task.id,
          132,
          scene.nativeTaskID(owner),
          word,
          { flags: 0 },
        );
      }
      const duplicate = input.register({
        owner: baseID,
        receiver: baseRegion.receiver,
        bounds: [3, 4, 33, 24],
        priority: -1,
      });
      await active(baseID, 0x12345678);
      assert.equal(baseRegion.active, 0x12345678);
      assert.equal(duplicate.active, 0x12345678);
      let at = inner.length;
      await inputEnableInvoke(scene, 'enable-input.kcs', [baseNative, 1]);
      assert.equal(baseRegion.enabled, 1);
      assert.equal(duplicate.enabled, 1, 'Only the first matching enabled field is written');
      assert.equal(baseRegion.active, 0x12345678, 'A nonzero enabled word does not change active');
      assert.deepEqual(inner.slice(at), [[134, baseID, 1, 0]]);
      at = inner.length;
      await inputEnableInvoke(scene, 'enable-input.kcs', [baseNative, 0]);
      assert.equal(baseRegion.enabled, 0);
      assert.equal(duplicate.enabled, 1);
      assert.equal(baseRegion.active, 0);
      assert.equal(duplicate.active, 0, 'Zero clears every matching active record');
      assert.deepEqual(inner.slice(at), [
        [134, baseID, 0, 0],
        [132, baseID, 0, 0],
      ]);
      await active(simpleID, 37);
      await inputEnableInvoke(scene, 'enable-input.kcs', [baseNative, 0]);
      assert.equal(simpleRegion.active, 37, 'Disabling another owner preserves this active word');
      at = inner.length;
      await inputEnableInvoke(scene, 'enable-input.kcs', [simpleNative, high]);
      assert.equal(
        simpleRegion.enabled,
        high,
        'SimplePlane delegates to the same raw Input setter',
      );
      assert.equal(simpleRegion.active, 37);
      assert.deepEqual(inner.slice(at), [[134, simpleID, high, 0]]);
      const zero = await inputEnableInvoke(scene, 'enable-input.kcs', [0, 0]);
      assert.deepEqual(outer.at(-1), [0, zero.task.id, 92, 0, 0, 0]);
      assert.deepEqual(received.at(-1), [
        scene.root,
        zero.record.nativeID,
        92,
        0,
        0,
        zero.task.id,
        0,
      ]);
      for (let i = 0; i < calls.length; i++) {
        const [target, enabled] = calls[i].args;
        assert.deepEqual(outer[i], [target, outer[i][1], 92, 0, enabled, 0]);
      }
      assert.deepEqual(
        await Promise.all(calls.map((call) => call.reply)),
        Array.from({ length: calls.length }, () => ({ control: 2 })),
      );
      assert.strictEqual(simple.graph, graph);
      assert.deepEqual({ rect: simple.state.rect, colors: graph.colors }, geometry);
      assert.equal(scene.graphics.renderSequence, order);
      assert.equal(scene.frame, frame);
      const checkpoint = structuredClone(scene.snapshot());
      fresh = await dataWorld(profile, files, { initialize: false });
      let restoring = true,
        replay = 0;
      const execute = fresh.runtime.scheduler.execute,
        freshNative = fresh.runtime.native;
      fresh.runtime.scheduler.execute = function (...args) {
        if (restoring) replay++;
        return execute.apply(this, args);
      };
      fresh.runtime.native = function (...args) {
        if (restoring) replay++;
        return freshNative.apply(this, args);
      };
      await fresh.restore(structuredClone(checkpoint));
      restoring = false;
      assert.equal(replay, 0, 'Restore executes no native or guest input replay');
      assert.deepEqual(fresh.snapshot(), checkpoint, 'True fresh restore needs zero warm frames');
      freshInput = fresh.inputFor(simpleID);
      assert.notStrictEqual(freshInput, input);
      assert.notStrictEqual(freshInput.get(simpleID), simpleRegion);
      await inputEnableInvoke(fresh, 'enable-input.kcs', [simpleNative, 0]);
      assert.equal(freshInput.get(simpleID).enabled, 0);
      assert.equal(freshInput.get(simpleID).active, 0);
      assert.deepEqual(
        scene.snapshot(),
        checkpoint,
        'Fresh input leaves the source owner unchanged',
      );
      while (input.get(baseID)) input.unregister(baseID);
      at = inner.length;
      await inputEnableInvoke(scene, 'enable-input.kcs', [baseNative, high]);
      assert.equal(input.get(baseID), null);
      assert.deepEqual(
        inner.slice(at),
        [[134, baseID, high, 0]],
        'A stale bound owner still reaches Input',
      );
      assert.equal(input.changed, true);
      at = inner.length;
      await inputEnableInvoke(scene, 'enable-input.kcs', [scene.nativeTaskID(unboundID), high]);
      assert.deepEqual(inner.slice(at), [], 'An unbound receiver skips Input');
      assert.equal(scene.objects.objects.get(unboundID).implementation.state.receiver, -1);
      assert.ok(!scene.nativeEngine && !scene.nativeEngineLoading);
      assert.ok(!fresh.nativeEngine && !fresh.nativeEngineLoading);
      const entry = nativeABI(profile).tables.main.entries[105];
      assert.equal(entry.status, 'recovered');
      assert.equal(entry.name, 'plane.setInputEnabled');
      assert.equal(entry.signature.argumentWords, 2);
      assert.equal(entry.signature.parameters[1].name, 'enabled');
      assert.equal(entry.signature.parameters[1].type.bits, 32);
      assert.deepEqual(entry.controlCodes, [2]);
      assert.equal(entry.signature.result.kind, 'void');
      assert.equal(entry.signature.resultWritten, false);
      assert.equal(nativeABI(profile).tables.main.entries[97].status, 'unknown');
      assert.equal(nativeABI(rectangleProfiles[0]).tables.main.entries[109].status, 'unknown');
      assert.equal(nativeABI(profile).tables.main.entries[467].status, 'unknown');
      assert.equal(base.state.receiver !== -1, true);
    } finally {
      await fresh?.close();
      await scene.close();
      if (simpleID !== undefined) {
        assert.equal(input?.get(simpleID), null);
        assert.equal(freshInput?.get(simpleID) ?? null, null);
      }
    }
  });

for (const profile of rectangleProfiles)
  test(`${profile} main106 GCALL preserves raw active words for all matching input owners`, async () => {
    const files = {
        'case.kcs': kcsProgram([[59]]),
        'bind-input.kcs': inputEnableProgram(104, 7),
        'active-input.kcs': inputEnableProgram(106, 2),
      },
      scene = await dataWorld(profile, files);
    let fresh, input, freshInput, simpleID;
    try {
      const baseID = await scene.objects.create({
          kind: 6,
          parent: scene.root,
          nativeID: 0x006a0106,
          name: 'active Base',
        }),
        unboundID = await scene.objects.create({
          kind: 6,
          parent: scene.root,
          nativeID: 0x006a0306,
          name: 'unbound active Base',
        });
      simpleID = await scene.objects.create({
        kind: 2,
        parent: scene.root,
        nativeID: 0x006a0206,
        name: 'active SimplePlane',
      });
      const baseNative = scene.nativeTaskID(baseID),
        simpleNative = scene.nativeTaskID(simpleID),
        simple = scene.objects.objects.get(simpleID).implementation,
        high = 0x80000006;
      assert.notEqual(baseNative, baseID);
      assert.notEqual(simpleNative, simpleID);
      assert.equal(scene.objects.objects.get(scene.root).nativeID, 0);
      await scene.sendNativeEngine(simpleNative, scene.main.id, 42, 0, 0, {
        payload: new NativeGraphicsPacket([
          0,
          0,
          0,
          floatBits(20.5),
          floatBits(12.25),
          0,
          0,
          0x80667788,
        ]),
      });
      await inputEnableInvoke(scene, 'bind-input.kcs', [baseNative, 3, 4, 30, 20, 700, 0]);
      await inputEnableInvoke(scene, 'bind-input.kcs', [simpleNative, 1, 2, 3, 4, 500, 0]);
      input = scene.inputFor(baseID);
      assert.strictEqual(input, scene.inputFor(simpleID));
      const baseRegion = input.get(baseID),
        simpleRegion = input.get(simpleID),
        graph = simple.graph,
        geometry = structuredClone({ rect: simple.state.rect, colors: graph.colors }),
        frame = scene.frame,
        order = scene.graphics.renderSequence,
        outer = [],
        received = [],
        inner = [],
        calls = [],
        native = scene.runtime.native,
        send = scene.sendNativeEngine,
        message = input.message;
      assert.equal(baseRegion.active, 0);
      assert.equal(simpleRegion.active, 0);
      assert.equal(input.changed, false);
      scene.runtime.native = function (table, id, ...args) {
        const reply = native.call(this, table, id, ...args);
        if (table === 'main' && id === 106)
          calls.push({ args: [...args[0]], sender: args[2].id, reply });
        return reply;
      };
      scene.sendNativeEngine = function (target, sender, number, w, l, context) {
        if (number === 93) outer.push([target, sender, number, w, l, context.flags]);
        return send.call(this, target, sender, number, w, l, context);
      };
      Object.defineProperty(input, 'message', {
        configurable: true,
        value: function (number, w, l, context) {
          if (number === 132) inner.push([number, w, l, context?.flags]);
          return message.call(this, number, w, l, context);
        },
      });
      for (const id of [scene.root, baseID, simpleID, unboundID]) {
        const record = scene.objects.objects.get(id),
          original = record.implementation.message;
        record.implementation.message = function (words, context, ...rest) {
          if (words[1] === 93)
            received.push([id, ...words, context.nativeSenderWorldID, context.flags]);
          return original.call(this, words, context, ...rest);
        };
      }
      await inputEnableInvoke(scene, 'active-input.kcs', [baseNative, high]);
      assert.equal(baseRegion.active, high, 'Main106 preserves the complete active DWORD');
      assert.equal(simpleRegion.active, 0);
      assert.deepEqual(inner, [[132, baseID, high, 0]]);
      const duplicate = input.register({
        owner: baseID,
        receiver: baseRegion.receiver,
        bounds: [3, 4, 33, 24],
        priority: -1,
      });
      await inputEnableInvoke(scene, 'active-input.kcs', [baseNative, 0x12345678]);
      assert.equal(baseRegion.active, 0x12345678);
      assert.equal(duplicate.active, 0x12345678, 'Every matching owner receives the raw word');
      await inputEnableInvoke(scene, 'active-input.kcs', [simpleNative, 0x87654321]);
      assert.equal(simpleRegion.active, 0x87654321);
      assert.equal(baseRegion.active, 0);
      assert.equal(duplicate.active, 0);
      await inputEnableInvoke(scene, 'active-input.kcs', [baseNative, 0]);
      assert.equal(simpleRegion.active, 0x87654321, 'Zero does not clear another owner');
      assert.equal(baseRegion.active, 0);
      assert.equal(duplicate.active, 0);
      await inputEnableInvoke(scene, 'active-input.kcs', [baseNative, high]);
      assert.equal(baseRegion.active, high);
      assert.equal(duplicate.active, high);
      assert.equal(simpleRegion.active, 0);
      await inputEnableInvoke(scene, 'active-input.kcs', [simpleNative, high]);
      assert.equal(
        simpleRegion.active,
        high,
        'Loaded SimplePlane delegates to the same Input setter',
      );
      assert.equal(baseRegion.active, 0);
      assert.equal(duplicate.active, 0);
      assert.equal(baseRegion.enabled, 1);
      assert.equal(simpleRegion.enabled, 1);
      assert.equal(input.changed, false, 'Setting active does not mark Input changed');
      const checkpoint = structuredClone(scene.snapshot());
      fresh = await dataWorld(profile, files, { initialize: false });
      let restoring = true,
        replay = 0;
      const execute = fresh.runtime.scheduler.execute,
        freshNative = fresh.runtime.native;
      fresh.runtime.scheduler.execute = function (...args) {
        if (restoring) replay++;
        return execute.apply(this, args);
      };
      fresh.runtime.native = function (...args) {
        if (restoring) replay++;
        return freshNative.apply(this, args);
      };
      await fresh.restore(structuredClone(checkpoint));
      restoring = false;
      assert.equal(replay, 0, 'Cold restore replays no native call or guest');
      assert.deepEqual(
        fresh.snapshot(),
        checkpoint,
        'No warm frame is needed after true fresh restore',
      );
      freshInput = fresh.inputFor(baseID);
      assert.notStrictEqual(freshInput, input);
      assert.notStrictEqual(freshInput.get(simpleID), simpleRegion);
      await inputEnableInvoke(fresh, 'active-input.kcs', [baseNative, 0x7fffffff]);
      assert.equal(freshInput.get(baseID).active, 0x7fffffff);
      assert.equal(freshInput.get(simpleID).active, 0);
      assert.deepEqual(
        scene.snapshot(),
        checkpoint,
        'Fresh input does not mutate the source owner',
      );
      while (input.get(baseID)) input.unregister(baseID);
      let at = inner.length;
      await inputEnableInvoke(scene, 'active-input.kcs', [baseNative, high]);
      assert.equal(input.get(baseID), null);
      assert.equal(
        simpleRegion.active,
        0,
        'A bound missing owner still clears nonmatching records',
      );
      assert.deepEqual(inner.slice(at), [[132, baseID, high, 0]]);
      await inputEnableInvoke(scene, 'active-input.kcs', [simpleNative, 27]);
      await inputEnableInvoke(scene, 'active-input.kcs', [baseNative, 0]);
      assert.equal(
        simpleRegion.active,
        27,
        'A missing owner with zero preserves other active words',
      );
      at = inner.length;
      await inputEnableInvoke(scene, 'active-input.kcs', [scene.nativeTaskID(unboundID), high]);
      assert.deepEqual(inner.slice(at), [], 'An unbound receiver never calls Input');
      assert.equal(simpleRegion.active, 27);
      const zero = await inputEnableInvoke(scene, 'active-input.kcs', [0, high]);
      assert.deepEqual(outer.at(-1), [0, zero.task.id, 93, 0, high, 0]);
      assert.deepEqual(received.at(-1), [
        scene.root,
        zero.record.nativeID,
        93,
        0,
        high,
        zero.task.id,
        0,
      ]);
      assert.equal(simpleRegion.active, 27);
      assert.equal(calls.length, outer.length);
      assert.equal(calls.length, received.length);
      for (let i = 0; i < calls.length; i++) {
        const call = calls[i],
          [target, active] = call.args,
          sender = scene.objects.objects.get(call.sender),
          owner = scene.resolveTaskID(target, call.sender);
        assert.deepEqual(outer[i], [target, call.sender, 93, 0, active, 0]);
        assert.deepEqual(received[i], [owner, sender.nativeID, 93, 0, active, call.sender, 0]);
      }
      assert.deepEqual(
        await Promise.all(calls.map((call) => call.reply)),
        Array.from({ length: calls.length }, () => ({ control: 2 })),
      );
      assert.strictEqual(simple.graph, graph);
      assert.deepEqual({ rect: simple.state.rect, colors: graph.colors }, geometry);
      assert.equal(scene.graphics.renderSequence, order);
      assert.equal(scene.frame, frame);
      assert.equal(fresh.frame, frame);
      assert.ok(!scene.nativeEngine && !scene.nativeEngineLoading);
      assert.ok(!fresh.nativeEngine && !fresh.nativeEngineLoading);
      const entry = nativeABI(profile).tables.main.entries[106];
      assert.equal(entry.status, 'recovered');
      assert.equal(entry.name, 'plane.setInputActive');
      assert.equal(entry.signature.argumentWords, 2);
      assert.equal(entry.signature.parameters[1].name, 'active');
      assert.deepEqual(entry.signature.parameters[1].type, { bits: 32, kind: 'bits' });
      assert.deepEqual(entry.controlCodes, [2]);
      assert.equal(entry.signature.result.kind, 'void');
      assert.equal(entry.signature.resultWritten, false);
      assert.equal(nativeABI(rectangleProfiles[0]).tables.main.entries[109].status, 'unknown');
      assert.equal(nativeABI(profile).tables.main.entries[467].status, 'unknown');
    } finally {
      await fresh?.close();
      await scene.close();
      if (simpleID !== undefined) {
        assert.equal(input?.get(simpleID), null);
        assert.equal(freshInput?.get(simpleID) ?? null, null);
      }
    }
  });

for (const profile of rectangleProfiles)
  test(`${profile} main848 GCALL preserves the raw hover word on its first owned input region`, async () => {
    const files = {
        'case.kcs': kcsProgram([[59]]),
        'bind-input.kcs': inputEnableProgram(104, 7),
        'hover-input.kcs': inputEnableProgram(848, 2),
        'active-input.kcs': inputEnableProgram(106, 2),
      },
      scene = await dataWorld(profile, files);
    let fresh, missing, input, freshInput, simpleID;
    try {
      const baseID = await scene.objects.create({
          kind: 6,
          parent: scene.root,
          nativeID: 0x03500848,
          name: 'hover Base',
        }),
        unboundID = await scene.objects.create({
          kind: 6,
          parent: scene.root,
          nativeID: 0x03500348,
          name: 'unbound hover Base',
        });
      simpleID = await scene.objects.create({
        kind: 2,
        parent: scene.root,
        nativeID: 0x03500248,
        name: 'hover SimplePlane',
      });
      const baseNative = scene.nativeTaskID(baseID),
        simpleNative = scene.nativeTaskID(simpleID),
        simple = scene.objects.objects.get(simpleID).implementation,
        high = 0x80000350;
      assert.notEqual(baseNative, baseID);
      assert.notEqual(simpleNative, simpleID);
      assert.equal(scene.objects.objects.get(scene.root).nativeID, 0);
      await scene.sendNativeEngine(simpleNative, scene.main.id, 42, 0, 0, {
        payload: new NativeGraphicsPacket([
          0,
          0,
          0,
          floatBits(20.5),
          floatBits(12.25),
          0,
          0,
          0x80778899,
        ]),
      });
      await inputEnableInvoke(scene, 'bind-input.kcs', [baseNative, 3, 4, 30, 20, 700, 0]);
      await inputEnableInvoke(scene, 'bind-input.kcs', [simpleNative, 1, 2, 3, 4, 500, 0]);
      input = scene.inputFor(baseID);
      assert.strictEqual(input, scene.inputFor(simpleID));
      const baseRegion = input.get(baseID),
        simpleRegion = input.get(simpleID),
        graph = simple.graph,
        geometry = structuredClone({ rect: simple.state.rect, colors: graph.colors }),
        frame = scene.frame,
        order = scene.graphics.renderSequence,
        outer = [],
        received = [],
        inner = [],
        calls = [],
        native = scene.runtime.native,
        send = scene.sendNativeEngine,
        message = input.message;
      assert.equal(baseRegion.hoverEnabled, 1);
      assert.equal(simpleRegion.hoverEnabled, 1);
      assert.equal(input.changed, false);
      scene.runtime.native = function (table, id, ...args) {
        const reply = native.call(this, table, id, ...args);
        if (table === 'main' && id === 848)
          calls.push({ args: [...args[0]], sender: args[2].id, reply });
        return reply;
      };
      scene.sendNativeEngine = function (target, sender, number, w, l, context) {
        if (number === 98) outer.push([target, sender, number, w, l, context.flags]);
        return send.call(this, target, sender, number, w, l, context);
      };
      Object.defineProperty(input, 'message', {
        configurable: true,
        value: function (number, w, l, context) {
          if (number === 135) inner.push([number, w, l, context?.flags]);
          return message.call(this, number, w, l, context);
        },
      });
      for (const id of [scene.root, baseID, simpleID, unboundID]) {
        const record = scene.objects.objects.get(id),
          original = record.implementation.message;
        record.implementation.message = function (words, context, ...rest) {
          if (words[1] === 98)
            received.push([id, ...words, context.nativeSenderWorldID, context.flags]);
          return original.call(this, words, context, ...rest);
        };
      }
      await inputEnableInvoke(scene, 'hover-input.kcs', [baseNative, high]);
      assert.equal(baseRegion.hoverEnabled, high, 'Main848 preserves the complete hover DWORD');
      assert.equal(input.changed, true);
      assert.deepEqual(inner, [[135, baseID, high, 0]]);
      const duplicate = input.register({
        owner: baseID,
        receiver: baseRegion.receiver,
        bounds: [3, 4, 33, 24],
        priority: -1,
      });
      await inputEnableInvoke(scene, 'active-input.kcs', [baseNative, 0x13572468]);
      let at = inner.length;
      await inputEnableInvoke(scene, 'hover-input.kcs', [baseNative, 0]);
      assert.equal(baseRegion.hoverEnabled, 0);
      assert.equal(duplicate.hoverEnabled, 1, 'Only the first matching hover word is written');
      assert.equal(baseRegion.active, 0x13572468, 'Hover zero does not clear active');
      assert.equal(duplicate.active, 0x13572468);
      assert.equal(baseRegion.enabled, 1);
      assert.deepEqual(inner.slice(at), [[135, baseID, 0, 0]]);
      await inputEnableInvoke(scene, 'hover-input.kcs', [simpleNative, high]);
      assert.equal(simpleRegion.hoverEnabled, high, 'SimplePlane reaches the same Input135 setter');
      assert.equal(simpleRegion.active, 0);
      assert.equal(simpleRegion.enabled, 1);
      assert.equal(baseRegion.hoverEnabled, 0, 'Another owner is not rewritten');
      await inputEnableInvoke(scene, 'hover-input.kcs', [baseNative, high]);
      assert.equal(duplicate.hoverEnabled, 1);
      const checkpoint = structuredClone(scene.snapshot());
      fresh = await dataWorld(profile, files, { initialize: false });
      let restoring = true,
        replay = 0;
      const execute = fresh.runtime.scheduler.execute,
        freshNative = fresh.runtime.native;
      fresh.runtime.scheduler.execute = function (...args) {
        if (restoring) replay++;
        return execute.apply(this, args);
      };
      fresh.runtime.native = function (...args) {
        if (restoring) replay++;
        return freshNative.apply(this, args);
      };
      await fresh.restore(structuredClone(checkpoint));
      restoring = false;
      assert.equal(replay, 0, 'Cold restore does not replay a native or guest call');
      assert.deepEqual(fresh.snapshot(), checkpoint, 'The true fresh owner needs no warm frame');
      freshInput = fresh.inputFor(simpleID);
      assert.notStrictEqual(freshInput, input);
      assert.notStrictEqual(freshInput.get(simpleID), simpleRegion);
      await inputEnableInvoke(fresh, 'hover-input.kcs', [simpleNative, 0]);
      assert.equal(freshInput.get(simpleID).hoverEnabled, 0);
      assert.equal(freshInput.get(baseID).active, 0x13572468);
      assert.deepEqual(
        scene.snapshot(),
        checkpoint,
        'Fresh input leaves the source owner unchanged',
      );
      // A separate actual World supplies an independently false changed baseline.
      // No live changed field is manually reset to manufacture this missing-owner guard.
      missing = await dataWorld(profile, files);
      const missingID = await missing.objects.create({
          kind: 6,
          parent: missing.root,
          nativeID: 0x03500448,
          name: 'removed hover registration',
        }),
        missingNative = missing.nativeTaskID(missingID);
      await inputEnableInvoke(missing, 'bind-input.kcs', [missingNative, 1, 1, 8, 8, 10, 0]);
      const missingInput = missing.inputFor(missingID);
      assert.equal(missingInput.unregister(missingID), true);
      assert.equal(missingInput.changed, false);
      await inputEnableInvoke(missing, 'hover-input.kcs', [missingNative, high]);
      assert.equal(missingInput.get(missingID), null);
      assert.equal(missingInput.changed, true, 'A bound missing owner still marks Input changed');
      assert.equal(
        missing.objects.objects.get(missingID).implementation.state.receiver !== -1,
        true,
      );
      at = inner.length;
      await inputEnableInvoke(scene, 'hover-input.kcs', [scene.nativeTaskID(unboundID), high]);
      assert.deepEqual(inner.slice(at), [], 'An unbound receiver never accesses Input');
      const zero = await inputEnableInvoke(scene, 'hover-input.kcs', [0, high]);
      assert.deepEqual(outer.at(-1), [0, zero.task.id, 98, 0, high, 0]);
      assert.deepEqual(received.at(-1), [
        scene.root,
        zero.record.nativeID,
        98,
        0,
        high,
        zero.task.id,
        0,
      ]);
      assert.equal(calls.length, outer.length);
      assert.equal(calls.length, received.length);
      for (let i = 0; i < calls.length; i++) {
        const call = calls[i],
          [target, enabled] = call.args,
          sender = scene.objects.objects.get(call.sender),
          owner = scene.resolveTaskID(target, call.sender);
        assert.deepEqual(outer[i], [target, call.sender, 98, 0, enabled, 0]);
        assert.deepEqual(received[i], [owner, sender.nativeID, 98, 0, enabled, call.sender, 0]);
      }
      assert.deepEqual(
        await Promise.all(calls.map((call) => call.reply)),
        Array.from({ length: calls.length }, () => ({ control: 2 })),
      );
      assert.strictEqual(simple.graph, graph);
      assert.deepEqual({ rect: simple.state.rect, colors: graph.colors }, geometry);
      assert.equal(scene.graphics.renderSequence, order);
      assert.equal(scene.frame, frame);
      assert.equal(fresh.frame, frame);
      for (const current of [scene, fresh, missing])
        assert.ok(!current.nativeEngine && !current.nativeEngineLoading);
      const entry = nativeABI(profile).tables.main.entries[848];
      assert.equal(entry.status, 'recovered');
      assert.equal(entry.name, 'plane.setInputHoverEnabled');
      assert.equal(entry.signature.argumentWords, 2);
      assert.equal(entry.signature.parameters[1].name, 'enabled');
      assert.deepEqual(entry.signature.parameters[1].type, { bits: 32, kind: 'bits' });
      assert.deepEqual(entry.controlCodes, [2]);
      assert.equal(entry.signature.result.kind, 'void');
      assert.equal(entry.signature.resultWritten, false);
      assert.equal(nativeABI(rectangleProfiles[0]).tables.main.entries[109].status, 'unknown');
      assert.equal(nativeABI(profile).tables.main.entries[467].status, 'unknown');
    } finally {
      await missing?.close();
      await fresh?.close();
      await scene.close();
      if (simpleID !== undefined) {
        assert.equal(input?.get(simpleID), null);
        assert.equal(freshInput?.get(simpleID) ?? null, null);
      }
    }
  });

for (const profile of rectangleProfiles)
  test(`${profile} main849 GCALL preserves the raw drag word on its first owned input region`, async () => {
    const files = {
        'case.kcs': kcsProgram([[59]]),
        'bind-input.kcs': inputEnableProgram(104, 7),
        'drag-input.kcs': inputEnableProgram(849, 2),
        'active-input.kcs': inputEnableProgram(106, 2),
      },
      scene = await dataWorld(profile, files);
    let fresh, missing, input, freshInput, simpleID;
    try {
      const baseID = await scene.objects.create({
          kind: 6,
          parent: scene.root,
          nativeID: 0x03510849,
          name: 'drag Base',
        }),
        unboundID = await scene.objects.create({
          kind: 6,
          parent: scene.root,
          nativeID: 0x03510349,
          name: 'unbound drag Base',
        });
      simpleID = await scene.objects.create({
        kind: 2,
        parent: scene.root,
        nativeID: 0x03510249,
        name: 'drag SimplePlane',
      });
      const baseNative = scene.nativeTaskID(baseID),
        simpleNative = scene.nativeTaskID(simpleID),
        simple = scene.objects.objects.get(simpleID).implementation,
        high = 0x80000351;
      assert.notEqual(baseNative, baseID);
      assert.notEqual(simpleNative, simpleID);
      assert.equal(scene.objects.objects.get(scene.root).nativeID, 0);
      await scene.sendNativeEngine(simpleNative, scene.main.id, 42, 0, 0, {
        payload: new NativeGraphicsPacket([
          0,
          0,
          0,
          floatBits(20.5),
          floatBits(12.25),
          0,
          0,
          0x80778899,
        ]),
      });
      await inputEnableInvoke(scene, 'bind-input.kcs', [baseNative, 0, 0, 0, 0, 700, 0]);
      await inputEnableInvoke(scene, 'bind-input.kcs', [simpleNative, 1, 2, 3, 4, 500, 0]);
      input = scene.inputFor(baseID);
      assert.strictEqual(input, scene.inputFor(simpleID));
      const baseRegion = input.get(baseID),
        simpleRegion = input.get(simpleID),
        graph = simple.graph,
        geometry = structuredClone({ rect: simple.state.rect, colors: graph.colors }),
        frame = scene.frame,
        order = scene.graphics.renderSequence,
        dragEvents = [],
        outer = [],
        received = [],
        inner = [],
        calls = [],
        native = scene.runtime.native,
        send = scene.sendNativeEngine,
        message = input.message;
      assert.equal(baseRegion.dragEnabled, 1);
      assert.equal(simpleRegion.dragEnabled, 1);
      assert.equal(input.changed, false);
      scene.runtime.native = function (table, id, ...args) {
        const reply = native.call(this, table, id, ...args);
        if (table === 'main' && id === 849)
          calls.push({ args: [...args[0]], sender: args[2].id, reply });
        return reply;
      };
      scene.sendNativeEngine = function (target, sender, number, w, l, context) {
        if (number === 99) outer.push([target, sender, number, w, l, context.flags]);
        return send.call(this, target, sender, number, w, l, context);
      };
      Object.defineProperty(input, 'message', {
        configurable: true,
        value: function (number, w, l, context) {
          if (number === 153) inner.push([number, w, l, context?.flags]);
          return message.call(this, number, w, l, context);
        },
      });
      for (const id of [scene.root, baseID, simpleID, unboundID]) {
        const record = scene.objects.objects.get(id),
          original = record.implementation.message;
        record.implementation.message = function (words, context, ...rest) {
          if (words[1] === 99)
            received.push([id, ...words, context.nativeSenderWorldID, context.flags]);
          if (id === baseID && words[1] === 6) dragEvents.push([...words]);
          return original.call(this, words, context, ...rest);
        };
      }
      await inputEnableInvoke(scene, 'drag-input.kcs', [baseNative, high]);
      assert.equal(baseRegion.dragEnabled, high, 'Main849 preserves the complete drag DWORD');
      assert.equal(input.changed, false, 'Input153 does not mark changed on a found owner');
      assert.equal(baseRegion.hoverEnabled, 1);
      assert.equal(high & 2, 0, 'The stored enable word is not the region mask');
      assert.equal(baseRegion.mask, 7);
      assert.deepEqual(inner, [[153, baseID, high, 0]]);
      await input.drag();
      assert.equal(dragEvents.length, 1, 'Nonzero field40 admits the actual drag service');
      assert.deepEqual(dragEvents[0].slice(1), [6, 4, 12]);
      await inputEnableInvoke(scene, 'drag-input.kcs', [baseNative, 0]);
      await input.drag();
      assert.equal(dragEvents.length, 1, 'Zero field40 suppresses that owner drag route');
      await inputEnableInvoke(scene, 'drag-input.kcs', [baseNative, high]);
      const duplicate = input.register({
        owner: baseID,
        receiver: baseRegion.receiver,
        bounds: [3, 4, 33, 24],
        priority: -1,
      });
      await inputEnableInvoke(scene, 'active-input.kcs', [baseNative, 0x13572468]);
      let at = inner.length;
      await inputEnableInvoke(scene, 'drag-input.kcs', [baseNative, 0]);
      assert.equal(baseRegion.dragEnabled, 0);
      assert.equal(duplicate.dragEnabled, 1, 'Only the first matching drag word is written');
      assert.equal(baseRegion.active, 0x13572468, 'Hover zero does not clear active');
      assert.equal(duplicate.active, 0x13572468);
      assert.equal(baseRegion.enabled, 1);
      assert.deepEqual(inner.slice(at), [[153, baseID, 0, 0]]);
      await inputEnableInvoke(scene, 'drag-input.kcs', [simpleNative, high]);
      assert.equal(simpleRegion.dragEnabled, high, 'SimplePlane reaches the same Input153 setter');
      assert.equal(simpleRegion.active, 0);
      assert.equal(simpleRegion.enabled, 1);
      assert.equal(simpleRegion.hoverEnabled, 1);
      assert.equal(baseRegion.dragEnabled, 0, 'Another owner is not rewritten');
      await inputEnableInvoke(scene, 'drag-input.kcs', [baseNative, high]);
      assert.equal(duplicate.dragEnabled, 1);
      assert.equal(input.changed, false, 'Raw zero/high/duplicate updates leave changed false');
      const checkpoint = structuredClone(scene.snapshot());
      fresh = await dataWorld(profile, files, { initialize: false });
      let restoring = true,
        replay = 0;
      const execute = fresh.runtime.scheduler.execute,
        freshNative = fresh.runtime.native;
      fresh.runtime.scheduler.execute = function (...args) {
        if (restoring) replay++;
        return execute.apply(this, args);
      };
      fresh.runtime.native = function (...args) {
        if (restoring) replay++;
        return freshNative.apply(this, args);
      };
      await fresh.restore(structuredClone(checkpoint));
      restoring = false;
      assert.equal(replay, 0, 'Cold restore does not replay a native or guest call');
      assert.deepEqual(fresh.snapshot(), checkpoint, 'The true fresh owner needs no warm frame');
      freshInput = fresh.inputFor(simpleID);
      assert.notStrictEqual(freshInput, input);
      assert.notStrictEqual(freshInput.get(simpleID), simpleRegion);
      await inputEnableInvoke(fresh, 'drag-input.kcs', [simpleNative, 0]);
      assert.equal(freshInput.get(simpleID).dragEnabled, 0);
      assert.equal(freshInput.get(baseID).active, 0x13572468);
      assert.deepEqual(
        scene.snapshot(),
        checkpoint,
        'Fresh input leaves the source owner unchanged',
      );
      // A separate actual World supplies an independently false changed baseline.
      // No live changed field is manually reset to manufacture this missing-owner guard.
      missing = await dataWorld(profile, files);
      const missingID = await missing.objects.create({
          kind: 6,
          parent: missing.root,
          nativeID: 0x03510449,
          name: 'removed drag registration',
        }),
        missingNative = missing.nativeTaskID(missingID);
      await inputEnableInvoke(missing, 'bind-input.kcs', [missingNative, 1, 1, 8, 8, 10, 0]);
      const missingInput = missing.inputFor(missingID);
      assert.equal(missingInput.unregister(missingID), true);
      assert.equal(missingInput.changed, false);
      await inputEnableInvoke(missing, 'drag-input.kcs', [missingNative, high]);
      assert.equal(missingInput.get(missingID), null);
      assert.equal(
        missingInput.changed,
        false,
        'A bound missing owner does not mark Input changed',
      );
      assert.equal(
        missing.objects.objects.get(missingID).implementation.state.receiver !== -1,
        true,
      );
      at = inner.length;
      await inputEnableInvoke(scene, 'drag-input.kcs', [scene.nativeTaskID(unboundID), high]);
      assert.deepEqual(inner.slice(at), [], 'An unbound receiver never accesses Input');
      const zero = await inputEnableInvoke(scene, 'drag-input.kcs', [0, high]);
      assert.deepEqual(outer.at(-1), [0, zero.task.id, 99, 0, high, 0]);
      assert.deepEqual(received.at(-1), [
        scene.root,
        zero.record.nativeID,
        99,
        0,
        high,
        zero.task.id,
        0,
      ]);
      assert.equal(calls.length, outer.length);
      assert.equal(calls.length, received.length);
      for (let i = 0; i < calls.length; i++) {
        const call = calls[i],
          [target, enabled] = call.args,
          sender = scene.objects.objects.get(call.sender),
          owner = scene.resolveTaskID(target, call.sender);
        assert.deepEqual(outer[i], [target, call.sender, 99, 0, enabled, 0]);
        assert.deepEqual(received[i], [owner, sender.nativeID, 99, 0, enabled, call.sender, 0]);
      }
      assert.deepEqual(
        await Promise.all(calls.map((call) => call.reply)),
        Array.from({ length: calls.length }, () => ({ control: 2 })),
      );
      assert.strictEqual(simple.graph, graph);
      assert.deepEqual({ rect: simple.state.rect, colors: graph.colors }, geometry);
      assert.equal(scene.graphics.renderSequence, order);
      assert.equal(scene.frame, frame);
      assert.equal(fresh.frame, frame);
      for (const current of [scene, fresh, missing])
        assert.ok(!current.nativeEngine && !current.nativeEngineLoading);
      const entry = nativeABI(profile).tables.main.entries[849];
      assert.equal(entry.status, 'recovered');
      assert.equal(entry.name, 'plane.setInputDragEnabled');
      assert.equal(entry.signature.argumentWords, 2);
      assert.equal(entry.signature.parameters[1].name, 'enabled');
      assert.deepEqual(entry.signature.parameters[1].type, { bits: 32, kind: 'bits' });
      assert.deepEqual(entry.controlCodes, [2]);
      assert.equal(entry.signature.result.kind, 'void');
      assert.equal(entry.signature.resultWritten, false);
      assert.equal(nativeABI(rectangleProfiles[0]).tables.main.entries[109].status, 'unknown');
      assert.equal(nativeABI(profile).tables.main.entries[467].status, 'unknown');
    } finally {
      await missing?.close();
      await fresh?.close();
      await scene.close();
      if (simpleID !== undefined) {
        assert.equal(input?.get(simpleID), null);
        assert.equal(freshInput?.get(simpleID) ?? null, null);
      }
    }
  });

for (const profile of rectangleProfiles)
  test(`${profile} main100 GCALL retains raw ARGB and override words in its owned Plane`, async () => {
    const files = { 'case.kcs': kcsProgram([[59]]), 'color.kcs': inputEnableProgram(100, 3) },
      scene = await dataWorld(profile, files);
    let fresh;
    try {
      const targetID = await scene.objects.create({
          kind: 2,
          parent: scene.root,
          nativeID: 0x01000064,
          name: 'color target',
        }),
        siblingID = await scene.objects.create({
          kind: 2,
          parent: scene.root,
          nativeID: 0x01010064,
          name: 'color sibling',
        }),
        unloadedID = await scene.objects.create({
          kind: 2,
          parent: scene.root,
          nativeID: 0x01020064,
          name: 'unloaded color target',
        }),
        baseID = await scene.objects.create({
          kind: 6,
          parent: scene.root,
          nativeID: 0x01030064,
          name: 'unhandled Base color target',
        });
      const targetNative = scene.nativeTaskID(targetID),
        siblingNative = scene.nativeTaskID(siblingID);
      assert.notEqual(targetNative, targetID);
      assert.notEqual(siblingNative, siblingID);
      for (const nativeID of [targetNative, siblingNative])
        await scene.sendNativeEngine(nativeID, scene.main.id, 42, 0, 0, {
          payload: new NativeGraphicsPacket([
            0,
            0,
            0,
            floatBits(20.5),
            floatBits(12.25),
            0,
            0,
            0xff334455,
          ]),
        });
      const target = scene.objects.objects.get(targetID).implementation,
        sibling = scene.objects.objects.get(siblingID).implementation,
        unloaded = scene.objects.objects.get(unloadedID).implementation,
        base = scene.objects.objects.get(baseID).implementation,
        graph = target.graph,
        motion = new DataView(graph.kx2.buffer),
        siblingBefore = sibling.snapshot(),
        unloadedBefore = unloaded.snapshot(),
        baseBefore = base.snapshot(),
        frame = scene.frame,
        order = scene.graphics.renderSequence,
        argb = 0x80402010,
        high = 0x80000000,
        calls = [],
        outer = [],
        received = [],
        originalNative = scene.runtime.native,
        originalSend = scene.sendNativeEngine,
        originalMark = target.markBoundsDirty;
      let dirtyCalls = 0;
      target.markBoundsDirty = function (...args) {
        dirtyCalls++;
        return originalMark.apply(this, args);
      };
      scene.runtime.native = function (table, id, ...args) {
        const reply = originalNative.call(this, table, id, ...args);
        if (table === 'main' && id === 100)
          calls.push({ args: [...args[0]], sender: args[2].id, reply });
        return reply;
      };
      scene.sendNativeEngine = function (id, sender, number, w, l, context) {
        if (number === 59) outer.push([id, sender, number, w, l, context.flags]);
        return originalSend.call(this, id, sender, number, w, l, context);
      };
      for (const id of [targetID, siblingID, unloadedID, baseID]) {
        const implementation = scene.objects.objects.get(id).implementation,
          original = implementation.message;
        implementation.message = function (words, context, ...rest) {
          if (words[1] === 59)
            received.push([id, ...words, context.nativeSenderWorldID, context.flags]);
          return original.call(this, words, context, ...rest);
        };
      }
      await inputEnableInvoke(scene, 'color.kcs', [targetNative, argb, high]);
      assert.equal(motion.getUint32(MOTION_ABI.color, true), argb);
      assert.equal(
        target.state.colorOverride,
        high,
        'The override word is retained rather than reduced to Boolean',
      );
      assert.equal(graph.style.colorOverride, high);
      assert.equal(dirtyCalls, 1);
      await inputEnableInvoke(scene, 'color.kcs', [targetNative, argb, 1]);
      assert.equal(target.state.colorOverride, 1);
      assert.equal(dirtyCalls, 1, 'Equal ARGB and two nonzero modes do not dirty the source model');
      await inputEnableInvoke(scene, 'color.kcs', [targetNative, argb, 0]);
      assert.equal(target.state.colorOverride, 0);
      assert.equal(dirtyCalls, 2, 'The nonzero-to-zero category change dirties the source model');
      await inputEnableInvoke(scene, 'color.kcs', [targetNative, argb, 0]);
      assert.equal(dirtyCalls, 2);
      await inputEnableInvoke(scene, 'color.kcs', [targetNative, 0x4080c0e0, high]);
      assert.equal(motion.getUint32(MOTION_ABI.color, true), 0x4080c0e0);
      assert.equal(target.state.colorOverride, high);
      assert.equal(dirtyCalls, 3);
      assert.deepEqual(
        sibling.snapshot(),
        siblingBefore,
        'The other registered native identity is unchanged',
      );
      await inputEnableInvoke(scene, 'color.kcs', [scene.nativeTaskID(unloadedID), argb, high]);
      assert.deepEqual(
        unloaded.snapshot(),
        unloadedBefore,
        'An absent owned model receives no color state',
      );
      await inputEnableInvoke(scene, 'color.kcs', [scene.nativeTaskID(baseID), argb, high]);
      assert.deepEqual(
        base.snapshot(),
        baseBefore,
        'Native Base does not handle the color message',
      );
      const beforeZero = outer.length,
        zero = await inputEnableInvoke(scene, 'color.kcs', [0, argb, high]);
      assert.equal(outer.length, beforeZero, 'A real zero-target GCALL does not dispatch');
      const lazyArgs = [0];
      for (const index of [1, 2])
        Object.defineProperty(lazyArgs, index, {
          get() {
            throw new Error('zero target read a skipped color argument');
          },
        });
      assert.deepEqual(await nativeGraphics(100, lazyArgs, zero.machine, zero.task, scene), {
        control: 2,
      });
      const nonzero = calls.filter((call) => call.args[0] !== 0);
      assert.equal(nonzero.length, outer.length);
      assert.equal(nonzero.length, received.length);
      for (let i = 0; i < nonzero.length; i++) {
        const call = nonzero[i],
          [id, color, mode] = call.args,
          sender = scene.objects.objects.get(call.sender),
          owner = scene.resolveTaskID(id, call.sender);
        assert.deepEqual(outer[i], [id, call.sender, 59, mode, color, 0]);
        assert.deepEqual(received[i], [owner, sender.nativeID, 59, mode, color, call.sender, 0]);
      }
      assert.deepEqual(
        await Promise.all(calls.map((call) => call.reply)),
        Array.from({ length: calls.length }, () => ({ control: 2 })),
      );
      assert.strictEqual(target.graph, graph);
      assert.equal(scene.graphics.renderSequence, order);
      assert.equal(scene.frame, frame);
      const checkpoint = structuredClone(scene.snapshot());
      fresh = await dataWorld(profile, files, { initialize: false });
      let restoring = true,
        replay = 0;
      const execute = fresh.runtime.scheduler.execute,
        native = fresh.runtime.native;
      fresh.runtime.scheduler.execute = function (...args) {
        if (restoring) replay++;
        return execute.apply(this, args);
      };
      fresh.runtime.native = function (...args) {
        if (restoring) replay++;
        return native.apply(this, args);
      };
      await fresh.restore(structuredClone(checkpoint));
      restoring = false;
      assert.equal(replay, 0);
      assert.deepEqual(
        fresh.snapshot(),
        checkpoint,
        'Cold full DTO restoration needs no warm frame',
      );
      const restored = fresh.objects.objects.get(targetID).implementation;
      assert.notStrictEqual(restored.graph, graph);
      assert.equal(restored.state.colorOverride, high);
      await inputEnableInvoke(fresh, 'color.kcs', [targetNative, 0x7f030201, 0]);
      assert.equal(
        new DataView(restored.graph.kx2.buffer).getUint32(MOTION_ABI.color, true),
        0x7f030201,
      );
      assert.equal(restored.state.colorOverride, 0);
      assert.deepEqual(
        scene.snapshot(),
        checkpoint,
        'Fresh mutation does not change the source owner',
      );
      assert.equal(fresh.frame, frame);
      for (const current of [scene, fresh])
        assert.ok(!current.nativeEngine && !current.nativeEngineLoading);
      const entry = nativeABI(profile).tables.main.entries[100];
      assert.equal(entry.status, 'recovered');
      assert.equal(entry.name, 'plane.setColor');
      assert.equal(entry.signature.argumentWords, 3);
      assert.equal(entry.signature.parameters[1].name, 'colorARGB');
      assert.equal(entry.signature.parameters[2].name, 'override');
      assert.deepEqual(entry.signature.parameters[2].type, { bits: 32, kind: 'bits' });
      assert.deepEqual(entry.controlCodes, [2]);
      assert.equal(entry.signature.result.kind, 'void');
      assert.equal(entry.signature.resultWritten, false);
      assert.equal(nativeABI(rectangleProfiles[0]).tables.main.entries[97].status, 'unknown');
      assert.equal(nativeABI(rectangleProfiles[0]).tables.main.entries[109].status, 'unknown');
      assert.equal(nativeABI(profile).tables.main.entries[467].status, 'unknown');
    } finally {
      await fresh?.close();
      await scene.close();
      assert.equal(scene.graphics.tasks.size, 0);
      if (fresh) assert.equal(fresh.graphics.tasks.size, 0);
    }
  });

for (const profile of rectangleProfiles)
  test(`${profile} main108 GCALL preserves the owned raw return word and poll-clear lifecycle`, async () => {
    const files = {
        'case.kcs': kcsProgram([[59]]),
        'return.kcs': inputEnableProgram(108, 2),
      },
      scene = await dataWorld(profile, files);
    let fresh;
    try {
      const baseID = await scene.objects.create({
          kind: 6,
          parent: scene.root,
          nativeID: 0x006c0108,
          name: 'return Base',
        }),
        planeID = await scene.objects.create({
          kind: 2,
          parent: scene.root,
          nativeID: 0x006c0208,
          name: 'return Plane',
        }),
        siblingID = await scene.objects.create({
          kind: 6,
          parent: scene.root,
          nativeID: 0x006c0308,
          name: 'return sibling',
        });
      const base = scene.objects.objects.get(baseID).implementation,
        plane = scene.objects.objects.get(planeID).implementation,
        sibling = scene.objects.objects.get(siblingID).implementation;
      await scene.sendNativeEngine(scene.nativeTaskID(planeID), scene.main.id, 42, 0, 0, {
        payload: new NativeGraphicsPacket([0, 0, 0, floatBits(7), floatBits(5), 0, 0, 0xff102030]),
      });
      const siblingBefore = sibling.snapshot(),
        graph = plane.graph,
        input = base.input,
        inputBefore = input.snapshot(),
        frame = scene.frame,
        outer = [],
        calls = [],
        send = scene.sendNativeEngine,
        native = scene.runtime.native;
      scene.sendNativeEngine = function (...args) {
        if (args[2] === 94)
          outer.push([args[0], args[1], args[2], args[3], args[4], args[5]?.flags]);
        return send.apply(this, args);
      };
      scene.runtime.native = function (table, id, ...args) {
        const result = native.call(this, table, id, ...args);
        if (table === 'main' && id === 108)
          calls.push({ words: [...args[0]], caller: args[2].id, result });
        return result;
      };
      for (const id of [baseID, planeID]) {
        const target = scene.objects.objects.get(id).implementation,
          targetNative = scene.nativeTaskID(id);
        assert.notEqual(targetNative, id);
        assert.equal(
          target.state.receiver,
          -1,
          'the native store does not require Input registration',
        );
        for (const value of [0, 1, 0x80000000, 0xffffffff]) {
          const caller = await inputEnableInvoke(scene, 'return.kcs', [targetNative, value]);
          assert.equal(target.state.changed, value);
          assert.equal(
            await scene.sendNativeEngine(targetNative, caller.task.id, 6, 0, 0, { flags: 0 }),
            value,
          );
          assert.equal(target.state.changed, 0);
          assert.equal(
            await scene.sendNativeEngine(targetNative, caller.task.id, 6, 0, 0, { flags: 0 }),
            0,
          );
        }
      }
      const count = outer.length;
      await inputEnableInvoke(scene, 'return.kcs', [0, 0x80000000]);
      assert.equal(
        outer.length,
        count + 1,
        'zero dispatches normally; no Root response is invented',
      );
      assert.equal(outer.at(-1)[0], 0);
      for (let i = 0; i < calls.length; i++)
        assert.deepEqual(outer[i], [
          calls[i].words[0],
          calls[i].caller,
          94,
          0,
          calls[i].words[1],
          0,
        ]);
      assert.deepEqual(
        await Promise.all(calls.map((call) => call.result)),
        calls.map(() => ({ control: 2 })),
      );
      assert.deepEqual(sibling.snapshot(), siblingBefore);
      assert.deepEqual(input.snapshot(), inputBefore, 'the return word does not mutate Input');
      assert.strictEqual(plane.graph, graph);
      assert.equal(scene.frame, frame);

      await inputEnableInvoke(scene, 'return.kcs', [scene.nativeTaskID(baseID), 0x80000000]);
      const checkpoint = structuredClone(scene.snapshot());
      fresh = await dataWorld(profile, files, { initialize: false });
      let replay = 0,
        draws = 0;
      const execute = fresh.runtime.scheduler.execute,
        freshNative = fresh.runtime.native;
      fresh.runtime.scheduler.execute = function (...args) {
        replay++;
        return execute.apply(this, args);
      };
      fresh.runtime.native = function (...args) {
        replay++;
        return freshNative.apply(this, args);
      };
      for (const stream of [fresh.random.integer, fresh.random.real]) {
        const next = stream.nextUint32;
        stream.nextUint32 = function (...args) {
          draws++;
          return next.apply(this, args);
        };
      }
      await fresh.restore(structuredClone(checkpoint));
      assert.equal(replay, 0);
      assert.equal(draws, 0);
      assert.deepEqual(fresh.snapshot(), checkpoint, 'full DTO matches before a warm frame');
      const restored = fresh.objects.objects.get(baseID).implementation;
      assert.notEqual(restored, base);
      assert.equal(restored.state.changed, 0x80000000);
      const caller = await inputEnableInvoke(fresh, 'return.kcs', [
        fresh.nativeTaskID(baseID),
        0xffffffff,
      ]);
      assert.equal(
        await fresh.sendNativeEngine(fresh.nativeTaskID(baseID), caller.task.id, 6, 0, 0, {
          flags: 0,
        }),
        0xffffffff,
      );
      assert.equal(restored.state.changed, 0);
      assert.deepEqual(scene.snapshot(), checkpoint, 'the source owner is isolated');
      assert.equal(nativeABI(profile).tables.main.entries[108].name, 'plane.setInputReturn');
      assert.equal(nativeABI(rectangleProfiles[0]).tables.main.entries[109].status, 'unknown');
      assert.equal(nativeABI(rectangleProfiles[0]).tables.main.entries[455].status, 'unknown');
      assert.equal(nativeABI(profile).tables.main.entries[467].status, 'unknown');
      for (const current of [scene, fresh])
        assert.ok(!current.nativeEngine && !current.nativeEngineLoading);
    } finally {
      await fresh?.close();
      await scene.close();
      assert.equal(scene.graphics.tasks.size, 0);
      if (fresh) assert.equal(fresh.graphics.tasks.size, 0);
    }
  });

const texturedRectangleCode = kcsProgram([
  [37, rectangleSentinel],
  [37, 0],
  [37, floatBits(111)],
  [37, floatBits(222)],
  [43, 78, 12],
  [37, 73],
  [38, [0x13, 512]],
  [37, [0x13, 128]],
  [37, floatBits(20.5)],
  [37, floatBits(12.25)],
  [43, 78, 12],
  [37, 89],
  [38, [0x13, 516]],
  [59],
]);

for (const profile of rectangleProfiles)
  test(`${profile} main78 GCALL preserves textured factory modes and cold model ownership`, async () => {
    const files = { 'case.kcs': kcsProgram([[59]]), 'rectangle.kcs': texturedRectangleCode },
      scene = await dataWorld(profile, files);
    let fresh;
    try {
      const id = await scene.objects.create({
          kind: 2,
          parent: scene.main.id,
          nativeID: 0x004e004e,
          name: 'textured rectangle',
        }),
        target = scene.nativeTaskID(id),
        plane = scene.objects.objects.get(id).implementation,
        siblingID = await scene.objects.create({ kind: 2, parent: scene.main.id }),
        sibling = scene.objects.objects.get(siblingID).implementation,
        siblingBefore = structuredClone(sibling.state),
        packets = [],
        replies = [],
        send = scene.sendNativeEngine,
        native = scene.runtime.native;
      let current;
      assert.notEqual(target, id);
      scene.runtime.native = function (table, number, ...args) {
        const reply = native.call(this, table, number, ...args);
        if (table === 'main' && number === 78) replies.push(reply);
        return reply;
      };
      scene.sendNativeEngine = function (destination, sender, message, w, l, context) {
        if (message === 41) {
          assert.equal(current.machine.load(512), 73, 'The zero target returned before this send');
          packets.push({
            destination,
            sender,
            message,
            w,
            l,
            flags: context.flags,
            words: Array.from({ length: 8 }, (_, i) => context.payload.load(i * 4)),
          });
        }
        return send.call(this, destination, sender, message, w, l, context);
      };
      const words = [0, 0, 0, floatBits(20.5), floatBits(12.25), 32, 1, 0xffffffff],
        invoke = async (destination = target) => {
          current = await rectangleCaller(scene);
          current.machine.store(128, destination);
          current.machine.bytes(800, 8).fill(0xa5);
          await scene.runtime.scheduler.execute(current.task);
          rectangleContinuation(current);
          assert.deepEqual(packets.at(-1), {
            destination,
            sender: current.task.id,
            message: 41,
            w: 0,
            l: 0,
            flags: 0,
            words,
          });
          return current;
        },
        order = scene.graphics.renderSequence;
      await invoke();
      assert.equal(packets.length, 1, 'Target zero creates and sends nothing');
      assert.equal(scene.graphics.renderSequence, order + 1);
      assert.equal(plane.graph.type, 1);
      assert.equal(plane.graph.vram, true);
      assert.equal(plane.graph.width, 20.5);
      assert.equal(plane.graph.height, 12.25);
      assert.deepEqual(plane.state.rect, [0, 0, 20.5, 12.25]);
      assert.equal(plane.state.drawType, 1);
      assert.deepEqual(plane.state.shapeWords, words);
      assert.strictEqual(scene.graphics.graphs.get(target), plane.graph);
      const output = scene.graphics.stage.planes[plane.stageKey];
      assert.equal(output.width, 20.5);
      assert.equal(output.height, 12.25);
      assert.strictEqual(output.nativeGraph, plane.graph);

      for (const mode of [0, 2]) {
        await scene.sendNativeEngine(target, scene.main.id, 84, 0, mode);
        const retained = structuredClone({
            rect: plane.state.rect,
            drawType: plane.state.drawType,
            shapeWords: plane.state.shapeWords,
          }),
          previous = plane.graph,
          sequence = scene.graphics.renderSequence;
        await invoke();
        assert.equal(plane.graph, null, `Mode ${mode} removes the old model without replacement`);
        assert.equal(scene.graphics.graphs.has(target), false);
        assert.equal(Object.hasOwn(scene.graphics.stage.planes, plane.stageKey), false);
        assert.equal(scene.graphics.renderSequence, sequence);
        assert.deepEqual(
          {
            rect: plane.state.rect,
            drawType: plane.state.drawType,
            shapeWords: plane.state.shapeWords,
          },
          retained,
        );
        assert.equal(plane.state.vramType, mode);
        await scene.sendNativeEngine(target, scene.main.id, 84, 0, 1);
        await invoke();
        assert.notStrictEqual(plane.graph, previous);
        assert.equal(plane.graph.type, 1);
        assert.deepEqual(plane.state.shapeWords, words);
      }
      const sequence = scene.graphics.renderSequence;
      await invoke(0x7f780078);
      assert.equal(
        scene.graphics.renderSequence,
        sequence,
        'A missing native target owns no model',
      );
      assert.deepEqual(sibling.state, siblingBefore);
      assert.deepEqual(
        await Promise.all(replies),
        replies.map(() => ({ control: 2 })),
      );
      const declaration = nativeABI(profile).tables.main.entries[78];
      assert.equal(declaration.status, 'recovered');
      assert.equal(declaration.name, 'plane.texturedRectangle');
      assert.equal(declaration.signature.argumentWords, 3);
      assert.deepEqual(declaration.controlCodes, [2]);
      assert.equal(declaration.signature.result.kind, 'void');
      assert.equal(declaration.signature.resultWritten, false);
      for (const field of declaration.signature.parameters.slice(1))
        assert.deepEqual(field.type, { kind: 'float', bits: 32 });
      for (const unknown of [109, 110, 339, 340, 341, 467])
        assert.equal(
          nativeABI(rectangleProfiles[0]).tables.main.entries[unknown].status,
          'unknown',
        );

      const saved = scene.snapshot(),
        encoded = await serializeCheckpoint(saved),
        decoded = await deserializeCheckpoint(encoded);
      fresh = await dataWorld(profile, files, { initialize: false });
      fresh.runtime.native = () => {
        throw new Error('Textured model restore replayed a native call');
      };
      for (const random of [fresh.random.integer, fresh.random.real])
        random.nextUint32 = () => {
          throw new Error('Textured model restore replayed RNG');
        };
      await fresh.restore(decoded);
      assert.deepEqual(fresh.snapshot(), saved, 'Full DTO equality is checked before a warm frame');
      const restored = fresh.objects.objects.get(id).implementation;
      assert.notStrictEqual(restored.graph, plane.graph);
      assert.notStrictEqual(restored.state.shapeWords, plane.state.shapeWords);
      assert.deepEqual(restored.state.shapeWords, words);
      assert.equal(restored.graph.width, 20.5);
      assert.equal(restored.graph.height, 12.25);
      await scene.objects.release(id);
      assert.equal(scene.graphics.graphs.has(target), false);
      assert.equal(fresh.graphics.graphs.has(target), true);
      assert.deepEqual(restored.state.shapeWords, words);
      assert.equal(scene.nativeEngine, undefined);
      assert.equal(fresh.nativeEngine, undefined);
    } finally {
      await fresh?.close();
      await scene.close();
    }
  });
