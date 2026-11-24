// SPDX-License-Identifier: MPL-2.0
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { KCSMachine, encodeCP932, readKCS } from '../src/kcs.mjs';
import { mapABIMessage } from '../src/native/abi/messages.mjs';
import { dataWorld } from './fixtures/data-world.mjs';
import { kcsProgram } from './helpers.mjs';

const profile = 'grisaia-jp-engine-2.6.1.23',
  sentinel = 0xad47192e;

async function run(world, owner, id, args, control = 2, prepare = () => {}) {
  const guest = await readKCS(
      kcsProgram([
        [37, sentinel],
        ...args.map((word) => [37, word]),
        [43, id, args.length * 4],
        [59],
      ]),
    ),
    task = { ...owner, io: null };
  const machine = (task.machine = new KCSMachine(
    guest,
    {
      native: (number, supplied, caller) =>
        world.runtime.scheduler.native(task, number, supplied, caller),
    },
    world.runtime.scheduler.shared,
  ));
  prepare(machine);
  const initial = machine.sp;
  assert.equal((await world.runtime.scheduler.execute(task)).status, 'halted');
  assert.equal(machine.sp, initial + (control === 1 ? 8 : 4));
  const result = control === 1 ? machine.pop() : undefined;
  assert.equal(machine.pop(), sentinel);
  return { machine, result };
}

test('fixed 2.6.1.23 copies an owned FES context name to local and shared VM memory', async (t) => {
  const world = await dataWorld(profile);
  t.after(() => world.close({ flushFiles: false }));
  const innerTop = await world.objects.create({ kind: 1, nativeID: 0 }),
    inner = await world.spawnScript('case.kcs', { parent: innerTop }),
    outerRecord = world.objects.objects.get(world.main.id),
    innerRecord = world.objects.objects.get(inner.id);
  outerRecord.context.contextName = '選択';
  innerRecord.context.contextName = 'テストゲーム123';
  innerRecord.context.contextNameBytes = encodeCP932(innerRecord.context.contextName);
  for (const [owner, context] of [
    [world.main, outerRecord.context],
    [inner, innerRecord.context],
  ]) {
    const bytes = encodeCP932(context.contextName);
    for (const address of [64, 0x80000040]) {
      const { machine } = await run(world, owner, 454, [address], 2, (guest) => {
        guest.bytes(address - 1, bytes.length + 3).fill(0x63);
      });
      assert.deepEqual(
        [...machine.bytes(address - 1, bytes.length + 3)],
        [0x63, ...bytes, 0, 0x63],
      );
    }
  }
  outerRecord.context.contextName = '';
  const { machine } = await run(world, world.main, 454, [64], 2, (guest) => {
    guest.bytes(63, 3).fill(0x63);
  });
  assert.deepEqual([...machine.bytes(63, 3)], [0x63, 0, 0x63]);
});

test('fixed 2.6.1.23 routes Top and Base fields in the caller namespace', async (t) => {
  const world = await dataWorld(profile);
  t.after(() => world.close({ flushFiles: false }));
  const outerPlane = await world.objects.create({ kind: 2, parent: world.root }),
    innerTop = await world.objects.create({ kind: 1, nativeID: 0 }),
    inner = await world.spawnScript('case.kcs', { parent: innerTop }),
    innerPlane = await world.objects.create({ kind: 2, parent: innerTop }),
    target = world.nativeTaskID(innerPlane),
    outerPlaneRecord = world.objects.objects.get(outerPlane),
    innerPlaneRecord = world.objects.objects.get(innerPlane),
    outer = world.objects.objects.get(world.root),
    nested = world.objects.objects.get(innerTop);
  assert.equal(world.nativeTaskID(outerPlane), target);
  assert.notEqual(outerPlane, innerPlane);
  assert.equal(mapABIMessage(profile, 'base', 'raw', 24), 23);
  assert.equal(mapABIMessage(profile, 'base', 'canonical', 28), 29);
  assert.throws(() => mapABIMessage(profile, 'base', 'canonical', 29), /Unreviewed ABI message/);
  await run(world, world.main, 577, [0x80000000]);
  await run(world, inner, 577, [0xff123456]);
  assert.equal(outer.implementation.field, 0x80000000);
  assert.equal(nested.implementation.field, 0xff123456);
  outerPlaneRecord.exitCode = 17;
  innerPlaneRecord.exitCode = 29;
  nested.exitCode = 73;
  nested.userValue = 71;
  for (const absent of [0, 0x12345]) {
    await run(world, inner, 651, [absent]);
    await run(world, inner, 694, [absent, 37]);
  }
  assert.equal(nested.exitCode, 73);
  assert.equal(nested.userValue, 71);
  assert.equal(innerPlaneRecord.userValue, 0);
  assert.equal((await run(world, inner, 452, [target], 1)).result, 29);
  await run(world, inner, 651, [target]);
  assert.equal((await run(world, inner, 452, [target], 1)).result, 0xffffffff);
  assert.equal((await run(world, world.main, 452, [target], 1)).result, 17);
  assert.equal((await run(world, inner, 452, [0x12345], 1)).result, 0xffffffff);
  await run(world, inner, 694, [target, 0x80001234]);
  await run(world, world.main, 694, [target, 0xffffffff]);
  assert.equal(innerPlaneRecord.userValue, 0x80001234);
  assert.equal(outerPlaneRecord.userValue, 0xffffffff);
});

test('fixed 2.6.1.23 task queries use signed route keys and full Base and Input words', async (t) => {
  const world = await dataWorld(profile);
  t.after(() => world.close({ flushFiles: false }));
  const caller = world.main,
    first = 0xdf20be12,
    descendant = 0xe4decaa1,
    last = 101,
    front = await world.objects.create({ kind: 2, parent: caller.id, nativeID: first }),
    tail = await world.objects.create({ kind: 2, parent: caller.id, nativeID: last }),
    nested = await world.objects.create({ kind: 2, parent: front, nativeID: descendant }),
    records = world.objects.objects,
    root = records.get(world.root),
    frontRecord = records.get(front),
    query = async (id, word, owner = caller) => (await run(world, owner, id, [word], 1)).result;
  assert.equal(world.resolveTaskID(descendant, caller.id), nested);
  assert.equal(world.nativeTaskID(tail), last);
  records.get(caller.id).nativeTaskRoutes.set(66, null);
  root.nativeTaskRoutes.set(73, null);
  for (const [index, key] of [first, descendant, last, 0xffffffff].entries())
    assert.equal(await query(75, index), key);
  assert.equal(await query(75, 0xffffffff), 0xffffffff);
  for (const word of [0, 2, 0x10023, 0x81300000, 0xffffffff]) {
    frontRecord.flags = word;
    assert.equal(await query(74, first), word);
  }
  assert.equal(await query(74, 66), 0xffffffff);
  assert.equal(await query(74, 73), 0xffffffff);
  assert.equal(await query(74, 0xeddc0f73), 0xffffffff);
  await assert.rejects(() => query(74, 0), /Root query caller pointer/);
  frontRecord.destroyRequested = true;
  await assert.rejects(() => query(74, first), /retiring owner/);
  assert.equal(await query(75, 0), first);
  assert.equal(await query(77, first), 1);
  frontRecord.destroyRequested = false;
  for (const word of [first, descendant, last, 73]) assert.equal(await query(77, word), 1);
  for (const word of [0, 0xa78f80cd]) assert.equal(await query(77, word), 0);
  const otherTop = await world.objects.create({ kind: 1, nativeID: 0 }),
    otherCaller = await world.spawnScript('case.kcs', { parent: otherTop }),
    other = await world.objects.create({ kind: 2, parent: otherCaller.id, nativeID: first }),
    input = world.inputFor(caller.id),
    otherInput = world.inputFor(otherCaller.id);
  records.get(other).flags = 0x72810;
  assert.equal(await query(74, first, otherCaller), 0x72810);
  assert.equal(await query(77, 73, otherCaller), 0);
  assert.equal(await query(75, 0, otherCaller), first);
  const region = input.register({ owner: front }),
    otherRegion = otherInput.register({ owner: other });
  otherRegion.active = 0x7eac994a;
  for (const word of [0, 1, 0x80000000, 0x381abcdd, 0xffffffff]) {
    region.active = word;
    assert.equal(await query(107, first), word);
    assert.equal(await query(107, first, otherCaller), 0x7eac994a);
  }
  for (const word of [0, world.nativeTaskID(caller.id), 0xa32fbb2c])
    await assert.rejects(() => query(107, word), /no initialized 32-bit output word/);
  for (const id of [74, 75, 77, 107])
    await assert.rejects(() => run(world, caller, id, [], 1), /expects 1 argument/);
});
