// SPDX-License-Identifier: MPL-2.0
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { test } from 'node:test';
import { dataWorld } from './fixtures/data-world.mjs';
import { kcsProgram } from './helpers.mjs';
const golden = JSON.parse(
  await readFile(new URL('./fixtures/native-sdk23-draw-resize.json', import.meta.url)),
);
const profile = 'grisaia-jp-engine-2.6.1.23',
  marker = 0x64726131,
  inputs = {
    [golden.resource.name]: Buffer.from(golden.resource.base64, 'base64'),
    'draw-resize.kcs': kcsProgram(
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

test('SDK23 renderer resize replaces its output while preserving retained sources and cold continuation', async (t) => {
  const world = await dataWorld(profile, inputs);
  t.after(() => world.close({ flushFiles: false }));
  const task = await world.spawnScript('draw-resize.kcs', {
      parent: world.main.id,
      initialExecute: false,
    }),
    m = task.machine,
    floor = m.sp;
  m.store(44, world.nativeTaskID(world.main.id));
  let drawID, renderer, previousOutput, borrowedFrame;
  const compare = async (w, row, label) => {
    const draw = w.objects.objects.get(drawID).implementation,
      output = draw.state.renderer;
    assert.equal(output?.items.length ?? null, row.itemCount, label + ' count');
    if (row.bitmap) {
      const bitmap = w.graphics.images.get(output.bitmap);
      assert.deepEqual([output.width, output.height, bitmap.state.bpp], row.bitmap.shape);
      assert.equal(
        Buffer.from(await bitmap.pixels()).toString('base64'),
        row.bitmap.rgbaBase64,
        label,
      );
      assert.deepEqual(draw.state.offset, row.id === 256 ? null : [0, 0]);
    }
    return output;
  };
  for (const [index, row] of golden.rows.entries()) {
    await world.runtime.scheduler.execute(task);
    const label = 'Main' + row.id + ' at' + index;
    assert.equal(m.sp, floor + 4, label + ' control');
    assert.equal(m.load(floor), marker, label + ' marker');
    if (row.id === 66) drawID = world.resolveTaskID(m.load(32), task.id);
    const current = await compare(world, row, label);
    if (row.id === 256) renderer = current;
    else if (current) assert.equal(current, renderer, label + ' renderer identity');
    if (row.id === 261) {
      assert.equal(m.load(row.resultAddress), current.bitmap, label + ' new borrowed output');
      if (!borrowedFrame) {
        const bitmap = world.graphics.images.get(current.bitmap);
        borrowedFrame = { frame: await bitmap.frame(), bytes: (await bitmap.pixels()).slice() };
      }
    }
    if (row.id === 663) {
      assert.equal(world.runtime.handles.records.has(previousOutput), false, 'old output released');
      assert.notEqual(current.bitmap, previousOutput);
      assert.deepEqual(
        borrowedFrame.frame.rgba,
        borrowedFrame.bytes,
        'previous owned pixels stay stable',
      );
      assert.deepEqual(current.items[0].clip, [0, 0, 8, 6], 'existing entry clip retained');
      if (row.args[1] === 10) {
        const fresh = await dataWorld(profile, inputs, { initialize: false });
        try {
          await fresh.restore(structuredClone(world.snapshot()));
          await compare(fresh, row, 'independent resize cold');
          const restored = fresh.runtime.scheduler.tasks.get(task.id);
          for (let next = index + 1; next < golden.rows.length; next++) {
            await fresh.runtime.scheduler.execute(restored);
            assert.equal(restored.machine.load(floor), marker);
            await compare(fresh, golden.rows[next], 'cold continuation ' + next);
          }
          await fresh.objects.tick(40);
          assert.equal(fresh.objects.objects.has(drawID), false);
        } finally {
          await fresh.close({ flushFiles: false });
        }
      }
    }
    previousOutput = current?.bitmap;
  }
  await world.objects.tick(40);
  assert.equal(world.objects.objects.has(drawID), false);
});
