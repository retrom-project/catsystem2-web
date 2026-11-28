// SPDX-License-Identifier: MPL-2.0
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { test } from 'node:test';
import { dataWorld } from './fixtures/data-world.mjs';
import { kcsProgram } from './helpers.mjs';
const golden = JSON.parse(
    await readFile(new URL('./fixtures/native-sdk23-selector-blend-types.json', import.meta.url)),
  ),
  marker = 0x73636231,
  profile = 'grisaia-jp-engine-2.6.1.23',
  name = 'selector-blend.kcs',
  files = {
    ...Object.fromEntries(golden.resources.map((r) => [r.name, Buffer.from(r.base64, 'base64')])),
    [name]: kcsProgram(
      [
        [37, marker],
        ...golden.rows.flatMap((row) => [
          ...row.args.map((a) => [37, a]),
          [43, row.id, row.args.length * 4],
          ...(row.resultAddress === null ? [] : [[38, row.resultAddress]]),
          [43, 65, 0],
        ]),
        [59],
      ],
      golden.queries.map((text, i) => [512 + i * 128, text]),
    ),
  };
test('SDK23 selector cptype modes and RGB no-dispatch preserve full pixels, metadata and explicit cold lifetime', async (t) => {
  const world = await dataWorld(profile, files);
  t.after(() => world.close({ flushFiles: false }));
  const task = await world.spawnScript(name, { parent: world.main.id, initialExecute: false }),
    m = task.machine,
    floor = m.sp;
  let handle;
  const compare = async (w, expected) => {
    const bitmap = w.graphics.images.get(handle);
    assert.deepEqual([bitmap.width, bitmap.height, bitmap.state.bpp], expected.shape);
    assert.equal(Buffer.from(await bitmap.pixels()).toString('base64'), expected.rgbaBase64);
    assert.equal(
      [...w.runtime.handles.records.values()].filter(
        (record) => record.type === 'bitmap' && record.value.dataHandle === bitmap.dataHandle,
      ).length,
      expected.dataReferences,
    );
  };
  for (const row of golden.rows) {
    await world.runtime.scheduler.execute(task);
    assert.equal(m.sp, floor + 4);
    assert.equal(m.load(floor), marker);
    if (row.id === 460) {
      handle = m.load(48);
      assert(handle);
      await compare(world, row.bitmap);
      const fresh = await dataWorld(profile, files, { initialize: false });
      try {
        await fresh.restore(structuredClone(world.snapshot()));
        await compare(fresh, row.bitmap);
        const restored = fresh.runtime.scheduler.tasks.get(task.id);
        await fresh.runtime.scheduler.execute(restored);
        assert.equal(restored.machine.load(floor), marker);
        assert.equal(fresh.runtime.handles.records.has(handle), false);
      } finally {
        await fresh.close({ flushFiles: false });
      }
    } else assert.equal(world.runtime.handles.records.has(handle), false);
    assert.equal(
      [...world.runtime.handles.records.values()].filter(
        (r) => r.type === 'bitmap' && r.value.owner === task.id,
      ).length,
      row.list,
    );
  }
});
