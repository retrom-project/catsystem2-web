// SPDX-License-Identifier: MPL-2.0
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { dataWorld } from './fixtures/data-world.mjs';
import { kcsProgram } from './helpers.mjs';

const profiles = [
  'grisaia-jp-engine-2.6.1.23',
  'rebellions-jp-engine-2.6.1.63',
  'bokutomo-engine-2.6.1.67',
  'sdk-4.01-engine-2.6.1.74',
  'nekopara-vol3-engine-2.6.1.76',
];
const ignoredOwner = 0x70000001,
  marker = 0x49a0b513;
const call = (args) => [...args.map((n) => [37, n]), [43, 713, 16]];

for (const profile of profiles) {
  test(profile + ' actual VM neutral RGB tone does not consume the owner', async (t) => {
    const program = kcsProgram([
      [37, marker],
      ...call([ignoredOwner, 100, 100, 100]),
      ...call([0, 71, 123, 82]),
      ...call([ignoredOwner, 100, 100, 100]),
      [59],
    ]);
    const world = await dataWorld(profile, { 'neutral.kcs': program });
    t.after(() => world.close({ flushFiles: false }));
    const task = await world.spawnScript('neutral.kcs', {
      parent: world.main.id,
      initialExecute: false,
    });
    const floor = task.machine.sp;
    await world.runtime.scheduler.execute(task);
    assert.equal(task.machine.halted, true);
    assert.equal(task.machine.sp, floor + 4);
    assert.equal(task.machine.load(floor), marker);
    assert.equal(world.runtime.handles.records.has(ignoredOwner), false);
  });

  test(profile + ' nonneutral RGB tone still requires its real owner', async (t) => {
    const world = await dataWorld(profile, {
      'nonneutral.kcs': kcsProgram([...call([ignoredOwner, 101, 100, 100]), [59]]),
    });
    t.after(() => world.close({ flushFiles: false }));
    const task = await world.spawnScript('nonneutral.kcs', {
      parent: world.main.id,
      initialExecute: false,
    });
    await assert.rejects(world.runtime.scheduler.execute(task), /image-owner|handle/i);
    assert.equal(world.runtime.handles.records.has(ignoredOwner), false);
  });
}
