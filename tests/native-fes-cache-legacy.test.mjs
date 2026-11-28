// SPDX-License-Identifier: MPL-2.0
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { dataWorld } from './fixtures/data-world.mjs';
import { kcsProgram } from './helpers.mjs';
import { nativeABI } from '../src/native/abi/index.mjs';
const golden = JSON.parse(
  await readFile(
    new URL('./fixtures/native-fes-cache-legacy-golden.json', import.meta.url),
    'utf8',
  ),
);
const ptr = (address) => [0x13, address],
  marker = 0xc066738a;
function program(own) {
  return kcsProgram(
    [
      [37, marker],
      ...own.calls.flatMap((row) => [
        ...row.args.map((arg, index) => [
          37,
          arg === own.pointer
            ? ptr(96)
            : arg === own.other
              ? ptr(100)
              : [738, 67].includes(row.id) && index === 0
                ? ptr(80)
                : arg,
        ]),
        [43, row.id, row.args.length * 4],
        ...(row.control === 1
          ? [[38, row.label === 'load independent duplicate candidate' ? 100 : 96]]
          : []),
      ]),
      [59],
    ],
    [
      [256, 'tiny.hg3'],
      [320, 'cache-key'],
      [352, 'cache-alias'],
    ],
  );
}
for (const own of golden.versions) {
  test(`${own.version} cached real ImageData survives retirement and cold sharing, then releases exactly once`, async (t) => {
    const files = {
        'authored.fes': new TextEncoder().encode('#START\nnext WAIT\n#WAIT\n'),
        'tiny.hg3': Uint8Array.from(own.image),
        'cache.kcs': program(own),
      },
      world = await dataWorld(own.profile, files);
    t.after(() => world.close({ flushFiles: false }));
    world.runtime.variableBank(world.main).initialize(512);
    const invoke = (id, args) =>
        world.runtime.native('main', id, args, world.main.machine, world.main),
      created = await invoke(66, [34, world.nativeTaskID(world.main.id), 0]),
      target = created.value,
      id = world.resolveTaskID(target, world.main.id),
      record = world.objects.objects.get(id);
    world.main.machine.writeString('authored', 256);
    await invoke(447, [target, 256]);
    await invoke(448, [target]);
    const task = await world.spawnScript('cache.kcs', {
        parent: world.main.id,
        initialExecute: false,
      }),
      m = task.machine,
      buffers = world.runtime.imageDataBuffers;
    m.store(80, target);
    const dispatch = world.runtime.scheduler.dispatch;
    let at = 0,
      pointer,
      other;
    const refs = [],
      labels = new Map([
        ['cache real descriptor under new key', 'new key'],
        ['cache duplicate key again', 'duplicate key'],
        ['cache shared descriptor under another key', 'second key'],
        ['release caller descriptor reference', 'caller released'],
        ['retire real FES owner', 'retiring owner keeps cache'],
      ]);
    world.runtime.scheduler.dispatch = async (table, main, args, machine, caller, ...rest) => {
      if (caller !== task) return dispatch(table, main, args, machine, caller, ...rest);
      const row = own.calls[at++];
      assert.equal(main, row.id);
      const reply = await dispatch(table, main, args, machine, caller, ...rest);
      assert.equal(reply.control, row.control, row.label);
      if (main === 365) {
        assert(reply.value);
        const p = buffers.pointer(reply.value);
        if (pointer === undefined) pointer = p;
        else other = p;
      }
      const label = labels.get(row.label);
      if (label) refs.push({ label, words: buffers.words(pointer).slice(1) });
      if (row.label === 'duplicate key does not retain other descriptor')
        assert.equal(buffers.words(other)[3], 1);
      if (row.label === 'release duplicate candidate') assert.equal(buffers.owns(other), false);
      return reply;
    };
    await world.runtime.scheduler.execute(task);
    world.runtime.scheduler.dispatch = dispatch;
    assert.equal(at, own.calls.length);
    assert.equal(m.pop(), marker);
    assert.deepEqual(refs, own.refs);
    assert.equal(record.destroyRequested, true);
    assert.equal(record.implementation.imageCacheModel.entries.size, 2);
    assert.deepEqual(buffers.data(pointer), Uint8Array.from(own.image));
    const fresh = await dataWorld(own.profile, files, { initialize: false });
    t.after(() => fresh.close({ flushFiles: false }));
    await fresh.restore(structuredClone(world.snapshot()));
    const restored = fresh.objects.objects.get(id),
      cache = restored.implementation.imageCacheModel,
      freshBuffers = fresh.runtime.imageDataBuffers;
    assert.deepEqual([...cache.entries.values()], [pointer, pointer]);
    assert.equal(freshBuffers.words(pointer)[3], 2);
    assert.equal(restored.destroyRequested, true);
    await world.objects.release(id);
    assert.equal(buffers.owns(pointer), false);
    assert.equal(freshBuffers.owns(pointer), true);
    await fresh.objects.release(id);
    assert.equal(freshBuffers.owns(pointer), false);
    assert.equal(nativeABI(own.profile).tables.main.entries[738].status, 'recovered');
  });
}
