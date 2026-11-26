// SPDX-License-Identifier: MPL-2.0
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { test } from 'node:test';
import { dataWorld } from './fixtures/data-world.mjs';
import { kcsProgram } from './helpers.mjs';

const profile = 'grisaia-jp-engine-2.6.1.23',
  marker = 0x73646233;
const golden = JSON.parse(
  await readFile(new URL('./fixtures/native-sdk23-image-metadata.json', import.meta.url)),
);
const call = (id, args, result) => [
  ...args.map((arg) => [37, arg]),
  [43, id, args.length * 4],
  ...(result === undefined ? [] : [[38, result]]),
];
const handle = [0x13, 32];
const files = {
  'image-metadata.kcs': kcsProgram([
    [37, marker],
    ...call(112, [4, 3], 32),
    ...call(117, [handle, 0, 0, 4, 3, 0x80402010]),
    ...call(374, [handle, -2, 5], 36),
    ...call(371, [handle, 100, 104], 40),
    ...call(378, [handle, 1]),
    ...call(377, [handle], 44),
    ...call(370, [handle, 0, 0], 48),
    ...call(378, [handle, 0]),
    ...call(377, [handle], 52),
    [59],
  ]),
  'image-release.kcs': kcsProgram([[37, marker], ...call(114, [handle]), [59]]),
  'image-empty.kcs': kcsProgram([[59]]),
};

test('SDK23 KCS bitmap base and alpha outputs match original live owners and cold lifetime', async (t) => {
  const world = await dataWorld(profile, files);
  t.after(() => world.close({ flushFiles: false }));
  const task = await world.spawnScript('image-metadata.kcs', {
    parent: world.main.id,
    initialExecute: false,
  });
  const machine = task.machine,
    floor = machine.sp;
  await world.runtime.scheduler.execute(task);
  assert.equal(machine.halted, true);
  assert.equal(machine.sp, floor + 4);
  assert.equal(machine.load(floor), marker);
  assert.deepEqual(
    [36, 40, 44, 48, 52].map((address) => machine.load(address)),
    [
      golden.setBaseResult,
      golden.baseResult,
      golden.enabledHintResult,
      golden.sampleAlpha,
      golden.disabledHintResult,
    ],
  );
  assert.deepEqual([machine.load(100), machine.load(104)], golden.base);
  const bitmapHandle = machine.load(32),
    bitmap = world.graphics.images.get(bitmapHandle);
  assert.equal(bitmap.owner, task.id);
  assert.deepEqual([...(await bitmap.pixels())], golden.rgba);
  assert.deepEqual([bitmap.state.baseX, bitmap.state.baseY], [-2, 5]);

  const fresh = await dataWorld(profile, files, { initialize: false });
  t.after(() => fresh.close({ flushFiles: false }));
  await fresh.restore(structuredClone(world.snapshot()));
  const restored = fresh.graphics.images.get(bitmapHandle);
  assert.equal(restored.owner, task.id);
  assert.deepEqual([...(await restored.pixels())], golden.rgba);
  assert.deepEqual([restored.state.baseX, restored.state.baseY], [-2, 5]);
  assert.equal(await restored.hasAlpha(), false);
  const release = await fresh.spawnScript('image-release.kcs', {
    parent: fresh.main.id,
    initialExecute: false,
  });
  release.machine.store(32, bitmapHandle);
  await fresh.runtime.scheduler.execute(release);
  assert.equal(fresh.runtime.handles.records.has(bitmapHandle), false);
  assert.equal(world.runtime.handles.records.has(bitmapHandle), true);
  await world.objects.objects
    .get(task.id)
    .implementation.loadScript('image-empty.kcs', { initialExecute: false });
  assert.equal(world.runtime.handles.records.has(bitmapHandle), false);
});

test('SDK23 protects the alpha query whose absent owner leaves its original result unwritten', async (t) => {
  const world = await dataWorld(profile, {
    'image-null-alpha.kcs': kcsProgram([[37, 0], [43, 377, 4], [59]]),
  });
  t.after(() => world.close({ flushFiles: false }));
  const task = await world.spawnScript('image-null-alpha.kcs', {
    parent: world.main.id,
    initialExecute: false,
  });
  await assert.rejects(world.runtime.scheduler.execute(task), /requires a live bitmap owner/);
});

const encoded = JSON.parse(
  await readFile(new URL('./fixtures/native-sdk23-encoded-images.json', import.meta.url)),
);
for (const fixture of encoded.cases) {
  test('SDK23 actual encoded bitmap GCALL and independent cold: ' + fixture.name, async (t) => {
    const source = Buffer.from(fixture.encodedBase64, 'base64');
    const program = kcsProgram(
      [
        [37, marker],
        ...call(365, [256], 32),
        ...call(428, [handle, fixture.index, 100], 36),
        ...(fixture.ninePatch
          ? call(648, [handle, fixture.ninePatch.width, fixture.ninePatch.height], 40)
          : []),
        ...call(366, [handle]),
        [59],
      ],
      [[256, fixture.file]],
    );
    const inputs = {
      [fixture.file]: source,
      'encoded.kcs': program,
      'empty.kcs': files['image-empty.kcs'],
    };
    const world = await dataWorld(profile, inputs);
    t.after(() => world.close({ flushFiles: false }));
    const task = await world.spawnScript('encoded.kcs', {
      parent: world.main.id,
      initialExecute: false,
    });
    const machine = task.machine,
      floor = machine.sp;
    await world.runtime.scheduler.execute(task);
    assert.equal(machine.halted, true);
    assert.equal(machine.sp, floor + 4);
    assert.equal(machine.load(floor), marker);
    assert.equal(machine.load(100), fixture.decoded.frameID);
    const produced = [
      [machine.load(36), fixture.decoded],
      ...(fixture.ninePatch ? [[machine.load(40), fixture.ninePatch]] : []),
    ];
    for (const [id, expected] of produced) {
      const bitmap = world.graphics.images.get(id);
      assert.equal(bitmap.owner, task.id);
      assert.deepEqual(
        [bitmap.width, bitmap.height, bitmap.state.bpp],
        [expected.width, expected.height, expected.bpp],
      );
      assert.deepEqual([...(await bitmap.pixels())], expected.rgba);
    }
    assert.equal(world.runtime.handles.records.has(machine.load(32)), false);
    const fresh = await dataWorld(profile, inputs, { initialize: false });
    t.after(() => fresh.close({ flushFiles: false }));
    await fresh.restore(structuredClone(world.snapshot()));
    for (const [id, expected] of produced)
      assert.deepEqual([...(await fresh.graphics.images.get(id).pixels())], expected.rgba);
    await world.objects.objects
      .get(task.id)
      .implementation.loadScript('empty.kcs', { initialExecute: false });
    await fresh.objects.release(task.id);
    for (const [id] of produced) {
      assert.equal(world.runtime.handles.records.has(id), false);
      assert.equal(fresh.runtime.handles.records.has(id), false);
    }
  });
}

test('SDK23 keeps the separately observed partial nine-piece shape protected before its admission', async (t) => {
  const fixture = encoded.cases.find((item) => item.protectedPartialNinePatch);
  const world = await dataWorld(profile, {
    [fixture.file]: Buffer.from(fixture.encodedBase64, 'base64'),
    'partial.kcs': kcsProgram(
      [...call(365, [256], 32), ...call(648, [handle, 8, 8], 40), [59]],
      [[256, fixture.file]],
    ),
  });
  t.after(() => world.close({ flushFiles: false }));
  const task = await world.spawnScript('partial.kcs', {
    parent: world.main.id,
    initialExecute: false,
  });
  await assert.rejects(world.runtime.scheduler.execute(task), /missing tile frames/);
  world.runtime.imageDataBuffers.release(task.machine.load(32));
});
