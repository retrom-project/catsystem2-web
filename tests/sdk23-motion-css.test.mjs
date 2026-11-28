// SPDX-License-Identifier: MPL-2.0
import assert from 'node:assert/strict';
import test from 'node:test';
import { readFile } from 'node:fs/promises';
import { modernParticleMessageWorld } from './fixtures/modern-particle-message-world.mjs';
import { kif, kcsProgram } from './helpers.mjs';
import { serializeCheckpoint, deserializeCheckpoint } from '../src/checkpoint.mjs';
import { NativeGlobalFile } from '../src/native/persistence.mjs';
const golden = JSON.parse(
    await readFile(new URL('./fixtures/sdk23-motion-css-golden.json', import.meta.url)),
  ),
  bytes = (value) => new Uint8Array(Buffer.from(value, 'base64'));

// strcpy writes the name only through NUL. The native keeps the other bytes
// uninitialized on first allocation; they are retained by later pure copies.
function knownRecord(source) {
  const copy = bytes(source);
  if (copy.length >= 44) {
    const end = copy.indexOf(0, 12);
    assert(end >= 12 && end < 44);
    copy.fill(0, end + 1, 44);
  }
  return copy;
}
async function open(saved, initialize = true) {
  const world = await modernParticleMessageWorld(
    golden.profile,
    {
      'startup.xml': bytes(golden.inputs.startup),
      'scripts.int': kif([
        ['main.kcs', kcsProgram([[37, 240], [43, 71, 4], [59]])],
        ['mot-css23.kcs', bytes(golden.inputs.program)],
      ]),
      'images.int': bytes(golden.inputs.supportImagesArchive),
      'motion.int': kif([['saved.kcs', bytes(golden.inputs.motionProgram)]]),
    },
    { initialize },
  );
  // The normal persistence service owns this test's in-memory output port.
  // The mounted game files remain read-only, and writes retain a private copy.
  world.runtime.services.persistence.read = async (name) => saved.get(name)?.slice() ?? null;
  world.runtime.services.persistence.write = async (name, data) => {
    assert.equal(name, 'mot-state23.css');
    saved.set(name, data.slice());
    return true;
  };
  return world;
}
function local(source, aliases) {
  const copy = bytes(source),
    view = new DataView(copy.buffer);
  const pointerAliases = new Map();
  for (const [at, handle] of aliases) pointerAliases.set(view.getUint32(at, true), handle);
  for (let at = 0; at < copy.length; at += 4) {
    const value = view.getUint32(at, true);
    if (pointerAliases.has(value)) view.setUint32(at, pointerAliases.get(value), true);
  }
  for (const [at, handle] of aliases) view.setUint32(at, handle, true);
  return copy;
}
async function compare(world, caller, row, aliases) {
  const { handles } = world.runtime;
  const wanted = local(row.local, aliases),
    first = caller.machine.memory.findIndex((word, at) => word !== wanted[at]);
  assert.equal(
    first,
    -1,
    row.label +
      ' first VM difference at ' +
      first +
      ': actual=' +
      caller.machine.memory[first] +
      ', expected=' +
      wanted[first],
  );
  for (const key of ['pc', 'sp', 'fp']) assert.equal(caller.machine[key], row[key]);
  for (const [key, at] of [
    ['capture', 72],
    ['restored', 84],
    ['detached', 88],
  ]) {
    const expected = row[key];
    if (!expected) continue;
    const actual = handles.get(aliases.get(at), 'motion-checkpoint');
    assert.equal(actual.owner, expected.owner ? aliases.get(at === 72 ? 64 : 80) : 0);
    assert.equal(actual.bytes.length, expected.capacity);
    assert.deepEqual(
      actual.bytes,
      knownRecord(expected.bytes),
      row.label + ' known checkpoint fields',
    );
  }
  if (row.target) {
    const manager = await world.runtime.services.motion.get(aliases.get(80)),
      record = manager.records.get(row.target.handle),
      instance = record.instance;
    assert.equal(manager.records.size, 1);
    assert.equal(record.group, row.target.group);
    assert.equal(record.startTick, row.target.start);
    assert.equal(instance.delay, row.target.delay);
    assert.equal(instance.script.recordName, row.target.filename);
    assert.deepEqual(instance.shared.subarray(156, 1180), bytes(row.target.registers));
    assert.equal(instance.machine.load(0x80000000 + 1180), row.target.extraPointer);
    assert.equal(instance.machine.load(0x80000000 + 1184), row.target.extraSize);
    if (row.target.frameKnown) {
      assert.equal(instance.frame, row.target.frame);
      assert.equal(instance.machine.load(64), row.target.motVM.seenFrame);
      assert.deepEqual(manager.readBank(true), bytes(row.target.working));
    } else assert.throws(() => instance.frame, /uninitialized memory/);
    for (const key of ['pc', 'sp', 'fp'])
      assert.equal(instance.machine[key], row.target.motVM[key]);
  }
  if (row.phase === 7) assert(!handles.records.has(aliases.get(80)));
}
for (const coldAt of [null, 0, 1, 2, 3, 4, 5, 6, 7]) {
  test(`SDK23 real CSS/MOT owned copy and restore${coldAt === null ? '' : ' with independent cold at phase' + coldAt}`, async () => {
    const saved = new Map(),
      aliases = new Map();
    let world = await open(saved),
      caller = await world.spawnScript('mot-css23', { initialExecute: false });
    try {
      for (const row of golden.rows) {
        await world.objects.update(caller.id, row.frame);
        for (const at of [64, 68, 72, 76, 80, 84, 88])
          if (!aliases.has(at) && caller.machine.load(at)) aliases.set(at, caller.machine.load(at));
        await compare(world, caller, row, aliases);
        if (row.phase === 2) {
          const actual = await NativeGlobalFile.fromFile(saved.get('mot-state23.css')),
            expected = await NativeGlobalFile.fromFile(bytes(golden.savedFiles[0].data));
          assert.equal(actual.tag, expected.tag);
          assert.deepEqual(
            actual.records.map((r) => [r.id, r.bytes.length]),
            [
              [7, 1087],
              [8, 1087],
            ],
          );
          for (let i = 0; i < actual.records.length; i++)
            assert.deepEqual(
              actual.records[i].bytes,
              knownRecord(Buffer.from(expected.records[i].bytes).toString('base64')),
            );
        }
        if (row.phase === coldAt) {
          const id = caller.id,
            snapshot = await deserializeCheckpoint(await serializeCheckpoint(world.snapshot()));
          await world.close({ flushFiles: false });
          world = await open(saved, false);
          await world.restore(snapshot);
          caller = world.runtime.scheduler.tasks.get(id);
          await compare(world, caller, row, aliases);
        }
      }
    } finally {
      await world.close({ flushFiles: false });
    }
  });
}
