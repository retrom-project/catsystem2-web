// SPDX-License-Identifier: MPL-2.0
import assert from 'node:assert/strict';
import test from 'node:test';
import { readFile } from 'node:fs/promises';
import { NativeHandles } from '../src/native/handles.mjs';
import { nativeABI } from '../src/native/abi/index.mjs';
import { dataWorld } from './fixtures/data-world.mjs';
import { NativeSceneData } from '../src/native/scene-data.mjs';
import { kcsProgram } from './helpers.mjs';
import { serializeCheckpoint, deserializeCheckpoint } from '../src/checkpoint.mjs';
const profile = 'grisaia-jp-engine-2.6.1.23';
const call = (id, args = [], out) => [
  ...args.map((arg) => [37, arg]),
  [43, id, args.length * 4],
  ...(out === undefined ? [] : [[38, out]]),
];
const files = {
  'source.kcs': kcsProgram(
    [
      ...call(219),
      ...call(223, [[0x23, 256], 6]),
      ...call(224, [[0x23, 256], 4]),
      ...call(71, [240]),
      [59],
    ],
    [[256, 'chapter']],
  ),
  'consumer.kcs': kcsProgram(
    [
      ...call(219),
      ...call(234, [[0x13, 64]], 128),
      ...call(227, [[0x23, 256]], 132),
      ...call(228, [99, [0x23, 320], [0x23, 384]], 136),
      ...call(71, [240]),
      [59],
    ],
    [[256, 'chapter']],
  ),
};
async function query(world, task) {
  const values = new Map();
  await world.sendNativeEngine(world.nativeTaskID(task.id), task.id, 162, 0, 4, {
    payload: { store: (at, word) => values.set(at, word) },
  });
  assert.equal(values.size, 2);
  return [values.get(0), values.get(4)];
}
for (const cold of [false, true])
  test(`SDK23 live raw162 typed pair routes real cross-Script consumers${cold ? ' through independent cold' : ''}`, async () => {
    let world = await dataWorld(profile, files),
      source,
      consumer;
    try {
      source = await world.spawnScript('source.kcs', { initialExecute: false });
      await world.runtime.native('main', 209, [512], source.machine, source);
      assert.deepEqual(await query(world, source), [0, 0]);
      await world.objects.update(source.id, 100);
      const handle = source.context.sceneData,
        data = world.runtime.handles.get(handle, 'scene-data'),
        pair = await query(world, source);
      assert(pair.every((id) => id > 0));
      assert.deepEqual(await query(world, source), pair);
      assert.throws(() => world.runtime.imageDataBuffers.process.readHostData(pair[0], 4, 836));
      const another = world.runtime.handles.add('scene-data', new NativeSceneData()),
        anotherPair = world.runtime.scenePointers(another);
      assert.throws(
        () => world.runtime.sceneDataFromPointers(pair[0], anotherPair[1]),
        /different owners/,
      );
      world.runtime.handles.release(another, 'scene-data');
      assert(anotherPair.every((id) => !world.runtime.handles.records.has(id)));
      assert.deepEqual(await query(world, source), pair);
      assert.equal(world.runtime.sceneDataFromPointers(...pair), data);
      assert.equal(
        [...world.runtime.handles.records.values()].filter((record) => record.type === 'scene-data')
          .length,
        1,
      );
      assert.throws(
        () => world.runtime.handles.release(pair[0], 'scene-reader-reference'),
        /only be retired with their owner/,
      );
      assert.deepEqual(await query(world, source), pair);
      if (cold) {
        const id = source.id,
          saved = await deserializeCheckpoint(await serializeCheckpoint(world.snapshot()));
        await world.close({ flushFiles: false });
        world = await dataWorld(profile, files, { initialize: false });
        await world.restore(saved);
        source = world.runtime.scheduler.tasks.get(id);
        assert.deepEqual(await query(world, source), pair);
        assert.equal(world.runtime.sceneDataFromPointers(...pair), world.runtime.sceneData(source));
      }
      consumer = await world.spawnScript('consumer.kcs', { initialExecute: false });
      await world.runtime.native('main', 209, [512], consumer.machine, consumer);
      consumer.machine.store(64, world.nativeTaskID(source.id));
      await world.objects.update(consumer.id, 101);
      assert.deepEqual(
        [128, 132, 136].map((at) => consumer.machine.load(at)),
        [1, 6, 0],
      );
      assert.equal(consumer.machine.string(320), 'chapter');
      assert.equal(consumer.machine.load(384), 4);
      assert.notEqual(consumer.context.sceneData, source.context.sceneData);
      await world.runtime.native('main', 219, [], source.machine, source);
      assert(pair.every((id) => !world.runtime.handles.records.has(id)));
      assert.throws(() => world.runtime.sceneDataFromPointers(...pair), /released/);
      const replacement = await query(world, source);
      assert(replacement.every((id) => !pair.includes(id)));
      assert.equal(
        world.runtime.sceneDataFromPointers(...replacement),
        world.runtime.sceneData(source),
      );
      await world.objects.destroy(source.id);
      assert(replacement.every((id) => world.runtime.handles.records.has(id)));
      await world.objects.update(source.id, 102);
      assert(replacement.every((id) => !world.runtime.handles.records.has(id)));
      assert.equal(world.runtime.sceneData(consumer).history.path[0].value, 4);
    } finally {
      await world.close({ flushFiles: false });
    }
  });
test('optional handle cleanup validates the whole plan before retirement and preserves replacement records', () => {
  const handles = new NativeHandles();
  let mode = 'throw',
    pair;
  handles.registerType('owner', {
    snapshot: (value) => value,
    restore: (value) => value,
    release: (_value, id) => {
      if (mode === 'throw') throw Error('cleanup failed');
      if (mode === 'reentrant') return handles.release(id, 'owner');
      if (mode === 'replace') {
        handles.restore(handles.snapshot());
        return [];
      }
      if (mode === 'bad-plan')
        return [
          { handle: pair[0], type: 'borrowed', value: handles.get(pair[0], 'borrowed') },
          { handle: 999, type: 'borrowed', value: {} },
        ];
      return pair.map((handle) => ({
        handle,
        type: 'borrowed',
        value: handles.get(handle, 'borrowed'),
      }));
    },
  });
  const owner = handles.add('owner', {});
  pair = [handles.add('borrowed', { owner }), handles.add('borrowed', { owner })];
  for (mode of ['throw', 'reentrant', 'bad-plan']) {
    assert.throws(() => handles.release(owner, 'owner'));
    assert.equal(handles.records.size, 3);
  }
  const before = handles.records.get(owner);
  mode = 'replace';
  assert.throws(() => handles.release(owner, 'owner'), /changed during cleanup/);
  assert.notEqual(handles.records.get(owner), before);
  assert.equal(handles.records.size, 3);
  mode = 'normal';
  handles.release(owner, 'owner');
  assert.equal(handles.records.size, 0);
  assert.throws(() => handles.release(owner, 'owner'), /released/);
  const ordinary = handles.add('ordinary', 7);
  assert.equal(handles.release(ordinary, 'ordinary'), 7);
});
test('borrowed Scene reference policy is only qualified for SDK23', () => {
  for (const other of ['rebellions-jp-engine-2.6.1.63', 'bokutomo-engine-2.6.1.67'])
    assert.equal(nativeABI(other).scene?.borrowedSceneReferences, undefined);
});
test('SDK23 normal content load and Script reload retain the same borrowed Scene pair', async () => {
  const input = JSON.parse(
      await readFile(new URL('./fixtures/sdk23-scene-reader-cursor-golden.json', import.meta.url)),
    ),
    program = kcsProgram(
      [
        ...call(219),
        ...call(220, [[0x23, 256]], 128),
        ...call(65),
        ...call(220, [[0x23, 256]], 132),
        ...call(71, [240]),
        [59],
      ],
      [[256, 'owned.cst']],
    ),
    control = kcsProgram(
      [...call(143, [[0x13, 64], [0x23, 256], 0]), ...call(71, [240]), [59]],
      [[256, 'reload.kcs']],
    ),
    world = await dataWorld(profile, {
      'content.kcs': program,
      'control.kcs': control,
      'reload.kcs': kcsProgram([...call(71, [240]), [59]]),
      'owned.cst': new Uint8Array(Buffer.from(input.inputs.cst, 'base64')),
    });
  try {
    let source = await world.spawnScript('content.kcs', { initialExecute: false });
    await world.runtime.native('main', 209, [512], source.machine, source);
    await world.objects.update(source.id, 100);
    assert.equal(source.machine.load(128), 1);
    const handle = source.context.sceneData,
      pair = await query(world, source);
    await world.objects.update(source.id, 101);
    assert.equal(source.machine.load(132), 1);
    assert.deepEqual(await query(world, source), pair);
    const controller = await world.spawnScript('control.kcs', { initialExecute: false });
    await world.runtime.native('main', 209, [512], controller.machine, controller);
    controller.machine.store(64, world.nativeTaskID(source.id));
    await world.objects.update(controller.id, 102);
    source = world.runtime.scheduler.tasks.get(source.id);
    assert.equal(source.name, 'reload.kcs');
    assert.equal(source.context.sceneData, handle);
    assert.deepEqual(await query(world, source), pair);
  } finally {
    await world.close({ flushFiles: false });
  }
});
