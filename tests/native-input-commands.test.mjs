// SPDX-License-Identifier: MPL-2.0
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { verifyInputCommands } from '../scripts/verify-native-input-commands.mjs';
import { verifyNativePlaneInput } from '../scripts/verify-native-plane-input.mjs';
import { NativeWorld } from '../web/transitional-entry.mjs';
import { NativeConfiguration } from '../src/native/config.mjs';
import { NativeInputBindings } from '../src/native/input-bindings.mjs';
import { MotionLibrary } from '../src/motion/library.mjs';
import { ParticleRandom } from '../src/ppi/random.mjs';
import { floatBits } from '../src/kcs.mjs';
import { kcsProgram, memoryGame } from './helpers.mjs';

for (const [profile, variable] of [
  ['nekopara-vol3-engine-2.6.1.76', 'CATSYSTEM2_ENGINE_EXE'],
  ['sdk-4.01-engine-2.6.1.74', 'CATSYSTEM2_SDK_EXE'],
]) {
  test(
    `${profile} complete input command wrappers preserve task packets and unwritten outputs`,
    { skip: !process.env[variable] },
    async () => {
      const bytes = new Uint8Array(await readFile(process.env[variable]));
      await verifyInputCommands(bytes, profile);
      await verifyNativePlaneInput(bytes, profile);
    },
  );
  test(
    `${profile} original 5F binds the moving legacy text graph with a literal flag word`,
    { skip: !process.env[variable] },
    async () => {
      const game = memoryGame({
          'engine.exe': new Uint8Array(await readFile(process.env[variable])),
          'main.kcs': kcsProgram([[37, 1024], [43, 0x47, 4], [59]]),
        }),
        make = () => {
          const random = new ParticleRandom();
          return new NativeWorld({
            game,
            profile,
            random,
            images: {},
            host: {},
            configuration: new NativeConfiguration({ profile }),
            motionLibrary: new MotionLibrary(game, { profile, random }),
            storage: { read: async () => null, write: async () => true },
          });
        },
        send = async (world, id, message, fields) => {
          const p = world.nativeEngine.process,
            pointer = p.allocate(32, true);
          try {
            fields.forEach((field, i) => p.store(pointer + 4 * i, field));
            await world.sendEngine(id, world.main.id, message, 0, pointer, {
              nativePointer: true,
              payload: p,
            });
          } finally {
            p.free(pointer);
          }
        },
        first = make(),
        fresh = make();
      try {
        // Build the original legacy-text task without opening the game's
        // independent E-mote view.
        await first.ensureNativeEngine();
        first.root = await first.objects.create({ kind: 1, name: 'BASE TASK' });
        first.main = await first.spawnScript('main.kcs');
        const id = await first.objects.create({ kind: 8, parent: first.root }),
          target = first.nativeTaskID(id),
          { main } = first,
          apply = (args) => first.runtime.native('main', 0x5f, args, main.machine, main);
        await send(first, id, 41, [0, 0, 0, floatBits(20), floatBits(15), 0, 0, 0]);
        await send(first, id, 49, [3.5, 5.5, -8.5].map(floatBits));
        await send(first, id, 51, [11.25, 2.25, 1].map(floatBits));
        assert.deepEqual(await apply([0]), { control: 2 });
        assert.deepEqual(await apply([target, 0xf2345678]), { control: 2 });
        const region = first.inputFor(id).get(id);
        assert.deepEqual(region.bounds, [7, -3, 27, 11]);
        assert.equal(region.priority | 0, -8);
        assert.equal(region.flags, 0xf2345678);
        assert.equal(region.receiver, first.nativeTaskID(main.id));
        assert.equal(region.mask, 7);
        await apply([target, 3]);
        assert.equal(first.inputFor(id).regions.filter((r) => r.owner === id).length, 1);
        assert.equal(region.flags, 0xf2345678);
        await fresh.restore(structuredClone(first.snapshot()));
        const restored = fresh.inputFor(id).get(id);
        assert.deepEqual(restored, region);
        await send(fresh, id, 51, [20.75, 16.125, 2].map(floatBits));
        assert.deepEqual(restored.bounds, [17, 10, 37, 25]);
        assert.equal(restored.priority | 0, -8);
        assert.deepEqual(region.bounds, [7, -3, 27, 11]);
        await send(fresh, id, 90, []);
        assert.equal(fresh.inputFor(id).get(id), null);
      } finally {
        await fresh.close({ flushFiles: false });
        await first.close({ flushFiles: false });
      }
    },
  );
}

test(
  'SDK input commands use the caller Top, original bitmap mask and real wheel device across fresh restore',
  { skip: !process.env.CATSYSTEM2_SDK_EXE },
  async () => {
    const profile = 'sdk-4.01-engine-2.6.1.74',
      exe = new Uint8Array(await readFile(process.env.CATSYSTEM2_SDK_EXE)),
      make = () => {
        const game = memoryGame({
            'engine.exe': exe,
            'main.kcs': kcsProgram([[37, 1024], [43, 0xd1, 4], [59]]),
          }),
          configuration = new NativeConfiguration({ profile }),
          random = new ParticleRandom();
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
        const world = new NativeWorld({
          game,
          profile,
          configuration,
          random,
          host: { nativeWindowFocused: () => true },
          images: {},
          storage: { read: async () => null, write: async () => true },
          motionLibrary: new MotionLibrary(game, { profile, random }),
        });
        world.inputBindings = new NativeInputBindings(world.input, configuration);
        return world;
      },
      world = make();
    let fresh;
    try {
      await world.initialize('main.kcs');
      const task = world.main,
        m = task.machine,
        call = (owner, id, args) => world.runtime.native('main', id, args, owner.machine, owner),
        planeID = await world.objects.create({
          kind: 6,
          parent: world.root,
          name: 'Authored mask input',
        }),
        planeNativeID = world.nativeTaskID(planeID);
      [0, 0, 4, 3, 0, 0].forEach((v, i) => m.store(512 + i * 4, v));
      await world.sendEngine(planeID, task.id, 89, 0, 512, { machine: m });
      const input = world.inputFor(planeID),
        region = input.get(planeID);
      assert.ok(region);
      region.active = 23;
      assert.equal((await call(task, 0x6b, [planeNativeID])).value, 23);
      const h = (await call(task, 0x70, [4, 3])).value,
        bitmap = world.graphics.images.get(h);
      bitmap.state.canvasWidth = 4;
      bitmap.state.canvasHeight = 3;
      await bitmap.fill(0, 0, 4, 3, 0xff123456);
      await call(task, 0x18a, [planeNativeID, h]);
      assert.deepEqual([...region.alpha.bytes], [15, 15, 15]);
      assert.deepEqual([region.alpha.width, region.alpha.height], [4, 3]);
      const top = await world.objects.create({ kind: 1, nativeID: 0 }),
        inner = await world.spawnScript('main.kcs', { parent: top });
      [0, 0, 4, 3].forEach((v, i) => inner.machine.store(512 + i * 4, v));
      await call(task, 0x90, [world.nativeTaskID(task.id), 0, 512, 7]);
      await call(inner, 0x90, [world.nativeTaskID(inner.id), 0, 512, 7]);
      world.inputFor(task.id).get(task.id).active = 19;
      world.inputFor(inner.id).get(inner.id).active = 29;
      assert.equal(
        world.nativeTaskID(inner.id),
        world.nativeTaskID(task.id),
        'native IDs are reused in distinct Tops',
      );
      assert.equal((await call(task, 0x6b, [world.nativeTaskID(task.id)])).value, 19);
      assert.equal((await call(inner, 0x6b, [world.nativeTaskID(inner.id)])).value, 29);
      const device = await world.getNativeFeature('input-device');
      await device.pointer();
      const p = world.nativeEngine.process,
        window = device.refs.window;
      for (const [at, word] of [
        [1536, 0xa5a5a5a5],
        [1540, 123],
        [1544, 456],
        [1548, 0xa5a5a5a5],
      ])
        p.store(window + at, word);
      world.inputBindings.wheel(true);
      world.inputBindings.wheel(false);
      fresh = make();
      await fresh.restore(structuredClone(world.snapshot()));
      const fp = fresh.nativeEngine.process,
        fd = await fresh.getNativeFeature('input-device'),
        ft = fresh.main,
        invoke = (id, args) => fresh.runtime.native('main', id, args, ft.machine, ft);
      assert.equal(fd.refs.window, window);
      await invoke(0x3a9, []);
      assert.deepEqual(
        [1536, 1540, 1544, 1548].map((at) => fp.load(window + at)),
        [0xa5a5a5a5, 0, 0, 0xa5a5a5a5],
      );
      assert.deepEqual(fresh.inputBindings.pulses, []);
      assert.deepEqual([p.load(window + 1540), p.load(window + 1544)], [123, 456]);
      assert.deepEqual(world.inputBindings.pulses, [6, 7]);
      assert.equal((await invoke(0x6b, [planeNativeID])).value, 23);
      const restoredRegion = fresh.inputFor(planeID).get(planeID);
      assert.deepEqual([...restoredRegion.alpha.bytes], [15, 15, 15]);
      await fresh.graphics.images.release(h);
      assert.deepEqual(
        [...restoredRegion.alpha.bytes],
        [15, 15, 15],
        'input owns a copied native mask after image release',
      );
      await invoke(0x18a, [planeNativeID, 0]);
      assert.equal(restoredRegion.alpha, null);
      assert.deepEqual([...region.alpha.bytes], [15, 15, 15]);
    } finally {
      await fresh?.close({ flushFiles: false });
      await world.close({ flushFiles: false });
    }
  },
);
