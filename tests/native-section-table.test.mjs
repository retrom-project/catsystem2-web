// SPDX-License-Identifier: MPL-2.0
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { sectionFixture, sectionFiles } from './fixtures/section-table-fixture.mjs';
import { dataWorld } from './fixtures/data-world.mjs';
import { encodeCP932 } from '../src/kcs/strings.mjs';
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
