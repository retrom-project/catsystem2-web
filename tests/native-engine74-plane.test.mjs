// SPDX-License-Identifier: MPL-2.0
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { floatBits } from '../src/kcs.mjs';
import { MOTION_ABI, motionVector, setMotionVector } from '../src/motion/abi.mjs';
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
  [96, 3],
  [97, 2],
  [98, 1],
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
        ...([89, 98, 109].includes(id) ? [[38, resultPosition]] : []),
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
  const call = async (id, args, error, prepare) => {
    const task = await world.spawnScript(file(id), {
      parent: world.main.id,
      initialExecute: false,
    });
    const { machine } = task;
    for (const at of [...coordinates, resultPosition]) machine.store(at, canary);
    args.forEach((word, i) => machine.store(argumentAddress(i), word));
    prepare?.(machine);
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

test('fixed SDK Plane buttons copy owned rows and select the texture pose through real KCS and Input', async (t) => {
  const { world, plane, call, device } = await planeWorld(t);
  const { id, target, owner } = await plane();
  const hint = await plane();
  owner.makeGraph({ type: 1, width: 26, height: 84 });
  hint.owner.makeGraph({ type: 2, width: 110.75, height: 18.875 });
  world.graphics.view.configure({ virtualWidth: 1280, virtualHeight: 720, clientWidth: 1024 });
  setMotionVector(owner.graph.kx2, MOTION_ABI.base, [0, 0, -15.75]);
  setMotionVector(owner.graph.kx2, MOTION_ABI.pos, [992, 4, 9]);
  setMotionVector(owner.graph.textureTransform, MOTION_ABI.pos, [170, 200, -25.5]);
  const geometry = () => motionVector(owner.graph.kx2, MOTION_ABI.pos);
  const texture = () => motionVector(owner.graph.textureTransform, MOTION_ABI.pos);
  const rows = [1, -31, 9, 1, 7, 33, 1, 9, 11, 1, 888, -13];
  const load = (address, flags, values = rows) =>
    call(96, [target, flags, address], undefined, (machine) =>
      values.forEach((word, i) => machine.store(address + i * 4, word >>> 0)),
    );
  const read = async (phase) => assert.equal((await call(98, [target])).result, phase);
  const select = async (selection) =>
    assert.equal((await call(97, [target, selection])).result, canary);

  await call(102, [target, hint.target]);
  assert.equal(hint.owner.state.shown, false);
  await load(0x80000041, 0x88112273);
  const input = owner.input.get(id);
  assert.deepEqual(input.bounds, [992, 4, 1018, 88]);
  assert.equal(input.priority | 0, -15);
  assert.equal(owner.state.inputTracksGraph, true);
  assert.deepEqual(
    owner.state.button,
    rows.map((word) => word >>> 0),
  );
  assert.deepEqual(texture(), [-31, 9, -25.5]);
  assert.deepEqual(geometry(), [992, 4, 9]);
  await read(0);

  await select(0x80000001);
  assert.equal(hint.owner.state.shown, true);
  assert.deepEqual(motionVector(hint.owner.graph.kx2, MOTION_ABI.pos), [914, 88, 0]);
  await read(0x80000001);
  assert.deepEqual(texture(), [7, 33, -25.5]);
  await select(3);
  assert.equal(hint.owner.state.shown, false);
  await select(0x888e32a0);
  await read(0x80000003);
  assert.deepEqual(texture(), [888, -13, -25.5]);

  await call(103, [target, 0]);
  await load(65, 0x912343fe);
  assert.equal(owner.state.buttonFlags, 0x912343fe);
  assert.equal(owner.input.get(id), input);
  assert.deepEqual(input.bounds, [992, 4, 1018, 88]);
  await select(0);
  owner.input.pointer(1003, 22);
  await owner.input.hover();
  await read(1);
  assert.equal(hint.owner.state.shown, false);
  await owner.input.route(7, true, 2);
  await read(2);
  await owner.input.route(7, false, 2);
  await read(1);
  assert.deepEqual(texture(), [7, 33, -25.5]);
  assert.deepEqual(geometry(), [992, 4, 9]);
  await select(0x80000001);
  await owner.input.route(7, true, 2);
  await read(0x80000001);
  device.retire();
  await select(2);
  await read(2);
  assert.deepEqual(texture(), [7, 33, -25.5]);
});

test('fixed SDK Plane button registration honors full virtual hit rectangles and native input boundaries', async (t) => {
  const { world, plane, call } = await planeWorld(t);
  const { id, target, owner } = await plane();
  const rows = [0, -31, 9, 0, 7, 33, 0, 0, 0, 1, 888, -13];
  await call(96, [0, 0x88112273, 0xffffffff]);
  await call(97, [0, 0xffffffff]);
  assert.equal((await call(98, [0])).result, 0);
  await call(98, [0x82113417], /initialized 32-bit output word/);
  await call(96, [target, 0x88112273, 0xffffffff], /KCS memory/);
  await call(96, [target, 0, 65], /requires live model geometry/);
  assert.equal(owner.input.get(id), null);
  assert.equal((await call(98, [target])).result, 0);
  world.graphics.view.configure({ virtualWidth: 640, virtualHeight: 480 });
  owner.makeGraph({ type: 2, width: 642, height: 482 });
  setMotionVector(owner.graph.kx2, MOTION_ABI.base, [5.25, 7.25, -117.75]);
  setMotionVector(owner.graph.kx2, MOTION_ABI.pos, [4, 5.75, 3.75]);
  await call(96, [target, 0, 65], undefined, (machine) =>
    rows.forEach((word, i) => machine.store(65 + i * 4, word >>> 0)),
  );
  assert.deepEqual(owner.input.get(id).bounds, [-100000, -100000, 100000, 100000]);
  await call(97, [target, 0x80000002]);
  assert.equal((await call(98, [target])).result, 0x80000000);
  await call(83, [target]);
  assert.equal(owner.input.get(id), null);
});
