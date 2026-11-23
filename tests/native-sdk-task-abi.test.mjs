// SPDX-License-Identifier: MPL-2.0
import test from 'node:test';
import assert from 'node:assert/strict';
import { NativeRuntime } from '../src/native/runtime.mjs';
import { nativeReply } from '../src/kcs.mjs';
import { nativeABI } from '../src/native/abi/index.mjs';
import { NATIVE_SEMANTICS } from '../src/native/abi/semantics.mjs';
import { kcsProgram } from './helpers.mjs';
import { dataWorld } from './fixtures/data-world.mjs';

const profile = 'sdk-4.01-engine-2.6.1.74';
const legacy = 'grisaia-jp-engine-2.6.1.23';
const game = nativeABI('nekopara-vol3-engine-2.6.1.76');
const specs = [
  { id: 0x42, label: 'task creation', words: 3, args: [27, 0, 0], evidence: 'task-create' },
  { id: 0x44, label: 'current task identity', words: 0, args: [], evidence: 'task-current' },
];

for (const { id, label, words, args, evidence } of specs) {
  test(`SDK main${id} explicitly registers the ${label} reply contract`, async () => {
    const entry = nativeABI(profile).tables.main.entries[id];
    const runtime = new NativeRuntime({ profile, read: async () => kcsProgram([[59]]) });
    const task = await runtime.spawn('task-abi-control.kcs');
    const value = 0x3200 + id;
    const received = [];
    let reply = nativeReply(1, value);
    runtime.register('main', id, (actualArgs, machine, caller, scheduler) => {
      assert.equal(machine, task.machine);
      assert.equal(caller, task);
      assert.equal(scheduler, runtime.scheduler);
      received.push([...actualArgs]);
      return reply;
    });
    const valid = runtime.native('main', id, args, task.machine, task, runtime.scheduler);
    reply = nativeReply(2);
    let rejectedWrongControl = false;
    let wrongControlResult;
    let wrongControlError;
    try {
      wrongControlResult = runtime.native('main', id, args, task.machine, task, runtime.scheduler);
    } catch (error) {
      rejectedWrongControl = true;
      wrongControlError = error;
    }
    const observed = {
      status: entry.status,
      name: entry.name,
      registrationAccepted: runtime.handlers.has(`main:${id}`),
      valid,
      wrongControlResult,
      rejectedWrongControl,
    };
    assert.deepEqual(received, [args, args]);
    assert.deepEqual(valid, nativeReply(1, value));
    assert.equal(rejectedWrongControl, true, JSON.stringify(observed));
    assert.match(wrongControlError.message, /control 2 disagrees with the fixed ABI [(]1[)]/);
    assert.equal(entry.status, 'recovered');
    assert.equal(entry.name, NATIVE_SEMANTICS.main[id].name);
    assert.deepEqual(entry.signature, NATIVE_SEMANTICS.main[id].signature);
    assert.deepEqual(entry.signature, game.tables.main.entries[id].signature);
    assert.equal(entry.signature.argumentWords, words);
    assert.deepEqual(entry.signature.controlCodes, [1]);
    assert.deepEqual(entry.observedArgumentWords, [words]);
    assert.match(entry.evidence, new RegExp(`reviewed-SDK-2[.]6[.]1[.]74-${evidence}`));
    assert.notEqual(entry.evidence, game.tables.main.entries[id].evidence);
  });
}

const copyProgram = kcsProgram([
  [37, [0x13, 128]],
  [37, 256],
  [37, 5],
  [37, 512],
  [43, 0x49, 16],
  [37, [0x13, 128]],
  [37, 258],
  [37, 3],
  [37, 768],
  [43, 0x48, 16],
  [59],
]);

async function createScript(world, name) {
  const id = await world.objects.create({ kind: 12, parent: world.main.id, name });
  const script = world.objects.objects.get(id).implementation;
  await script.loadScript(name + '.kcs');
  return script.task;
}

for (const engine of [profile, game.profile, legacy])
  test(`${engine} GCALL writes and reads bytes on the live target Script`, async () => {
    const world = await dataWorld(engine, {
      'receiver.kcs': kcsProgram([[59]]),
      'caller.kcs': copyProgram,
    });
    try {
      const target = await createScript(world, 'receiver'),
        caller = await createScript(world, 'caller');
      const stack = caller.machine.sp;
      caller.machine.store(128, world.nativeTaskID(target.id));
      caller.machine.bytes(512, 5).set([19, 28, 37, 46, 55]);
      caller.machine.bytes(767, 5).fill(0xa5);
      target.machine.bytes(255, 7).fill(0x5a);

      await world.runtime.scheduler.execute(caller);

      assert.equal(caller.machine.halted, true);
      assert.equal(caller.machine.sp, stack);
      assert.deepEqual(target.machine.bytes(255, 7), Uint8Array.of(0x5a, 19, 28, 37, 46, 55, 0x5a));
      assert.deepEqual(caller.machine.bytes(767, 5), Uint8Array.of(0xa5, 37, 46, 55, 0xa5));
      assert.deepEqual(caller.machine.bytes(512, 5), Uint8Array.of(19, 28, 37, 46, 55));
      for (const id of [0x48, 0x49]) {
        const declaration = nativeABI(engine).tables.main.entries[id];
        assert.equal(declaration.status, 'recovered');
        assert.deepEqual(declaration.signature, NATIVE_SEMANTICS.main[id].signature);
        assert.equal(declaration.signature.argumentWords, 4);
        assert.deepEqual(declaration.signature.controlCodes, [2]);
        assert.equal(declaration.signature.resultWritten, false);
        if (engine !== legacy) assert.deepEqual(declaration.observedArgumentWords, [4]);
        if (engine === legacy) assert.match(declaration.evidence, /2\.6\.1\.23.*copy VM bytes/);
        if (engine === profile) assert.match(declaration.evidence, /SDK-2\.6\.1\.74.*VM-byte-copy/);
      }
    } finally {
      await world.close({ flushFiles: false });
    }
  });

for (const engine of [profile, legacy])
  test(`${engine} GCALL defers a four-word packet and returns the queued result`, async () => {
    const world = await dataWorld(engine, {
      'receiver.kcs': kcsProgram([
        [37, 256],
        [43, 0x47, 4],
        [38, 128],
        [41, 0],
      ]),
      'caller.kcs': kcsProgram([
        [37, [0x13, 128]],
        [37, 1],
        [37, 0],
        [37, 0x7b],
        [43, 0x46, 16],
        [38, 64],
        [59],
      ]),
    });
    try {
      const target = await createScript(world, 'receiver');
      await world.runtime.scheduler.execute(target);
      const caller = await createScript(world, 'caller');
      caller.machine.store(128, world.nativeTaskID(target.id));
      target.machine.bytes(256, 16).fill(0xa5);
      const packet = [world.nativeTaskID(caller.id), 1, 0, 0x7b];

      await world.runtime.scheduler.execute(caller);

      assert.equal(caller.machine.halted, true);
      assert.equal(caller.machine.load(64), 1);
      assert.deepEqual(target.messages, [packet]);
      assert.deepEqual(target.machine.bytes(256, 16), new Uint8Array(16).fill(0xa5));
      await world.tick();
      assert.deepEqual(target.messages, []);
      assert.deepEqual(
        Array.from({ length: 4 }, (_, index) => target.machine.load(256 + index * 4)),
        packet,
      );
      const entry = nativeABI(engine).tables.main.entries[0x46];
      assert.equal(entry.status, 'recovered');
      assert.equal(entry.name, NATIVE_SEMANTICS.main[0x46].name);
      assert.equal(entry.signature.argumentWords, 4);
      assert.deepEqual(entry.signature.controlCodes, [1]);
      if (engine !== legacy) assert.deepEqual(entry.observedArgumentWords, [4]);
      assert.equal(entry.signature.resultWritten, true);
      assert.match(entry.evidence, /(?:SDK-2\.6\.1\.74-main70|2\.6\.1\.23 Main 70).*deferred/);
    } finally {
      await world.close({ flushFiles: false });
    }
  });
