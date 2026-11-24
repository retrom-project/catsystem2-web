// SPDX-License-Identifier: MPL-2.0
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { dataWorld } from './fixtures/data-world.mjs';
import { kcsProgram } from './helpers.mjs';

const profile = 'bokutomo-engine-2.6.1.67',
  unchanged = 0xe6f13918,
  destinations = [100, 104, 108, 112, 116];

function bitmapCall(number, words) {
  return kcsProgram([
    [37, unchanged],
    ...Array.from({ length: words }, (_, i) => [37, [0x13, 56 + i * 4]]),
    [43, number, words * 4],
    [38, 88],
    [59],
  ]);
}

test('2.6.1.67 KCS bitmap attributes query low keys and merge owned entries without losing pixels', async (t) => {
  const world = await dataWorld(profile, {
    'bitmap-get-attribute.kcs': bitmapCall(536, 7),
    'bitmap-merge-attributes.kcs': bitmapCall(537, 2),
  });
  t.after(() => world.close({ flushFiles: false }));
  const images = world.graphics.images,
    targetHandle = images.create(2, 1, world.main.id),
    sourceHandle = images.create(1, 1, world.main.id),
    emptyHandle = images.create(1, 1, world.main.id),
    target = images.get(targetHandle),
    source = images.get(sourceHandle),
    attr = (id, values) => ({ id, rect: values.slice(0, 4), color: values[4] }),
    words = (values) => values.map((value) => value >>> 0);
  const earlier = [10, -20, 30, -40, 0xff801230],
    retained = [345, -456, 21, 0, 0x80002000],
    replaced = [20, 400, -32, 14, 0x40007000],
    added = [-1, -2, -3, -4, 0xffffffff];
  target.state.attributes = [attr(7, earlier), attr(11, retained)];
  source.state.attributes = [attr(7, replaced), attr(0xffff, added)];

  const savedPixels = Uint8ClampedArray.of(93, 42, 100, 128, 249, 100, 77, 255);
  async function call(name, args, outputs = []) {
    const task = await world.spawnScript(name, { parent: world.main.id, initialExecute: false }),
      m = task.machine,
      floor = m.sp;
    args.forEach((value, i) => m.store(56 + i * 4, value));
    outputs.forEach((address) => m.store(address, unchanged));
    m.store(120, unchanged);
    await world.runtime.scheduler.execute(task);
    assert.equal(m.halted, true);
    assert.equal(m.sp, floor + 4);
    assert.equal(m.pop(), unchanged);
    assert.equal(m.load(120), unchanged);
    return [m.load(88), outputs.map((address) => m.load(address))];
  }

  const get = (handle, key, outputs = destinations) =>
      call('bitmap-get-attribute.kcs', [handle, key, ...outputs], outputs),
    merge = async (lhs, rhs) => (await call('bitmap-merge-attributes.kcs', [lhs, rhs]))[0];
  for (const [handle, key] of [
    [0, 7],
    [emptyHandle, 7],
    [targetHandle, 0],
    [targetHandle, 0xffffffff],
  ])
    assert.deepEqual(await get(handle, key), [0, new Array(5).fill(unchanged)]);
  assert.deepEqual(await get(targetHandle, 7), [1, words(earlier)]);
  assert.deepEqual(await get(targetHandle, 0x20007), [1, words(earlier)]);
  assert.deepEqual(await get(targetHandle, 7, new Array(5).fill(100)), [
    1,
    new Array(5).fill(earlier[4]),
  ]);
  assert.deepEqual(await get(targetHandle, 11), [1, words(retained)]);

  assert.equal(await merge(0, sourceHandle), 0);
  assert.equal(await merge(targetHandle, 0), 0);
  assert.equal(await merge(targetHandle, emptyHandle), 1);
  assert.equal(await merge(emptyHandle, sourceHandle), 1);
  assert.deepEqual(await get(emptyHandle, 0xffffffff), [1, words(added)]);

  target.canvas = { getContext: () => ({ getImageData: () => ({ data: savedPixels }) }) };
  target.canvasRevision = target.state.revision;
  target.canvasDirty = true;
  assert.equal(await merge(targetHandle, sourceHandle), 1);
  assert.deepEqual(await target.pixels(), savedPixels);
  assert.equal(await merge(sourceHandle, sourceHandle), 1);
  assert.deepEqual(await get(sourceHandle, 0xffff), [1, words(added)]);

  source.state.attributes[0] = attr(7, added);
  assert.deepEqual(await get(sourceHandle, 7), [1, words(added)]);
  assert.deepEqual(await get(targetHandle, 0x10007), [1, words(replaced)]);
  assert.deepEqual(await get(targetHandle, 11), [1, words(retained)]);
  assert.deepEqual(await get(targetHandle, 0xffff), [1, words(added)]);
});
