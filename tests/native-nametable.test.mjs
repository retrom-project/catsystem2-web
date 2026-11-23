// SPDX-License-Identifier: MPL-2.0
import { dataWorld } from './fixtures/data-world.mjs';
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { nameTableFixture, nameTableFiles } from './fixtures/name-table-fixture.mjs';
import { encodeCP932 } from '../src/kcs/strings.mjs';

for (const [profile, variable] of [
  ['nekopara-vol3-engine-2.6.1.76', 'CATSYSTEM2_ENGINE_EXE'],
  ['sdk-4.01-engine-2.6.1.74', 'CATSYSTEM2_SDK_EXE'],
]) {
  test(
    `${profile} name table original parser, exact aliases, fields and filename substitution use one owner`,
    { skip: !process.env[variable] },
    async () => {
      const f = await nameTableFixture(
          new Uint8Array(await readFile(process.env[variable])),
          profile,
        ),
        m = f.machine,
        call = (id, args) => f.tables.apply(id, args, m, { id: 1 });
      try {
        m.writeString('names.tsv', 256);
        const h = (await call(0x279, [256])).value,
          pointer = f.tables.pointer(h);
        assert.equal(f.process.allocations.get(pointer), 4);
        m.writeString('Alias', 512);
        assert.equal(
          (await call(0x27b, [h, 512])).value,
          profile.startsWith('sdk-') ? 0xffffffff : 0,
        );
        m.writeString('alias', 512);
        assert.equal((await call(0x27b, [h, 512])).value, 0xffffffff);
        m.writeString('Same', 512);
        assert.equal(
          (await call(0x27b, [h, 512])).value,
          profile.startsWith('sdk-') ? 0xffffffff : 0,
        );
        assert.equal((await call(0x27c, [h, 0])).value, 7);
        m.bytes(1024, 64).fill(0xa5);
        assert.equal((await call(0x27d, [h, 0, 1024])).value, 1);
        assert.equal(m.string(1024), '猫');
        assert.equal(m.load(1027, 1), 0xa5);
        assert.equal((await call(0x27e, [h, 0, 0, 1024])).value, 1);
        assert.equal(m.string(1024), 'bg*.hg2');
        assert.equal((await call(0x27e, [h, 0, 2, 1024])).value, 0);
        assert.equal(m.string(1024), 'bg*.hg2');
        m.writeString('bg001.hg2,1,2', 512);
        assert.equal((await call(0x280, [h, 0, 512, 1024])).value, 1);
        assert.equal(m.string(1024), 'bg*.hg2-001-bg001.hg2,1,2-,1,2');
        assert.equal((await call(0x27f, [h, 0, 512])).value, 0);
        assert.equal((await call(0x27c, [0])).value, 0xffffffff);
        assert.equal((await call(0x280, [0])).value, 0);
        for (const name of ['empty.tsv', 'missing.tsv']) {
          m.writeString(name, 256);
          assert.equal((await call(0x279, [256])).value, 0);
        }
        m.writeString('header.tsv', 256);
        const empty = (await call(0x279, [256])).value;
        assert.ok(empty);
        assert.equal((await call(0x27c, [empty, 0])).value, 0xffffffff);
        await call(0x27a, [empty]);
        m.nativeArgumentBase = 3000;
        m.store(3000, h);
        await call(0x27a, []);
        assert.equal(f.process.allocations.has(pointer), false);
        await assert.rejects(call(0x27c, [h, 0]), /released/);
      } finally {
        await f.engine.close();
      }
    },
  );
  test(
    `${profile} restored name tables retain original pointers and independent ownership`,
    { skip: !process.env[variable] },
    async () => {
      const bytes = new Uint8Array(await readFile(process.env[variable])),
        f = await nameTableFixture(bytes, profile),
        fresh = await nameTableFixture(bytes, profile);
      try {
        f.machine.writeString('names.tsv', 256);
        const h = (await f.tables.apply(0x279, [256], f.machine, { id: 1 })).value,
          pointer = f.tables.pointer(h),
          saved = structuredClone({
            engine: f.engine.snapshot(),
            handles: f.handles.snapshot(),
            machine: f.machine.snapshot(),
          });
        fresh.engine.restore(saved.engine);
        fresh.handles.restore(saved.handles);
        fresh.machine.restore(saved.machine);
        assert.equal(fresh.tables.pointer(h), pointer);
        assert.equal((await fresh.tables.apply(0x27c, [h, 0], fresh.machine, { id: 1 })).value, 7);
        await fresh.tables.apply(0x27a, [h], fresh.machine, { id: 1 });
        assert.equal(fresh.process.allocations.has(pointer), false);
        assert.equal(f.tables.pointer(h), pointer);
      } finally {
        await fresh.engine.close();
        await f.engine.close();
      }
    },
  );
}

for (const profile of ['sdk-4.01-engine-2.6.1.74', 'nekopara-vol3-engine-2.6.1.76'])
  test(
    profile + ' JS name-table snapshots retain raw fields and independent ownership',
    async () => {
      const world = await dataWorld(
        profile,
        Object.fromEntries(
          [...nameTableFiles()].map(([name, bytes]) => [name.replace(/^@cat\/fes\//, ''), bytes]),
        ),
      );
      let fresh;
      const call = (w, id, args) => w.runtime.native('main', id, args, w.main.machine, w.main);
      try {
        world.main.machine.writeString('names.tsv', 256);
        const h = (await call(world, 0x279, [256])).value;
        fresh = await dataWorld(profile, {}, { initialize: false });
        await fresh.restore(structuredClone(world.snapshot()));
        const m = fresh.main.machine;
        m.bytes(1024, 32).fill(0xa5);
        assert.equal((await call(fresh, 0x27d, [h, 0, 1024])).value, 1);
        assert.equal(m.string(1024), '猫');
        assert.equal(m.load(1027, 1), 0xa5);
        await call(fresh, 0x27a, [h]);
        await assert.rejects(() => call(fresh, 0x27c, [h, 0]), /released/);
        assert.equal((await call(world, 0x27c, [h, 0])).value, 7);
      } finally {
        await fresh?.close({ flushFiles: false });
        await world.close({ flushFiles: false });
      }
    },
  );

for (const profile of ['rebellions-jp-engine-2.6.1.63', 'grisaia-jp-engine-2.6.1.23'])
  test(`${profile} name table uses CP932 fields capped at 32 bytes and keeps authored row order`, () =>
    verifyLegacyNameTable(profile));

async function verifyLegacyNameTable(profile) {
  const world = await dataWorld(profile, {
    'names.csv': encodeCP932(
      `8\t${'x'.repeat(32)}\tignored\r\n7\t猫\t${'a'.repeat(40)}\t${'b'.repeat(40)}\talias\r\n3\t犬\tbg*\t%r\r\n`,
    ),
  });
  try {
    const { main } = world,
      m = main.machine,
      call = (id, args) => world.runtime.native('main', id, args, m, main);
    m.writeString('names.csv', 256);
    const { value: handle } = await call(633, [256]);
    assert.ok(handle);
    assert.deepEqual(await call(636, [handle, 0]), { control: 1, value: 7 });
    assert.deepEqual(await call(636, [handle, 1]), { control: 1, value: 3 });
    m.writeString('alias', 512);
    assert.deepEqual(await call(635, [handle, 512]), { control: 1, value: 0xffffffff });
    assert.deepEqual(await call(637, [handle, 0, 1024]), { control: 1, value: 1 });
    assert.equal(m.string(1024), '猫');
    for (const [index, byte] of [
      [0, 'a'],
      [1, 'b'],
    ]) {
      assert.deepEqual(await call(638, [handle, 0, index, 1024]), { control: 1, value: 1 });
      assert.equal(m.string(1024), byte.repeat(31));
    }
    m.writeString('bg002.hg3', 512);
    assert.deepEqual(await call(639, [handle, 1, 512]), { control: 1, value: 1 });
    m.writeString('body.hg3', 512);
    assert.deepEqual(await call(639, [handle, 1, 512]), { control: 1, value: 0 });
    assert.deepEqual(await call(640, [handle, 1, 512, 1024]), { control: 1, value: 1 });
    assert.equal(m.string(1024), 'body.hg3');
    if (profile === 'rebellions-jp-engine-2.6.1.63') {
      m.bytes(512, 4).set([0xa1, 0x41, 0x42, 0]);
      m.writeString('A', 1024);
      assert.deepEqual(await call(49, [512, 1024]), { control: 1, value: 3 });
    }
    assert.deepEqual(await call(634, [handle]), { control: 2 });
  } finally {
    await world.close({ flushFiles: false });
  }
}
