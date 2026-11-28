// SPDX-License-Identifier: MPL-2.0
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { dataWorld } from './fixtures/data-world.mjs';
import { kcsProgram } from './helpers.mjs';
import { nativeABI } from '../src/native/abi/index.mjs';

const golden = JSON.parse(
  await readFile(
    new URL('./fixtures/native-fes-private-legacy-golden.json', import.meta.url),
    'utf8',
  ),
);
const marker = 0xa1caa17e;
const program = (rows) =>
  kcsProgram([
    [37, marker],
    ...rows.flatMap((row) => [
      ...row.args.map((arg, index) => [37, index === 0 ? [0x13, 80] : arg]),
      [43, row.id, row.args.length * 4],
      ...(row.control === 1 ? [[45]] : []),
    ]),
    [59],
  ]);
for (const own of golden.versions) {
  test(`${own.version} real FES private GCALLs use a loaded Script context and preserve cold ownership`, async (t) => {
    const files = {
        'authored.fes': Uint8Array.from(own.sourceBytes),
        'private.kcs': program(own.calls),
      },
      world = await dataWorld(own.profile, files);
    t.after(() => world.close({ flushFiles: false }));
    const invoke = (id, args) =>
        world.runtime.native('main', id, args, world.main.machine, world.main),
      bank = world.runtime.variableBank(world.main);
    bank.initialize(512);
    assert.equal(bank.context(world.main.id), null);
    const created = await invoke(66, [34, world.nativeTaskID(world.main.id), 0]),
      id = world.resolveTaskID(created.value, world.main.id),
      record = world.objects.objects.get(id),
      target = world.nativeTaskID(id),
      fes = record.implementation;
    assert.equal(created.control, 1);
    assert.equal(record.kind, 34);
    world.main.machine.writeString('authored', 256);
    await invoke(447, [target, 256]);
    await invoke(448, [target]);
    await invoke(645, [target, 0, 7]);
    await invoke(665, [target]);
    assert.deepEqual(await invoke(646, [target, 0]), { control: 1, value: 7 });
    const task = await world.spawnScript('private.kcs', {
        parent: world.main.id,
        initialExecute: false,
      }),
      machine = task.machine;
    assert(bank.context(task.id));
    machine.store(80, target);
    machine.writeString('', 320);
    const dispatch = world.runtime.scheduler.dispatch;
    let at = 0;
    world.runtime.scheduler.dispatch = async (table, id, args, m, caller, ...rest) => {
      if (caller !== task) return dispatch(table, id, args, m, caller, ...rest);
      const row = own.calls[at++];
      assert.equal(id, row.id);
      if (row.label === 'synchronous native notification') machine.writeString('MES_SHOW', 256);
      if (row.label === 'synchronously fetch named operands') machine.writeString('FETCH', 256);
      if (row.label === 'set named private word') machine.writeString('named_value', 352);
      if (row.label.startsWith('set named ') && row.label !== 'set named private word')
        machine.writeString(row.label.slice(10), 352);
      const reply = await dispatch(table, id, args, m, caller, ...rest);
      assert.equal(reply.control, row.control, row.label);
      if (row.control === 1) assert.equal(reply.value, row.result, row.label);
      return reply;
    };
    await world.runtime.scheduler.execute(task);
    world.runtime.scheduler.dispatch = dispatch;
    assert.equal(at, own.calls.length);
    assert.equal(machine.pop(), marker);
    const key = fes.variableContextKey(),
      words = bank.context(key).words;
    assert.equal(words[511], 0x12345678 + 511);
    assert.equal(bank.context(task.id).words[511], words[511]);
    assert.equal(bank.context(key).names.size, 4);
    assert.equal(bank.context(task.id).names.size, 0);
    const saved = structuredClone(world.snapshot()),
      fresh = await dataWorld(own.profile, files, { initialize: false });
    t.after(() => fresh.close({ flushFiles: false }));
    await fresh.restore(saved);
    const restored = fresh.objects.objects.get(id).implementation,
      restoredBank = restored.variableBank();
    assert.deepEqual(restoredBank.context(key).words, words);
    assert.equal(restoredBank.context(key).names.size, 4);
    assert.equal(restored.player.root.value('_CLICK_L_'), 5);
    assert.equal(restored.player.root.value('_PUSH_DOWN_'), 0);
    assert.equal(restored.player.root.value('_CLICK_L_[1]'), 0);
    await world.objects.release(id);
    assert.equal(bank.context(key), null);
    assert(restoredBank.context(key));
    assert(restoredBank.context(task.id));
    for (const raw of [664, 665, 666, 667, 668]) {
      const entry = nativeABI(own.profile).tables.main.entries[raw];
      assert.equal(entry.status, 'recovered');
      assert.equal(entry.signature.resultWritten, raw === 667);
    }
    assert.throws(
      () => fresh.runtime.native('main', 688, [], fresh.main.machine, fresh.main),
      /Unsupported/,
    );
  });
}

const dynamicGolden = JSON.parse(
  await readFile(
    new URL('./fixtures/native-fes-dynamic-legacy-golden.json', import.meta.url),
    'utf8',
  ),
);
for (const own of dynamicGolden.versions) {
  test(`${own.version} dynamic BASE and deferred STRING owners route full GCALLs and retain ignored argv`, async (t) => {
    const files = {
        'authored.fes': Uint8Array.from(own.sourceBytes),
        'dynamic.kcs': program(own.calls),
      },
      world = await dataWorld(own.profile, files);
    t.after(() => world.close({ flushFiles: false }));
    world.runtime.variableBank(world.main).initialize(512);
    const id = await world.objects.create({ kind: 34, parent: world.main.id }),
      record = world.objects.objects.get(id),
      target = world.nativeTaskID(id),
      invoke = (main, args) =>
        world.runtime.native('main', main, args, world.main.machine, world.main);
    world.main.machine.writeString('authored', 256);
    await invoke(447, [target, 256]);
    await invoke(448, [target]);
    const task = await world.spawnScript('dynamic.kcs', {
        parent: world.main.id,
        initialExecute: false,
      }),
      m = task.machine;
    m.store(80, target);
    m.writeString('marker', 256);
    m.writeString('marker', 320);
    m.writeString('PRI', 352);
    m.writeString('PRI 123', 384);
    m.writeString('deferred_text', 416);
    const dispatch = world.runtime.scheduler.dispatch;
    let at = 0;
    const packets = [],
      send = world.sendNativeEngine;
    world.sendNativeEngine = function (to, sender, message, w, l, context = {}) {
      if ([338, 339].includes(message)) {
        const memory = context.payload;
        packets.push(
          message === 338
            ? {
                type: l,
                name: [...new TextEncoder().encode(memory.string(w))],
                count: memory.load(w + 32),
              }
            : { columns: memory.string(w), row: memory.string(l) },
        );
      }
      return send.call(this, to, sender, message, w, l, context);
    };
    world.runtime.scheduler.dispatch = async (table, main, args, machine, caller, ...rest) => {
      if (caller !== task) return dispatch(table, main, args, machine, caller, ...rest);
      const row = own.calls[at++];
      assert.equal(main, row.id);
      if (row.label.startsWith('notify declared')) m.writeString('PING', 256);
      if (row.label === 'query original PRI') m.writeString('PRI', 320);
      const reply = await dispatch(table, main, args, machine, caller, ...rest);
      assert.equal(reply.control, row.control, row.label);
      if (row.control === 1) assert.equal(reply.value, row.result, row.label);
      return reply;
    };
    await world.runtime.scheduler.execute(task);
    world.runtime.scheduler.dispatch = dispatch;
    assert.equal(at, own.calls.length);
    assert.equal(m.pop(), marker);
    assert.deepEqual(
      packets,
      own.packets.map((packet) =>
        packet.name
          ? { type: packet.type, name: packet.name, count: packet.count }
          : {
              columns: Buffer.from(packet.columns).toString(),
              row: Buffer.from(packet.row).toString(),
            },
      ),
    );
    assert.deepEqual(
      nativeABI(own.profile).fes.definitionTypes,
      own.factoryCatalog.map((row) => row.name),
    );
    const c = record.implementation.player.root.collection;
    assert.equal(c.count('marker'), 2);
    assert.equal(c.lookup('marker', 0).type, 'BASE');
    assert.equal(c.lookup('marker', 1).index, 1);
    assert.equal(c.lookup('deferred_text', 0).type, 'STRING');
    const fresh = await dataWorld(own.profile, files, { initialize: false });
    t.after(() => fresh.close({ flushFiles: false }));
    await fresh.restore(structuredClone(world.snapshot()));
    const fc = fresh.objects.objects.get(id).implementation.player.root.collection;
    assert.equal(fc.count('marker'), 2);
    assert.equal(fc.lookup('deferred_text', 0).type, 'STRING');
    await world.objects.release(id);
    assert.equal(fc.count('marker'), 2);
    for (const raw of [631, 632]) {
      const entry = nativeABI(own.profile).tables.main.entries[raw];
      assert.equal(entry.status, 'recovered');
      assert.equal(entry.signature.resultWritten, false);
    }
  });
}
