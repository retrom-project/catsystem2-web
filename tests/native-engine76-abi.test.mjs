// SPDX-License-Identifier: MPL-2.0
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { defaultFESWorld, loadDefaultFES } from './fixtures/default-fes-world.mjs';
import { kcsProgram } from './helpers.mjs';

const profile = 'nekopara-vol3-engine-2.6.1.76';
const marker = 0xb5178731;

async function randomWorld(t, lines, seed) {
  const world = await defaultFESWorld(profile, {
    'screen.fes': new TextEncoder().encode(['#START', ...lines, 'wait 1'].join('\n')),
    'integer.kcs': kcsProgram([[37, marker], [43, 33, 0], [38, 64], [59]]),
  });
  t.after(() => world.close({ flushFiles: false }));
  const bank = world.runtime.variableBank(world.objects.objects.get(world.main.id));
  bank.initialize(1024);
  bank.words.fill(marker);
  bank.dirty = false;
  await loadDefaultFES(world);
  world.random.integer.seed(seed);
  return { world, bank };
}

async function nextInteger(world) {
  const task = await world.spawnScript('integer.kcs', {
    parent: world.main.id,
    initialExecute: false,
  });
  const sp = task.machine.sp;
  await world.runtime.scheduler.execute(task);
  assert.equal(task.machine.halted, true);
  assert.equal(task.machine.sp, sp + 4);
  assert.equal(task.machine.pop(), marker);
  return task.machine.load(64);
}

test('prepared 2.6.1.76 title ranges share the integer stream with KCS Main33', async (t) => {
  for (const [seed, selected, following] of [
    [0, [6, 1], 2229421029],
    [4357, [1, 0], 3113124129],
    [0xffffffff, [5, 1], 2016717621],
  ]) {
    const { world, bank } = await randomWorld(t, ['rand 850 0 6', 'rand 851 0 1'], seed);
    const real = world.random.real.snapshot();
    await world.tick();
    assert.deepEqual([...bank.words.slice(850, 852)], selected);
    assert.equal(bank.dirty, true);
    assert.equal(world.random.integer.index, 2);
    assert.equal(await nextInteger(world), following);
    assert.equal(world.random.integer.index, 3);
    assert.deepEqual(world.random.real.snapshot(), real);
  }
});

test('prepared 2.6.1.76 randtbl uses the original 1001 swaps in the owned variable bank', async (t) => {
  const { world, bank } = await randomWorld(t, ['randtbl 20 23 40 44', 'rand 851 0'], 0);
  await world.tick();
  assert.deepEqual([...bank.words.slice(19, 25)], [marker, 42, 43, 40, 41, marker]);
  assert.equal(bank.words[851], marker);
  assert.equal(bank.dirty, true);
  assert.equal(world.random.integer.index, 130);
  assert.equal(await nextInteger(world), 3399954203);
});
