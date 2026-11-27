// SPDX-License-Identifier: MPL-2.0
import assert from 'node:assert/strict';
import test from 'node:test';
import { readFile } from 'node:fs/promises';
import { modernParticleMessageWorld } from './fixtures/modern-particle-message-world.mjs';
import { kif, kcsProgram } from './helpers.mjs';
import { serializeCheckpoint, deserializeCheckpoint } from '../src/checkpoint.mjs';
const golden = JSON.parse(
    await readFile(new URL('./fixtures/sdk23-motion-fes-cache-golden.json', import.meta.url)),
  ),
  bytes = (source) => new Uint8Array(Buffer.from(source, 'base64')),
  programs = golden.inputs.motionPrograms.map(bytes);
async function open(revision, initialize = true) {
  const world = await modernParticleMessageWorld(
    golden.profile,
    {
      'startup.xml': bytes(golden.inputs.startup),
      'scripts.int': kif([
        ['main.kcs', kcsProgram([[37, 240], [43, 71, 4], [59]])],
        ['mot-fes23.kcs', bytes(golden.inputs.program)],
      ]),
      'images.int': bytes(golden.inputs.supportImagesArchive),
      'motion.int': kif([['unused.kcs', kcsProgram([[59]])]]),
      'motion-loose/mutable.kcs': programs[0],
      'fes.int': kif([['mot-attached.fes', new TextEncoder().encode(golden.inputs.source)]]),
    },
    { initialize },
  );
  // This is the ordinary current storage overlay, not a MotionLibrary reader
  // replacement. Existing actors and the library's named cache own their code.
  world.storage.read = async (path) =>
    path === 'motion-loose/mutable.kcs' ? programs[revision.value].slice() : null;
  return world;
}
function local(source, aliases) {
  const result = bytes(source),
    view = new DataView(result.buffer),
    pointerAliases = new Map();
  for (const at of [64, 68])
    if (aliases.has(at)) pointerAliases.set(view.getUint32(at, true), aliases.get(at));
  for (let at = 0; at < result.length; at += 4) {
    const value = view.getUint32(at, true);
    if (pointerAliases.has(value)) view.setUint32(at, pointerAliases.get(value), true);
  }
  for (const [at, handle] of aliases) view.setUint32(at, handle, true);
  return result;
}
async function compare(world, caller, row, aliases) {
  const wanted = local(row.local, aliases),
    diff = caller.machine.memory.findIndex((value, at) => value !== wanted[at]);
  assert.equal(diff, -1, row.label + ' first VM difference at ' + diff);
  for (const key of ['pc', 'sp', 'fp']) assert.equal(caller.machine[key], row[key]);
  const bank = world.runtime.variableBank(caller);
  assert.deepEqual(
    [61, 62, 63, 64].map((index) => bank.get(index)),
    row.globals,
  );
  assert.equal(
    world.motionLibrary.scripts.size,
    row.sourceCacheCount,
    row.label + ' current named cache',
  );
  for (const [key, at] of [
    ['a', 64],
    ['b', 68],
  ]) {
    const expected = row[key];
    if (!expected) continue;
    const manager = await world.runtime.services.motion.get(aliases.get(at));
    assert.deepEqual(
      manager.readBank(true),
      bytes(expected.working),
      row.label + ' working ' + key,
    );
    assert.equal(manager.records.size, expected.records.length);
    for (const original of expected.records) {
      const record = manager.records.get(original.handle),
        instance = record.instance;
      assert.equal(record.startTick, original.start);
      assert.equal(instance.script.recordName, original.name);
      assert.deepEqual(instance.shared, bytes(original.shared));
      for (const field of ['pc', 'sp', 'fp'])
        assert.equal(instance.machine[field], original.motVM[field]);
    }
  }
  const fes = [...world.objects.objects.values()].filter((record) => record.kind === 34);
  assert.equal(fes.length, row.phase === 6 ? 0 : 1);
  if (row.phase >= 1 && row.phase <= 2) {
    const instance = fes[0].implementation.player.root,
      holder = instance.byKey.get('holder');
    assert.equal(holder.nativeType, 3);
    const target = instance.runtime.targetFor(holder, false);
    assert(target);
    assert.equal(target.busy(), row.phase === 1, 'real FES stop cleared the attached manager');
  }
  if (row.phase >= 5) assert(!world.runtime.handles.records.has(aliases.get(68)));
  if (row.phase === 6) assert(!world.runtime.handles.records.has(aliases.get(64)));
}
for (const coldAt of [null, 0, 1, 2, 3, 4, 5]) {
  test(`SDK23 true FES/MOT source ownership${coldAt === null ? '' : ' with independent cold at phase' + coldAt}`, async () => {
    const revision = { value: 0 },
      aliases = new Map();
    let world = await open(revision),
      caller = await world.spawnScript('mot-fes23', { initialExecute: false });
    try {
      await world.runtime.native('main', 209, [512], caller.machine, caller);
      for (const row of golden.rows) {
        await world.objects.update(caller.id, row.frame);
        for (const at of [32, 44, 64, 68])
          if (!aliases.has(at) && caller.machine.load(at)) aliases.set(at, caller.machine.load(at));
        await compare(world, caller, row, aliases);
        if (row.phase === 1) revision.value = 1;
        if (row.phase === coldAt) {
          const id = caller.id,
            saved = await deserializeCheckpoint(await serializeCheckpoint(world.snapshot()));
          await world.close({ flushFiles: false });
          world = await open(revision, false);
          await world.restore(saved);
          caller = world.runtime.scheduler.tasks.get(id);
          await compare(world, caller, row, aliases);
        }
      }
    } finally {
      await world.close({ flushFiles: false });
    }
  });
}
