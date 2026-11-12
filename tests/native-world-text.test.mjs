// SPDX-License-Identifier: MPL-2.0
import test from 'node:test';
import assert from 'node:assert/strict';
import { dataWorld } from './fixtures/data-world.mjs';
import { nativeABI } from '../src/native/abi/index.mjs';
import { textPacket } from '../src/native/text-config.mjs';
import { encodeCP932 } from '../src/kcs/strings.mjs';
import { NativeBufferMemory } from '../src/native/buffer-memory.mjs';
import { NativeTextConsumerView } from '../oracle/text-consumer-view.mjs';

const profiles = ['sdk-4.01-engine-2.6.1.74', 'nekopara-vol3-engine-2.6.1.76'];
const glyphs = {
  measure: (_font, value) => ({
    width: value.length * 4,
    height: 8,
    ascent: 6,
    descent: 2,
    averageWidth: 4,
    maximumWidth: 8,
  }),
  glyph: () => ({
    width: 4,
    height: 6,
    originX: 0,
    originY: 6,
    advanceX: 4,
    advanceY: 0,
    alpha: new Uint8Array(24).fill(255),
  }),
};
function memory(bytes) {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  return {
    load: (at) => view.getUint32(at, true),
    store: (at, value) => view.setUint32(at, value >>> 0, true),
    bytes: (at, count) => bytes.subarray(at, at + count),
    write: (at, value) => bytes.set(value, at),
  };
}
for (const profile of profiles) {
  test(`${profile} default World text owns one writer state and restores real task pixels without an EXE`, async () => {
    const world = await dataWorld(profile, {}, { glyphs });
    world.game.width = world.game.height = 32;
    let fresh;
    try {
      const [core, same] = await Promise.all([world.text.runtime(), world.text.runtime()]);
      assert.strictEqual(core, world.text.core);
      assert.strictEqual(core, same);
      const taskID = await world.objects.create({ kind: 48, parent: world.main.id }),
        task = world.objects.objects.get(taskID).implementation,
        packet = textPacket(profile, 'cp932', world.configuration),
        view = new DataView(packet.buffer),
        size = nativeABI(profile).layouts.textCores.cp932.configSize;
      view.setUint32(8, 32, true);
      view.setUint32(12, 32, true);
      view.setUint32(size + 12, 1, true);
      await world.sendEngine(taskID, world.main.id, 450, 0, 0, { payload: memory(packet) });
      const source = Uint8Array.from([...encodeCP932('AB'), 0]);
      await world.sendEngine(taskID, world.main.id, 452, 0, 0, { payload: memory(source) });
      await world.sendEngine(taskID, world.main.id, 455);
      const writer = await task.writer(),
        bitmap = world.graphics.vramHandle,
        pixels = (await world.graphics.images.get(bitmap).pixels()).slice(),
        saved = structuredClone(world.snapshot());
      assert.equal(core.writers.size, 1);
      assert.strictEqual(core.get(task.text.writer), writer);
      assert.ok(pixels.some((value) => value !== 0));
      assert.equal(world.nativeEngine, undefined);
      assert.equal(saved.nativeEngine, null);
      assert.equal(saved.text.writers.length, 1);
      assert.equal(Object.hasOwn(saved.text, 'windows'), false);
      fresh = await dataWorld(profile, {}, { initialize: false, glyphs });
      fresh.game.width = fresh.game.height = 32;
      const read = fresh.game.read.bind(fresh.game);
      fresh.game.read = (name) => {
        if (['case.kcs', 'emotedriver.dll', 'm2view.cnf'].includes(name)) return read(name);
        throw new Error('text restore attempted resource I/O');
      };
      await fresh.restore(saved);
      const restored = fresh.objects.objects.get(taskID).implementation,
        restoredCore = await fresh.text.runtime();
      assert.equal(restored.text.writer, task.text.writer);
      assert.strictEqual(await restored.writer(), restoredCore.get(task.text.writer));
      assert.deepEqual(
        restoredCore.snapshot({ windows: false }),
        core.snapshot({ windows: false }),
      );
      assert.deepEqual(await fresh.graphics.images.get(bitmap).pixels(), pixels);
      assert.equal(fresh.nativeEngine, undefined);
      await fresh.sendEngine(taskID, fresh.main.id, 455);
      assert.deepEqual(await fresh.graphics.images.get(bitmap).pixels(), pixels);
      let closes = 0;
      const close = restoredCore.close.bind(restoredCore);
      restoredCore.close = async () => {
        closes++;
        await close();
      };
      await fresh.close();
      assert.equal(closes, 1);
      assert.equal(restoredCore.writers.size, 0);
    } finally {
      await fresh?.close();
      await world.close();
    }
  });
  test(`${profile} explicit Windows consumer borrows the World writer map and snapshots only its own handles`, async () => {
    const world = await dataWorld(profile, {}, { glyphs });
    try {
      const core = await world.text.runtime(),
        definitions = new Map(),
        features = new Map(),
        engine = {
          profile,
          process: new NativeBufferMemory(),
          kernel: {
            resolve() {
              throw new Error('unexpected imported call');
            },
          },
          registerWindows: (dll, name, value) => definitions.set(dll + ':' + name, value),
          registerFeature: (name, value) => features.set(name, value),
        },
        view = new NativeTextConsumerView(engine, core),
        writer = await view.create('cp932');
      assert.strictEqual(features.get('text'), view);
      assert.strictEqual(view.writers, core.writers);
      assert.strictEqual(view.get(writer.pointer), core.get(writer.pointer));
      assert.ok(definitions.size);
      const handle = view.windows.createObject('font', { height: 8 }),
        state = view.snapshot(),
        current = core.snapshot({ windows: false });
      assert.deepEqual(Object.keys(state), ['windows']);
      view.windows.objects.delete(handle);
      view.restore(state);
      assert.equal(view.windows.objects.get(handle).kind, 'font');
      assert.deepEqual(core.snapshot({ windows: false }), current);
      view.close();
      assert.strictEqual(core.get(writer.pointer), writer);
      assert.equal(core.process, undefined);
      assert.equal(world.nativeEngine, undefined);
    } finally {
      await world.close();
    }
  });
}
