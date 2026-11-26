// SPDX-License-Identifier: MPL-2.0
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { test } from 'node:test';
import { dataWorld } from './fixtures/data-world.mjs';
import { kcsProgram } from './helpers.mjs';
const golden = JSON.parse(
  await readFile(new URL('./fixtures/native-sdk23-image-file-info.json', import.meta.url)),
);
const profile = 'grisaia-jp-engine-2.6.1.23',
  marker = 0x73646237;
for (const fixture of golden.cases) {
  test(
    'SDK23 actual KCS image file/container words and cold descriptor lifetime: ' + fixture.format,
    async (t) => {
      const init = Array.from({ length: 18 }, (_, i) => [
        [37, (0x31415920 + i) >>> 0],
        [38, 100 + i * 4],
      ]).flat();
      const code = [
        [37, marker],
        ...init,
        ...fixture.rows.flatMap((row) => [
          ...row.args.map((arg) => [37, arg]),
          [43, row.id, row.args.length * 4],
          ...(row.resultAddress === null ? [] : [[38, row.resultAddress]]),
          [43, 65, 0],
        ]),
        [59],
      ];
      const inputs = {
        [fixture.name]: Buffer.from(fixture.base64, 'base64'),
        'metadata.kcs': kcsProgram(code, [[256, fixture.name]]),
      };
      const world = await dataWorld(profile, inputs);
      t.after(() => world.close({ flushFiles: false }));
      const task = await world.spawnScript('metadata.kcs', {
        parent: world.main.id,
        initialExecute: false,
      });
      const m = task.machine,
        floor = m.sp;
      for (const row of fixture.rows) {
        await world.runtime.scheduler.execute(task);
        assert.equal(m.sp, floor + 4);
        assert.equal(m.load(floor), marker);
        if (row.id !== 365 && row.resultAddress !== null)
          assert.equal(m.load(row.resultAddress), row.result);
        assert.deepEqual(
          Array.from({ length: 18 }, (_, i) => m.load(100 + i * 4)),
          row.outputs,
        );
        if (row.id === 431) {
          const fresh = await dataWorld(profile, inputs, { initialize: false });
          try {
            await fresh.restore(structuredClone(world.snapshot()));
            const restored = fresh.runtime.scheduler.tasks.get(task.id);
            assert.deepEqual(
              [
                ...fresh.runtime.imageDataBuffers.data(
                  fresh.runtime.imageDataBuffers.pointer(m.load(32)),
                ),
              ],
              [...Buffer.from(fixture.base64, 'base64')],
            );
            await fresh.runtime.scheduler.execute(restored);
            assert.equal(fresh.runtime.handles.records.has(m.load(32)), false);
          } finally {
            await fresh.close({ flushFiles: false });
          }
        }
      }
      assert.equal(world.runtime.handles.records.has(m.load(32)), false);
    },
  );
}
