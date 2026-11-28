// SPDX-License-Identifier: MPL-2.0
import test from 'node:test';
import assert from 'node:assert/strict';
import { KCSScheduler } from '../src/kcs/scheduler.mjs';
import { KCSMachine, nativeReply } from '../src/kcs/vm.mjs';
import { readKCS } from '../src/kcs.mjs';
import { kcsProgram } from './helpers.mjs';

test('native IO retry preserves fresh guest steps while retaining attempt budgets', async () => {
  const bytes = kcsProgram([[43, 7, 0], [59]]),
    reply = nativeReply(1, 0x13579bdf),
    effects = [0, 0],
    make = (promise) =>
      new KCSScheduler({
        shared: new Uint8Array(64),
        budget: 32,
        load: async (name) => ({ ...(await readKCS(bytes)), name }),
        native: (_table, id, args) => {
          assert.equal(id, 7);
          assert.deepEqual(args, []);
          effects[Number(promise)]++;
          return promise ? Promise.resolve(reply) : reply;
        },
      }),
    source = make(false),
    original = await source.spawn('owned.kcs', { abi: 'owned' }),
    checkpoint = structuredClone(source.snapshot()),
    fresh = make(true);
  assert.equal(fresh.tasks.size, 0);
  assert.equal(fresh.programs.size, 0);
  await fresh.restore(structuredClone(checkpoint));
  const restored = fresh.tasks.get(original.id);
  assert.deepEqual(restored.machine.snapshot(), checkpoint.tasks[0].machine);
  const synchronous = await source.execute(original),
    asynchronous = await fresh.execute(restored);
  assert.deepEqual(effects, [1, 1], 'ready IO consumption does not repeat the native effect');
  assert.equal(original.machine.steps, 1, 'HALT remains excluded from guest steps');
  assert.equal(restored.machine.steps, original.machine.steps, 'pending IO is not a guest step');
  assert.deepEqual(restored.machine.snapshot(), original.machine.snapshot());
  assert.equal(synchronous.executed, 2, 'synchronous attempt budget includes HALT');
  assert.equal(asynchronous.executed, 3, 'asynchronous attempt budget still includes the IO retry');
});

test('a completed self-jump counts steps and retains bounded-run budget behavior', async () => {
  const machine = new KCSMachine(await readKCS(kcsProgram([[41, 0]])));
  assert.deepEqual(machine.run({ budget: 4, yieldOnBudget: true }), {
    status: 'budget',
    executed: 4,
  });
  assert.equal(machine.pc, 0);
  assert.equal(machine.steps, 4, 'same PC does not imply an incomplete instruction');
  assert.equal(machine.halted, false);
  assert.throws(() => machine.run({ budget: 2 }), /KCS instruction budget at 0/);
  assert.equal(machine.pc, 0);
  assert.equal(machine.steps, 6);
});
