// SPDX-License-Identifier: MPL-2.0
import test from 'node:test';
import assert from 'node:assert/strict';
import { NativeRuntime } from '../src/native/runtime.mjs';
import { nativeReply } from '../src/kcs.mjs';
import { nativeABI } from '../src/native/abi/index.mjs';
import { NATIVE_SEMANTICS } from '../src/native/abi/semantics.mjs';
import { kcsProgram } from './helpers.mjs';

const profile = 'sdk-4.01-engine-2.6.1.74';
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
