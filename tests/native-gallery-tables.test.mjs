// SPDX-License-Identifier: MPL-2.0
import test from 'node:test';
import assert from 'node:assert/strict';
import { nativeGalleryTable } from '../src/native/gallery-tables.mjs';
import { galleryNameFile, galleryTableFiles } from './fixtures/gallery-table-fixture.mjs';
import { dataWorld } from './fixtures/data-world.mjs';
import { kcsProgram } from './helpers.mjs';

test('null gallery tables retain their defined controls without inventing an engine service', async () => {
  for (let id = 0x196; id <= 0x19f; id++) {
    if (id === 0x19c) continue;
    assert.deepEqual(
      nativeGalleryTable(id, [0], {}),
      id === 0x196 || id === 0x19d ? { control: 2 } : { control: 1, value: 0 },
    );
  }
  assert.equal(nativeGalleryTable(0x195, [0], {}), undefined);
  assert.equal(nativeGalleryTable(0x19c, [0], {}), undefined);
});

for (const profile of [
  'nekopara-vol3-engine-2.6.1.76',
  'sdk-4.01-engine-2.6.1.74',
  'bokutomo-engine-2.6.1.67',
])
  test(`${profile} JS gallery tables retain independent bytes across fresh World restoration`, async () => {
    const tables = galleryTableFiles(),
      make = (initialize = true) => dataWorld(profile, Object.fromEntries(tables), { initialize }),
      world = await make();
    let fresh;
    try {
      const task = world.main,
        call = (id, args) => world.runtime.native('main', id, args, task.machine, task);
      task.machine.writeString('variants1', 64);
      const variants = (await call(0x195, [64])).value;
      assert.equal((await call(0x197, [variants])).value, 2);
      assert.equal((await call(0x198, [variants, 0])).value, 3);
      assert.equal((await call(0x199, [variants, 0, 0])).value, 3);
      assert.equal((await call(0x19a, [variants, 0, 0])).value, 2);
      assert.equal((await call(0x19b, [variants, 0, 0, 0, 0, 256])).value, 1);
      assert.equal(task.machine.string(256), 'img0_0,0,A,C');
      task.machine.writeString('names1', 64);
      const names = (await call(0x19c, [64])).value;
      assert.equal((await call(0x19e, [names])).value, 3);
      assert.equal((await call(0x19f, [names, 0, 0])).value, 0);
      task.machine.writeString('old', 512);
      assert.equal((await call(0x1a0, [names, 0, 0, 512])).value, 0);
      assert.equal(task.machine.string(512), 'old');
      fresh = await make(false);
      await fresh.restore(structuredClone(world.snapshot()));
      const ft = fresh.main,
        fc = (id, args) => fresh.runtime.native('main', id, args, ft.machine, ft);
      assert.notEqual(
        fresh.runtime.handles.get(variants, 'gallery-table').bytes,
        world.runtime.handles.get(variants, 'gallery-table').bytes,
      );
      assert.equal((await fc(0x19b, [variants, 0, 0, 1, 0, 256])).value, 1);
      assert.equal(ft.machine.string(256), 'img0_0,B,0,C,D');
      assert.equal((await fc(0x1a0, [names, 1, 0, 512])).value, 1);
      assert.equal(ft.machine.string(512).slice(0, 36), 'A'.repeat(32) + 'r1c1');
      await fc(0x196, [variants]);
      assert.equal((await call(0x197, [variants])).value, 2);
      await fc(0x19d, [names]);
      assert.throws(() => fc(0x197, [variants]), /released/);
    } finally {
      await world.close({ flushFiles: false });
      await fresh?.close({ flushFiles: false });
    }
  });

async function legacyGalleryTableSlots(t, profile) {
  const type = 'gallery-table',
    files = galleryTableFiles(),
    namesSlot = [0x13, 64],
    variantsSlot = [0x13, 68],
    results = 720,
    variantOut = 320,
    nameOut = 512,
    guard = 0x5b82a493,
    call = (id, ...args) => [...args.map((arg) => [37, arg]), [43, id, args.length * 4]],
    rows = [
      [407, [variantsSlot], 3],
      [414, [variantsSlot], 3],
      [408, [variantsSlot, 4], 1],
      [409, [variantsSlot, 0, 0], 3],
      [410, [variantsSlot, 0, 0], 2],
      [411, [variantsSlot, 0, 0, 0, 0, variantOut], 1],
      [414, [namesSlot], 3],
      [407, [namesSlot], 3],
      [415, [namesSlot, 0, 0], 0],
      [415, [namesSlot, 2, 3], 1],
      [416, [namesSlot, 2, 3, nameOut], 1],
    ];
  const world = await dataWorld(profile, {
    ...Object.fromEntries(files),
    '台%帳': files.get('variants2'),
    truncated: galleryNameFile(0).slice(0, 17),
    'case.kcs': kcsProgram(
      [
        [37, guard],
        ...call(405, 128),
        [38, variantsSlot],
        ...call(412, 200),
        [38, namesSlot],
        ...rows.flatMap(([id, args], i) => [...call(id, ...args), [38, [0x13, results + i * 4]]]),
        [59],
      ],
      [
        [128, '台%%帳'],
        [200, 'names1'],
        [variantOut, '............last'],
        [nameOut, '............last'],
      ],
    ),
  });
  t.after(() => world.close({ flushFiles: false }));
  const task = world.main,
    machine = task.machine,
    native = (id, args) => world.runtime.native('main', id, args, machine, task),
    variants = machine.load(68),
    names = machine.load(64);
  assert.deepEqual(
    rows.map((_, i) => machine.load(results + i * 4)),
    rows.map(([, , expected]) => expected),
  );
  assert.equal(machine.load(machine.sp - 4), guard);
  assert.equal(machine.string(variantOut), 'img0_0,0,A,C');
  assert.deepEqual([...machine.bytes(variantOut + 12, 3)], [0, 0, 115]);
  assert.equal(machine.string(nameOut), 'r2c3日本');
  assert.deepEqual([...machine.bytes(nameOut + 8, 2)], [0, 46]);
  assert.equal(world.runtime.handles.get(variants, type).kind, 'variants');
  assert.equal(world.runtime.handles.get(names, type).kind, 'names');
  assert.throws(() => native(408, [names, 0]), /different binary layout/);
  assert.deepEqual(await native(411, [variants, 0, 0, 0, 0, 0xffffffff]), { control: 1, value: 0 });
  assert.throws(() => native(416, [names, 2, 3, 0xffffffff]), /KCS memory/);
  machine.writeString('truncated', 200);
  const count = world.runtime.handles.records.size;
  await assert.rejects(native(412, [200]), /names table crosses its source allocation/);
  assert.equal(world.runtime.handles.records.size, count);
  assert.deepEqual(await native(406, [names]), { control: 2 });
  assert.deepEqual(await native(413, [variants]), { control: 2 });
  assert.throws(() => native(407, [names]), /released/);
  assert.throws(() => native(414, [variants]), /released/);
}

for (const [version, profile] of [
  ['2.6.1.23', 'grisaia-jp-engine-2.6.1.23'],
  ['2.6.1.67', 'bokutomo-engine-2.6.1.67'],
])
  test(`${version} reads and closes both binary gallery layouts through their original GCALL slots`, (t) =>
    legacyGalleryTableSlots(t, profile));
