// SPDX-License-Identifier: MPL-2.0
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { modernParticleMessageWorld } from './fixtures/modern-particle-message-world.mjs';
import { kif, kcsProgram } from './helpers.mjs';
import { serializeCheckpoint, deserializeCheckpoint } from '../src/checkpoint.mjs';
const golden = JSON.parse(
  await readFile(new URL('./fixtures/sdk23-motion-manager-golden.json', import.meta.url)),
);
const bytes = (source) => new Uint8Array(Buffer.from(source, 'base64'));
async function open(initialize = true) {
  return modernParticleMessageWorld(
    golden.profile,
    {
      'startup.xml': bytes(golden.inputs.startup),
      'scripts.int': kif([
        ['main.kcs', kcsProgram([[37, 240], [43, 71, 4], [59]])],
        ['mot-manager23.kcs', bytes(golden.inputs.program)],
      ]),
      'images.int': bytes(golden.inputs.supportImagesArchive),
      'motion.int': kif(
        Object.entries(golden.inputs.motions).map(([name, source]) => [name, bytes(source)]),
      ),
    },
    { initialize },
  );
}
function portableLocal(source, actualManager) {
  const result = bytes(source),
    view = new DataView(result.buffer);
  for (let at = 0; at < result.length; at += 4)
    if (view.getUint32(at, true) === golden.nativeManager) view.setUint32(at, actualManager, true);
  return result;
}
async function compare(world, caller, row, managerID) {
  const machine = caller.machine;
  assert.deepEqual(
    machine.memory,
    portableLocal(row.local, managerID),
    row.label + ' complete caller VM',
  );
  for (const key of ['pc', 'sp', 'fp'])
    assert.equal(machine[key], row[key], row.label + ' caller ' + key);
  if (!row.manager) {
    assert(
      !world.runtime.handles.records.has(managerID),
      'Main295 releases the independent manager',
    );
    return;
  }
  const manager = await world.runtime.services.motion.get(managerID),
    expected = row.manager;
  assert.deepEqual(manager.base, bytes(expected.base), row.label + ' base');
  if (expected.working === null)
    assert.throws(() => manager.readBank(true), /uninitialized working bytes/);
  else assert.deepEqual(manager.readBank(true), bytes(expected.working), row.label + ' working');
  for (const key of ['nextHandle', 'speedWord', 'flags'])
    assert.equal(manager[key], expected[key], row.label + ' ' + key);
  assert.equal(manager.records.size, expected.records.length);
  for (const wanted of expected.records) {
    const record = manager.records.get(wanted.handle),
      instance = record.instance;
    assert.equal(record.group, wanted.group);
    assert.equal(record.startTick, wanted.start);
    assert.equal(instance.script.recordName, wanted.filename);
    const shared = instance.shared.slice();
    if (!wanted.objectInitialized) {
      shared.fill(0, 0, 144);
      assert.throws(() => instance.machine.load(0x80000000), /uninitialized memory/);
    }
    if (!wanted.frameKnown) {
      shared.fill(0, 144, 148);
      assert.throws(() => instance.frame, /uninitialized memory/);
    }
    assert.deepEqual(
      shared,
      bytes(wanted.knownShared),
      row.label + ' known MOT fields ' + wanted.handle,
    );
    for (const key of ['pc', 'sp', 'fp'])
      assert.equal(instance.machine[key], wanted.motVM[key], row.label + ' MOT ' + key);
    if (wanted.ran) assert.equal(instance.machine.load(64), wanted.motVM.seenFrame);
    if (wanted.motVM.seenExtra !== null)
      assert.equal(
        instance.machine.load(68),
        wanted.motVM.seenExtra,
        'MOT consumes copied extra after caller source changed',
      );
  }
}
for (const coldAt of [null, 0, 1, 2, 3, 4, 5, 6, 7]) {
  test(`SDK23 actual manager banks/records/raw active and release${coldAt === null ? '' : ' with independent cold at phase' + coldAt}`, async () => {
    let world = await open(),
      caller = await world.spawnScript('mot-manager23', { initialExecute: false }),
      managerID;
    try {
      for (const row of golden.rows) {
        await world.objects.update(caller.id, row.frame);
        if (row.phase === 0) managerID = caller.machine.load(64);
        await compare(world, caller, row, managerID);
        if (row.phase === coldAt) {
          const callerID = caller.id,
            snapshot = await deserializeCheckpoint(await serializeCheckpoint(world.snapshot()));
          await world.close({ flushFiles: false });
          world = await open(false);
          await world.restore(snapshot);
          caller = world.runtime.scheduler.tasks.get(callerID);
          await compare(world, caller, row, managerID);
        }
      }
    } finally {
      await world.close({ flushFiles: false });
    }
  });
}
