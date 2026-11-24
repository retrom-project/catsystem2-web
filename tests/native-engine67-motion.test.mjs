// SPDX-License-Identifier: MPL-2.0
import assert from 'node:assert/strict';
import test from 'node:test';
import { dataWorld } from './fixtures/data-world.mjs';
import { kcsProgram } from './helpers.mjs';

const profile = 'bokutomo-engine-2.6.1.67',
  managerWord = [0x13, 80],
  motionWord = [0x13, 84],
  flags = 0x81fe0032;

function motionProgram(steps) {
  return kcsProgram([
    [37, 0xa0263136],
    ...steps.flatMap(([id, args, result]) => [
      ...args.map((arg) => [37, arg]),
      [43, id, args.length * 4],
      ...(result === undefined ? [] : [[38, result]]),
    ]),
    [59],
  ]);
}

test('2.6.1.67 motion GCALLs own a manager, identity matrix, flags, members and release', async (t) => {
  const world = await dataWorld(profile, {
    'motion-create.kcs': motionProgram([
      [207, [128]],
      [294, [], 80],
      [586, [0, 0xffffffff]],
      [586, [managerWord, flags]],
    ]),
    'motion-unlink.kcs': motionProgram([
      [297, [managerWord, motionWord]],
      [298, [managerWord, 0x81234abc]],
    ]),
    'motion-clear.kcs': motionProgram([
      [296, [0]],
      [296, [managerWord]],
    ]),
    'motion-release.kcs': motionProgram([
      [295, [0]],
      [295, [managerWord]],
    ]),
    'fixture.kcs': kcsProgram([[59]]),
  });
  t.after(() => world.close({ flushFiles: false }));
  const execute = async (name, manager = 0, motion = 0) => {
    const task = await world.spawnScript(name, { initialExecute: false });
    const { machine } = task;
    const floor = machine.sp;
    machine.store(80, manager);
    machine.store(84, motion);
    machine.bytes(127, 66).fill(0x42);
    await world.runtime.scheduler.execute(task);
    assert.equal(machine.sp, floor + 4);
    assert.equal(machine.load(floor), 0xa0263136);
    return task;
  };
  const created = await execute('motion-create.kcs');
  const { machine } = created;
  const identity = new DataView(
    machine.bytes(128, 64).buffer,
    machine.bytes(128, 64).byteOffset,
    64,
  );
  assert.deepEqual(
    Array.from({ length: 16 }, (_, i) => identity.getFloat32(i * 4, true)),
    [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1],
  );
  assert.equal(machine.load(127, 1), 0x42);
  assert.equal(machine.load(192, 1), 0x42);
  const handle = machine.load(80),
    record = world.runtime.handles.get(handle, 'motion-manager'),
    manager = record.manager,
    script = await manager.loadScript('fixture');
  assert.equal(record.owner, created.id);
  assert.equal(manager.flags, flags);
  const removed = manager.add(script, { group: 17, startTick: 1 });
  manager.add(script, { group: 0x81234abc, startTick: 1 });
  const remaining = manager.add(script, { group: 17, startTick: 1 });
  manager.update(1);
  await execute('motion-unlink.kcs', handle, removed);
  assert.deepEqual([...manager.records.keys()], [remaining]);
  await execute('motion-clear.kcs', handle);
  assert.equal(manager.records.size, 0);
  assert.equal(manager.flags, flags);
  await execute('motion-release.kcs', handle);
  assert.equal(world.runtime.handles.records.has(handle), false);
});
