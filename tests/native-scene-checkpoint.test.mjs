// SPDX-License-Identifier: MPL-2.0
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { NativeEngineProcess } from '../src/native/engine-process.mjs';
import { NativeGlobalStringsBridge } from '../src/native/global-strings-bridge.mjs';
import { NativeScriptReplacementsBridge } from '../src/native/script-replacements-bridge.mjs';
import { NativeWorld } from '../web/transitional-entry.mjs';
import { NativeConfiguration } from '../src/native/config.mjs';
import { MotionLibrary } from '../src/motion/library.mjs';
import { ParticleRandom } from '../src/ppi/random.mjs';
import { kcsProgram, memoryGame } from './helpers.mjs';

for (const [profile, variable] of [
  ['nekopara-vol3-engine-2.6.1.76', 'CATSYSTEM2_ENGINE_EXE'],
  ['sdk-4.01-engine-2.6.1.74', 'CATSYSTEM2_SDK_EXE'],
])
  test(
    `${profile} native local checkpoints restore banks, branch scene paths and preserve their fresh World ownership`,
    { skip: !process.env[variable] },
    async () => {
      const exe = new Uint8Array(await readFile(process.env[variable])),
        xml = `<?xml version="1.0" encoding="${profile.startsWith('sdk-') ? 'Shift_JIS' : 'UTF-8'}"?><document><localstr>4,9</localstr></document>`,
        game = memoryGame({
          'main.kcs': kcsProgram([[37, 1024], [43, 0x47, 4], [59]]),
          'localstr.xml': new TextEncoder().encode(xml),
        }),
        make = async () => {
          const configuration = new NativeConfiguration({ profile }),
            random = new ParticleRandom();
          configuration.variableRanges.local.fill(0);
          configuration.variableRanges.local.set([2, 2]);
          const world = new NativeWorld({
            game,
            images: {},
            host: {},
            profile,
            configuration,
            random,
            motionLibrary: new MotionLibrary(game, { profile, random }),
            storage: { read: async () => null, write: async () => true },
          });
          // This authored bank client loads the reviewed process directly; it
          // has no game executable/plugin bootstrap in its mounted content.
          const engine = await NativeEngineProcess.open({ bytes: exe, profile, configuration });
          new NativeGlobalStringsBridge(engine, world.globalStrings);
          new NativeScriptReplacementsBridge(engine, configuration);
          world.nativeEngine = engine;
          world.nativeEngineLoading = Promise.resolve(engine);
          return world;
        },
        world = await make();
      let fresh;
      try {
        await world.initialize('main.kcs');
        const task = world.main,
          m = task.machine,
          call = (id, args = []) =>
            world.runtime.native('main', id, args, m, task, world.runtime.scheduler);
        await call(0xd1, [64]);
        const scene = (await call(0x143)).value,
          data = world.runtime.handles.get(scene, 'scene-data'),
          variables = world.runtime.variableBank(task, false),
          strings = world.runtime.stringBank(task);
        m.writeString('localstr.xml', 64);
        data.history.appendPath('first', 11);
        data.history.markSeen('watched', 9);
        variables.set(2, 123);
        variables.set(3, 456);
        variables.set(5, 789);
        strings.setBytes(4, new TextEncoder().encode('UTF-8 猫'));
        strings.setBytes(9, Uint8Array.of(0x81, 0xff));
        strings.set(99, 'outside');
        assert.deepEqual(await call(0x3df, [scene, 10, 64]), { control: 2 });
        variables.set(2, 888);
        strings.set(4, 'later');
        assert.deepEqual(await call(0x3df, [scene, 30, 64]), { control: 2 });
        data.history.appendPath('second', 22);
        variables.set(2, 999);
        strings.set(4, 'second');
        await call(0x3df, [scene, 20, 64]);
        const snapshot = structuredClone(world.snapshot());
        fresh = await make();
        await fresh.restore(snapshot);
        const ft = fresh.main,
          fm = ft.machine,
          invoke = (id, args) =>
            fresh.runtime.native('main', id, args, fm, ft, fresh.runtime.scheduler),
          fb = fresh.runtime.variableBank(ft, false),
          fs = fresh.runtime.stringBank(ft, false);
        fb.set(2, 0);
        fb.set(3, 0);
        fb.set(5, 9999);
        fs.set(4, 'mutated');
        fs.set(99, 'retained');
        fm.store(1024, 1);
        fm.store(1028, 9);
        assert.deepEqual(await invoke(0x3e0, [scene, 1024, 1028, 64]), { control: 1, value: 1 });
        assert.deepEqual(
          [fm.load(1024), fm.load(1028)],
          [0, 30],
          'earlier scene chooses its newest checkpoint regardless of the requested current-scene position',
        );
        assert.deepEqual([fb.get(2), fb.get(3), fb.get(5)], [888, 456, 9999]);
        assert.equal(fs.get(4), 'later');
        assert.equal(fs.get(99), 'retained');
        fm.store(1024, 0);
        fm.store(1028, 15);
        assert.deepEqual(await invoke(0x3e0, [scene, 1024, 1028, 64]), { control: 1, value: 1 });
        assert.deepEqual([fm.load(1024), fm.load(1028)], [0, 10]);
        assert.equal(fb.get(2), 123);
        assert.deepEqual(fs.getBytes(4), new TextEncoder().encode('UTF-8 猫'));
        assert.deepEqual(fs.getBytes(9), Uint8Array.of(0x81, 0xff));
        fm.store(1024, 0);
        fm.store(1028, 0xffffffff);
        const previous = fb.words.slice();
        assert.deepEqual(await invoke(0x3e0, [scene, 1024, 1028, 64]), { control: 1, value: 0 });
        assert.deepEqual(
          [fm.load(1024), fm.load(1028)],
          [0, 0xffffffff],
          'negative signed positions miss without changing output',
        );
        assert.deepEqual(fb.words, previous);
        assert.equal(variables.get(2), 999, 'restored banks have independent ownership');
        assert.deepEqual(await invoke(0x3df, [0, 0, 0xffffffff]), { control: 2 });
        assert.deepEqual(await invoke(0x3e0, [0, 0xffffffff, 0xffffffff, 0xffffffff]), {
          control: 1,
          value: 0,
        });
        const restoredHistory = fresh.runtime.handles.get(scene, 'scene-data').history,
          originalFirst = restoredHistory.path[0].extra.slice(),
          seen = restoredHistory.encode('seen', true),
          bankWords = fb.words.slice(),
          bankStrings = structuredClone(fs.snapshot());
        assert.deepEqual(await invoke(0x3e2, [scene, 0, 15]), { control: 2 });
        assert.equal(restoredHistory.path.length, 1);
        assert.equal(restoredHistory.path[0].value, 15);
        assert.deepEqual(
          restoredHistory.path[0].extra,
          originalFirst,
          'the original earlier-entry branch writes the old tail before deleting it',
        );
        assert.deepEqual(await invoke(0x3e2, [scene, 0, 30]), { control: 2 });
        assert.equal(
          new DataView(restoredHistory.path[0].extra.buffer).getUint32(16, true),
          10,
          'branching the final entry removes checkpoints at or above the signed position',
        );
        const older = restoredHistory.path[0].extra.slice();
        assert.deepEqual(await invoke(0x3e2, [scene, 0, 0]), { control: 2 });
        assert.deepEqual(
          restoredHistory.path[0].extra,
          older,
          'finding no older checkpoint preserves its original extra bytes',
        );
        assert.deepEqual(fb.words, bankWords);
        assert.deepEqual(fs.snapshot(), bankStrings);
        assert.deepEqual(restoredHistory.encode('seen', true), seen);
        assert.equal(
          data.history.path.length,
          2,
          'branching a restored history does not change its source',
        );
        assert.deepEqual(await invoke(0x3e1, [scene, scene]), { control: 2 });
        assert.equal(restoredHistory.path.length, 0, 'the native self-copy clears the path first');
        assert.deepEqual(restoredHistory.encode('seen', true), seen);
        assert.deepEqual(await invoke(0x3e2, [0, 0xffffffff, 0xffffffff]), { control: 2 });
      } finally {
        await fresh?.close({ flushFiles: false });
        await world.close({ flushFiles: false });
      }
    },
  );
