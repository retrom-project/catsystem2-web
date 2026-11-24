// SPDX-License-Identifier: MPL-2.0
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { floatBits } from '../src/kcs.mjs';
import { MOTION_ABI } from '../src/motion/abi.mjs';
import { NativeGraphicsPacket } from '../src/native/graphics-task.mjs';
import { dataWorld } from './fixtures/data-world.mjs';
import { kcsProgram } from './helpers.mjs';

const profile = 'sdk-4.01-engine-2.6.1.74';
const canary = 0xb5178731;
const coordinates = [64, 68, 72];
const resultPosition = 76;
const calls = [
  [80, 1],
  [83, 1],
  [86, 4],
  [87, 5],
  [89, 1],
  [91, 1],
  [94, 2],
  [99, 1],
  [102, 2],
  [103, 2],
  [109, 1],
  [110, 2],
];

async function planeWorld(t) {
  const argumentAddress = (i) => 128 + i * 4;
  const file = (id) => `plane-gcall-${id}.kcs`;
  const files = Object.fromEntries(
    calls.map(([id, count]) => [
      file(id),
      kcsProgram([
        [37, canary],
        ...Array.from({ length: count }, (_, i) => [37, [0x13, argumentAddress(i)]]),
        [43, id, count * 4],
        ...([89, 109].includes(id) ? [[38, resultPosition]] : []),
        [59],
      ]),
    ]),
  );
  const world = await dataWorld(profile, files);
  t.after(() => world.close({ flushFiles: false }));
  const device = world.graphics.createLogicalDevice();
  const plane = async (kind = 2) => {
    const id = await world.objects.create({ kind, parent: world.root });
    return { id, target: world.nativeTaskID(id), owner: world.graphics.get(id) };
  };
  const call = async (id, args, error) => {
    const task = await world.spawnScript(file(id), {
      parent: world.main.id,
      initialExecute: false,
    });
    const { machine } = task;
    for (const at of [...coordinates, resultPosition]) machine.store(at, canary);
    args.forEach((word, i) => machine.store(argumentAddress(i), word));
    const floor = machine.sp;
    const executed = world.runtime.scheduler.execute(task);
    if (error) await assert.rejects(executed, error);
    else assert.equal((await executed).status, 'halted');
    assert.equal(machine.sp, floor + 4);
    assert.equal(machine.pop(), canary);
    return {
      coordinates: coordinates.map((at) => machine.load(at)),
      result: machine.load(resultPosition),
    };
  };
  const draw = (target) =>
    world.sendNativeEngine(target, world.main.id, 41, 0, 0, {
      payload: new NativeGraphicsPacket([0, 0, 0, floatBits(24), floatBits(36), 32, 1, 0xffffffff]),
    });
  const send = (target, cmd, w, l, payload) =>
    world.sendNativeEngine(target, world.main.id, cmd, w, l, payload ? { payload } : {});
  return { world, plane, draw, call, send, device };
}

function pose(buffer, offset, words) {
  const view = new DataView(buffer.buffer, buffer.byteOffset, buffer.byteLength);
  words.forEach((word, i) => view.setUint32(offset + i * 4, word, true));
}

test('fixed SDK KCS Plane getters preserve the two renderer poses and output alias order', async (t) => {
  const { plane, draw, call, device } = await planeWorld(t);
  const { target, owner } = await plane();
  const unchanged = [canary, canary, canary];
  assert.deepEqual((await call(86, [0, 0x80000000, 68, 1])).coordinates, unchanged);
  assert.deepEqual((await call(89, [0])).result, 0);
  assert.deepEqual(
    (await call(87, [target, 64, 68, 72, 1], /initialized 32-bit output word/)).coordinates,
    unchanged,
  );
  await draw(target);
  const base = [floatBits(-5.25), 0x80000000, 0x7fa12456];
  const texBase = [floatBits(21.25), floatBits(-3.75), floatBits(15.5)];
  const pos = [floatBits(4.25), floatBits(-0.25), floatBits(17.5)];
  const texPos = [floatBits(201.5), floatBits(2.75), floatBits(-128.5)];
  pose(owner.graph.kx2, MOTION_ABI.base, base);
  pose(owner.graph.kx2, MOTION_ABI.pos, pos);
  pose(owner.graph.textureTransform, MOTION_ABI.base, texBase);
  pose(owner.graph.textureTransform, MOTION_ABI.pos, texPos);
  assert.deepEqual((await call(86, [target, 64, 68, 0])).coordinates, [
    ...base.slice(0, 2),
    canary,
  ]);
  assert.deepEqual((await call(86, [target, 64, 64, 1])).coordinates, [texBase[1], canary, canary]);
  assert.deepEqual((await call(87, [target, 64, 68, 72, 0])).coordinates, pos);
  assert.deepEqual((await call(87, [target, 64, 68, 72, 0x80000000])).coordinates, texPos);
  assert.deepEqual((await call(87, [target, 64, 64, 64, 0])).coordinates, [pos[2], canary, canary]);
  assert.equal((await call(89, [target])).result, base[2]);
  assert.deepEqual(
    (await call(87, [target, 64, 0xffffffff, 72, 1], /KCS memory ffffffff/)).coordinates,
    unchanged,
  );
  device.retire();
  assert.deepEqual(
    (await call(87, [target, 64, 68, 72, 1], /initialized 32-bit output word/)).coordinates,
    unchanged,
  );
});

test('fixed SDK KCS Plane release, tracked Input reset and alpha use the original graph ownership', async (t) => {
  const { world, plane, draw, call, send } = await planeWorld(t);
  const { id, target, owner } = await plane();
  assert.equal(owner.state.colorOverride, 0);
  await call(94, [target, 0x7fffffff]);
  assert.equal(owner.state.colorOverride, 0);
  await draw(target);
  const graphView = new DataView(owner.graph.kx2.buffer);
  graphView.setUint32(MOTION_ABI.color, 0xd0345678, true);
  for (const [argument, expected] of [
    [0x80000000, 0x00345678],
    [133, 0x85345678],
    [255, 0xff345678],
    [256, 0xff345678],
  ]) {
    assert.equal((await call(94, [target, argument])).result, canary);
    assert.equal(graphView.getUint32(MOTION_ABI.color, true), expected);
  }
  assert.equal(owner.state.colorOverride, 1);

  await send(target, 89, 0, 157);
  assert.ok(owner.input.get(id));
  assert.equal(owner.state.inputTracksGraph, true);
  await call(80, [target]);
  assert.equal(owner.graph.type, 5);
  assert.equal(owner.graph.triangles.length, 0);
  assert.ok(owner.input.get(id));
  await call(83, [target]);
  assert.equal(owner.graph, null);
  assert.equal(owner.input.get(id), null);
  assert.equal(owner.state.inputTracksGraph, false);
  assert.deepEqual(owner.state.rect, [0, 0, 0, 0]);
  assert.equal(world.graphics.stage.planes[owner.stageKey], undefined);
  await draw(target);
  const formerMode = owner.state.drawType;
  owner.state.vramType = 2;
  await call(80, [target]);
  assert.equal(owner.graph, null);
  assert.equal(owner.state.drawType, formerMode);
});

test('fixed SDK BasePlane owners preserve the source conversion, receiver and selector messages', async (t) => {
  const { world, plane, draw, call, send } = await planeWorld(t);
  const { id, target, owner } = await plane();
  const base = await plane(6);
  const other = await plane();
  await draw(other.target);
  assert.equal(other.owner.state.shown, true);
  await call(102, [target, other.target]);
  assert.equal(owner.state.imageIndex, other.target);
  assert.equal(other.owner.state.shown, false);
  await call(103, [target, 0xf121abcd]);
  assert.equal(owner.state.frameStep, 0xf121abcd);

  for (const [machineTarget, graphic] of [
    [target, owner],
    [base.target, base.owner],
  ]) {
    graphic.state.inheritPosition = true;
    await call(91, [machineTarget]);
    assert.equal(graphic.state.inheritPosition, false);
    for (const [source, result] of [
      [0, 0],
      [1, 1],
      [16, 2],
      [0x12340161, 0x12340161],
    ]) {
      world.input.source = source;
      assert.equal((await call(109, [machineTarget])).result, result);
    }
    await call(110, [machineTarget, 0x8234fedc]);
    assert.equal(graphic.state.receiver >>> 0, 0x8234fedc);
    await call(110, [machineTarget, 0xffffffff]);
    assert.equal(graphic.state.receiver, -1);
  }
  assert.equal((await call(109, [0x1234ffff])).result, 0);
  await draw(target);
  await send(target, 89, 0, 0x234);
  assert.ok(owner.input.get(id));
  await call(99, [target]);
  assert.equal(owner.input.get(id), null);
  assert.equal(owner.state.receiver, -1);
  await send(base.target, 89, 0, 0, new NativeGraphicsPacket([2, 3, 4, 5, 0, 8]));
  assert.ok(base.owner.input.get(base.id));
  await call(99, [base.target]);
  assert.equal(base.owner.input.get(base.id), null);
  assert.equal(base.owner.state.receiver, -1);
});
