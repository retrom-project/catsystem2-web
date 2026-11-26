// SPDX-License-Identifier: MPL-2.0
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { test } from 'node:test';
import { dataWorld } from './fixtures/data-world.mjs';
import { kcsProgram } from './helpers.mjs';
const profile = 'grisaia-jp-engine-2.6.1.23',
  marker = 0x70667231;
for (const fixture of ['native-sdk23-raster-primary', 'native-sdk23-raster-psd-kcf']) {
  const golden = JSON.parse(
    await readFile(new URL('./fixtures/' + fixture + '.json', import.meta.url)),
  );
  for (const resource of golden.resources) {
    const original = golden.rows.filter((row) => row.source === resource.name),
      rows = original,
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
        const task = await world.spawnScript(name, {
            parent: world.main.id,
            initialExecute: false,
          }),
          m = task.machine,
          floor = m.sp;
        const pixels = async (w, handle, row) => {
          const bitmap = w.graphics.images.get(handle);
          assert.deepEqual([bitmap.width, bitmap.height, bitmap.state.bpp], row.bitmap.shape);
          assert.equal(
            Buffer.from(await bitmap.pixels()).toString('base64'),
            row.bitmap.rgbaBase64,
          );
        };
        for (const row of rows) {
          const dataBefore = [...world.runtime.handles.records.values()].filter(
            (r) => r.type === 'bitmap-data',
          ).length;
          await world.runtime.scheduler.execute(task);
          assert.equal(m.sp, floor + 4, 'Main' + row.id + ' control');
          assert.equal(m.load(floor), marker);
          assert.equal(m.load(100), row.thirdOutput, 'third output stays untouched');
          if (row.id === 428 || (row.id === 460 && !row.result))
            assert.equal(m.load(row.resultAddress), 0);
          if (row.id === 460 && row.result) await pixels(world, m.load(row.resultAddress), row);
          if (row.id === 648) {
            const handle = m.load(row.resultAddress),
              empty = world.graphics.images.get(handle);
            assert.equal(empty.dataHandle, 0, 'actual null-storage owner');
            const alias = world.graphics.images.alias(handle);
            assert.equal(world.graphics.images.get(alias).dataHandle, 0);
            await world.graphics.images.release(alias);
            assert.equal(
              world.runtime.handles.records.has(handle),
              true,
              'independent empty wrapper',
            );
            assert.equal(
              [...world.runtime.handles.records.values()].filter((r) => r.type === 'bitmap-data')
                .length,
              dataBefore,
              'no zero-size pixel allocation',
            );
            const fresh = await dataWorld(profile, files, { initialize: false });
            try {
              await fresh.restore(structuredClone(world.snapshot()));
              assert.equal(fresh.graphics.images.get(handle).dataHandle, 0);
              const restored = fresh.runtime.scheduler.tasks.get(task.id);
              await fresh.runtime.scheduler.execute(restored);
              assert.equal(
                fresh.runtime.handles.records.has(handle),
                false,
                'cold explicit release',
              );
            } finally {
              await fresh.close({ flushFiles: false });
            }
            const retired = await dataWorld(profile, files, { initialize: false });
            try {
              await retired.restore(structuredClone(world.snapshot()));
              await retired.sendEngine(task.id, retired.main.id, 3);
              await retired.objects.tick(40);
              assert.equal(
                retired.runtime.handles.records.has(handle),
                false,
                'Script automatic release',
              );
            } finally {
              await retired.close({ flushFiles: false });
            }
          }
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
            row.list,
            'actual automatic bitmap owner list',
          );
        }
      },
    );
  }
}
