// SPDX-License-Identifier: MPL-2.0
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { NativeEngineProcess } from '../src/native/engine-process.mjs';
import { NativeWorld } from '../web/transitional-entry.mjs';
import { NativeConfiguration } from '../src/native/config.mjs';
import { NativeSceneHistory } from '../src/native/scene-data.mjs';
import { NativeKCSMemory } from '../src/native/kcs-memory.mjs';
import { MotionLibrary } from '../src/motion/library.mjs';
import { ParticleRandom } from '../src/ppi/random.mjs';
import { kcsProgram, memoryGame, translation } from './helpers.mjs';

function scene() {
  const text = Uint8Array.from([1, 0x21, 65, 0, 1, 0x20, 66, 0]),
    body = new Uint8Array(40),
    v = new DataView(body.buffer);
  [24, 1, 8, 16, 2, 0, 0, 4].forEach((n, i) => v.setUint32(i * 4, n, true));
  body.set(text, 32);
  const bytes = new Uint8Array(56),
    view = new DataView(bytes.buffer);
  bytes.set(new TextEncoder().encode('CatScene'));
  view.setUint32(12, 40, true);
  bytes.set(body, 16);
  return bytes;
}
for (const [profile, variable] of [
  ['nekopara-vol3-engine-2.6.1.76', 'CATSYSTEM2_ENGINE_EXE'],
  ['sdk-4.01-engine-2.6.1.74', 'CATSYSTEM2_SDK_EXE'],
])
  test(
    `${profile} Script175 exposes distinct original reader/history objects backed by live scene data`,
    { skip: !process.env[variable] },
    async () => {
      const bytes = new Uint8Array(await readFile(process.env[variable])),
        files = memoryGame({ 'main.kcs': kcsProgram([[37, 1024], [43, 0x47, 4], [59]]) }),
        make = () => {
          const configuration = new NativeConfiguration({ profile }),
            random = new ParticleRandom();
          return new NativeWorld({
            game: files,
            images: {},
            host: {},
            profile,
            configuration,
            random,
            sceneLanguages: ['en'],
            motionLibrary: new MotionLibrary(files, { profile, random }),
            storage: { read: async () => null, write: async () => true },
          });
        },
        world = make();
      let fresh;
      try {
        await world.initialize('main.kcs');
        world.nativeEngine = await NativeEngineProcess.open({
          bytes,
          profile,
          configuration: world.configuration,
        });
        world.nativeEngineLoading = Promise.resolve(world.nativeEngine);
        const task = world.main,
          m = task.machine,
          p = world.nativeEngine.process;
        await world.runtime.native('main', 0xdb, [], m, task);
        const data = world.runtime.sceneData(task);
        assert.equal(await data.reader.load(scene()), true);
        if (!profile.startsWith('sdk-'))
          assert.equal(
            data.reader.loadTranslations(translation(['en'], [{ en: ['N', 'T'] }])),
            true,
          );
        data.reader.filename = 'authored.cst';
        data.reader.block = 0;
        data.reader.line = 1;
        data.history.markSeen('authored', 3);
        data.history.appendPath('authored', 4);
        await world.sendEngine(task.id, task.id, 175, 128, 132);
        const reader = m.load(128),
          history = m.load(132);
        assert.ok(reader);
        assert.ok(history);
        assert.notEqual(reader, history);
        assert.equal(p.load(reader + 4), 1);
        assert.equal(p.load(reader + 32), 0);
        assert.equal(p.load(reader + 36), 1);
        const pair = p.allocate(8, true),
          args = p.allocate(20, true),
          out = p.allocate(4, true),
          table = profile.startsWith('sdk-') ? 0xb3c900 : 0xa2dd38;
        p.store(pair, reader);
        p.store(pair + 4, history);
        [pair, 0, 0].forEach((n, i) => p.store(args + i * 4, n));
        assert.equal(
          await world.nativeEngine.call(p.load(table + 0x146 * 4), [0, 0, args, out]),
          1,
        );
        assert.equal(p.load(out), 0x21);
        if (!profile.startsWith('sdk-')) {
          m.writeString('en', 64);
          const bridge = new NativeKCSMemory(p, m);
          try {
            [pair, 256, 0, 1, 64].forEach((n, i) => p.store(args + i * 4, n));
            assert.equal(
              await world.nativeEngine.call(p.load(table + 0x409 * 4), [
                bridge.pointer,
                0,
                args,
                out,
              ]),
              1,
            );
          } finally {
            bridge.close();
          }
          assert.equal(m.string(256), 'T');
        }
        const replacement = new NativeSceneHistory();
        replacement.markSeen('native change', 7);
        replacement.appendPath('native change', 9);
        const a = replacement.encode('seen', true),
          b = replacement.encode('path', true),
          ap = p.allocate(a.length, true),
          bp = p.allocate(b.length, true);
        p.write(ap, a);
        p.write(bp, b);
        await world.nativeEngine.call(
          profile.startsWith('sdk-') ? 0x5dc610 : 0x72d680,
          [ap, a.length, bp, b.length],
          history,
        );
        assert.equal(data.history.seenValue('native change'), 7);
        assert.equal(data.history.pathAt(0).scene, 'native change');
        [pair, args, out, ap, bp].forEach((at) => p.free(at));
        const snapshot = structuredClone(world.snapshot());
        fresh = make();
        fresh.nativeEngine = await NativeEngineProcess.open({
          bytes,
          profile,
          configuration: fresh.configuration,
        });
        fresh.nativeEngineLoading = Promise.resolve(fresh.nativeEngine);
        await fresh.restore(snapshot);
        const ft = fresh.main;
        await fresh.sendEngine(ft.id, ft.id, 175, 128, 132);
        assert.deepEqual([ft.machine.load(128), ft.machine.load(132)], [reader, history]);
        assert.equal(fresh.runtime.sceneData(ft).history.pathAt(0).scene, 'native change');
        const handle = ft.context.sceneData;
        await fresh.objects.release(ft.id);
        assert.equal(fresh.nativeEngine.refs.scenes.has(handle), false);
        assert.equal(fresh.runtime.handles.records.has(handle), false);
      } finally {
        await world.close({ flushFiles: false });
        await fresh?.close({ flushFiles: false });
      }
    },
  );
