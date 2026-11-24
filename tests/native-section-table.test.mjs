// SPDX-License-Identifier: MPL-2.0
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { sectionFixture, sectionFiles } from './fixtures/section-table-fixture.mjs';
import { dataWorld } from './fixtures/data-world.mjs';
import { encodeCP932 } from '../src/kcs/strings.mjs';
import { kcsProgram } from './helpers.mjs';
for (const [profile, variable] of [
  ['sdk-4.01-engine-2.6.1.74', 'CATSYSTEM2_SDK_EXE'],
  ['nekopara-vol3-engine-2.6.1.76', 'CATSYSTEM2_ENGINE_EXE'],
]) {
  test(
    profile +
      ' section tables preserve source order, exact keys, output aliases and valid empty files',
    { skip: !process.env[variable] },
    async () => {
      const f = await sectionFixture(
          new Uint8Array(await readFile(process.env[variable])),
          profile,
        ),
        { tables, machine: m, engine } = f,
        call = (id, args) => tables.apply(id, args, m, { id: 1 }),
        put = (s, at) => m.writeString(s, at);
      try {
        put('basic.txt', 256);
        const h = (await call(0x2ab, [256])).value;
        assert.ok(h);
        for (const [section, key, index, expected] of [
          ['#first', 'key', 0, 'first value'],
          ['#first', 'key', 1, 'second value'],
          ['#first', 'key', 2, 'third value'],
          ['#First', 'key', 0, 'case distinct'],
          ['#second', 'key', 0, '日本語'],
          ['#first', 'empty', 0, ''],
          ['#first', 'spaces', 0, 'keep two leading'],
          ['#first', 'comment', 0, 'before after'],
        ]) {
          put(section, 512);
          put(key, 768);
          m.bytes(1024, 600).fill(0xa5);
          assert.equal((await call(0x2ad, [h, 512, 768, index, 1024])).value, 1);
          assert.equal(m.string(1024), expected);
          assert.equal(m.bytes(1024, 600)[encodeCP932(expected).length + 1], 0xa5);
        }
        for (const [section, key, index] of [
          ['first', 'key', 0],
          ['#first', 'Key', 0],
          ['#first', 'key', 3],
          ['#first', 'key', 0xffffffff],
        ]) {
          put(section, 512);
          put(key, 768);
          m.bytes(1024, 64).fill(0xa5);
          assert.equal((await call(0x2ad, [h, 512, 768, index, 1024])).value, 0);
          assert.deepEqual(m.bytes(1024, 64), new Uint8Array(64).fill(0xa5));
        }
        put('#first', 512);
        put('key', 768);
        assert.equal((await call(0x2ad, [h, 512, 768, 1, 512])).value, 1);
        assert.equal(m.string(512), 'second value');
        const pointer = tables.pointer(h);
        await call(0x2ac, [h]);
        assert.equal(engine.process.allocations.has(pointer), false);
        put('syntax.txt', 256);
        const syntax = (await call(0x2ab, [256])).value;
        for (const [key, expected] of [
          ['tab', 'value'],
          ['colon:value', ''],
          ['semi', ';value'],
        ]) {
          put('#one', 512);
          put(key, 768);
          assert.equal((await call(0x2ad, [syntax, 512, 768, 0, 1024])).value, 1);
          assert.equal(m.string(1024), expected);
        }
        await call(0x2ac, [syntax]);
        put('empty.txt', 256);
        const empty = (await call(0x2ab, [256])).value;
        assert.ok(empty);
        await call(0x2ac, [empty]);
        put('missing.txt', 256);
        assert.equal((await call(0x2ab, [256])).value, 0);
        assert.deepEqual(await call(0x2ad, [0]), { control: 1, value: 0 });
        assert.deepEqual(await call(0x2ac, [0]), { control: 2 });
      } finally {
        await engine.close();
      }
    },
  );
}
for (const profile of [
  'rebellions-jp-engine-2.6.1.63',
  'bokutomo-engine-2.6.1.67',
  'sdk-4.01-engine-2.6.1.74',
  'nekopara-vol3-engine-2.6.1.76',
]) {
  test(
    profile + ' JS section tables restore imported bytes independently of source files',
    async () => {
      const first = await dataWorld(profile, Object.fromEntries(sectionFiles()));
      let fresh;
      const call = (world, id, args) =>
        world.runtime.native('main', id, args, world.main.machine, world.main);
      try {
        first.main.machine.writeString('basic.txt', 256);
        const h = (await call(first, 0x2ab, [256])).value;
        fresh = await dataWorld(
          profile,
          { 'basic.txt': encodeCP932('#first\nkey changed\n') },
          { initialize: false },
        );
        await fresh.restore(structuredClone(first.snapshot()));
        fresh.main.machine.writeString('#first', 512);
        fresh.main.machine.writeString('key', 768);
        assert.equal((await call(fresh, 0x2ad, [h, 512, 768, 2, 1024])).value, 1);
        assert.equal(fresh.main.machine.string(1024), 'third value');
        await call(fresh, 0x2ac, [h]);
        await assert.rejects(() => call(fresh, 0x2ad, [h, 512, 768, 0, 1024]), /released/);
        assert.ok(first.runtime.handles.get(h, 'section-table'));
      } finally {
        await fresh?.close({ flushFiles: false });
        await first.close({ flushFiles: false });
      }
    },
  );
}

test('fixed 2.6.1.67 KCS opens, queries and releases a CP932 section table', async (t) => {
  const filename = 256,
    section = 512,
    key = 640,
    out = 768,
    handle = [0x13, 128],
    marker = 0xdd674a95;
  const resultCall = (id, words, result) => [
    ...words.map((word) => [37, word]),
    [43, id, words.length * 4],
    [38, result],
  ];
  const world = await dataWorld('bokutomo-engine-2.6.1.67', {
    ...Object.fromEntries(sectionFiles()),
    'section.kcs': kcsProgram([
      [37, marker],
      ...resultCall(683, [filename], 128),
      ...resultCall(685, [handle, section, key, [0x13, 132], out], 136),
      [37, handle],
      [43, 684, 4],
      [59],
    ]),
  });
  t.after(() => world.close({ flushFiles: false }));
  for (const [file, group, entry, ordinal, expected] of [
    ['basic.txt', '#first', 'key', 0, 'first value'],
    ['basic.txt', '#first', 'key', 2, 'third value'],
    ['basic.txt', '#First', 'key', 0, 'case distinct'],
    ['basic.txt', '#first', 'empty', 0, ''],
    ['basic.txt', '#first', 'comment', 0, 'before after'],
    ['basic.txt', '#second', 'key', 0, '日本語'],
    ['basic.txt', '#first', 'Key', 0, null],
    ['basic.txt', '#first', 'key', -1, null],
    ['basic.txt', '#first', 'key', 3, null],
    ['empty.txt', '#first', 'key', 0, null],
    ['missing.txt', '#first', 'key', 0, null],
  ]) {
    const task = await world.spawnScript('section.kcs', {
        parent: world.main.id,
        initialExecute: false,
      }),
      machine = task.machine,
      floor = machine.sp;
    machine.writeString(file, filename);
    machine.writeString(group, section);
    machine.writeString(entry, key);
    machine.store(132, ordinal);
    machine.bytes(out - 1, 40).fill(0x91);
    assert.equal((await world.runtime.scheduler.execute(task)).status, 'halted');
    assert.equal(machine.sp, floor + 4);
    assert.equal(machine.pop(), marker);
    const loaded = machine.load(128);
    assert.equal(Boolean(loaded), file !== 'missing.txt');
    assert.equal(world.runtime.handles.records.has(loaded), false);
    assert.equal(machine.load(136), Number(expected !== null));
    const encoded = expected === null ? [] : [...encodeCP932(expected), 0];
    assert.deepEqual(
      [...machine.bytes(out - 1, 40)],
      [0x91, ...encoded, ...new Array(39 - encoded.length).fill(0x91)],
    );
  }
});

test('63 section table lookup returns CP932 data and its integer wrapper reads the same buffer', async () => {
  const world = await dataWorld('rebellions-jp-engine-2.6.1.63', {
    'table.txt': encodeCP932('#name\r\nkey 0x2b\r\nkey -27trailing\r\nkey 日本語\r\n'),
  });
  try {
    const { main } = world,
      m = main.machine,
      call = (id, args) => world.runtime.native('main', id, args, m, main);
    m.writeString('table.txt', 256);
    m.writeString('#name', 512);
    m.writeString('key', 768);
    const handle = (await call(683, [256])).value;
    assert.ok(handle);
    for (const [ordinal, expected] of [
      [0, 43],
      [1, -27 >>> 0],
    ]) {
      assert.deepEqual(await call(685, [handle, 512, 768, ordinal, 1024]), {
        control: 1,
        value: 1,
      });
      assert.deepEqual(await call(25, [1024]), { control: 1, value: expected });
    }
    assert.deepEqual(await call(685, [handle, 512, 768, 2, 1024]), { control: 1, value: 1 });
    assert.equal(m.string(1024), '日本語');
    assert.deepEqual(await call(685, [handle, 512, 768, 3, 1024]), { control: 1, value: 0 });
    assert.equal(m.string(1024), '日本語');
    m.writeString('12.5', 1024);
    assert.deepEqual(await call(25, [1024]), { control: 1, value: 0 });
    assert.deepEqual(await call(684, [handle]), { control: 2 });
  } finally {
    await world.close({ flushFiles: false });
  }
});
