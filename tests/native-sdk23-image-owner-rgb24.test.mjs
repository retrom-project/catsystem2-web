// SPDX-License-Identifier: MPL-2.0
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { test } from 'node:test';
import { dataWorld } from './fixtures/data-world.mjs';
import { kcsProgram } from './helpers.mjs';
const golden = JSON.parse(
    await readFile(new URL('./fixtures/native-sdk23-image-owner-rgb24.json', import.meta.url)),
  ),
  profile = 'grisaia-jp-engine-2.6.1.23',
  marker = 0x72676231,
  inputs = {
    ...Object.fromEntries(golden.resources.map((r) => [r.name, Buffer.from(r.base64, 'base64')])),
    'owner-rgb24.kcs': kcsProgram(
      [
        [37, marker],
        ...golden.rows.flatMap((r) => [
          ...r.args.map((a) => [37, a]),
          [43, r.id, r.args.length * 4],
          ...(r.resultAddress === null ? [] : [[38, r.resultAddress]]),
          [43, 65, 0],
        ]),
        [59],
      ],
      [
        [256, 'rgb24.hg3'],
        [320, 'rgba32.hg3'],
        [384, 'back24.hg3'],
      ],
    ),
  };
test('SDK23 actual RGB24/RGBA owner rectangles and unsupported mask destination preserve pixels and cold state', async (t) => {
  const world = await dataWorld(profile, inputs);
  t.after(() => world.close({ flushFiles: false }));
  const task = await world.spawnScript('owner-rgb24.kcs', {
      parent: world.main.id,
      initialExecute: false,
    }),
    m = task.machine,
    floor = m.sp;
  const compare = async (w, current, row) => {
    for (const [at, expected] of [
      [36, row.source],
      [40, row.target],
    ]) {
      const handle = current.machine.load(at),
        record = w.runtime.handles.records.get(handle);
      if (!expected) {
        assert.equal(record?.type === 'image-owner', false);
        continue;
      }
      const bitmap = w.graphics.images.get(w.imageOwners.get(handle).bitmap);
      assert.deepEqual([bitmap.width, bitmap.height, bitmap.state.bpp], expected.shape);
      assert.equal(Buffer.from(await bitmap.pixels()).toString('base64'), expected.rgbaBase64);
      assert.equal(bitmap.state.mask ?? 0, expected.mask);
      assert.equal(bitmap.state.alphaHint ?? 0, expected.alphaHint);
    }
    assert.equal(
      [...w.runtime.handles.records.values()].filter(
        (r) => r.type === 'image-owner' && r.value.owner === task.id,
      ).length,
      row.list,
    );
  };
  for (const [index, row] of golden.rows.entries()) {
    await world.runtime.scheduler.execute(task);
    assert.equal(m.sp, floor + 4);
    assert.equal(m.load(floor), marker);
    await compare(world, task, row);
    if (row.id === 734) {
      const fresh = await dataWorld(profile, inputs, { initialize: false });
      try {
        await fresh.restore(structuredClone(world.snapshot()));
        const restored = fresh.runtime.scheduler.tasks.get(task.id);
        await compare(fresh, restored, row);
        await fresh.runtime.scheduler.execute(restored);
        assert.equal(restored.machine.load(floor), marker);
        await compare(fresh, restored, golden.rows[index + 1]);
      } finally {
        await fresh.close({ flushFiles: false });
      }
    }
  }
});
