// SPDX-License-Identifier: MPL-2.0
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { test } from 'node:test';
import { dataWorld } from './fixtures/data-world.mjs';
import { kcsProgram } from './helpers.mjs';

const golden = JSON.parse(
  await readFile(new URL('./fixtures/native-sdk23-bitmap-pixels.json', import.meta.url)),
);
const profile = 'grisaia-jp-engine-2.6.1.23',
  marker = 0x73646236;
test('SDK23 complete KCS bitmap pixel and attribute sequence matches the actual original after every call', async (t) => {
  const program = kcsProgram(
    [
      [37, marker],
      ...golden.rows.flatMap((row) => [
        ...row.args.map((arg) => [37, arg]),
        [43, row.id, row.args.length * 4],
        ...(row.resultAddress === null ? [] : [[38, row.resultAddress]]),
        [43, 65, 0],
      ]),
      [59],
    ],
    [[256, golden.resource.name]],
  );
  const inputs = {
    [golden.resource.name]: Buffer.from(golden.resource.base64, 'base64'),
    'pixels.kcs': program,
  };
  const world = await dataWorld(profile, inputs);
  t.after(() => world.close({ flushFiles: false }));
  const task = await world.spawnScript('pixels.kcs', {
    parent: world.main.id,
    initialExecute: false,
  });
  const m = task.machine,
    floor = m.sp;
  const compare = async (world, id, expected, label) => {
    if (!expected) return;
    const bitmap = world.graphics.images.get(id),
      state = bitmap.state;
    assert.equal(bitmap.owner, task.id, label + ' owner');
    assert.deepEqual(
      [bitmap.width, bitmap.height, state.bpp],
      [expected.width, expected.height, expected.bpp],
      label + ' geometry',
    );
    assert.equal(
      Buffer.from(await bitmap.pixels()).toString('base64'),
      expected.rgbaBase64,
      label + ' pixels',
    );
    for (const [key, value] of Object.entries(expected.metadata))
      assert.equal(state[key] ?? 0, value, label + ' ' + key);
    assert.deepEqual(state.clip, expected.clip, label + ' clip');
  };
  for (const [index, row] of golden.rows.entries()) {
    await world.runtime.scheduler.execute(task);
    const label = 'Main' + row.id + ' at sequence' + index;
    assert.equal(m.sp, floor + 4, label + ' SP');
    assert.equal(m.load(floor), marker, label + ' marker');
    if (row.result !== null) assert.equal(m.load(row.resultAddress), row.result, label + ' result');
    assert.deepEqual(
      Array.from({ length: 7 }, (_, i) => m.load(100 + i * 4)),
      row.outputs,
      label + ' VM outputs',
    );
    await compare(world, m.load(36), row.source, label + ' source');
    await compare(world, m.load(40), row.target, label + ' target');
    if (row.id === 641) {
      const fresh = await dataWorld(profile, inputs, { initialize: false });
      try {
        await fresh.restore(structuredClone(world.snapshot()));
        await compare(fresh, m.load(36), row.source, 'independent cold');
      } finally {
        await fresh.close({ flushFiles: false });
      }
    }
  }
  assert.equal(world.runtime.handles.records.has(m.load(36)), false);
  assert.equal(world.runtime.handles.records.has(m.load(40)), false);
});
