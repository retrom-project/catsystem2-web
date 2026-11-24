// SPDX-License-Identifier: MPL-2.0
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { KCSMachine, encodeCP932, floatBits, readKCS } from '../src/kcs.mjs';
import { MOTION_ABI, motionVector, setMotionVector } from '../src/motion/abi.mjs';
import { FESImages } from '../src/native/fes-image-driver.mjs';
import { NATIVE_UNWRITTEN_WORD } from '../src/native/engine-message.mjs';
import { NativeGraphicsPacket } from '../src/native/graphics-task.mjs';
import { dataWorld } from './fixtures/data-world.mjs';
import { kcsProgram } from './helpers.mjs';

const profile = 'grisaia-jp-engine-2.6.1.23';
const canary = 0xd9237ab1;

async function call(world, id, args, expectedMemory, error, initialize = () => {}) {
  const script = kcsProgram([
    [37, canary],
    ...args.map((word) => [37, word]),
    [43, id, args.length * 4],
    [59],
  ]);
  const task = { ...world.main, io: null };
  const machine = (task.machine = new KCSMachine(await readKCS(script), {
    native: (number, supplied, caller) =>
      world.runtime.scheduler.native(task, number, supplied, caller),
  }));
  const floor = machine.sp;
  for (const address of [124, 128, 132, 136, 140]) machine.store(address, canary);
  initialize(machine);
  const executed = world.runtime.scheduler.execute(task);
  if (error) await assert.rejects(executed, error);
  else {
    assert.equal((await executed).status, 'halted');
    assert.equal(machine.sp, floor + 4);
    assert.equal(machine.pop(), canary);
  }
  assert.deepEqual(
    [124, 128, 132, 136, 140].map((address) => machine.load(address)),
    [canary, ...expectedMemory, canary],
  );
}

test('fixed 2.6.1.23 Plane GCALLs read owned geometry and texture poses and release tracked input', async () => {
  const world = await dataWorld(profile);
  try {
    const worldID = await world.objects.create({ kind: 2, parent: world.root }),
      target = world.nativeTaskID(worldID),
      plane = world.graphics.get(worldID),
      send = (id, w, l, payload) =>
        world.sendNativeEngine(target, world.main.id, id, w, l, payload ? { payload } : {});
    const noWrites = [canary, canary, canary];
    await call(world, 86, [0, 0x89fffffc, 132, 0], noWrites);
    await call(world, 87, [0, 128, 132, 136, 0], noWrites);
    await call(world, 86, [target, 128, 132, 0], noWrites, /initialized 32-bit output word/);
    await call(
      world,
      87,
      [0x89fffffc, 128, 132, 136, 0],
      noWrites,
      /initialized 32-bit output word/,
    );
    await send(
      41,
      0,
      0,
      new NativeGraphicsPacket([0, 0, 0, floatBits(37), floatBits(29), 0, 0, 0xff774411]),
    );
    const base = [12.75, -16.25, 13],
      textureBase = [-0, 0.75, 33],
      position = [30.5, 16.25, -3.25],
      texturePosition = [5, 21, 44];
    setMotionVector(plane.graph.kx2, MOTION_ABI.base, base);
    setMotionVector(plane.graph.kx2, MOTION_ABI.pos, position);
    setMotionVector(plane.graph.textureTransform, MOTION_ABI.base, textureBase);
    setMotionVector(plane.graph.textureTransform, MOTION_ABI.pos, texturePosition);
    await call(world, 86, [target, 128, 132, 0], [...base.slice(0, 2).map(floatBits), canary]);
    await call(
      world,
      86,
      [target, 128, 132, 1],
      [...textureBase.slice(0, 2).map(floatBits), canary],
    );
    await call(world, 87, [target, 128, 132, 136, 0], position.map(floatBits));
    await call(world, 87, [target, 128, 132, 136, 0x80000000], texturePosition.map(floatBits));
    await call(world, 87, [target, 128, 128, 128, 0], [floatBits(position[2]), canary, canary]);
    await call(world, 87, [target, 128, 0xffffffff, 136, 0], noWrites, /KCS memory ffffffff/);
    await call(world, 87, [target, 128], noWrites, /expects 5 arguments/);

    await send(89, world.nativeTaskID(world.main.id), 0x74);
    assert.ok(plane.input.get(worldID));
    assert.equal(plane.state.inputTracksGraph, true);
    await call(world, 83, [0], noWrites);
    assert.ok(plane.graph);
    assert.ok(plane.input.get(worldID));
    await call(world, 83, [target], noWrites);
    assert.equal(plane.graph, null);
    assert.deepEqual(plane.state.rect, [0, 0, 0, 0]);
    assert.equal(plane.state.receiver, -1);
    assert.equal(plane.state.inputTracksGraph, false);
    assert.equal(plane.state.changed, 1);
    assert.equal(plane.input.get(worldID), null);
    assert.equal(world.graphics.stage.planes[plane.stageKey], undefined);
    await call(world, 83, [target], noWrites);
    await call(world, 87, [target, 128, 132, 136, 0], noWrites, /initialized 32-bit output word/);
  } finally {
    await world.close({ flushFiles: false });
  }
});

test('fixed 2.6.1.23 Plane history configures and shifts before the next draw', async () => {
  const world = await dataWorld(profile);
  try {
    const worldID = await world.objects.create({ kind: 2, parent: world.root }),
      target = world.nativeTaskID(worldID),
      plane = world.graphics.get(worldID),
      send = (id, w, l, payload) =>
        world.sendNativeEngine(target, world.main.id, id, w, l, payload ? { payload } : {}),
      noWrites = Array(3).fill(canary),
      configure = (count, mode = 0, stride = 2) => [
        target,
        count,
        stride,
        ...[3.125, -2.25, 7.5].map(floatBits),
        17,
        ...[0.5, 0.625, 0.875].map(floatBits),
        mode,
        3,
      ];
    await call(world, 398, configure(2), noWrites);
    assert.equal(plane.state.trail, null);

    world.graphics.createLogicalDevice();
    await send(
      42,
      0,
      0,
      new NativeGraphicsPacket([0, 0, 0, floatBits(41), floatBits(19), 0, 0, 0xfedd12cc]),
    );
    setMotionVector(plane.graph.kx2, MOTION_ABI.base, [11.125, 4.125, 5064]);
    setMotionVector(plane.graph.kx2, MOTION_ABI.pos, [66.75, 18.125, -2.375]);
    setMotionVector(plane.graph.kx2, MOTION_ABI.scale, [1, 2, 0.5]);
    await send(47, 0, 1);

    for (const [mode, requestedStride, actualStride] of [
      [0, 2, 2],
      [1, 4, 2],
      [2, 3, 1],
      [3, 3, 1],
      [4, 2, 1],
      [5, 2, 1],
      [6, 2, 2],
    ]) {
      await call(world, 398, configure(2, mode, requestedStride), noWrites);
      const history = plane.state.trail;
      assert.equal(history.stride, actualStride);
      assert.equal(history.history.length, 2 * actualStride + 1);
      const first = new DataView(history.history[0].buffer);
      assert.deepEqual(
        [24, 40, 56].map((offset) => first.getUint32(offset, true)),
        Array(3).fill(0x3f800000),
      );
      assert.equal(first.getUint32(8, true), 1);
      const second = new DataView(history.history[1].buffer);
      assert.equal(second.getFloat32(28, true), 63.625);
      const graphs = history.graphs.map(({ nativeID }) => nativeID);
      await call(world, 398, configure(0), noWrites);
      assert.equal(plane.state.trail, null);
      assert(graphs.every((id) => !world.graphics.graphs.has(id)));
    }

    await call(world, 398, configure(2, 0, 1), noWrites);
    const history = plane.state.trail,
      previous = history.graphs.map(({ kx2 }) => kx2.slice());
    await call(world, 398, configure(0x40000000, 0, 4), noWrites, /history exceeds/);
    assert.equal(plane.state.trail, history);
    const matrix = Array.from({ length: 16 }, (_, i) => floatBits(Number(i % 5 === 0)));
    matrix[3] = 0xff801234;
    await call(
      world,
      399,
      [target, 256, 272, 272, 320, 0x88443322, 0x80000005],
      noWrites,
      undefined,
      (machine) => {
        [floatBits(2.75), 0xff801234, 0x80000000].forEach((word, i) =>
          machine.store(256 + i * 4, word),
        );
        [floatBits(11.125), floatBits(71.5), floatBits(-7)].forEach((word, i) =>
          machine.store(272 + i * 4, word),
        );
        matrix.forEach((word, i) => machine.store(320 + i * 4, word));
      },
    );
    const head = new DataView(history.history[0].buffer);
    assert.equal(head.getUint32(8, true), 0x80000005);
    assert.equal(head.getUint32(16, true), 0xffc01234);
    assert.equal(head.getUint32(72, true), 0xff801234);
    assert.equal(head.getUint32(124, true), 0x88443322);
    assert.deepEqual(
      history.graphs.map(({ kx2 }) => kx2),
      previous,
    );
    plane.drawTick();
    assert.notDeepEqual(
      history.graphs.map(({ kx2 }) => kx2),
      previous,
    );
  } finally {
    await world.close({ flushFiles: false });
  }
});

test('fixed 2.6.1.23 tiled Plane keeps registered owners and declines undefined parent bounds', async () => {
  const world = await dataWorld(profile);
  try {
    const id = await world.objects.create({ kind: 2, parent: world.root }),
      owner = world.graphics.get(id),
      target = world.nativeTaskID(id),
      memory = Array(3).fill(canary),
      width = 7.625,
      height = 3.8125,
      grid = [floatBits(width), floatBits(height), 2, 3],
      send = (message, w, l, payload) =>
        world.sendNativeEngine(target, world.main.id, message, w, l, payload ? { payload } : {});
    await call(world, 433, [0, ...grid], memory);
    await call(world, 433, [0xffffffff, ...grid], memory);
    await call(world, 433, [target, ...grid], memory);
    assert.equal(owner.graph, null);

    world.graphics.createLogicalDevice();
    await send(84, 0, 2);
    await call(world, 433, [target, ...grid], memory);
    assert.equal(owner.graph, null);
    await send(84, 0, 1);
    await send(41, 0, 0, new NativeGraphicsPacket([0, 0, 0, ...grid.slice(0, 2), 32, 1, 0]));
    const populated = owner.graph;
    await call(world, 433, [target, ...grid], memory);
    assert.equal(owner.graph, populated);
    assert.deepEqual(world.objects.children(owner.record), []);
    await call(world, 83, [target], memory);

    await call(world, 433, [target, ...grid], memory);
    const tiled = owner.graph,
      children = world.objects.children(owner.record);
    assert.equal(tiled.type, 5);
    assert.equal(owner.state.drawType, 8);
    assert.equal(children.length, 6);
    assert.deepEqual(owner.state.shapeWords, [0, 0, 0, ...grid.slice(0, 2), ...Array(3), 2, 3]);
    for (const [index, child] of children.entries()) {
      assert.equal(child.kind, 2);
      assert.equal(child.name, 'ptn plane');
      assert.equal(child.parent, id);
      const plane = world.graphics.get(child.id),
        expected = [(index % 2) * width, Math.floor(index / 2) * height, 0];
      assert.equal(plane.graph.type, 1);
      assert.deepEqual([plane.graph.width, plane.graph.height], [width, height]);
      assert.deepEqual(plane.state.parentOffset, expected);
      assert.deepEqual(motionVector(plane.graph.kx2, MOTION_ABI.base), [
        0 - expected[0],
        0 - expected[1],
        5000,
      ]);
    }
    await call(world, 433, [target, floatBits(1), floatBits(2), 1, 1], memory);
    assert.equal(owner.graph, tiled);
    assert.deepEqual(world.objects.children(owner.record), children);

    const fault = /Native tiled parent geometry bounds are undefined/;
    await call(world, 343, [target, 128, 132], memory, fault);
    await call(world, 345, [target, 128, 132, 136, 140], memory, fault);
    await assert.rejects(send(89, world.nativeTaskID(world.main.id), 0x74), fault);
    assert.equal(owner.state.inputTracksGraph, false);
    assert.equal(owner.input.get(id), null);
    const images = new FESImages(world, { cacheFor() {}, lookup() {} }),
      request = { parentPlaneID: target };
    assert.throws(() => images.plane({ runtimeID: world.main.id }, request), fault);
    assert.equal(images.scratch.has(request), false);

    const child = children[1];
    await call(
      world,
      343,
      [child.nativeID, 128, 132],
      [floatBits(width), floatBits(height), canary],
    );
    assert.equal(
      images.plane({ runtimeID: world.main.id }, { parentPlaneID: child.nativeID }).width,
      7,
    );
    await world.objects.release(id);
    assert(children.every((child) => !world.objects.objects.has(child.id)));
  } finally {
    await world.close({ flushFiles: false });
  }
});

test('fixed 2.6.1.23 Plane KX3 sends CP932 and leaves verified recipients unchanged', async () => {
  const world = await dataWorld(profile);
  try {
    const plane = await world.objects.create({ kind: 2, parent: world.root }),
      base = await world.objects.create({ kind: 6, parent: world.root }),
      target = world.nativeTaskID(plane),
      baseTarget = world.nativeTaskID(base),
      send = world.sendNativeEngine.bind(world),
      memory = Array(3).fill(canary),
      trace = [];
    await send(target, world.main.id, 41, 0, 0, {
      payload: new NativeGraphicsPacket([0, 0, 0, floatBits(37), floatBits(29), 32, 1, 0]),
    });
    const registered = world.graphics.get(plane).graph,
      pose = registered.kx2.slice();
    world.game.nativeResources = {
      entries: [{ name: 'KX3', directory: 'models', archive: 'different.int', extension: 'kx3' }],
    };
    world.sendNativeEngine = (id, sender, message, w, l, context) => {
      if (message === 71) {
        const filename = [];
        for (let i = 0; ; i++) {
          const byte = context.payload.bytes(i, 1)[0];
          filename.push(byte);
          if (byte === 0) break;
        }
        trace.push({ id, w, filename });
      }
      return send(id, sender, message, w, l, context);
    };

    for (const [id, name, expected, formatAt = 256] of [
      [target, '表情', 'models/表情.kx3', 0x80000040],
      [baseTarget, 'mark.表', 'models/mark.表.kx3'],
      [target, 'mix-%%-01', 'models/mix-%-01.kx3'],
      [target, '/root', 'models//root.kx3'],
      [target, '', 'models/.kx3'],
      [0x83f0, 'parts/顔', 'parts/顔'],
    ]) {
      const selector = 0x88fe7311;
      await call(world, 346, [id, formatAt, selector], memory, undefined, (machine) =>
        machine.bytes(formatAt, encodeCP932(name).length + 1).set(encodeCP932(name + '\0')),
      );
      assert.deepEqual(trace.pop(), {
        id,
        w: selector,
        filename: [...encodeCP932(expected + '\0')],
      });
    }
    const retained = world.planeModelCommands.snapshot();
    world.planeModelCommands.restore(structuredClone(retained));
    world.game.nativeResources.entries = [];
    await call(world, 346, [target, 256, 7], memory, undefined, (machine) =>
      machine.bytes(256, 5).set(encodeCP932('next\0')),
    );
    assert.deepEqual(trace.pop(), { id: target, w: 7, filename: [...encodeCP932('parts/顔\0')] });
    await call(world, 346, [0, 0xffffffff, 7], memory);
    await call(
      world,
      346,
      [world.nativeTaskID(world.main.id), 0xffffffff, 7],
      memory,
      /requires a Plane or BasePlane/,
    );
    assert.deepEqual(trace, []);
    assert.equal(world.graphics.get(plane).graph, registered);
    assert.deepEqual(registered.kx2, pose);
    for (const [id, handled] of [
      [target, true],
      [baseTarget, false],
    ]) {
      const payload = { bytes: () => assert.fail('The original receiver ignores the payload') };
      assert.deepEqual(
        await world.engineMessages.dispatchNative(world.main.id, id, 71, 113, 0xffffffff, {
          payload,
        }),
        { routed: true, handled, result: NATIVE_UNWRITTEN_WORD },
      );
    }
  } finally {
    await world.close({ flushFiles: false });
  }
});

test('fixed 2.6.1.23 Plane input preserves installed geometry and the raw source word', async () => {
  const world = await dataWorld(profile);
  try {
    const id = await world.objects.create({ kind: 2, parent: world.root }),
      baseID = await world.objects.create({ kind: 6, parent: world.root }),
      target = world.nativeTaskID(id),
      base = world.nativeTaskID(baseID),
      plane = world.graphics.get(id),
      memory = Array(3).fill(canary),
      flags = 0x8012ab73,
      replacement = 0x00004455;
    await call(world, 95, [0, flags], memory);
    await call(world, 95, [0x1234abc, flags], memory);
    await call(world, 95, [target, flags], memory, /requires a live graphics device/);
    world.graphics.createLogicalDevice();
    await call(world, 95, [target, flags], memory, /input geometry is unreviewed/);
    world.graphics.view.configure({ virtualWidth: 64, virtualHeight: 48 });
    await world.sendNativeEngine(target, world.main.id, 41, 0, 0, {
      payload: new NativeGraphicsPacket([0, 0, 0, floatBits(64), floatBits(48), 32, 1, 0]),
    });
    setMotionVector(plane.graph.kx2, MOTION_ABI.base, [0, 0, 12.875]);
    await call(world, 95, [target, flags], memory);
    const region = plane.input.get(id);
    assert.deepEqual(region.bounds, [-100000, -100000, 100000, 100000]);
    assert.equal(region.priority, 12);
    assert.equal(region.flags, flags);
    assert.equal(region.mask, 7);
    assert.equal(plane.state.bindFlags, flags);
    assert.equal(plane.state.bindExtra, flags);
    await call(world, 95, [target, replacement], memory);
    assert.equal(plane.input.get(id), region);
    assert.equal(region.flags, flags);
    assert.equal(plane.state.bindFlags, flags);
    assert.equal(plane.state.bindExtra, replacement);

    const query = await readKCS(
      kcsProgram([
        [37, canary],
        [37, target],
        [43, 109, 4],
        [37, base],
        [43, 109, 4],
        [37, 0x1234abc],
        [43, 109, 4],
        [59],
      ]),
    );
    for (const source of [0, 2, 16, 0x80000001, 0xffffffff]) {
      const task = { ...world.main, io: null };
      const machine = (task.machine = new KCSMachine(query, {
        native: (native, args, caller) =>
          world.runtime.scheduler.native(task, native, args, caller),
      }));
      plane.input.source = source;
      await world.runtime.scheduler.execute(task);
      assert.equal(machine.sp, machine.floor + 16);
      assert.deepEqual(
        [0, 4, 8, 12].map((at) => machine.load(machine.floor + at)),
        [canary, source, source, 0],
      );
    }
    await call(world, 109, [0], memory, /requires a verified receiver/);
    await call(
      world,
      109,
      [world.nativeTaskID(world.main.id)],
      memory,
      /requires a verified receiver/,
    );
    await call(world, 83, [target], memory);
    assert.equal(plane.input.get(id), null);
  } finally {
    await world.close({ flushFiles: false });
  }
});
