// SPDX-License-Identifier: MPL-2.0
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { NativeWorld } from '../src/native/world.mjs';
import { NativeConfiguration } from '../src/native/config.mjs';
import { NativeEngineProcess } from '../src/native/engine-process.mjs';
import { NativeGlobalStringsBridge } from '../src/native/global-strings-bridge.mjs';
import { MotionLibrary } from '../src/motion/library.mjs';
import { ParticleRandom } from '../src/ppi/random.mjs';
import { kcsProgram, memoryGame } from './helpers.mjs';
const profile = 'nekopara-vol3-engine-2.6.1.76';
test(
  'record queue retains native FIFO/deque state, raw record lifetime and live VM domains through fresh World restore',
  { skip: !process.env.CATSYSTEM2_ENGINE_EXE },
  async () => {
    const bytes = new Uint8Array(await readFile(process.env.CATSYSTEM2_ENGINE_EXE)),
      make = async () => {
        const game = memoryGame({ 'main.kcs': kcsProgram([[37, 4096], [43, 0x47, 4], [59]]) }),
          configuration = new NativeConfiguration({ profile }),
          random = new ParticleRandom(),
          world = new NativeWorld({
            game,
            images: {},
            host: {},
            configuration,
            profile,
            random,
            motionLibrary: new MotionLibrary(game, { profile, random }),
            storage: { read: async () => null, write: async () => true },
          });
        configuration.fields.texture.size.set([2, 2]);
        configuration.fields.texture.grid.set([1, 1]);
        configuration.fields.texture.areas[0].set([0, 0, 1, 1]);
        configuration.fields.texture.bppY.set([0, 1]);
        const engine = await NativeEngineProcess.open({ bytes, profile, configuration });
        new NativeGlobalStringsBridge(engine, world.globalStrings);
        world.nativeEngine = engine;
        world.nativeEngineLoading = Promise.resolve(engine);
        world.ensureNativeEngine = async () => engine;
        return world;
      },
      first = await make();
    let fresh;
    const invoke = (world, id, args) =>
      world.runtime.native('main', id, args, world.main.machine, world.main);
    try {
      await first.initialize('main.kcs');
      const handle = (await invoke(first, 0x3f2, [3])).value,
        m = first.main.machine,
        block = m.allocate(64),
        addresses = [0, 0x80000000, block],
        p = first.nativeEngine.process,
        pointer = first.runtime.handles.get(handle, 'record-queue').pointer;
      assert.equal((await invoke(first, 0x400, [handle])).value, 1);
      assert.equal((await invoke(first, 0x3f5, [handle, 512])).value, 0);
      await invoke(first, 0x3f4, [handle, 0xffffffff]);
      assert.equal(p.load(pointer + 20), 0);
      for (let i = 0; i < 90; i++) {
        const at = addresses[i % 3];
        m.bytes(at, 3).set([i, i ^ 85, 255 - i]);
        await invoke(first, 0x3f4, [handle, at]);
      }
      assert.ok(p.load(pointer + 12) >= 32);
      const front = p.load(p.load(pointer + 8)),
        leaked = p.load(front);
      for (let i = 0; i < 9; i++) {
        m.bytes(512, 5).fill(0xa5);
        assert.equal((await invoke(first, 0x3f5, [handle, 512])).value, 1);
        assert.deepEqual([...m.bytes(512, 5)], [i, i ^ 85, 255 - i, 0xa5, 0xa5]);
      }
      assert.ok(
        p.allocations.has(leaked),
        'the original pop does not release its record allocation',
      );
      fresh = await make();
      await fresh.restore(structuredClone(first.snapshot()));
      const fm = fresh.main.machine;
      for (let i = 9; i < 90; i++) {
        const at = addresses[i % 3];
        fm.bytes(at, 5).fill(0xa5);
        assert.equal((await invoke(fresh, 0x3f5, [handle, at])).value, 1);
        assert.deepEqual([...fm.bytes(at, 5)], [i, i ^ 85, 255 - i, 0xa5, 0xa5]);
      }
      assert.equal(
        p.load(pointer + 20),
        81,
        'restored queue mutations do not change the original process',
      );
      assert.equal((await invoke(fresh, 0x3f5, [handle, 512])).value, 0);
      assert.equal(
        (await invoke(fresh, 0x400, [handle])).value,
        1,
        'the original query is always one, including empty queues',
      );
      assert.equal((await invoke(fresh, 0x400, [0])).value, 1);
      await invoke(fresh, 0x3f3, [handle]);
      await assert.rejects(() => invoke(fresh, 0x400, [handle]), /released/);
      const wrong = fresh.runtime.handles.add('another-type', {});
      await assert.rejects(() => invoke(fresh, 0x3f5, [wrong, 512]), /expected record-queue/);
      const zero = (await invoke(fresh, 0x3f2, [0])).value;
      await invoke(fresh, 0x3f4, [zero, 0]);
      assert.equal((await invoke(fresh, 0x3f5, [zero, 0])).value, 1);
      await invoke(fresh, 0x3f3, [zero]);
      await invoke(fresh, 0x3f3, [0]);
      await invoke(first, 0x3f3, [handle]);
      assert.ok(p.allocations.has(leaked));
    } finally {
      await first.close({ flushFiles: false });
      await fresh?.close({ flushFiles: false });
    }
  },
);
