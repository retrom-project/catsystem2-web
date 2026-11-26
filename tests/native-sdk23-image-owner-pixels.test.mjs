// SPDX-License-Identifier: MPL-2.0
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { test } from 'node:test';
import { dataWorld } from './fixtures/data-world.mjs';
import { kcsProgram } from './helpers.mjs';
const golden = JSON.parse(
  await readFile(new URL('./fixtures/native-sdk23-image-owner-pixels.json', import.meta.url)),
);
const profile = 'grisaia-jp-engine-2.6.1.23',
  marker = 0x73646238;
const call = (row) => [
  ...row.args.map((arg) => [37, arg]),
  [43, row.id, row.args.length * 4],
  ...(row.resultAddress === null ? [] : [[38, row.resultAddress]]),
  [43, 65, 0],
];
const inputs = {
  [golden.resource.name]: Buffer.from(golden.resource.base64, 'base64'),
  'owner-pixels.kcs': kcsProgram(
    [[37, marker], ...golden.rows.flatMap(call), [59]],
    [[256, golden.resource.name]],
  ),
  'owner-empty.kcs': kcsProgram([[59]]),
};
test('SDK23 image-owner pixel services match actual constructed original owners through KCS and cold restore', async (t) => {
  const world = await dataWorld(profile, inputs);
  t.after(() => world.close({ flushFiles: false }));
  const task = await world.spawnScript('owner-pixels.kcs', {
      parent: world.main.id,
      initialExecute: false,
    }),
    m = task.machine,
    floor = m.sp;
  const compare = async (w, handle, expected, label) => {
    if (!expected) return;
    const owner = w.imageOwners.get(handle),
      bitmap = w.graphics.images.get(owner.bitmap);
    assert.equal(owner.owner, task.id, label + ' Script ownership');
    assert.deepEqual(
      [bitmap.width, bitmap.height, bitmap.state.bpp],
      [expected.width, expected.height, expected.bpp],
      label + ' geometry',
    );
    assert.equal(
      Buffer.from(await bitmap.pixels()).toString('base64'),
      expected.rgbaBase64,
      label + ' pixels',
    );
    for (const [key, value] of Object.entries(expected.metadata))
      assert.equal(bitmap.state[key] ?? 0, value, label + ' ' + key);
    assert.deepEqual(bitmap.state.clip, expected.clip, label + ' clip');
    assert.deepEqual(owner.info, expected.info, label + ' image metadata');
    assert.equal(owner.layers?.length ?? null, expected.layers, label + ' layers');
  };
  for (const [index, row] of golden.rows.entries()) {
    await world.runtime.scheduler.execute(task);
    const label = 'Main' + row.id + ' at' + index;
    assert.equal(m.sp, floor + 4, label + ' SP');
    assert.equal(m.load(floor), marker, label + ' marker');
    if (row.result !== null) assert.equal(m.load(row.resultAddress), row.result, label + ' result');
    assert.deepEqual(
      Array.from({ length: 5 }, (_, i) => m.load(100 + i * 4)),
      row.outputs,
      label + ' VM outputs',
    );
    await compare(world, m.load(36), row.source, label + ' source');
    await compare(world, m.load(40), row.target, label + ' target');
    assert.equal(
      [...world.runtime.handles.records.values()].filter(
        (r) => r.type === 'image-owner' && r.value.owner === task.id,
      ).length,
      row.listCount,
      label + ' owned records',
    );
    if (row.id === 734) {
      const fresh = await dataWorld(profile, inputs, { initialize: false });
      try {
        await fresh.restore(structuredClone(world.snapshot()));
        await compare(fresh, m.load(36), row.source, 'independent cold source');
        await compare(fresh, m.load(40), row.target, 'independent cold target');
        await fresh.objects.objects
          .get(task.id)
          .implementation.loadScript('owner-empty.kcs', { initialExecute: false });
        assert.equal(fresh.runtime.handles.records.has(m.load(36)), false);
        assert.equal(fresh.runtime.handles.records.has(m.load(40)), false);
      } finally {
        await fresh.close({ flushFiles: false });
      }
    }
  }
  assert.equal(world.runtime.handles.records.has(m.load(36)), false);
  assert.equal(world.runtime.handles.records.has(m.load(40)), false);
});
test('SDK23 protects the uninitialized-result image alpha query without invoking the original null branch', async (t) => {
  const world = await dataWorld(profile, {
    'null-owner.kcs': kcsProgram([[37, 0], [43, 721, 4], [59]]),
  });
  t.after(() => world.close({ flushFiles: false }));
  const task = await world.spawnScript('null-owner.kcs', {
    parent: world.main.id,
    initialExecute: false,
  });
  await assert.rejects(world.runtime.scheduler.execute(task), /requires an owner bitmap/);
});
