// SPDX-License-Identifier: MPL-2.0
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { test } from 'node:test';
import { dataWorld } from './fixtures/data-world.mjs';
import { kcsProgram } from './helpers.mjs';
const golden = JSON.parse(
  await readFile(new URL('./fixtures/native-sdk23-image-owner-draw.json', import.meta.url)),
);
const profile = 'grisaia-jp-engine-2.6.1.23',
  marker = 0x7364623a,
  rows = golden.rows.filter((row) => row.id);
const inputs = {
  [golden.resource.name]: Buffer.from(golden.resource.base64, 'base64'),
  'owner-draw.kcs': kcsProgram(
    [
      [37, marker],
      ...rows.flatMap((row) => [
        ...row.args.map((arg, i) => [37, row.id === 66 && i === 1 ? [0x13, 44] : arg]),
        [43, row.id, row.args.length * 4],
        ...(row.resultAddress === null ? [] : [[38, row.resultAddress]]),
        [43, 65, 0],
      ]),
      [59],
    ],
    [
      [256, golden.resource.name],
      [320, 'CPU Draw'],
    ],
  ),
};
test('SDK23 actual image-owner Draw GCALL retains pixels through source release, cold restore and Draw destruction', async (t) => {
  const world = await dataWorld(profile, inputs);
  t.after(() => world.close({ flushFiles: false }));
  const task = await world.spawnScript('owner-draw.kcs', {
      parent: world.main.id,
      initialExecute: false,
    }),
    m = task.machine,
    floor = m.sp;
  m.store(44, world.nativeTaskID(world.main.id));
  let drawID;
  const compare = async (w, expected, label) => {
    const draw = w.objects.objects.get(drawID).implementation,
      renderer = draw.state.renderer;
    assert.equal(renderer?.items.length ?? null, expected.itemCount, label + ' retained count');
    if (expected.bitmap) {
      const bitmap = w.graphics.images.get(renderer.bitmap);
      assert.deepEqual(
        [bitmap.width, bitmap.height, bitmap.state.bpp],
        [expected.bitmap.width, expected.bitmap.height, expected.bitmap.bpp],
        label + ' geometry',
      );
      assert.equal(
        Buffer.from(await bitmap.pixels()).toString('base64'),
        expected.bitmap.rgbaBase64,
        label + ' pixels',
      );
    }
  };
  for (const [index, row] of rows.entries()) {
    await world.runtime.scheduler.execute(task);
    const label = 'Main' + row.id + ' at' + index;
    assert.equal(m.sp, floor + 4, label + ' SP');
    assert.equal(m.load(floor), marker, label + ' marker');
    if (row.id === 66) drawID = world.resolveTaskID(m.load(32), task.id);
    await compare(world, row, label);
    assert.equal(
      [...world.runtime.handles.records.values()].filter(
        (r) => r.type === 'image-owner' && r.value.owner === task.id,
      ).length,
      row.scriptOwnerCount,
      label + ' Script owners',
    );
    if (row.id === 261)
      assert.equal(
        m.load(40),
        world.objects.objects.get(drawID).implementation.state.renderer.bitmap,
        'borrowed Draw bitmap',
      );
    if (row.id === 340 && rows[index - 1]?.id === 731 && rows[index - 1].args[12] === 1) {
      const fresh = await dataWorld(profile, inputs, { initialize: false });
      try {
        await fresh.restore(structuredClone(world.snapshot()));
        await compare(fresh, row, 'independent affine cold');
        const restored = fresh.objects.objects.get(task.id).implementation.machine;
        for (let next = index + 1; next <= Math.min(index + 2, rows.length - 1); next++) {
          await fresh.runtime.scheduler.execute(fresh.runtime.scheduler.tasks.get(task.id));
          assert.equal(restored.load(floor), marker);
          await compare(fresh, rows[next], 'affine cold continuation');
        }
      } finally {
        await fresh.close({ flushFiles: false });
      }
    }
    if (row.id === 67) {
      const fresh = await dataWorld(profile, inputs, { initialize: false });
      try {
        await fresh.restore(structuredClone(world.snapshot()));
        await compare(fresh, row, 'cold retired Draw keeps borrowed bitmap');
        await fresh.objects.tick(30);
        assert.equal(fresh.objects.objects.has(drawID), false);
        assert.equal(fresh.runtime.handles.records.has(m.load(40)), false);
      } finally {
        await fresh.close({ flushFiles: false });
      }
    }
    if (row.id === 711) {
      assert.equal(
        world.runtime.handles.records.has(m.load(36)),
        false,
        'source owner is released',
      );
      const fresh = await dataWorld(profile, inputs, { initialize: false });
      try {
        await fresh.restore(structuredClone(world.snapshot()));
        await compare(fresh, row, 'independent cold after source release');
      } finally {
        await fresh.close({ flushFiles: false });
      }
    }
  }
  await world.objects.tick(30);
  assert.equal(world.objects.objects.has(drawID), false, 'retired Draw deleted on update');
  assert.equal(
    world.runtime.handles.records.has(m.load(40)),
    false,
    'borrowed bitmap ends with Draw',
  );
});

test('SDK23 rejects an unreviewed image-owner Draw mode before resolving resources', async (t) => {
  const args = [...new Array(12).fill(0), 2];
  const world = await dataWorld(profile, {
    'unreviewed-mode.kcs': kcsProgram([...args.map((v) => [37, v]), [43, 731, 52], [59]]),
  });
  t.after(() => world.close({ flushFiles: false }));
  const task = await world.spawnScript('unreviewed-mode.kcs', {
    parent: world.main.id,
    initialExecute: false,
  });
  await assert.rejects(world.runtime.scheduler.execute(task), /mode has no reviewed ABI binding/);
});
