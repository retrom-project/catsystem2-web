// SPDX-License-Identifier: MPL-2.0
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { dataWorld } from './fixtures/data-world.mjs';

const golden = JSON.parse(
  await readFile(new URL('./fixtures/native-modern-image-descriptor-golden.json', import.meta.url)),
);
const files = {
  'descriptor.kcs': Uint8Array.from(Buffer.from(golden.program, 'base64')),
  'images-loose\\encoded.hg3': Uint8Array.from(Buffer.from(golden.image, 'base64')),
  'cache.fes': new TextEncoder().encode('#START\nnext WAIT\n#WAIT\n'),
};
for (const own of golden.versions) {
  test(`${own.version} parsed ImageData cache retains exact descriptors and independent pixels after last owner/cold`, async (t) => {
    const world = await dataWorld(own.profile, files);
    t.after(() => world.close({ flushFiles: false }));
    const task = await world.spawnScript('descriptor.kcs', {
      parent: world.main.id,
      initialExecute: false,
    });
    world.runtime.variableBank(task).initialize(2048);
    const buffers = world.runtime.imageDataBuffers;
    const advance = async (w, script) => {
      script.machine.idle();
      const result = await w.runtime.scheduler.execute(script);
      assert.notEqual(result.status, 'halted');
    };
    let pointer, other, bitmapHandle, fesID;
    for (let phase = 0; phase < 4; phase++) {
      await advance(world, task);
      const m = task.machine;
      if (phase === 0) {
        pointer = buffers.pointer(m.load(96));
        other = buffers.pointer(m.load(100));
        assert.notEqual(pointer, other);
        fesID = world.resolveTaskID(m.load(80), task.id);
      }
      assert.deepEqual(buffers.words(pointer).slice(1), own.rows[phase].words);
      assert.equal(buffers.process.load(buffers.words(pointer)[0] - 4), own.rows[phase].payloadRef);
      assert.deepEqual(buffers.data(pointer), files['images-loose\\encoded.hg3']);
      if (phase === 1) assert.equal(buffers.words(other)[3], 1);
      if (phase === 2) {
        assert.equal(buffers.owns(other), false);
        bitmapHandle = m.load(104);
        assert.deepEqual(
          [...(await world.graphics.images.get(bitmapHandle).pixels())],
          own.rows[phase].bitmap.rgba,
        );
      }
    }
    const record = world.objects.objects.get(fesID);
    assert.equal(record.destroyRequested, true);
    assert.equal(record.implementation.imageCacheModel.entries.size, 2);
    assert.equal(task.machine.waiting.kind, 'message');
    const fresh = await dataWorld(own.profile, files, { initialize: false });
    t.after(() => fresh.close({ flushFiles: false }));
    await fresh.restore(structuredClone(world.snapshot()));
    assert.equal(fresh.runtime.imageDataBuffers.words(pointer)[3], 2);
    for (const w of [world, fresh]) {
      const b = w.runtime.imageDataBuffers,
        script = w.runtime.scheduler.tasks.get(task.id);
      await w.objects.release(fesID);
      assert.equal(b.owns(pointer), false);
      assert.throws(() => b.words(pointer), /Invalid or released/);
      assert.deepEqual(
        [...(await w.graphics.images.get(bitmapHandle).pixels())],
        own.rows[2].bitmap.rgba,
      );
      await w.runtime.native(
        'main',
        69,
        [w.nativeTaskID(script.id), 1536, 0, 0],
        script.machine,
        script,
      );
      await advance(w, script);
      assert.deepEqual(
        [script.machine.load(520), script.machine.load(524)],
        own.rows[4].output.slice(2),
      );
      assert.deepEqual(
        [...(await w.graphics.images.get(bitmapHandle).pixels())],
        own.rows[4].bitmap.rgba,
      );
      script.machine.idle();
      assert.equal((await w.runtime.scheduler.execute(script)).status, 'halted');
      assert.throws(() => w.graphics.images.get(bitmapHandle), /released|Invalid|Unknown/);
    }
  });
}
