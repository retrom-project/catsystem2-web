// SPDX-License-Identifier: MPL-2.0
import test from 'node:test';
import assert from 'node:assert/strict';
import { nativeGalleryTable } from '../src/native/gallery-tables.mjs';
import { galleryTableFiles } from './fixtures/gallery-table-fixture.mjs';
import { dataWorld } from './fixtures/data-world.mjs';

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

for (const profile of ['nekopara-vol3-engine-2.6.1.76', 'sdk-4.01-engine-2.6.1.74'])
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
