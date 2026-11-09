// SPDX-License-Identifier: MPL-2.0
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import { encodeCP932 } from '../src/kcs/strings.mjs';
import { MotionLibrary } from '../src/motion/library.mjs';
import { NativeConfiguration } from '../src/native/config.mjs';
import { NativeEngineProcess } from '../src/native/engine-process.mjs';
import { NativeGlobalStringsBridge } from '../src/native/global-strings-bridge.mjs';
import { NativeRandomMemory } from '../src/native/random-memory.mjs';
import { NativeWorld } from '../web/transitional-entry.mjs';
import { ParticleRandom } from '../src/ppi/random.mjs';
import { SaveSlotFiles } from './fixtures/save-slot-files.mjs';
import { kcsProgram, memoryGame } from './helpers.mjs';

for (const [profile, variable] of [
  ['sdk-4.01-engine-2.6.1.74', 'CATSYSTEM2_SDK_EXE'],
  ['nekopara-vol3-engine-2.6.1.76', 'CATSYSTEM2_ENGINE_EXE'],
])
  test(
    profile + ' original Script XML retains raw bytes and ownership across a fresh World',
    { skip: !process.env[variable] },
    async () => {
      const sdk = profile.startsWith('sdk-'),
        encode = sdk ? encodeCP932 : (text) => new TextEncoder().encode(text),
        encoding = sdk ? 'Shift_JIS' : 'UTF-8',
        declaration = `<?xml version="1.0" encoding="${encoding}"?>`,
        text = '日本語の値と&amp;長い文字列',
        file = 'config.int/sample.xml',
        bytes = new Uint8Array(await readFile(process.env[variable])),
        files = {
          'main.kcs': kcsProgram([[37, 2048], [43, 0x47, 4], [59]]),
          [file]: encode(
            declaration +
              `<document><group><word>${text}</word><number>-0x10</number></group><empty></empty></document>`,
          ),
          'malformed.xml': encode('<document><incomplete>'),
        },
        reads = [],
        make = async () => {
          const game = memoryGame(files),
            read = game.read;
          game.read = (name) => {
            reads.push(name);
            return read(name);
          };
          const random = new ParticleRandom(1234, 4321),
            configuration = new NativeConfiguration({ profile }),
            storage = new SaveSlotFiles(),
            world = new NativeWorld({
              game,
              images: {},
              host: {},
              profile,
              configuration,
              storage,
              random,
              motionLibrary: new MotionLibrary(game, { profile, random }),
            }),
            engine = await NativeEngineProcess.open({
              bytes,
              profile,
              configuration,
              ...storage.options(),
            });
          new NativeGlobalStringsBridge(engine, world.globalStrings);
          new NativeRandomMemory(engine, random);
          world.nativeEngine = engine;
          world.nativeEngineLoading = Promise.resolve(engine);
          return world;
        },
        call = (world, id, ...args) =>
          world.runtime.native(
            'main',
            id,
            args,
            world.main.machine,
            world.main,
            world.runtime.scheduler,
          ),
        first = await make();
      let fresh;
      try {
        await first.initialize('main.kcs');
        const engine = first.nativeEngine,
          m = first.main.machine;
        m.writeString('config.int/%s[G512].xml', 32);
        m.writeString('sample', 512);
        const opened = await call(first, 0x24e, 32),
          handle = opened.value;
        assert.equal(opened.control, 1);
        assert.ok(handle > 0);
        assert.ok(reads.includes(file));
        const feature = await first.getNativeFeature('script-xml'),
          pointer = feature.pointer(handle);
        assert.equal(engine.process.allocations.get(pointer), 8);
        assert.ok(engine.process.load(pointer + 4), 'document must own its original node vector');
        m.writeString('group/number', 128);
        assert.deepEqual(await call(first, 0x250, handle, 73, 128), {
          control: 1,
          value: -16 >>> 0,
        });
        m.writeString('group/word', 128);
        m.bytes(256, 128).fill(0x7e);
        assert.deepEqual(await call(first, 0x251, handle, 256, 128), { control: 2 });
        const expected = Uint8Array.from([...encode(text), 0, 0x7e]);
        assert.deepEqual(m.bytes(256, expected.length), expected);
        m.writeString('missing', 128);
        assert.deepEqual(await call(first, 0x250, handle, 73, 128), { control: 1, value: 73 });
        assert.deepEqual(await call(first, 0x251, handle, 256, 128), { control: 2 });
        assert.deepEqual(m.bytes(256, expected.length), expected);
        assert.deepEqual(await call(first, 0x250, 0, 73, 0x7fffffff), { control: 1, value: 73 });
        assert.deepEqual(await call(first, 0x251, 0, 0x7fffffff, 0x7fffffff), { control: 2 });
        assert.deepEqual(await call(first, 0x24f, 0), { control: 2 });
        assert.deepEqual(await call(first, 0x24e, 0x7fffffff), { control: 1, value: 0 });
        for (const name of ['malformed.xml', 'absent.xml']) {
          m.writeString(name, 32);
          assert.deepEqual(await call(first, 0x24e, 32), { control: 1, value: 0 });
        }
        assert.deepEqual([...feature.documents], [pointer]);

        const sourceReads = reads.filter((name) => name === file).length;
        fresh = await make();
        await fresh.restore(structuredClone(first.snapshot()));
        const restored = await fresh.getNativeFeature('script-xml');
        assert.equal(restored.pointer(handle), pointer);
        const vm = fresh.main.machine;
        vm.writeString('group/word', 128);
        vm.bytes(512, 128).fill(0x7e);
        await call(fresh, 0x251, handle, 512, 128);
        assert.deepEqual(vm.bytes(512, expected.length), expected);
        assert.equal(reads.filter((name) => name === file).length, sourceReads);
        assert.deepEqual(await call(fresh, 0x24f, handle), { control: 2 });
        assert.equal(fresh.nativeEngine.process.allocations.has(pointer), false);
        assert.equal(restored.documents.size, 0);
        await assert.rejects(() => call(fresh, 0x250, handle, 73, 128), /released/);
        assert.equal(feature.pointer(handle), pointer);
        await first.close({ flushFiles: false });
        assert.equal(feature.documents.size, 0);
      } finally {
        await fresh?.close({ flushFiles: false });
        await first.close({ flushFiles: false });
      }
    },
  );
