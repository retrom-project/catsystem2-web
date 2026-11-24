// SPDX-License-Identifier: MPL-2.0
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { KCSMachine, encodeCP932, readKCS } from '../src/kcs.mjs';
import { dataWorld } from './fixtures/data-world.mjs';
import { kcsProgram } from './helpers.mjs';

const profile = 'grisaia-jp-engine-2.6.1.23',
  sentinel = 0x963f2ba1,
  name = 192,
  mode = 320,
  buffer = 448,
  source = Uint8Array.of(5, 17, 31, 241, 71);

async function invoke(world, id, args, control, prepare = () => {}) {
  const program = kcsProgram([
    [37, sentinel],
    ...args.map((word) => [37, word]),
    [43, id, args.length * 4],
    [59],
  ]);
  const task = { ...world.main, io: null },
    machine = (task.machine = new KCSMachine(await readKCS(program), {
      native: (number, supplied, caller) =>
        world.runtime.scheduler.native(task, number, supplied, caller),
    }));
  prepare(machine);
  const floor = machine.sp;
  assert.equal((await world.runtime.scheduler.execute(task)).status, 'halted');
  assert.equal(machine.sp, floor + (control === 1 ? 8 : 4));
  const result = control === 1 ? machine.pop() : undefined;
  assert.equal(machine.pop(), sentinel);
  return { machine, result };
}

test('fixed 2.6.1.23 file GCALLs scan formatted mode bytes and preserve owned file cursors', async () => {
  const files = new Map([['短い.dat', source]]),
    storage = {
      read: async (filename) => files.get(filename)?.slice() ?? null,
      write: async (filename, bytes) => files.set(filename, bytes.slice()),
    },
    world = await dataWorld(profile, {}, { storage });
  let restored;
  try {
    const open = (filename, flags) =>
      invoke(world, 29, [name, mode], 1, (machine) => {
        machine.writeString(filename, name);
        machine.writeStringBytes(flags, mode);
      });
    const missing = await open('missing.dat', encodeCP932('rb'));
    assert.equal(missing.result, 0);
    const raw = await open('短い.dat', Uint8Array.of(0x81, 0x72)),
      ordinary = await open('短い.dat', encodeCP932('R+')),
      handle = raw.result;
    assert.ok(handle);
    assert.ok(ordinary.result);
    assert.notEqual(handle, ordinary.result);
    assert.equal((await invoke(world, 31, [buffer, 1, 3, handle], 1)).result, 0);
    const initial = await invoke(world, 30, [buffer + 1, 2, 2, handle], 1, (machine) => {
      machine.bytes(buffer, 8).fill(0x63);
    });
    assert.equal(initial.result, 4);
    assert.deepEqual(
      [...initial.machine.bytes(buffer, 8)],
      [0x63, 5, 17, 31, 241, 0x63, 0x63, 0x63],
    );
    assert.equal((await invoke(world, 30, [0xffffffff, 1, 2, handle], 1)).result, 0);
    assert.equal((await invoke(world, 30, [0xffffffff, 1, 2, 0], 1)).result, 0);
    await assert.rejects(
      invoke(world, 30, [initial.machine.memory.length - 2, 2, 2, ordinary.result], 1),
      /KCS memory/,
    );
    const second = await invoke(world, 30, [buffer, 0x80000001, 2, ordinary.result], 1);
    assert.equal(second.result, 2);
    assert.deepEqual([...second.machine.bytes(buffer, 2)], [5, 17]);

    restored = await dataWorld(profile, {}, { initialize: false, storage });
    await restored.restore(structuredClone(world.snapshot()));
    const remaining = await invoke(restored, 30, [buffer + 1, 8, 8, handle], 1, (machine) => {
      machine.bytes(buffer, 4).fill(0x63);
    });
    assert.equal(remaining.result, 1);
    assert.deepEqual([...remaining.machine.bytes(buffer, 4)], [0x63, 71, 0x63, 0x63]);
    assert.equal((await invoke(restored, 30, [buffer, 1, 1, handle], 1)).result, 0);
    await invoke(restored, 32, [handle], 2);
    await invoke(restored, 32, [0], 2);
    await assert.rejects(
      invoke(restored, 30, [buffer, 1, 1, handle], 1),
      /Invalid or released native file handle/,
    );
    const created = await open('created.dat', Uint8Array.of(0x81, 0x77));
    assert.equal(files.has('created.dat'), false);
    const written = await invoke(world, 31, [buffer, 0x80000001, 2, created.result], 1, (machine) =>
      machine.bytes(buffer, 4).set([11, 41, 73, 255]),
    );
    assert.equal(written.result, 2);
    assert.equal((await invoke(world, 31, [0xffffffff, 2, 1, 0], 1)).result, 0);
    assert.equal((await invoke(world, 30, [buffer, 1, 2, created.result], 1)).result, 0);
    await invoke(world, 32, [created.result], 2);
    assert.deepEqual(files.get('created.dat'), Uint8Array.of(11, 41));
  } finally {
    await restored?.close({ flushFiles: false });
    await world.close({ flushFiles: false });
  }
});

test('fixed 2.6.1.23 section table GCALLs match CP932 bytes, ordinals and bounded outputs', async () => {
  const resource = encodeCP932(
    '#main\r\nkey First\r\nkey Second\r\nKey Upper\r\nempty\r\n\tkey   Third value  // comment\r\n' +
      '#other\r\nkey Other\r\n#main\r\nkey Fourth?\r\n#main suffix\r\nkey Multiple\r\n#漢字\r\n声 確認\r\n',
  );
  const world = await dataWorld(profile, { 'table.txt': resource, 'empty.txt': new Uint8Array() });
  let restored;
  try {
    const load = (filename) =>
      invoke(world, 683, [name], 1, (machine) => machine.writeString(filename, name));
    const file = await load('table.txt'),
      empty = await load('empty.txt');
    assert.ok(file.result);
    assert.ok(empty.result);
    assert.equal((await load('missing.txt')).result, 0);
    assert.equal(world.runtime.handles.get(empty.result, 'section-table').sections.size, 0);
    await invoke(world, 684, [empty.result], 2);
    restored = await dataWorld(profile, {}, { initialize: false });
    await restored.restore(structuredClone(world.snapshot()));
    for (const [section, key, ordinal, value] of [
      ['#main', 'key', 0, 'First'],
      ['#main', 'key', 1, 'Second'],
      ['#main', 'key', 2, 'Third value'],
      ['#main', 'key', 3, 'Fourth?'],
      ['#main', 'key', 4, null],
      ['#main', 'key', -1, null],
      ['#main', 'Key', 0, 'Upper'],
      ['#MAIN', 'key', 0, null],
      ['main', 'key', 0, null],
      ['#main', 'empty', 0, ''],
      ['#other', 'key', 0, 'Other'],
      ['#main suffix', 'key', 0, 'Multiple'],
      ['#漢字', '声', 0, '確認'],
    ]) {
      const { machine, result } = await invoke(
        restored,
        685,
        [file.result, name, mode, ordinal, buffer + 1],
        1,
        (machine) => {
          machine.writeString(section, name);
          machine.writeString(key, mode);
          machine.bytes(buffer, 32).fill(0x77);
        },
      );
      const expected = Array(32).fill(0x77);
      if (value !== null)
        expected.splice(1, encodeCP932(value).length + 1, ...encodeCP932(value), 0);
      assert.equal(result, Number(value !== null));
      assert.deepEqual([...machine.bytes(buffer, 32)], expected);
    }
    assert.equal(
      (await invoke(restored, 685, [0, 0xffffffff, 0xffffffff, 0, buffer], 1)).result,
      0,
    );
    await invoke(restored, 684, [file.result], 2);
    await invoke(restored, 684, [0], 2);
  } finally {
    await restored?.close({ flushFiles: false });
    await world.close({ flushFiles: false });
  }
});
