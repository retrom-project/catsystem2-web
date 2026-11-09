// SPDX-License-Identifier: MPL-2.0
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { NATIVE_EXE_PROFILES } from '../src/native/catalog.mjs';
import { NativeConfiguration } from '../src/native/config.mjs';
import { NativeEngineProcess } from '../src/native/engine-process.mjs';
import { NativeGlobalStringsBridge } from '../src/native/global-strings-bridge.mjs';
import { NativeWorld } from '../web/transitional-entry.mjs';
import { MotionLibrary } from '../src/motion/library.mjs';
import { ParticleRandom } from '../src/ppi/random.mjs';
import { kcsProgram, memoryGame } from './helpers.mjs';

for (const [profile, fixture] of [
  ['sdk-4.01-engine-2.6.1.74', 'CATSYSTEM2_SDK_EXE'],
  ['nekopara-vol3-engine-2.6.1.76', 'CATSYSTEM2_ENGINE_EXE'],
])
  test(
    `${profile} saves the original display log to a CSS entry and reloads it in a fresh World`,
    { skip: !process.env[fixture] },
    async () => {
      const bytes = new Uint8Array(await readFile(process.env[fixture])),
        game = memoryGame({ 'main.kcs': kcsProgram([[37, 1024], [43, 0x47, 4], [59]]) }),
        files = new Map(),
        storage = {
          read: async (name) => files.get(name) ?? null,
          write: async (name, bytes) => (files.set(name, bytes.slice()), true),
        };
      const make = async () => {
        const random = new ParticleRandom(),
          configuration = new NativeConfiguration({ profile });
        const world = new NativeWorld({
          game,
          images: {},
          host: {},
          profile,
          configuration,
          random,
          motionLibrary: new MotionLibrary(game, { profile, random }),
          storage,
        });
        const engine = await NativeEngineProcess.open({ bytes, profile, configuration });
        new NativeGlobalStringsBridge(engine, world.globalStrings);
        world.nativeEngine = engine;
        world.nativeEngineLoading = Promise.resolve(engine);
        return world;
      };
      const original = await make(),
        invoke = (world, id, args = []) =>
          world.runtime.native('main', id, args, world.main.machine, world.main),
        ok = { control: 1, value: 1 },
        miss = { control: 1, value: 0 },
        tag = 0x30;
      let fresh;
      try {
        await original.initialize('main.kcs');
        const m = original.main.machine,
          fileHandle = (await invoke(original, 0xee, [0x1234])).value,
          file = original.runtime.handles.get(fileHandle, 'global-file'),
          handle = (await invoke(original, 0x2b8)).value,
          logs = await original.getNativeFeature('display-logs');
        for (const [i, message] of [
          'Authored first line.',
          '長いテキストと日本語の台詞',
        ].entries()) {
          m.writeString('authored-scene', 64);
          m.writeString('名前', 128);
          m.writeString(message, 256);
          await invoke(original, 0x3d1, [handle, 64, i, 128, 256, i, 1, i + 5]);
        }
        const lines = await logs.lines(handle);
        assert.ok(lines.length >= 2);
        assert.deepEqual(await invoke(original, 0x352, [0, tag, handle]), miss);
        assert.deepEqual(await invoke(original, 0x352, [fileHandle, tag, 0]), miss);
        assert.deepEqual(await invoke(original, 0x352, [fileHandle, tag, handle]), ok);
        const engine = original.nativeEngine,
          p = engine.process,
          table = NATIVE_EXE_PROFILES[profile].tables.main.va,
          argv = p.allocate(12, true),
          out = p.allocate(4, true),
          guest = (id, args) => {
            args.forEach((n, i) => p.store(argv + i * 4, n));
            p.store(out, 0xcccccccc);
            return engine.call(p.load(table + id * 4), [0, 0, argv, out]);
          };
        let nativeFile = 0;
        try {
          assert.equal(await guest(0xee, [0x1234]), 1);
          nativeFile = p.load(out);
          assert.ok(nativeFile);
          assert.equal(await guest(0x352, [nativeFile, tag, logs.pointer(handle)]), 1);
          assert.equal(p.load(out), 1);
          const structure = p.load(nativeFile);
          assert.deepEqual(p.read(p.load(structure), p.load(structure + 8)), file.payload());
          const target = (await invoke(original, 0x2b8)).value;
          try {
            assert.equal(await guest(0x353, [nativeFile, tag + 1, logs.pointer(target)]), 1);
            assert.equal(p.load(out), 0);
            assert.equal(await guest(0x353, [nativeFile, tag, logs.pointer(target)]), 1);
            assert.equal(p.load(out), 1);
            assert.deepEqual(await logs.lines(target), lines);
          } finally {
            await invoke(original, 0x2b9, [target]);
          }
        } finally {
          if (nativeFile) await guest(0xf6, [nativeFile]);
          p.free(argv);
          p.free(out);
        }
        m.writeString('slot01.dat', 512);
        assert.deepEqual(await invoke(original, 0xf5, [fileHandle, 512]), ok);
        assert.deepEqual(files.get('slot01.dat'), await file.file());
        await invoke(original, 0x2b9, [handle]);
        fresh = await make();
        await fresh.restore(structuredClone(original.snapshot()));
        const reopened = (await invoke(fresh, 0xf7, [512])).value,
          mounted = fresh.runtime.handles.get(reopened, 'global-file'),
          target = (await invoke(fresh, 0x2b8)).value,
          loaded = await fresh.getNativeFeature('display-logs');
        assert.deepEqual(mounted.payload(), file.payload());
        assert.deepEqual(await invoke(fresh, 0x353, [reopened, tag + 1, target]), miss);
        assert.deepEqual(await invoke(fresh, 0x353, [reopened, tag, 0]), miss);
        assert.deepEqual(await invoke(fresh, 0x353, [reopened, tag, target]), ok);
        assert.deepEqual(await loaded.lines(target), lines);
        mounted.write(tag + 2, Uint8Array.of(24));
        await assert.rejects(invoke(fresh, 0x353, [reopened, tag + 2, target]), /display.log/i);
        assert.deepEqual(await loaded.lines(target), lines);
      } finally {
        await fresh?.close({ flushFiles: false });
        await original.close({ flushFiles: false });
      }
    },
  );
