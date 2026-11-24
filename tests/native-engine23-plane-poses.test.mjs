// SPDX-License-Identifier: MPL-2.0
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { KCSMachine, floatBits, readKCS } from '../src/kcs.mjs';
import { MOTION_ABI, setMotionVector } from '../src/motion/abi.mjs';
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
