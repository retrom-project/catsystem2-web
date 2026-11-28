// SPDX-License-Identifier: MPL-2.0
import test from 'node:test';
import assert from 'node:assert/strict';
import { dataWorld } from './fixtures/data-world.mjs';
import { hg3, kcsProgram } from './helpers.mjs';
const profiles = [
  'grisaia-jp-engine-2.6.1.23',
  'rebellions-jp-engine-2.6.1.63',
  'bokutomo-engine-2.6.1.67',
];
async function open(profile) {
  const world = await dataWorld(profile, {
    'authored.fes': new TextEncoder().encode(
      '#DEFINE\nCIMAGE chip\n#OBJECT SIZE COLOR\nchip 2,2 0xff334455\n#START\nnext WAIT\n#WAIT\n',
    ),
    'observer.kcs': kcsProgram([[59]]),
  });
  world.graphics.createLogicalDevice();
  world.runtime.variableBank(world.main).initialize(512);
  const invoke = (id, args) =>
      world.runtime.native('main', id, args, world.main.machine, world.main),
    made = await invoke(66, [34, world.nativeTaskID(world.root), 0]),
    id = world.resolveTaskID(made.value, world.main.id),
    record = world.objects.objects.get(id),
    fes = record.implementation;
  assert.equal(record.parent, world.root);
  world.main.machine.writeString('authored', 256);
  await invoke(447, [made.value, 256]);
  await invoke(448, [made.value]);
  const buffers = world.runtime.imageDataBuffers,
    pointer = buffers.createPointer(hg3(1, 1, Uint8Array.from([1, 2, 3, 255])));
  fes.imageCacheModel.insert('held', pointer);
  buffers.releasePointer(pointer);
  assert.equal(buffers.words(pointer)[3], 1);
  const bitmapHandles = [...world.runtime.handles.records]
    .filter(([, r]) => r.type === 'bitmap' && r.value.owner === id)
    .map(([handle]) => handle);
  assert(bitmapHandles.length);
  return {
    world,
    id,
    record,
    fes,
    buffers,
    pointer,
    bank: record.context.variableBank,
    bitmapHandles,
  };
}
for (const profile of profiles) {
  test(`${profile} final disposal survives a supplying Script released first and frees FES resources`, async () => {
    const h = await open(profile);
    await h.world.close({ flushFiles: false });
    assert.equal(h.world.closed, true);
    assert.equal(h.buffers.owns(h.pointer), false);
    assert.equal(h.world.runtime.handles.records.size, 0);
    assert.equal(h.world.objects.objects.size, 0);
  });
  test(`${profile} a live VM keeps released-bank failures strict before final disposal`, async () => {
    const h = await open(profile),
      observer = await h.world.spawnScript('observer.kcs', {
        parent: h.world.root,
        initialExecute: false,
      });
    await h.world.objects.release(h.world.main.id);
    assert.equal(h.world.runtime.handles.records.has(h.bank), false);
    assert.throws(() => h.fes.variableBank(), /Invalid or released native variable-bank/);
    await assert.rejects(
      () =>
        h.world.runtime.native(
          'main',
          646,
          [h.world.nativeTaskID(h.id), 0],
          observer.machine,
          observer,
        ),
      /Invalid or released native variable-bank/,
    );
    await assert.rejects(
      () => h.world.close({ flushFiles: false }),
      (error) => {
        const leaves = [];
        const visit = (e) =>
          e instanceof AggregateError ? e.errors.forEach(visit) : leaves.push(e);
        visit(error);
        assert(leaves.length);
        assert(leaves.every((e) => /Invalid or released native variable-bank/.test(e.message)));
        return true;
      },
    );
    assert.equal(h.world.closed, true);
    assert.equal(h.buffers.owns(h.pointer), false);
    assert.equal(h.world.runtime.handles.records.size, 0);
  });
  test(`${profile} live banks still unregister normally and fresh restore rebuilds validation`, async () => {
    const h = await open(profile),
      bank = h.fes.variableBank(),
      key = h.fes.variableContextKey(),
      saved = structuredClone(h.world.snapshot());
    assert(bank.context(key));
    await h.world.objects.release(h.id);
    assert.equal(bank.context(key), null);
    assert.equal(h.world.runtime.handles.get(h.bank, 'variable-bank'), bank);
    await h.world.close({ flushFiles: false });
    const fresh = await dataWorld(profile, {}, { initialize: false });
    await fresh.restore(saved);
    await fresh.close({ flushFiles: false });
    assert.equal(fresh.runtime.handles.records.size, 0);
  });
}
test('final disposal does not bypass an existing wrong-type or never-validated missing bank', async () => {
  const h = await open(profiles[1]),
    handles = h.world.runtime.handles,
    bank = handles.records.get(h.bank);
  handles.records.set(h.bank, { type: 'foreign', value: {} });
  h.world.disposalRequested = true;
  await assert.rejects(() => h.fes.closeInterpreter(), /has type foreign, expected variable-bank/);
  handles.records.set(h.bank, bank);
  const old = h.record.context.variableBank;
  h.record.context.variableBank = 0x7fff0000;
  await assert.rejects(() => h.fes.closeInterpreter(), /Invalid or released native variable-bank/);
  h.record.context.variableBank = old;
  await h.world.close({ flushFiles: false });
});
