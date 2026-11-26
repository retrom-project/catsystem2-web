// SPDX-License-Identifier: MPL-2.0
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { test } from 'node:test';
import { dataWorld } from './fixtures/data-world.mjs';
import { kcsProgram } from './helpers.mjs';
const golden = JSON.parse(
    await readFile(new URL('./fixtures/native-sdk23-raster-primary.json', import.meta.url)),
  ),
  profile = 'grisaia-jp-engine-2.6.1.23',
  marker = 0x70667231;
for (const resource of golden.resources) {
  const original = golden.rows.filter((row) => row.source === resource.name),
    rows = original.filter(
      (row, i) => row.id !== 648 && !(row.id === 114 && original[i - 1]?.id === 648),
    ),
    name = resource.name + '.kcs',
    files = {
      [resource.name]: Buffer.from(resource.base64, 'base64'),
      [name]: kcsProgram(
        [
          [37, marker],
          [37, 0x12345678],
          [38, 100],
          ...rows.flatMap((row) => [
            ...row.args.map((arg) => [37, arg]),
            [43, row.id, row.args.length * 4],
            ...(row.resultAddress === null ? [] : [[38, row.resultAddress]]),
            [43, 65, 0],
          ]),
          [59],
        ],
        [[256, resource.name]],
      ),
    };
  test(
    'SDK23 ' +
      resource.name +
      ' primary parse and indexed rejection match complete original GCALLs and cold',
    async (t) => {
      const world = await dataWorld(profile, files);
      t.after(() => world.close({ flushFiles: false }));
      const task = await world.spawnScript(name, { parent: world.main.id, initialExecute: false }),
        m = task.machine,
        floor = m.sp;
      const pixels = async (w, handle, row) => {
        const bitmap = w.graphics.images.get(handle);
        assert.deepEqual([bitmap.width, bitmap.height, bitmap.state.bpp], row.bitmap.shape);
        assert.equal(Buffer.from(await bitmap.pixels()).toString('base64'), row.bitmap.rgbaBase64);
      };
      for (const row of rows) {
        await world.runtime.scheduler.execute(task);
        assert.equal(m.sp, floor + 4, 'Main' + row.id + ' control');
        assert.equal(m.load(floor), marker);
        assert.equal(m.load(100), row.thirdOutput, 'third output stays untouched');
        if (row.id === 428 || (row.id === 460 && !row.result))
          assert.equal(m.load(row.resultAddress), 0);
        if (row.id === 460 && row.result) await pixels(world, m.load(row.resultAddress), row);
        if (row.id === 703) {
          assert.equal(m.load(44), row.result);
          assert.equal(m.load(512), row.records[0]);
          assert.equal(Boolean(m.load(516)), Boolean(row.records[1]));
          if (row.bitmap) await pixels(world, m.load(516), row);
          const fresh = await dataWorld(profile, files, { initialize: false });
          try {
            await fresh.restore(structuredClone(world.snapshot()));
            const restored = fresh.runtime.scheduler.tasks.get(task.id);
            if (row.bitmap) await pixels(fresh, restored.machine.load(516), row);
            await fresh.runtime.scheduler.execute(restored);
            assert.equal(restored.machine.load(512), 0);
            assert.equal(restored.machine.load(516), 0);
          } finally {
            await fresh.close({ flushFiles: false });
          }
        }
        if (row.id === 704) {
          assert.equal(m.load(512), 0);
          assert.equal(m.load(516), 0);
        }
        assert.equal(
          [...world.runtime.handles.records.values()].filter(
            (r) => r.type === 'bitmap' && r.value.owner === task.id,
          ).length,
          0,
          'no automatic bitmap owner inserted',
        );
      }
      const encoded = (await world.runtime.native('main', 365, [256], m, task)).value;
      try {
        await assert.rejects(
          world.runtime.native('main', 648, [encoded, 8, 6], m, task),
          /Unreviewed encoded bitmap format/,
        );
      } finally {
        await world.runtime.native('main', 366, [encoded], m, task);
      }
    },
  );
}
