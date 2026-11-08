// SPDX-License-Identifier: MPL-2.0
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { sectionFixture, sectionFiles } from './fixtures/section-table-fixture.mjs';
import { NativeWorld } from '../src/native/world.mjs';
import { NativeEngineProcess } from '../src/native/engine-process.mjs';
import { NativeGlobalStringsBridge } from '../src/native/global-strings-bridge.mjs';
import { NativeRandomMemory } from '../src/native/random-memory.mjs';
import { NativeConfiguration } from '../src/native/config.mjs';
import { installNativeSectionTables } from '../src/native/section-table.mjs';
import { ParticleRandom } from '../src/ppi/random.mjs';
import { MotionLibrary } from '../src/motion/library.mjs';
import { memoryGame, kcsProgram } from './helpers.mjs';
import { encodeCP932 } from '../src/kcs/strings.mjs';
for (const [profile, variable] of [
  ['sdk-4.01-engine-2.6.1.74', 'CATSYSTEM2_SDK_EXE'],
  ['nekopara-vol3-engine-2.6.1.76', 'CATSYSTEM2_ENGINE_EXE'],
]) {
  test(
    profile +
      ' section tables preserve source order, exact keys, output aliases and valid empty files',
    { skip: !process.env[variable] },
    async () => {
      const f = await sectionFixture(
          new Uint8Array(await readFile(process.env[variable])),
          profile,
        ),
        { tables, machine: m, engine } = f,
        call = (id, args) => tables.apply(id, args, m, { id: 1 }),
        put = (s, at) => m.writeString(s, at);
      try {
        put('basic.txt', 256);
        const h = (await call(0x2ab, [256])).value;
        assert.ok(h);
        for (const [section, key, index, expected] of [
          ['#first', 'key', 0, 'first value'],
          ['#first', 'key', 1, 'second value'],
          ['#first', 'key', 2, 'third value'],
          ['#First', 'key', 0, 'case distinct'],
          ['#second', 'key', 0, '日本語'],
          ['#first', 'empty', 0, ''],
          ['#first', 'spaces', 0, 'keep two leading'],
          ['#first', 'comment', 0, 'before after'],
        ]) {
          put(section, 512);
          put(key, 768);
          m.bytes(1024, 600).fill(0xa5);
          assert.equal((await call(0x2ad, [h, 512, 768, index, 1024])).value, 1);
          assert.equal(m.string(1024), expected);
          assert.equal(m.bytes(1024, 600)[encodeCP932(expected).length + 1], 0xa5);
        }
        for (const [section, key, index] of [
          ['first', 'key', 0],
          ['#first', 'Key', 0],
          ['#first', 'key', 3],
          ['#first', 'key', 0xffffffff],
        ]) {
          put(section, 512);
          put(key, 768);
          m.bytes(1024, 64).fill(0xa5);
          assert.equal((await call(0x2ad, [h, 512, 768, index, 1024])).value, 0);
          assert.deepEqual(m.bytes(1024, 64), new Uint8Array(64).fill(0xa5));
        }
        put('#first', 512);
        put('key', 768);
        assert.equal((await call(0x2ad, [h, 512, 768, 1, 512])).value, 1);
        assert.equal(m.string(512), 'second value');
        const pointer = tables.pointer(h);
        await call(0x2ac, [h]);
        assert.equal(engine.process.allocations.has(pointer), false);
        put('syntax.txt', 256);
        const syntax = (await call(0x2ab, [256])).value;
        for (const [key, expected] of [
          ['tab', 'value'],
          ['colon:value', ''],
          ['semi', ';value'],
        ]) {
          put('#one', 512);
          put(key, 768);
          assert.equal((await call(0x2ad, [syntax, 512, 768, 0, 1024])).value, 1);
          assert.equal(m.string(1024), expected);
        }
        await call(0x2ac, [syntax]);
        put('empty.txt', 256);
        const empty = (await call(0x2ab, [256])).value;
        assert.ok(empty);
        await call(0x2ac, [empty]);
        put('missing.txt', 256);
        assert.equal((await call(0x2ab, [256])).value, 0);
        assert.deepEqual(await call(0x2ad, [0]), { control: 1, value: 0 });
        assert.deepEqual(await call(0x2ac, [0]), { control: 2 });
      } finally {
        await engine.close();
      }
    },
  );
  test(
    profile +
      ' a fresh World keeps section-table identity and its imported bytes independently of the source file',
    { skip: !process.env[variable] },
    async () => {
      const bytes = new Uint8Array(await readFile(process.env[variable])),
        files = sectionFiles();
      async function make() {
        const game = memoryGame({
            'main.kcs': kcsProgram([[37, 2048], [43, 0x47, 4], [59]]),
            ...Object.fromEntries(files),
          }),
          configuration = new NativeConfiguration({ profile }),
          random = new ParticleRandom(),
          world = new NativeWorld({
            game,
            profile,
            configuration,
            random,
            images: {},
            host: {},
            storage: { read: async (name) => files.get(name) ?? null, write: async () => true },
            motionLibrary: new MotionLibrary(game, { profile, random }),
          });
        if (!world.nativeFeatureFactories.has('section-tables')) installNativeSectionTables(world);
        const engine = await NativeEngineProcess.open({
          bytes,
          profile,
          configuration,
          readFile: async (name) => files.get(name) ?? null,
        });
        new NativeGlobalStringsBridge(engine, world.globalStrings);
        new NativeRandomMemory(engine, random);
        world.nativeEngine = engine;
        world.nativeEngineLoading = Promise.resolve(engine);
        return world;
      }
      const first = await make(),
        call = (world, id, args) =>
          world.runtime.native(
            'main',
            id,
            args,
            world.main.machine,
            world.main,
            world.runtime.scheduler,
          );
      let fresh;
      try {
        await first.initialize('main.kcs');
        first.main.machine.writeString('basic.txt', 256);
        const h = (await call(first, 0x2ab, [256])).value,
          feature = await first.getNativeFeature('section-tables'),
          pointer = feature.pointer(h),
          snapshot = structuredClone(first.snapshot());
        files.set('basic.txt', encodeCP932('#first\nkey changed\n'));
        fresh = await make();
        await fresh.restore(snapshot);
        const restored = await fresh.getNativeFeature('section-tables');
        assert.equal(restored.pointer(h), pointer);
        fresh.main.machine.writeString('#first', 512);
        fresh.main.machine.writeString('key', 768);
        assert.equal((await call(fresh, 0x2ad, [h, 512, 768, 2, 1024])).value, 1);
        assert.equal(fresh.main.machine.string(1024), 'third value');
        await call(fresh, 0x2ac, [h]);
        assert.equal(fresh.nativeEngine.process.allocations.has(pointer), false);
        assert.equal(first.nativeEngine.process.allocations.has(pointer), true);
      } finally {
        await fresh?.close({ flushFiles: false });
        await first.close({ flushFiles: false });
      }
    },
  );
}
