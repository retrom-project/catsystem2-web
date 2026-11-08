// SPDX-License-Identifier: MPL-2.0
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { NativeWorld } from '../src/native/world.mjs';
import { NativeEngineProcess } from '../src/native/engine-process.mjs';
import { NativeConfiguration } from '../src/native/config.mjs';
import { NativeGlobalStringsBridge } from '../src/native/global-strings-bridge.mjs';
import { NativeRandomMemory } from '../src/native/random-memory.mjs';
import { ParticleRandom } from '../src/ppi/random.mjs';
import { MotionLibrary } from '../src/motion/library.mjs';
import { contentFiles, contentFixture } from './fixtures/content-databases-fixture.mjs';
import { SaveSlotFiles } from './fixtures/save-slots-fixture.mjs';
import { memoryGame, kcsProgram } from './helpers.mjs';

for (const [profile, variable] of [
  ['sdk-4.01-engine-2.6.1.74', 'CATSYSTEM2_SDK_EXE'],
  ['nekopara-vol3-engine-2.6.1.76', 'CATSYSTEM2_ENGINE_EXE'],
]) {
  test(
    profile + ' compiled content objects parse real schemas and preserve distinct owners',
    { skip: !process.env[variable] },
    async () => {
      const f = await contentFixture(
          new Uint8Array(await readFile(process.env[variable])),
          profile,
        ),
        { content, machine: m, engine } = f,
        call = async (id, args = []) => content.apply(id, args, m, { id: 1 }),
        put = (s, at = 256) => m.writeString(s, at);
      try {
        const question = (await call(0x2e6)).value;
        put('questions');
        assert.equal((await call(0x2e8, [question, 256])).value, 1);
        assert.equal((await call(0x2e9, [question])).value, 3);
        put('configurations');
        assert.equal((await call(0x2ee, [question, 256])).value, 1);
        put('alpha');
        assert.equal((await call(0x2ef, [question, 256])).value, 1);
        await call(0x2fc, [question]);
        await call(0x2fd, [question]);
        assert.equal((await call(0x2ea, [question, 0, 512])).value, 1);
        assert.ok(m.string(512).length);
        assert.equal((await call(0x2ec, [question, 0, 0, 768])).value, 1);
        assert.ok(m.string(768).length);
        const selection = (await call(0x30b)).value;
        for (const [number, name] of [
          [7, 'alpha'],
          [8, 'beta'],
          [9, 'gamma'],
        ]) {
          put(name);
          await call(0x30d, [selection, number, 256]);
        }
        put('selections');
        assert.equal((await call(0x30e, [selection, 256])).value, 1);
        await call(0x33d, [selection, 1]);
        assert.equal((await call(0x30f, [selection])).value, 2);
        assert.equal((await call(0x310, [selection, 0])).value, 7);
        put('questions');
        const table = (await call(0x317, [256])).value;
        put('ID');
        assert.equal((await call(0x319, [table, 256, 0])).value, 11);
        put('Q');
        assert.equal((await call(0x31a, [table, 256, 0, 512])).value, 256);
        assert.equal(m.string(512), 'First authored question?');
        put('missions');
        const mission = (await call(0x31b, [256])).value;
        assert.equal((await call(0x324, [mission, 10, 512])).value, 1);
        assert.equal(m.string(512), 'first.cst');
        await call(0x31d, [mission, 7]);
        assert.equal((await call(0x31e, [mission])).value, 7);
        await call(0x321, [mission, 10]);
        await call(0x323, [mission, 10, 1024, 1028]);
        assert.equal(m.load(1024), 1);
        assert.equal(m.load(1028), 1);
        await assert.rejects(() => call(0x2e9, [mission]), /different object family/);
        const pointers = [question, selection, table, mission].map((h) => content.pointer(h));
        assert.equal(new Set(pointers).size, 4);
        await call(0x2e7, [question]);
        assert.equal(engine.process.allocations.has(pointers[0]), false);
        assert.equal((await call(0x30f, [selection])).value, 2);
        await call(0x30c, [selection]);
        await call(0x318, [table]);
        await call(0x31c, [mission]);
        assert.equal(content.refs.pointers.size, 0);
      } finally {
        await engine.close();
      }
    },
  );
  test(
    profile +
      ' all four content owners checkpoint once, while question and mission state interoperate with CSS restore',
    { skip: !process.env[variable] },
    async () => {
      const bytes = new Uint8Array(await readFile(process.env[variable])),
        files = new SaveSlotFiles(),
        resources = contentFiles();
      async function make() {
        const game = memoryGame({
          'main.kcs': kcsProgram([[37, 2048], [43, 0x47, 4], [59]]),
          ...Object.fromEntries(resources),
        });
        game.resolveCategory = (name) => name;
        game.readCategory = async (name) => game.read(name);
        const configuration = new NativeConfiguration({ profile }),
          random = new ParticleRandom(1234, 4321),
          world = new NativeWorld({
            game,
            profile,
            configuration,
            random,
            images: {},
            host: {},
            storage: files,
            motionLibrary: new MotionLibrary(game, { profile, random }),
          }),
          engine = await NativeEngineProcess.open({
            bytes,
            profile,
            configuration,
            ...files.options(),
          });
        new NativeGlobalStringsBridge(engine, world.globalStrings);
        new NativeRandomMemory(engine, random);
        world.nativeEngine = engine;
        world.nativeEngineLoading = Promise.resolve(engine);
        return world;
      }
      const first = await make(),
        call = (world, id, args = []) =>
          world.runtime.native(
            'main',
            id,
            args,
            world.main.machine,
            world.main,
            world.runtime.scheduler,
          ),
        put = (world, text, at = 256) => world.main.machine.writeString(text, at);
      async function owners(world) {
        const question = (await call(world, 0x2e6)).value;
        put(world, 'questions');
        await call(world, 0x2e8, [question, 256]);
        put(world, 'configurations');
        await call(world, 0x2ee, [question, 256]);
        put(world, 'alpha');
        await call(world, 0x2ef, [question, 256]);
        await call(world, 0x2fc, [question]);
        await call(world, 0x2fd, [question]);
        const selection = (await call(world, 0x30b)).value;
        for (const [number, name] of [
          [7, 'alpha'],
          [8, 'beta'],
          [9, 'gamma'],
        ]) {
          put(world, name);
          await call(world, 0x30d, [selection, number, 256]);
        }
        put(world, 'selections');
        await call(world, 0x30e, [selection, 256]);
        await call(world, 0x33d, [selection, 1]);
        put(world, 'questions');
        const table = (await call(world, 0x317, [256])).value;
        put(world, 'missions');
        const mission = (await call(world, 0x31b, [256])).value;
        return { question, selection, table, mission };
      }
      async function serialized(world, id, handle) {
        const size = (await call(world, id, [handle, 0])).value,
          pointer = (await call(world, 0x341, [size])).value;
        // The question serializer leaves the unused tail of each 64-byte
        // filename untouched. Make the caller's initial bytes explicit.
        world.nativeEngine.process.write(pointer, new Uint8Array(size).fill(0xa5));
        await call(world, id, [handle, pointer]);
        const bytes = world.nativeEngine.process.read(pointer, size);
        await call(world, 0x342, [pointer]);
        return bytes;
      }
      let restored, fresh;
      try {
        await first.initialize('main.kcs');
        const one = await owners(first);
        await call(first, 0x2ed, [one.question, 0]);
        await call(first, 0x2fe, [one.question, 0]);
        await call(first, 0x33f, [one.selection, 0]);
        await call(first, 0x31d, [one.mission, 9]);
        await call(first, 0x321, [one.mission, 10]);
        await call(first, 0x327, [one.mission, 0, 1]);
        const state = {
            question: await serialized(first, 0x2ff, one.question),
            mission: await serialized(first, 0x337, one.mission),
          },
          feature = await first.getNativeFeature('content-databases'),
          pointers = Object.values(one).map((h) => feature.pointer(h));
        const save = (await call(first, 0xee, [17])).value;
        for (const [entry, exportID, handle] of [
          [10, 0x2ff, one.question],
          [20, 0x337, one.mission],
        ]) {
          const size = (await call(first, exportID, [handle, 0])).value,
            data = (await call(first, 0x341, [size])).value;
          first.nativeEngine.process.write(data, new Uint8Array(size).fill(0xa5));
          await call(first, exportID, [handle, data]);
          assert.equal((await call(first, 0x343, [save, entry, size, data])).value, 1);
          await call(first, 0x342, [data]);
        }
        put(first, 'content-state.dat');
        assert.equal((await call(first, 0xf5, [save, 256])).value, 1);
        restored = await make();
        await restored.restore(structuredClone(first.snapshot()));
        const restoredFeature = await restored.getNativeFeature('content-databases');
        assert.deepEqual(
          Object.values(one).map((h) => restoredFeature.pointer(h)),
          pointers,
        );
        assert.deepEqual(await serialized(restored, 0x2ff, one.question), state.question);
        assert.deepEqual(await serialized(restored, 0x337, one.mission), state.mission);
        for (let i = 0; i < 100; i++) {
          assert.equal(restored.random.rand(), first.random.rand());
          assert.equal(restored.random.frand(), first.random.frand());
        }
        put(restored, 'ID');
        assert.equal((await call(restored, 0x319, [one.table, 256, 1])).value, 12);
        assert.equal(
          (await call(restored, 0x30f, [one.selection])).value,
          (await call(first, 0x30f, [one.selection])).value,
        );
        fresh = await make();
        await fresh.initialize('main.kcs');
        const two = await owners(fresh);
        put(fresh, 'content-state.dat');
        const opened = (await call(fresh, 0xf7, [256])).value;
        for (const [entry, importID, handle, size] of [
          [10, 0x300, two.question, state.question.length],
          [20, 0x338, two.mission, state.mission.length],
        ]) {
          const data = (await call(fresh, 0x344, [opened, entry, 1280])).value;
          assert.equal(fresh.main.machine.load(1280), size);
          assert.equal(
            (await call(fresh, importID, [handle, data, ...(importID === 0x338 ? [size] : [])]))
              .value,
            1,
          );
          await call(fresh, 0x342, [data]);
        }
        assert.deepEqual(await serialized(fresh, 0x2ff, two.question), state.question);
        assert.deepEqual(await serialized(fresh, 0x337, two.mission), state.mission);
        await call(restored, 0x321, [one.mission, 20]);
        assert.notDeepEqual(await serialized(restored, 0x337, one.mission), state.mission);
        assert.deepEqual(await serialized(first, 0x337, one.mission), state.mission);
      } finally {
        await fresh?.close({ flushFiles: false });
        await restored?.close({ flushFiles: false });
        await first.close({ flushFiles: false });
      }
    },
  );
}
