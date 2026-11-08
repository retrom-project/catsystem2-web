// SPDX-License-Identifier: MPL-2.0
import test from 'node:test';
import assert from 'node:assert/strict';
import { Binary } from '../src/binary.mjs';
import { floatBits, bitsFloat } from '../src/kcs.mjs';
import {
  MOTION_ABI,
  initialMotionObject,
  motionVector,
  setMotionVector,
} from '../src/motion/abi.mjs';
import { MotionInstance } from '../src/motion/instance.mjs';
import { MotionManager } from '../src/motion/manager.mjs';
import { u32 } from './helpers.mjs';
import { motionDefinition, motionRegisters } from '../src/motion/definitions.mjs';
import { evaluate } from '../src/fes/expression.mjs';
import { MotionTarget, objectMotionState, applyObjectMotionState } from '../src/motion/target.mjs';

const profile = 'nekopara-vol3-engine-2.6.1.76';
const shared = (offset) => 0x80000000 + offset;
function program(instructions, name = 'public-motion', dataSize = 16) {
  const bytes = new Uint8Array(
    instructions.flatMap(([opcode, ...args]) => [
      opcode,
      ...args.flatMap((arg) => [
        Array.isArray(arg) ? arg[0] : 3,
        ...u32(Array.isArray(arg) ? arg[1] : arg),
      ]),
    ]),
  );
  return {
    name,
    body: new Binary(bytes),
    codeSize: bytes.length,
    data: new Uint8Array(dataSize),
    stackSize: 1024,
  };
}
const load = (offset) => [0x13, shared(offset)];

test('MOT context uses the recovered 0x90 KX2 layout and native constructor defaults', () => {
  const object = initialMotionObject(),
    view = new DataView(object.buffer);
  assert.equal(object.length, 0x90);
  assert.deepEqual(motionVector(object, MOTION_ABI.vram), [0, 0, 0]);
  assert.deepEqual(motionVector(object, MOTION_ABI.scale), [1, 1, 1]);
  assert.deepEqual(
    Array.from({ length: 16 }, (_, i) => view.getFloat32(0x24 + i * 4, true)),
    [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1],
  );
  assert.equal(view.getUint32(0x70, true), 0xffffffff);
  assert.equal(view.getInt32(0x8c, true), 1);
});

test('MOT restarts PC each update while retaining script data and the heap', () => {
  const script = program([
    [22, [0x13, 0]],
    [21, load(0), [0x13, 0]],
    [21, load(4), load(MOTION_ABI.frame)],
    [59],
  ]);
  const motion = new MotionInstance(script, { profile });
  const allocation = motion.machine.allocate(4);
  motion.machine.store(allocation, 77);
  motion.update(2);
  assert.equal(motion.view.getUint32(0, true), 1);
  assert.equal(motion.view.getUint32(4, true), 2);
  motion.update(5);
  assert.equal(motion.view.getUint32(0, true), 2);
  assert.equal(motion.view.getUint32(4, true), 5);
  assert.equal(motion.machine.load(allocation), 77);
});

test('MOT delayed starts, skip flags and final-pass context restoration match native lifecycle', () => {
  const script = program([
    [21, load(0), load(MOTION_ABI.frame)],
    [21, load(4), load(MOTION_ABI.skip)],
    [59],
  ]);
  const motion = new MotionInstance(script, { profile, delay: 3 });
  assert.equal(motion.update(2).delayed, true);
  assert.equal(motion.calls.size, 0);
  motion.update(4);
  assert.equal(motion.frame, 1);
  motion.finish();
  assert.equal(motion.view.getInt32(0, true), -1);
  assert.equal(motion.view.getInt32(4, true), 1);
  assert.equal(motion.frame, 1);
  assert.equal(motion.skip, false);
  assert.equal(motion.active, true);
  motion.setSkip();
  motion.update(0);
  assert.equal(motion.frame, -3);
});

test('MOT exit deactivates a record without automatically removing or suppressing future updates', () => {
  const script = program([[22, [0x13, 0]], [21, load(0), [0x13, 0]], [43, 38, 0], [59]]);
  const motion = new MotionInstance(script, { profile });
  assert.equal(motion.update(0).status, 'yielded');
  assert.equal(motion.active, false);
  motion.update(1);
  assert.equal(motion.view.getUint32(0, true), 2);
});

test('MOT initialization registers and extra data are actual VM memory, preserved through checkpoints', () => {
  const script = program([[21, load(0), load(MOTION_ABI.registers)], [59]]);
  const motion = new MotionInstance(script, {
    profile,
    registers: [1.25],
    extra: new Uint8Array([1, 2, 3]),
  });
  motion.update(0);
  assert.equal(bitsFloat(motion.view.getUint32(0, true)), 1.25);
  const saved = motion.snapshot();
  const restored = new MotionInstance(script, { profile });
  restored.restore(saved);
  const address = restored.view.getUint32(MOTION_ABI.extraData, true);
  assert.deepEqual([...restored.machine.bytes(address, 3)], [1, 2, 3]);
  assert.equal(restored.view.getUint32(MOTION_ABI.extraSize, true), 3);
  assert.deepEqual(restored.snapshot().shared, saved.shared);
});

test('MOT math natives execute float32 results and reject unknown or mismatched native contracts', () => {
  const args = [10, 30, 0, 4, 1].map((value) => [37, floatBits(value)]);
  const script = program([...args, [43, 41, 20], [38, [3, shared(0)]], [59]]);
  const motion = new MotionInstance(script, { profile });
  motion.update(0);
  assert.equal(bitsFloat(motion.view.getUint32(0, true)), 15);
  assert.throws(
    () => new MotionInstance(program([[43, 45, 0], [59]]), { profile }).update(0),
    /Unrecovered MOT native/,
  );
  assert.throws(
    () => new MotionInstance(program([[43, 41, 0], [59]]), { profile }).update(0),
    /expects 5 arguments/,
  );
});

function changePosition(operation, value, name) {
  return program(
    [
      [operation, [0x17, shared(MOTION_ABI.pos)], [7, floatBits(value)]],
      [38, [3, shared(MOTION_ABI.pos)]],
      [59],
    ],
    name,
  );
}
test('MOT manager rebuilds from base and composes records in increasing handle order', () => {
  const base = initialMotionObject();
  setMotionVector(base, MOTION_ABI.pos, [100, 0, 0]);
  const manager = new MotionManager({ profile, base });
  const first = manager.add(changePosition(1, 10, 'add'), { group: 'first' });
  manager.add(changePosition(3, 2, 'multiply'), { group: 'second' });
  assert.deepEqual(motionVector(manager.update(10), MOTION_ABI.pos), [220, 0, 0]);
  assert.deepEqual(motionVector(manager.update(11), MOTION_ABI.pos), [220, 0, 0]);
  manager.remove(first);
  assert.deepEqual(motionVector(manager.update(12), MOTION_ABI.pos), [200, 0, 0]);
  manager.removeGroup('second');
  assert.deepEqual(motionVector(manager.update(13), MOTION_ABI.pos), [100, 0, 0]);
});

test('MOT manager uses elapsed frame/speed, defers starting when requested and restores record identities', async () => {
  const script = program([[21, load(0), load(MOTION_ABI.frame)], [59]], 'clock');
  const options = { profile, speed: 2, loadScript: async () => script };
  const manager = new MotionManager(options);
  manager.add(script);
  assert.equal(new DataView(manager.update(10, true).buffer).getInt32(0, true), 0);
  manager.update(11);
  manager.update(14);
  assert.equal(new DataView(manager.working.buffer).getInt32(0, true), 6);
  const restored = new MotionManager(options);
  await restored.restore(manager.snapshot());
  assert.equal(restored.nextHandle, 2);
  assert.equal(new DataView(restored.update(15).buffer).getInt32(0, true), 8);
});

const integer = (expression, current) =>
  evaluate(expression, { system: (name) => (name === '@' ? current : undefined) });
test('FES SUBCOMMAND lower-case coordinates become target-minus-current MOT offsets', () => {
  const definition = motionDefinition('move', {
    type: 'oneshot',
    words: 'motMove p[30] px[0] py[0] pz[0] : [0] 0 0 0 [1] [2] [3]'.split(' '),
  });
  const state = initialMotionObject();
  setMotionVector(state, MOTION_ABI.pos, [100, 200, 0]);
  assert.deepEqual(
    motionRegisters(definition, ['20', '150', '@', '-30'], state, integer),
    [20, 0, 0, 0, 50, 0, -30],
  );
});

test('MOT typed parameters apply percent units only to suffixed values and normalize angles', () => {
  const absolute = motionDefinition('scale', {
    type: 'oneshot',
    words: 'pScale SX[100%] SY[100%] SZ[100%] : [0] [1] [2]'.split(' '),
  });
  const relative = motionDefinition('mscale', {
    type: 'oneshot',
    words: 'motScale p[30] sx[100%] sy[100%] sz[100%] : [0] [1] [2] [3]'.split(' '),
  });
  const state = initialMotionObject();
  setMotionVector(state, MOTION_ABI.scale, [1.5, 2, 3]);
  assert.deepEqual(motionRegisters(absolute, ['200%', '@', '50%'], state, integer), [2, 2, 0.5]);
  assert.deepEqual(motionRegisters(absolute, ['2'], state, integer), [2, 1, 1]);
  assert.deepEqual(
    motionRegisters(relative, ['30', '200%', '100%', '50%'], state, integer),
    [30, 0.5, -1, -2.5],
  );
  const rotation = motionDefinition('rot', {
    type: 'oneshot',
    words: 'pRot RX[0] RY[0] RZ[0] : [0] [1] [2]'.split(' '),
  });
  assert.deepEqual(motionRegisters(rotation, ['90', '180', '0'], state, integer), [
    Math.fround(Math.PI / 2),
    Math.fround(Math.PI),
    0,
  ]);
});

test('MOT packed-color terms follow native channel extraction and malformed types stay explicit', () => {
  const definition = motionDefinition('colors', {
    type: 'oneshot',
    words: 'pColor CX[0xffffffff] : cxr cxg cxb cxa'.split(' '),
  });
  const state = initialMotionObject();
  new DataView(state.buffer).setUint32(MOTION_ABI.color, 0xaa112233, true);
  assert.deepEqual(motionRegisters(definition, ['0x12345678'], state, integer), [17, 34, 51, 170]);
  assert.throws(
    () => motionDefinition('bad', { type: 'oneshot', words: 'anything Width[0] : [0]'.split(' ') }),
    /Unknown MOT parameter/,
  );
  assert.throws(
    () => motionDefinition('bad', { type: 'oneshot', words: 'anything Bx[0] : [0]'.split(' ') }),
    /Unknown MOT parameter/,
  );
});

test('MOT concrete targets commit the last output before the owner retires exited scripts', async () => {
  const object = { x: 10, y: 20, z: 30, scaleX: 1, scaleY: 2, scaleZ: 3, alpha: 170, disp: true };
  const script = program(
    [[21, load(MOTION_ABI.pos), load(MOTION_ABI.registers)], [43, 38, 0], [59]],
    'set',
  );
  const library = {
    load: async () => script,
    manager: (base, speed) =>
      new MotionManager({ profile, base, speed, loadScript: async () => script }),
  };
  const target = new MotionTarget(library, {
    readState: () => objectMotionState(object),
    writeState: (state) => applyObjectMotionState(object, state),
  });
  await target.add('set', { registers: [15] });
  assert.equal(target.busy(), true);
  target.update(100);
  assert.equal(object.x, 15);
  assert.equal(target.busy(), false);
  assert.equal(target.manager.records.size, 0);
  assert.equal(target.update(101), false);
  assert.equal(object.x, 15);
});

test('MOT object adapters retain complete KX2 matrix, color and three-axis fields', () => {
  const state = initialMotionObject(),
    view = new DataView(state.buffer);
  for (const offset of [MOTION_ABI.base, MOTION_ABI.pos, MOTION_ABI.vram, MOTION_ABI.vscale])
    setMotionVector(state, offset, [1.5, -2.25, 8]);
  setMotionVector(state, MOTION_ABI.scale, [2, 3, 4]);
  view.setFloat32(MOTION_ABI.matrix + 12 * 4, 7, true);
  view.setUint32(MOTION_ABI.color, 0xaa112233, true);
  view.setInt32(MOTION_ABI.display, 0, true);
  const object = {};
  applyObjectMotionState(object, state, { scaleUnit: 100, visible: 'visible' });
  assert.equal(object.scaleZ, 400);
  assert.equal(object.alpha, 170);
  assert.equal(object.visible, false);
  assert.equal(object.motionMatrix[12], 7);
  assert.deepEqual(objectMotionState(object, { scaleUnit: 100, visible: 'visible' }), state);
});
