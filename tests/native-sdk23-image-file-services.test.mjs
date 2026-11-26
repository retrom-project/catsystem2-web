// SPDX-License-Identifier: MPL-2.0
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { test } from 'node:test';
import { dataWorld } from './fixtures/data-world.mjs';
import { kcsProgram } from './helpers.mjs';
const golden = JSON.parse(
  await readFile(new URL('./fixtures/native-sdk23-image-file-services.json', import.meta.url)),
);
const profile = 'grisaia-jp-engine-2.6.1.23',
  marker = 0x73646239;
const inputs = Object.fromEntries(
  Object.entries(golden.files).map(([name, b64]) => [name, Buffer.from(b64, 'base64')]),
);
inputs['file-services.kcs'] = kcsProgram(
  [
    [37, marker],
    ...golden.rows.flatMap((row) => [
      [37, row.id === 114 ? [0x13, 48] : row.string.address],
      [43, row.id, 4],
      ...(row.id === 114 ? [] : [[38, 48]]),
      [43, 65, 0],
    ]),
    [59],
  ],
  golden.rows.filter((row) => row.string).map((row) => [row.string.address, row.string.text]),
);
inputs['file-empty.kcs'] = kcsProgram([[59]]);
test('SDK23 KCS ANM presence and selector factories match actual initialized original output and explicit lifetime', async (t) => {
  const world = await dataWorld(profile, inputs);
  t.after(() => world.close({ flushFiles: false }));
  const task = await world.spawnScript('file-services.kcs', {
      parent: world.main.id,
      initialExecute: false,
    }),
    m = task.machine,
    floor = m.sp;
  const compare = async (w, handle, expected, label) => {
    const bitmap = w.graphics.images.get(handle);
    assert.equal(bitmap.owner, null, label + ' explicit owner');
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
  };
  let handle;
  for (const row of golden.rows) {
    await world.runtime.scheduler.execute(task);
    const label = 'Main' + row.id + ' ' + row.name;
    assert.equal(m.sp, floor + 4, label + ' SP');
    assert.equal(m.load(floor), marker, label + ' marker');
    if (row.id === 430) assert.equal(m.load(48), row.result, label + ' boolean');
    if (row.id === 460) {
      handle = m.load(48);
      await compare(world, handle, row.bitmap, label);
      if (row.name === 'x,1,2.hg3') {
        const fresh = await dataWorld(profile, inputs, { initialize: false });
        try {
          await fresh.restore(structuredClone(world.snapshot()));
          await compare(fresh, handle, row.bitmap, 'independent cold');
          await fresh.objects.objects
            .get(task.id)
            .implementation.loadScript('file-empty.kcs', { initialExecute: false });
          assert(
            fresh.runtime.handles.records.has(handle),
            'Main460 is independent of Script reload',
          );
          await fresh.graphics.images.release(handle);
          assert.equal(fresh.runtime.handles.records.has(handle), false);
        } finally {
          await fresh.close({ flushFiles: false });
        }
      }
    }
    if (row.id === 114)
      assert.equal(world.runtime.handles.records.has(handle), false, label + ' explicit release');
    assert.equal(
      [...world.runtime.handles.records.values()].filter(
        (r) => r.type === 'bitmap' && r.value.owner === task.id,
      ).length,
      0,
      label + ' no automatic Script bitmap',
    );
  }
});

test('SDK23 protects an unreviewed decoded image format and releases its tentative bitmap', async (t) => {
  const world = await dataWorld(profile, {
    'format-guard.kcs': kcsProgram([[37, 256], [43, 460, 4], [59]], [[256, 'unreviewed.image']]),
  });
  t.after(() => world.close({ flushFiles: false }));
  const images = world.graphics.images,
    before = [...world.runtime.handles.records.keys()];
  // The injected decoder represents an unsupported format without invoking a
  // browser codec or an original malformed-input path.
  images.load = async () => images.create(1, 1);
  images.images.load = async () => ({});
  const task = await world.spawnScript('format-guard.kcs', {
    parent: world.main.id,
    initialExecute: false,
  });
  await assert.rejects(world.runtime.scheduler.execute(task), /no reviewed format binding/);
  assert.deepEqual([...world.runtime.handles.records.keys()], before);
});
