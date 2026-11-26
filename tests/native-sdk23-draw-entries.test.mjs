// SPDX-License-Identifier: MPL-2.0
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { test } from 'node:test';
import { dataWorld } from './fixtures/data-world.mjs';
import { kcsProgram } from './helpers.mjs';
const golden = JSON.parse(
  await readFile(new URL('./fixtures/native-sdk23-draw-entries.json', import.meta.url)),
);
const profile = 'grisaia-jp-engine-2.6.1.23',
  marker = 0x64726131,
  inputs = {
    [golden.resource.name]: Buffer.from(golden.resource.base64, 'base64'),
    'draw-entries.kcs': kcsProgram(
      [
        [37, marker],
        ...golden.rows.flatMap((row) => [
          ...row.args.map((arg, i) => [37, row.id === 66 && i === 1 ? [0x13, 44] : arg]),
          [43, row.id, row.args.length * 4],
          ...(row.resultAddress === null ? [] : [[38, row.resultAddress]]),
          [43, 65, 0],
        ]),
        [59],
      ],
      [
        [256, golden.resource.name],
        [320, 'Draw entries'],
      ],
    ),
  };

test('SDK23 complete Draw entry GCALLs preserve controls, layers, borrowed pixels and cold ownership', async (t) => {
  const world = await dataWorld(profile, inputs);
  t.after(() => world.close({ flushFiles: false }));
  const task = await world.spawnScript('draw-entries.kcs', {
      parent: world.main.id,
      initialExecute: false,
    }),
    m = task.machine,
    floor = m.sp;
  m.store(44, world.nativeTaskID(world.main.id));
  let drawID;
  const compare = async (w, row, label) => {
    const draw = w.objects.objects.get(drawID).implementation,
      renderer = draw.state.renderer;
    assert.equal(renderer?.items.length ?? null, row.itemCount, label + ' count');
    if (row.bitmap) {
      const bitmap = w.graphics.images.get(renderer.bitmap);
      assert.deepEqual([bitmap.width, bitmap.height, bitmap.state.bpp], row.bitmap.shape);
      assert.equal(
        Buffer.from(await bitmap.pixels()).toString('base64'),
        row.bitmap.rgbaBase64,
        label,
      );
    }
  };
  for (const [index, row] of golden.rows.entries()) {
    await world.runtime.scheduler.execute(task);
    const label = 'Main' + row.id + ' at' + index;
    assert.equal(m.sp, floor + 4, label + ' control');
    assert.equal(m.load(floor), marker, label + ' marker');
    if (row.id === 66) drawID = world.resolveTaskID(m.load(32), task.id);
    await compare(world, row, label);
    if (row.id === 462) assert.equal(m.load(row.resultAddress), row.result, label + ' layer');
    if (row.id === 657) {
      const key = (world.nativeTaskID(task.id) | (row.args[1] << 16)) >>> 0,
        entry = world.objects.objects.get(drawID).implementation.entry(key),
        value = m.load(row.resultAddress);
      assert.equal(value, entry?.image ?? 0, label + ' borrowed entry');
      if (value)
        assert.equal(
          world.graphics.images.get(value).dataHandle,
          world.graphics.images.get(m.load(40)).dataHandle,
          label + ' source alias',
        );
    }
    assert.equal(
      [...world.runtime.handles.records.values()].filter(
        (r) => r.type === 'bitmap' && r.value.owner === task.id,
      ).length,
      row.scriptBitmapCount,
      label + ' automatic bitmap list',
    );
    if (row.id === 114) {
      assert.equal(world.runtime.handles.records.has(m.load(40)), false);
      const fresh = await dataWorld(profile, inputs, { initialize: false });
      try {
        await fresh.restore(structuredClone(world.snapshot()));
        await compare(fresh, row, 'independent cold after source release');
        const restoredTask = fresh.runtime.scheduler.tasks.get(task.id);
        for (let next = index + 1; next < golden.rows.length; next++) {
          await fresh.runtime.scheduler.execute(restoredTask);
          assert.equal(restoredTask.machine.load(floor), marker);
          await compare(fresh, golden.rows[next], 'cold continuation ' + next);
        }
        await fresh.objects.tick(40);
        assert.equal(fresh.objects.objects.has(drawID), false);
      } finally {
        await fresh.close({ flushFiles: false });
      }
    }
  }
  await world.objects.tick(40);
  assert.equal(world.objects.objects.has(drawID), false);
});

test('SDK23 count and layer queries keep the missing renderer precondition guarded', async (t) => {
  const world = await dataWorld(profile);
  t.after(() => world.close({ flushFiles: false }));
  const id = await world.objects.create({ kind: 15, parent: world.main.id }),
    nativeID = world.nativeTaskID(id),
    task = world.main;
  for (const [slot, args] of [
    [264, [nativeID]],
    [462, [nativeID, 7]],
    [463, [nativeID, 7, 3]],
  ])
    await assert.rejects(
      world.runtime.native('main', slot, args, task.machine, task),
      /require an initialized renderer/,
    );
});
