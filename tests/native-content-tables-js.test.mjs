// SPDX-License-Identifier: MPL-2.0
import test from 'node:test';
import assert from 'node:assert/strict';
import { dataWorld } from './fixtures/data-world.mjs';
import { contentFiles } from './fixtures/content-database-data.mjs';
for (const profile of ['sdk-4.01-engine-2.6.1.74', 'nekopara-vol3-engine-2.6.1.76'])
  test(
    profile + ' JS content table handles restore independently of their resource files',
    async () => {
      const first = await dataWorld(profile, Object.fromEntries(contentFiles()));
      let fresh;
      const call = (world, id, args = []) =>
        world.runtime.native('main', id, args, world.main.machine, world.main);
      try {
        const h = (await call(first, 0x30b)).value;
        first.main.machine.writeString('alpha', 64);
        await call(first, 0x30d, [h, 100, 64]);
        first.main.machine.writeString('selections', 64);
        await call(first, 0x30e, [h, 64]);
        await call(first, 0x33d, [h, 1]);
        first.main.machine.writeString('questions', 64);
        const table = (await call(first, 0x317, [64])).value;
        fresh = await dataWorld(profile, {}, { initialize: false });
        await fresh.restore(structuredClone(first.snapshot()));
        fresh.main.machine.writeString('ID', 64);
        assert.equal((await call(fresh, 0x319, [table, 64, 0])).value, 11);
        await call(fresh, 0x33f, [h, 0]);
        assert.equal((await call(fresh, 0x310, [h, 0])).value, -10 >>> 0);
        assert.equal((await call(first, 0x310, [h, 0])).value, 100);
        await call(fresh, 0x30c, [h]);
        await call(fresh, 0x318, [table]);
        await assert.rejects(() => call(fresh, 0x319, [table, 64, 0]), /released/);
        assert.equal((await call(first, 0x30f, [h])).value, 2);
      } finally {
        await fresh?.close({ flushFiles: false });
        await first.close({ flushFiles: false });
      }
    },
  );
