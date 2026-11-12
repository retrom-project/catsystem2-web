// SPDX-License-Identifier: MPL-2.0
// A CPU camera regression. Authored viewport input does not claim GPU drawing.
import test from 'node:test';
import assert from 'node:assert/strict';
import { dataWorld } from './fixtures/data-world.mjs';
import { NativeGraphicsPacket } from '../src/native/graphics-task.mjs';
import { floatBits } from '../src/effekseer/math43.mjs';
const words = (array) => new Uint32Array(array.buffer, array.byteOffset, array.length);
// Reused prior whole-method outputs on authored inputs; no new native calls.
const landscape = Uint32Array.from([
  1061168935, 0, 0, 0, 0, 1065359898, 0, 0, 0, 0, 3213008060, 3212836864, 0, 0, 3213008060, 0,
]);
const portrait = Uint32Array.from([
  1068158328, 0, 0, 0, 0, 1065359898, 0, 0, 0, 0, 3213008060, 3212836864, 0, 0, 3213008060, 0,
]);

test('defaultkind61 ctor/57 use virtual aspect independentlyof client/drawing/viewport', async () => {
  const world = await dataWorld('nekopara-vol3-engine-2.6.1.76');
  const viewportInput = { viewport: [0, 0, 320, 200, 0, 1], target: { width: 320, height: 200 } };
  try {
    world.graphics.createLogicalDevice();
    world.graphics.view.configure({
      virtualWidth: 800,
      virtualHeight: 600,
      clientWidth: 1600,
      clientHeight: 900,
      drawingRectangle: [0, 0, 500, 500],
    });
    // The existing StageRenderer endpoint has an independent authored viewport.
    // No fake draw/readback operation is supplied or invoked in this CPU case.
    world.stageRenderer.gpu = viewportInput;
    const id = await world.objects.create({
      kind: 61,
      parent: world.main.id,
      name: 'aspect independent',
    });
    const task = world.objects.objects.get(id).implementation;
    const beforeCRT = world.effekseer.threads.snapshot();
    const identity = new NativeGraphicsPacket(
      [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1].map(floatBits),
    );
    const matrix = () =>
      world.withExecutor(world.effekseer.frameExecutor, (executorEntry) =>
        world.sendEngine(id, world.main.id, 57, 0, 0, { executorEntry, payload: identity }),
      );
    assert.deepEqual(words(task.projection), landscape, 'constructor reads virtual800/600');
    await matrix();
    assert.deepEqual(words(task.projection), landscape, '57 reads the same source');
    for (const mutate of [
      () => world.graphics.view.configure({ clientWidth: 1920, clientHeight: 1000 }),
      () => world.graphics.view.configure({ drawingRectangle: [0, 0, 200, 900] }),
      () => {
        viewportInput.viewport = [0, 0, 900, 100, 0, 1];
        viewportInput.target = { width: 900, height: 100 };
      },
    ]) {
      mutate();
      await matrix();
      assert.deepEqual(
        words(task.projection),
        landscape,
        'nonconsumer size cannot choose the camera aspect',
      );
    }
    world.graphics.view.configure({ virtualWidth: 600, virtualHeight: 800 });
    await matrix();
    assert.deepEqual(words(task.projection), portrait, 'actual virtual consumer change matters');
    assert.notDeepEqual(words(task.projection), landscape);
    const id2 = await world.objects.create({
      kind: 61,
      parent: world.main.id,
      name: 'portrait constructor',
    });
    assert.deepEqual(words(world.objects.objects.get(id2).implementation.projection), portrait);
    assert.deepEqual(world.effekseer.threads.snapshot(), beforeCRT);
    assert.equal(task.manager.sets.size, 0);
    assert.equal(world.nativeEngine, undefined);
  } finally {
    delete world.stageRenderer.gpu;
    await world.close({ flushFiles: false });
  }
});
