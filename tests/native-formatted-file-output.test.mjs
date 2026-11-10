// SPDX-License-Identifier: MPL-2.0
import test from 'node:test';
import assert from 'node:assert/strict';
import { encodeCP932 } from '../src/kcs/strings.mjs';
import { dataWorld } from './fixtures/data-world.mjs';
import { SaveSlotFiles } from './fixtures/save-slot-files.mjs';
import { kcsProgram } from './helpers.mjs';
const id = 0x237;
const filename = '記録%d[G1100].txt';
const main = kcsProgram(
  [
    [37, 256],
    [37, 512],
    [43, id, 8],
    [37, 2048],
    [43, 0x47, 4],
    [37, 256],
    [37, 768],
    [43, id, 8],
    [37, 2048],
    [43, 0x47, 4],
    [59],
  ],
  [
    [256, filename],
    [512, '前 %s[G1024]'],
    [768, '後 %d[G1100]'],
    [1024, '一'],
    [1152, 'read-only.txt'],
  ],
);

for (const profile of ['sdk-4.01-engine-2.6.1.74', 'nekopara-vol3-engine-2.6.1.76']) {
  test(`0x237 JS file output resumes its original cursor in ${profile}`, async () => {
    const files = new SaveSlotFiles(),
      make = (initialize = false) =>
        dataWorld(profile, { 'case.kcs': main }, { storage: files, initialize });
    const first = await make();
    let fresh;
    try {
      await first.initialize('case.kcs');
      assert.deepEqual(await files.read(filename), encodeCP932('前 一\r\n'));
      assert.deepEqual(files.operations, [['write', filename.toLowerCase()]]);
      const saved = structuredClone(first.snapshot());
      fresh = await make();
      await fresh.restore(saved);
      fresh.main.machine.store(1100, 17);
      await fresh.runtime.scheduler.send(fresh.main.id, [0, 0, 0, 0]);
      assert.deepEqual(await files.read(filename), encodeCP932('前 一\r後 17\r\n'));

      await files.write('read-only.txt', Uint8Array.of(9, 8, 7));
      await files.setAttributes('read-only.txt', 1);
      const prior = files.operations.length;
      assert.deepEqual(
        await fresh.runtime.native('main', id, [1152, 768], fresh.main.machine, fresh.main),
        { control: 2 },
      );
      assert.deepEqual(await files.read('read-only.txt'), Uint8Array.of(9, 8, 7));
      assert.equal(files.operations.length, prior);
    } finally {
      await fresh?.close();
      await first.close();
    }
  });
}
