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

test('2.6.1.67 motion GCALLs transfer complete base and working register blocks', async (t) => {
  const blocks = [
      [128, 192, 3],
      [140, 204, 3],
      [152, 216, 3],
      [256, 448, 16],
      [164, 228, 3],
      [0, 240, 1],
      [176, 320, 3],
      [188, 336, 3],
      [0, 352, 1],
    ],
    incoming = (block, index) =>
      index === 5 || index === 8 ? 0xab582100 + index : [0x23, block[0]],
    inputs = blocks.map(incoming),
    outputs = blocks.map((block) => [0x23, block[1]]),
    world = await dataWorld(profile, {
      'set-base.kcs': motionProgram([
        [299, [0, ...inputs]],
        [299, [managerWord, ...inputs]],
      ]),
      'get-base.kcs': motionProgram([[300, [managerWord, ...outputs]]]),
      'set-working.kcs': motionProgram([[301, [managerWord, ...inputs]]]),
      'get-working.kcs': motionProgram([
        [302, [managerWord, ...outputs.slice(0, -1), 0xffffffff]],
        [302, [managerWord, ...outputs]],
      ]),
      'commit.kcs': motionProgram([
        [303, [managerWord]],
        [303, [0]],
      ]),
    });
  t.after(() => world.close({ flushFiles: false }));
  const h = world.runtime.services.motion.create(world.main.id);
  const expected = (seed, index, length) =>
    Array.from({ length }, (_, word) =>
      index === 5 || index === 8 ? 0xab582100 + index : seed + index * 256 + word,
    );
  const execute = async (name, seed = null) => {
    const task = await world.spawnScript(name, { parent: world.main.id, initialExecute: false }),
      { machine } = task,
      floor = machine.sp;
    machine.store(80, h);
    if (seed !== null)
      blocks.forEach(([address, , length], index) => {
        if (address)
          expected(seed, index, length).forEach((word, i) => machine.store(address + i * 4, word));
      });
    await world.runtime.scheduler.execute(task);
    assert.equal(machine.sp, floor + 4);
    assert.equal(machine.load(floor), 0xa0263136);
    return machine;
  };
  const check = (machine, seed) =>
    blocks.forEach(([, address, length], index) => {
      assert.deepEqual(
        expected(seed, index, length),
        Array.from({ length }, (_, i) => machine.load(address + i * 4)),
      );
    });
  await execute('set-base.kcs', 0xa1231000);
  await execute('set-working.kcs', 0xad2ed000);
  check(await execute('get-base.kcs'), 0xa1231000);
  check(await execute('get-working.kcs'), 0xad2ed000);
  await execute('commit.kcs');
  check(await execute('get-base.kcs'), 0xad2ed000);
});
