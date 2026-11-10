// SPDX-License-Identifier: MPL-2.0
import test from 'node:test';
import assert from 'node:assert/strict';
import { dataWorld } from './fixtures/data-world.mjs';
import { contentFiles } from './fixtures/content-database-data.mjs';
import { SaveSlotFiles } from './fixtures/save-slot-files.mjs';
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
        const question = (await call(first, 0x2e6)).value;
        first.main.machine.writeString('questions', 64);
        await call(first, 0x2e8, [question, 64]);
        await call(first, 0x2fc, [question]);
        fresh = await dataWorld(profile, {}, { initialize: false });
        await fresh.restore(structuredClone(first.snapshot()));
        await call(fresh, 0x2ed, [question, 0]);
        assert.equal((await call(fresh, 0x303, [question, 0])).value, 1);
        assert.equal((await call(first, 0x303, [question, 0])).value, 0);
        assert.equal((await call(fresh, 0x2ea, [question, 0, 768])).value, 1);
        assert.equal(fresh.main.machine.string(768), 'Another question?');
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

for (const profile of ['sdk-4.01-engine-2.6.1.74', 'nekopara-vol3-engine-2.6.1.76'])
  test(
    profile + ' JS question and mission data roundtrip through CSS in a fresh World',
    async () => {
      const storage = new SaveSlotFiles(),
        resources = Object.fromEntries(contentFiles()),
        first = await dataWorld(profile, resources, { storage });
      let fresh;
      const call = (world, id, args = []) =>
        world.runtime.native('main', id, args, world.main.machine, world.main);
      async function owners(world) {
        const question = (await call(world, 0x2e6)).value;
        world.main.machine.writeString('questions', 64);
        await call(world, 0x2e8, [question, 64]);
        await call(world, 0x2fc, [question]);
        world.main.machine.writeString('missions', 64);
        const mission = (await call(world, 0x31b, [64])).value;
        await call(world, 0x335, [mission]);
        return { question, mission };
      }
      try {
        const one = await owners(first);
        await call(first, 0x2ed, [one.question, 0]);
        await call(first, 0x321, [one.mission, 10]);
        const file = (await call(first, 0xee, [17])).value;
        for (const [id, handle, entry] of [
          [0x2ff, one.question, 1],
          [0x337, one.mission, 2],
        ]) {
          const size = (await call(first, id, [handle, 0])).value,
            pointer = (await call(first, 0x341, [size])).value;
          first.runtime.imageDataBuffers.process.write(pointer, new Uint8Array(size).fill(0xa5));
          await call(first, id, [handle, pointer]);
          await call(first, 0x343, [file, entry, size, pointer]);
          await call(first, 0x342, [pointer]);
        }
        first.main.machine.writeString('progress.dat', 64);
        assert.equal((await call(first, 0xf5, [file, 64])).value, 1);
        fresh = await dataWorld(profile, resources, { storage });
        const two = await owners(fresh);
        fresh.main.machine.writeString('progress.dat', 64);
        const loaded = (await call(fresh, 0xf7, [64])).value;
        for (const [id, handle, entry] of [
          [0x300, two.question, 1],
          [0x338, two.mission, 2],
        ]) {
          const pointer = (await call(fresh, 0x344, [loaded, entry, 1024])).value,
            size = fresh.main.machine.load(1024);
          assert.equal(
            (await call(fresh, id, [handle, pointer, ...(id === 0x338 ? [size] : [])])).value,
            1,
          );
          await call(fresh, 0x342, [pointer]);
        }
        assert.equal((await call(fresh, 0x303, [two.question, 0])).value, 1);
        await call(fresh, 0x323, [two.mission, 10, 1024, 1040]);
        assert.equal(fresh.main.machine.load(1024), 1);
        await call(fresh, 0x334, [two.mission, 10, 7, 1024]);
        assert.equal(fresh.main.machine.load(1024), 1);
        await call(fresh, 0x334, [two.mission, 10, 9, 1024]).then(
          () => assert.fail('empty character set query must fail'),
          (error) => assert.match(error.message, /empty set sentinel/),
        );
      } finally {
        await fresh?.close({ flushFiles: false });
        await first.close({ flushFiles: false });
      }
    },
  );
