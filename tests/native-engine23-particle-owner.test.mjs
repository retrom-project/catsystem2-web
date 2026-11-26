// SPDX-License-Identifier: MPL-2.0
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { KCSMachine, floatBits, readKCS } from '../src/kcs.mjs';
import { NATIVE_UNWRITTEN_WORD } from '../src/native/engine-message.mjs';
import { configureFESParticle } from '../src/native/fes-particle-driver.mjs';
import { particleWorld, setupParticle } from './fixtures/fes-particle-driver-world.mjs';
import { dataWorld } from './fixtures/data-world.mjs';
import { kcsProgram } from './helpers.mjs';

const profile = 'grisaia-jp-engine-2.6.1.23';
const programAddress = 160;
const textureAddress = 192;
const registersAddress = 256;
const canary = 0xb77d2300;
const registerValues = Float32Array.from({ length: 32 }, (_, index) => index / 2 - 5);
const program = kcsProgram([[59]]);
new DataView(program.buffer).setUint16(8, 2, true);
const files = { 'ptcl/probe.kcs': program };

async function mainCall(world, id, args, control, expected) {
  const bytes = kcsProgram([
    [37, canary],
    ...args.map((word) => [37, word]),
    [43, id, args.length * 4],
    [59],
  ]);
  const task = { ...world.main, io: null };
  const machine = (task.machine = new KCSMachine(await readKCS(bytes), {
    native: (number, supplied, caller) =>
      world.runtime.scheduler.native(task, number, supplied, caller),
  }));
  machine.writeString('probe', programAddress);
  machine.writeString('', textureAddress);
  machine.bytes(registersAddress, 128).set(new Uint8Array(registerValues.buffer));
  machine.store(registersAddress - 4, canary);
  machine.store(registersAddress + 128, canary);
  const floor = machine.sp;
  assert.equal((await world.runtime.scheduler.execute(task)).status, 'halted');
  assert.equal(machine.sp, floor + (control === 1 ? 8 : 4));
  if (control === 1) assert.equal(machine.pop(), expected);
  assert.equal(machine.pop(), canary);
  assert.equal(machine.load(registersAddress - 4), canary);
  assert.equal(machine.load(registersAddress + 128), canary);
}

test('fixed 2.6.1.23 particle GCALLs route the exact kind-16 packets and keep their owner after restore', async () => {
  const world = await dataWorld(profile, files);
  const targetID = await world.objects.create({ kind: 16, parent: world.root });
  const target = world.nativeTaskID(targetID),
    particle = world.particles.get(targetID);
  const sendRaw = (w, message, pointer = 0, context = {}) =>
    w.engineMessages.dispatchNative(w.main.id, target, message, 0, pointer, context);
  const call = (id, args, control, result) => mainCall(world, id, args, control, result);
  const load = [target, programAddress, textureAddress, 2, floatBits(12.25), registersAddress];
  let restored;
  try {
    assert.deepEqual(await sendRaw(world, 289), {
      routed: true,
      handled: false,
      result: NATIVE_UNWRITTEN_WORD,
    });
    world.graphics.createLogicalDevice();
    const messages = [];
    const dispatch = world.sendNativeEngine.bind(world);
    world.sendNativeEngine = (id, sender, message, w, l, context) => {
      messages.push(message);
      return dispatch(id, sender, message, w, l, context);
    };
    await call(271, load, 1, 1);
    assert.equal(particle.bank.program, 'ptcl/probe.kcs');
    assert.equal(particle.bank.instance.table, 'particle-v2');
    assert.equal(particle.bank.count, 2);
    assert.equal(particle.bank.priority, 12.25);
    assert.deepEqual(particle.bank.registers, registerValues);
    await call(693, [0xf00d1234, ...load.slice(1)], 1, 1);
    await call(274, [0xf00d1234], 1, 0);
    await call(272, [target], 2);
    await call(274, [target], 1, 1);
    await call(271, load, 1, 1);
    assert.equal(particle.active, true);
    for (const [value, alpha] of [
      [254, 254],
      [255, 256],
      [0xffffffff, -1],
    ]) {
      await call(426, [target, value], 2);
      assert.equal(particle.state.alpha, alpha);
    }
    await call(427, [target, 0x7bad], 2);
    assert.equal(particle.state.attachment, 0x7bad);
    await call(275, [target, registersAddress], 2);
    assert.deepEqual(particle.bank.registers, registerValues);
    await call(427, [target, 0], 2);
    assert.equal(particle.state.attachment, -1);
    await call(273, [target], 2);
    await call(274, [target], 1, 0);
    assert.deepEqual(
      messages,
      [285, 285, 289, 286, 289, 285, 291, 291, 291, 292, 290, 292, 287, 289],
    );
    assert.deepEqual(await sendRaw(world, 285), {
      routed: true,
      handled: true,
      result: NATIVE_UNWRITTEN_WORD,
    });
    assert.ok(particle.bank);
    assert.deepEqual(await sendRaw(world, 291, 199), {
      routed: true,
      handled: true,
      result: NATIVE_UNWRITTEN_WORD,
    });
    assert.equal(particle.state.alpha, 199);
    for (const raw of [284, 293, 314, 318])
      assert.deepEqual(await sendRaw(world, raw), {
        routed: true,
        handled: false,
        result: NATIVE_UNWRITTEN_WORD,
      });
    await assert.rejects(call(274, [], 1, 0), /expects 1 arguments/);
    await assert.rejects(call(275, [target, 0xffffffff], 2), /KCS memory ffffffff/);
    await assert.rejects(sendRaw(world, 290), /mapped VM address/);
    const source = world.main.machine;
    source.bytes(registersAddress, 128).set(new Uint8Array(registerValues.buffer));
    source.store(registersAddress + 124, 0xff812345);
    assert.deepEqual(await sendRaw(world, 290, registersAddress), {
      routed: true,
      handled: true,
      result: NATIVE_UNWRITTEN_WORD,
    });
    assert.equal(new Uint32Array(particle.bank.registers.buffer)[31], 0xffc12345);
    assert.equal(source.load(registersAddress + 124), 0xff812345);
    source.store(registersAddress + 124, floatBits(registerValues[31]));
    await sendRaw(world, 290, registersAddress);
    restored = await dataWorld(profile, files, { initialize: false });
    restored.graphics.createLogicalDevice();
    await restored.restore(structuredClone(world.snapshot()));
    const copy = restored.particles.get(targetID);
    assert.deepEqual(copy.state, particle.state);
    assert.deepEqual(copy.bank.registers, registerValues);
    assert.deepEqual(await sendRaw(restored, 288), {
      routed: true,
      handled: true,
      result: NATIVE_UNWRITTEN_WORD,
    });
    assert.equal(copy.bank, null);
    assert.equal(copy.active, false);
  } finally {
    await restored?.close({ flushFiles: false });
    await world.close({ flushFiles: false });
  }
});

test('fixed 2.6.1.23 FES particle producer uses the same owned load and start receiver', async () => {
  const world = await particleWorld(profile);
  try {
    const { api, object, sync, task } = await setupParticle(world);
    configureFESParticle(object, {
      family: 0,
      program: 'probe',
      texture: '',
      count: 1,
      priority: 25,
    });
    await sync();
    assert.equal(task().bank.program, 'ptcl/probe.kcs');
    assert.equal(task().bank.priority, 25);
    assert.equal(task().active, false);
    api.driver.start(object);
    await sync();
    assert.equal(object.running, true);
    assert.equal(task().active, true);
    api.driver.stop(object);
    await sync();
    assert.equal(object.running, false);
    assert.equal(task().active, false);
  } finally {
    await world.close({ flushFiles: false });
  }
});
