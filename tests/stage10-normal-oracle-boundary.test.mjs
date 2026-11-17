// SPDX-License-Identifier: MPL-2.0
import test from 'node:test';
import assert from 'node:assert/strict';
import { NativeWorld } from '../src/native/world.mjs';
import { dataWorld } from './fixtures/data-world.mjs';

test('ordinary World restores its real legacy text owner without process factories or raw heap state', async () => {
  const world = await dataWorld('sdk-4.01-engine-2.6.1.74');
  let fresh;
  try {
    for (const name of ['getNativeFeature', 'ensureNativeEngine', 'registerNativeFeature'])
      assert.equal(Object.hasOwn(NativeWorld.prototype, name), false);
    assert.equal(world.nativeFeatureFactories, undefined);
    const id = await world.objects.create({ kind: 8, parent: world.root });
    const record = world.objects.objects.get(id),
      task = record.implementation;
    assert.strictEqual(world.legacyText.tasks.get(record.id), task);
    await world.sendEngine(record.id, world.main.id, 105, 0, 0xfedcba98);
    assert.equal(task.text.w(197) >>> 0, 0xfedcba98);
    const saved = structuredClone(world.snapshot());
    assert.equal(Object.hasOwn(saved, 'nativeEngine'), false);
    fresh = await dataWorld(world.profile, {}, { initialize: false });
    await fresh.restore(saved);
    const restored = fresh.objects.objects.get(record.id).implementation;
    assert.strictEqual(fresh.legacyText.tasks.get(record.id), restored);
    assert.equal(restored.text.w(197) >>> 0, 0xfedcba98);
    assert.deepEqual(fresh.snapshot(), saved);
    assert.throws(
      () => restored.memory(fresh.main.id, { nativePointer: true }),
      /explicit oracle owner/,
    );
    assert.equal(world.nativeEngine, undefined);
    assert.equal(fresh.nativeEngine, undefined);
  } finally {
    if (fresh) await fresh.close();
    await world.close();
  }
});

test('ordinary bitmap destination zero writes the real shared VRAM and restores its pixels without a process', async () => {
  const world = await dataWorld('sdk-4.01-engine-2.6.1.74');
  let fresh;
  try {
    world.game.width = world.game.height = 4;
    const images = world.graphics.images,
      handle = images.create(2, 2),
      bitmap = images.get(handle);
    Object.assign(bitmap.state, {
      offsetX: 1,
      offsetY: 1,
      canvasWidth: 4,
      canvasHeight: 4,
      rgba: Uint8ClampedArray.of(255, 0, 0, 255, 0, 255, 0, 255, 0, 0, 255, 255, 255, 255, 0, 255),
    });
    let uploads = 0;
    const output = world.graphics.output;
    world.graphics.output = function (...args) {
      uploads++;
      return output.apply(this, args);
    };
    const call = (dx) =>
      world.runtime.native(
        'main',
        0x16f,
        [0, dx, 0, 2, 2, handle, 1, 1, 2, 2],
        world.main.machine,
        world.main,
      );
    assert.equal((await call(0)).control, 2);
    assert.equal(uploads, 1);
    const target = images.get(world.graphics.vramHandle),
      expected = new Uint8ClampedArray(4 * 4 * 4);
    expected.set([255, 0, 0, 255, 0, 255, 0, 255], (1 * 4 + 1) * 4);
    expected.set([0, 0, 255, 255, 255, 255, 0, 255], (2 * 4 + 1) * 4);
    assert.deepEqual(await target.pixels(), expected);
    const saved = structuredClone(world.snapshot());
    fresh = await dataWorld(world.profile, {}, { initialize: false });
    fresh.game.width = fresh.game.height = 4;
    await fresh.restore(saved);
    assert.deepEqual(await fresh.graphics.images.get(fresh.graphics.vramHandle).pixels(), expected);
    assert.deepEqual(fresh.snapshot(), saved);
    await call(-2);
    assert.equal(uploads, 2);
    expected.set([0, 255, 0, 255], 1 * 4 * 4);
    expected.set([255, 255, 0, 255], 2 * 4 * 4);
    assert.deepEqual(await target.pixels(), expected);
    assert.equal(world.nativeEngine, undefined);
    assert.equal(fresh.nativeEngine, undefined);
  } finally {
    if (fresh) await fresh.close();
    await world.close();
  }
});
