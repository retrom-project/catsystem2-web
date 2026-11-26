// SPDX-License-Identifier: MPL-2.0
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { dataWorld } from './fixtures/data-world.mjs';
import { kcsProgram } from './helpers.mjs';
import { NativeFileStorage } from '../src/native/storage.mjs';
import { NativeGlobalFile } from '../src/native/persistence.mjs';
import { nativeABI } from '../src/native/abi/index.mjs';
const golden = JSON.parse(
  await readFile(new URL('./fixtures/native-fes-bank63-golden.json', import.meta.url), 'utf8'),
);
const ptr = (address) => [0x13, address],
  marker = 0xc0665a78;
function program(rows) {
  return kcsProgram(
    [
      [37, marker],
      ...rows.flatMap((row) => [
        ...row.args.map((arg, index) => [
          37,
          arg === golden.file
            ? ptr(96)
            : arg === golden.reopened
              ? ptr(100)
              : ([645, 646].includes(row.id) && index === 0) ||
                  ([649, 650].includes(row.id) && index === 2)
                ? ptr(80)
                : arg,
        ]),
        [43, row.id, row.args.length * 4],
        ...(row.control === 1 ? [[38, row.id === 238 ? 96 : row.id === 247 ? 100 : 104]] : []),
      ]),
      [59],
    ],
    [[256, 'save0001.dat']],
  );
}
async function target(world) {
  world.runtime.variableBank(world.main).initialize(512);
  const invoke = (id, args) =>
      world.runtime.native('main', id, args, world.main.machine, world.main),
    created = await invoke(66, [34, world.nativeTaskID(world.main.id), 0]),
    id = world.resolveTaskID(created.value, world.main.id);
  world.main.machine.writeString('authored', 256);
  await invoke(447, [created.value, 256]);
  await invoke(448, [created.value]);
  return { id, nativeID: created.value, record: world.objects.objects.get(id) };
}
const storage = () =>
  new NativeFileStorage({ lookup: () => null, read: async () => null }, 'fes63-private');
test('63 real FES bank CSS passes through native GAME_SAVE and an independent fresh World', async (t) => {
  const source = Uint8Array.from(golden.sourceBytes),
    files = { 'authored.fes': source, 'save.kcs': program(golden.calls) },
    store = storage();
  await store.prepareGameSave(
    golden.nativeFiles.map((f) => ({
      path: f.path,
      bytes: Uint8Array.from(f.bytes),
      createdMs: 1700000000000,
      modifiedMs: 1700000002000,
      accessedMs: 1700000001000,
      attributes: 0x80,
    })),
  );
  const world = await dataWorld(golden.profile, files, { storage: store });
  t.after(() => world.close({ flushFiles: false }));
  const fes = await target(world),
    task = await world.spawnScript('save.kcs', { parent: world.main.id, initialExecute: false });
  task.machine.store(80, fes.nativeID);
  const dispatch = world.runtime.scheduler.dispatch;
  let at = 0;
  world.runtime.scheduler.dispatch = async (table, id, args, m, caller, ...rest) => {
    if (caller !== task) return dispatch(table, id, args, m, caller, ...rest);
    const row = golden.calls[at++];
    assert.equal(id, row.id);
    const reply = await dispatch(table, id, args, m, caller, ...rest);
    assert.equal(reply.control, row.control, row.label);
    if (row.control === 1) {
      if ([238, 247].includes(row.id)) assert(reply.value);
      else assert.equal(reply.value, row.result, row.label);
    }
    return reply;
  };
  await world.runtime.scheduler.execute(task);
  world.runtime.scheduler.dispatch = dispatch;
  assert.equal(at, golden.calls.length);
  assert.equal(task.machine.pop(), marker);
  const exported = store.exportGameSave();
  assert.equal(exported.files.length, 1);
  const decoded = await NativeGlobalFile.fromFile(exported.files[0].bytes);
  assert.deepEqual(decoded.read(0x12345678), Uint8Array.from(golden.payload));
  assert.deepEqual(exported.files[0].bytes, Uint8Array.from(golden.nativeFiles[0].bytes));
  const resumeRows = [
      { id: 247, args: [256], control: 1 },
      { id: 645, args: [golden.target, 0, 0], control: 2 },
      { id: 650, args: [golden.reopened, 0x12345678, golden.target], control: 1 },
      { id: 646, args: [golden.target, 0], control: 1 },
      { id: 646, args: [golden.target, 511], control: 1 },
    ],
    freshStore = storage();
  await freshStore.prepareGameSave(exported.files);
  const fresh = await dataWorld(
    golden.profile,
    { ...files, 'resume.kcs': program(resumeRows) },
    { storage: freshStore },
  );
  t.after(() => fresh.close({ flushFiles: false }));
  const restored = await target(fresh),
    caller = await fresh.spawnScript('resume.kcs', {
      parent: fresh.main.id,
      initialExecute: false,
    });
  caller.machine.store(80, restored.nativeID);
  await fresh.runtime.scheduler.execute(caller);
  assert.equal(caller.machine.load(104), 0x89abcdef);
  const implementation = restored.record.implementation;
  assert.equal(implementation.privateContext().words[0], 0xfedcba98);
  assert.equal(implementation.privateContext().words[511], 0x89abcdef);
  assert.equal(implementation.player.root.label, '_LOAD_');
  assert.equal(caller.machine.pop(), marker);
  assert.equal(nativeABI(golden.profile).tables.main.entries[650].status, 'recovered');
  assert.throws(() => fresh.runtime.native('main', 688, [], caller.machine, caller), /Unsupported/);
});
