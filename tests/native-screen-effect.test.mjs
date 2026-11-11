// SPDX-License-Identifier: MPL-2.0
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { NativeEngineProcess } from '../src/native/engine-process.mjs';
import {
  NATIVE_SCREEN_EFFECT_LAYOUTS,
  NativeScreenEffectTask,
  screenEffectRawMessage,
} from '../oracle/screen-effect-original.mjs';
import { NATIVE_UNWRITTEN_WORD } from '../src/native/engine-message.mjs';
import { encodeCP932 } from '../src/kcs/strings.mjs';
import { nativeRectangleDefinitions } from '../src/native/windows-rectangles.mjs';
import { NativeWorld } from '../web/transitional-entry.mjs';
import { NativeConfiguration } from '../src/native/config.mjs';
import { ParticleRandom } from '../src/ppi/random.mjs';
import { MotionLibrary } from '../src/motion/library.mjs';
import { kcsProgram, memoryGame } from './helpers.mjs';

function sdkWorld(exe, source = '') {
  const profile = 'sdk-4.01-engine-2.6.1.74',
    game = memoryGame({
      'engine.exe': exe,
      'main.kcs': kcsProgram([[37, 128], [43, 0xd1, 4], [43, 0x41, 0], [59]]),
      'effects.fes': encodeCP932(source),
    }),
    random = new ParticleRandom(),
    configuration = new NativeConfiguration({ profile });
  game.width = 64;
  game.height = 48;
  Object.assign(configuration.screen, {
    width: 64,
    height: 48,
    currentWidth: 64,
    currentHeight: 48,
    virtualWidth: 64,
    virtualHeight: 48,
  });
  return new NativeWorld({
    game,
    images: {},
    host: {},
    profile,
    random,
    configuration,
    motionLibrary: new MotionLibrary(game, { profile, random }),
    storage: {
      read: async () => null,
      write: async () => true,
      remove: async () => true,
      stat: async () => null,
      list: async () => [],
    },
  });
}

test('screen effects retain their independent SDK raw message ranges', () => {
  const sdk = 'sdk-4.01-engine-2.6.1.74',
    game = 'nekopara-vol3-engine-2.6.1.76';
  for (const [canonical, raw] of [
    [19, 19],
    [39, 37],
    [377, 372],
    [395, 390],
    [516, 490],
    [523, 497],
  ]) {
    assert.equal(screenEffectRawMessage(sdk, canonical), raw);
    assert.equal(screenEffectRawMessage(game, canonical), canonical);
  }
});

// Only the receiver/packet path is exercised here. The fields are authored
// native records; this does not claim device initialization or visual output.
for (const [profile, variable] of [
  ['nekopara-vol3-engine-2.6.1.76', 'CATSYSTEM2_ENGINE_EXE'],
  ['sdk-4.01-engine-2.6.1.74', 'CATSYSTEM2_SDK_EXE'],
])
  test(
    `${profile} all screen-effect receivers preserve query and untouched output words`,
    { skip: !process.env[variable] },
    async () => {
      const engine = await NativeEngineProcess.open({
          profile,
          bytes: new Uint8Array(await readFile(process.env[variable])),
        }),
        p = engine.process,
        owner = {
          engine,
          process: p,
          abi: NATIVE_SCREEN_EFFECT_LAYOUTS[profile],
          world: { base: () => ({}) },
          platform: { sync() {}, pull() {} },
          taskMemory: {
            messageOptions: (record, context) => ({
              task: record.id,
              messageContext: { receiver: record.id, context },
            }),
          },
        };
      try {
        for (const [kindString, abi] of Object.entries(owner.abi)) {
          const kind = Number(kindString),
            record = { id: 71, nativeID: 9, kind },
            task = new NativeScreenEffectTask(owner, record);
          assert.equal(p.load(abi.vtable + 28), abi.receiver, `kind ${kind} receiver slot`);
          task.pointer = p.allocate(abi.size, true);
          p.store(task.pointer, abi.vtable);
          p.store(task.pointer + 4, 9);
          p.store(task.pointer + 100, 27);
          try {
            for (const initialized of [0, 1]) {
              p.store(task.pointer + 112, initialized);
              p.store(task.pointer + 116, 0x12345678);
              assert.equal(
                await task.message([8, 377, 0, 0], { nativePointer: true }),
                !initialized && [38, 52, 57].includes(kind) ? 0 : 0x12345678,
                `kind ${kind}`,
              );
              const context = { nativePointer: true };
              assert.equal(await task.message([8, 0x700, 0, 0], context), NATIVE_UNWRITTEN_WORD);
              assert.equal(context.nativeUnhandled, true);
            }
          } finally {
            p.free(task.pointer);
          }
        }
      } finally {
        engine.close();
      }
    },
  );

test(
  'SDK JS screen-effect tasks retain canonical state and callback ownership in a fresh World',
  { skip: !process.env.CATSYSTEM2_SDK_EXE },
  async () => {
    const exe = new Uint8Array(await readFile(process.env.CATSYSTEM2_SDK_EXE)),
      create = () => sdkWorld(exe),
      world = create();
    let fresh;
    try {
      await world.initialize('main.kcs');
      for (const kind of [35, 36, 37, 38, 39, 50, 51, 52, 57, 58]) {
        const id = await world.objects.create({ kind, parent: world.root, name: 'Authored FX' }),
          task = world.objects.objects.get(id).implementation;
        assert.equal(task.state.capability, true);
        assert.equal(await world.sendEngine(id, world.root, 377), 0);
        await world.sendEngine(id, world.root, 29, 0, 73);
        assert.equal(world.objects.objects.get(id).userValue, 73);
        await world.objects.release(id);
        assert.equal(world.screenEffects.tasks.has(id), false);
      }
      const id = await world.objects.create({ kind: 38, parent: world.root, name: 'Retained FX' }),
        task = world.objects.objects.get(id).implementation,
        state = structuredClone(world.snapshot());
      fresh = create();
      await fresh.restore(state);
      const restored = fresh.objects.objects.get(id).implementation;
      assert.deepEqual(restored.state, task.state);
      assert.equal(fresh.screenEffects.callback, world.screenEffects.callback);
      assert.equal(fresh.screenEffects.callback, id);
      assert.equal(await fresh.sendEngine(id, fresh.root, 377), 0);
      await fresh.objects.release(id);
      assert.equal(fresh.screenEffects.callback, 0);
      assert.equal(world.screenEffects.callback, id);
      assert.equal(world.screenEffects.tasks.has(id), true);
    } finally {
      await fresh?.close({ flushFiles: false });
      await world.close({ flushFiles: false });
    }
  },
);

test(
  'SDK FES effects retain separate allocation lists and original completion across a fresh World',
  { skip: !process.env.CATSYSTEM2_SDK_EXE },
  async () => {
    const exe = new Uint8Array(await readFile(process.env.CATSYSTEM2_SDK_EXE)),
      source =
        '#DEFINE\nRDRAW draw\nWBREAK broken\nRWMOS mosaic\nRFMOS fmosaic\n#START\nnext WAIT\n#WAIT\n',
      world = sdkWorld(exe, source);
    let fresh;
    try {
      await world.initialize('main.kcs');
      await world.tick();
      const ids = [];
      for (let index = 0; index < 2; index++) {
        const id = await world.objects.create({
          kind: 34,
          parent: world.main.id,
          name: 'Authored effects',
        });
        ids.push(id);
        await world.objects.objects.get(id).implementation.load('effects', world.main);
      }
      const runtime = await world.getNativeFeature('fes-objects'),
        p = world.nativeEngine.process,
        rows = ids.map((id) => world.objects.objects.get(id).implementation.player.root.objects);
      const pointers = rows.flat().map((object) => object.nativeObjectPointer);
      assert.notEqual(
        runtime.initializationLists.get(ids[0]),
        runtime.initializationLists.get(ids[1]),
      );
      for (const objects of rows) {
        assert.deepEqual(
          objects.map((o) => world.objects.objects.get(o.nativeTaskID).kind),
          [38, 52, 50, 51],
        );
        assert.ok(objects.every((o) => o.nativeEffectInitialized && !o.deleted));
      }
      await world.tick();
      const snapshot = structuredClone(world.snapshot());
      fresh = sdkWorld(exe, source);
      await fresh.restore(snapshot);
      for (let frame = 0; frame < 12; frame++) {
        await world.tick();
        await fresh.tick();
      }
      for (const id of ids) {
        const original = world.objects.objects.get(id).implementation.player.root,
          restored = fresh.objects.objects.get(id).implementation.player.root;
        assert.ok(original.objects.every((o) => o.deleted));
        assert.deepEqual(
          restored.objects.map((o) => [o.key, o.deleted, o.nativeObjectPointer]),
          original.objects.map((o) => [o.key, o.deleted, o.nativeObjectPointer]),
        );
        for (const current of [world, fresh]) {
          const driver = await current.getNativeFeature('fes-objects'),
            list = driver.initializationLists.get(id);
          assert.equal(
            current.nativeEngine.process.load(list + 4),
            0,
            'the original resource traversal removed every completed record',
          );
        }
      }
      for (const pointer of pointers) assert.equal(p.allocations.has(pointer), false);
    } finally {
      await fresh?.close({ flushFiles: false });
      await world.close({ flushFiles: false });
    }
  },
);

for (const [profile, variable] of [
  ['nekopara-vol3-engine-2.6.1.76', 'CATSYSTEM2_ENGINE_EXE'],
  ['sdk-4.01-engine-2.6.1.74', 'CATSYSTEM2_SDK_EXE'],
])
  test(
    `${profile} every original screen-effect constructor retains a failed view capability`,
    { skip: !process.env[variable] },
    async () => {
      const engine = await NativeEngineProcess.open({
          profile,
          bytes: new Uint8Array(await readFile(process.env[variable])),
        }),
        p = engine.process,
        view = p.allocate(0x118, true),
        name = p.allocate(32, true);
      for (const [name, definition] of nativeRectangleDefinitions(p))
        engine.registerWindows('USER32.dll', name, definition);
      for (const suffix of ['A', 'W'])
        engine.registerWindows('SHELL32.dll', `SHGetFolderPath${suffix}`, {
          count: 5,
          // Authored OS boundary: this component probe exposes no Windows
          // user folders. The original initializer takes its failure path.
          fn: () => 0x80004005,
        });
      for (const suffix of ['A', 'W'])
        engine.registerWindows('SHELL32.dll', `SHGetSpecialFolderPath${suffix}`, {
          count: 4,
          fn: () => 0,
        });
      p.write(name, encodeCP932('Authored effect\0'));
      try {
        const configuration = p.allocate(0x30000, true),
          sdk = profile.startsWith('sdk-');
        await engine.call(sdk ? 0x5cd960 : 0x71c9a0, [], configuration);
        assert.equal(
          p.load(configuration + (sdk ? 47892 : 51076)),
          2,
          'the original configuration initializer allows two shared render targets',
        );
        p.free(configuration);
        for (const [kind, abi] of Object.entries(NATIVE_SCREEN_EFFECT_LAYOUTS[profile])) {
          const pointer = p.allocate(abi.size + 16, true);
          p.write(pointer + abi.size, new Uint8Array(16).fill(0xa5));
          await engine.call(abi.construct, [17, name, 72, view], pointer);
          assert.equal(p.load(pointer), abi.vtable, `kind ${kind}`);
          assert.deepEqual([p.load(pointer + 4), p.load(pointer + 72)], [17, 72]);
          assert.equal(p.load(pointer + 108), 0);
          assert.equal(p.load(pointer + 112), 0, 'a missing native view is not initialized');
          assert.equal(p.load(pointer + 116), 0);
          assert.deepEqual([...p.read(pointer + abi.size, 16)], new Array(16).fill(0xa5));
          await engine.call(p.load(abi.vtable), [1], pointer);
          assert.equal(p.allocations.has(pointer), false);
        }
      } finally {
        p.free(name);
        p.free(view);
        engine.close();
      }
    },
  );
