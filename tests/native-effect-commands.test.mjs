// SPDX-License-Identifier: MPL-2.0
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { NativeWorld } from '../web/transitional-entry.mjs';
import { NativeConfiguration } from '../src/native/config.mjs';
import { ParticleRandom } from '../src/ppi/random.mjs';
import { MotionLibrary } from '../src/motion/library.mjs';
import { floatBits } from '../src/kcs.mjs';
import { kcsProgram, memoryGame } from './helpers.mjs';

test(
  'SDK effect wrappers reach every original initialized receiver and restore active native state',
  { skip: !process.env.CATSYSTEM2_SDK_EXE },
  async () => {
    const exe = new Uint8Array(await readFile(process.env.CATSYSTEM2_SDK_EXE)),
      profile = 'sdk-4.01-engine-2.6.1.74',
      make = () => {
        const game = memoryGame({
            'engine.exe': exe,
            'main.kcs': kcsProgram([[37, 128], [43, 0xd1, 4], [59]]),
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
        return new NativeWorld({
          game,
          images: {},
          host: {},
          profile,
          configuration,
          random,
          motionLibrary: new MotionLibrary(game, { profile, random }),
          storage: { read: async () => null, write: async () => true },
        });
      },
      world = make();
    let fresh;
    try {
      await world.initialize('main.kcs');
      const task = world.main,
        m = task.machine,
        call = (id, args) => world.runtime.native('main', id, args, m, task),
        starts = new Map([
          [35, 0x20a],
          [36, 0x20c],
          [37, 0x20e],
          [38, 0x210],
          [39, 0x213],
          [50, 0x357],
          [51, 0x359],
          [52, 0x35d],
          [57, 0x3c8],
          [58, 0x3cc],
        ]);
      for (const [kind, start] of starts) {
        const id = await world.objects.create({ kind, parent: world.root, name: 'KCS effect' }),
          nativeID = world.nativeTaskID(id),
          implementation = world.objects.objects.get(id).implementation,
          p = world.nativeEngine.process;
        assert.deepEqual(await call(0x208, [nativeID]), { control: 1, value: 0 });
        assert.deepEqual(await call(start, [nativeID, 1]), { control: 2 });
        assert.deepEqual(await call(0x208, [nativeID]), { control: 1, value: 1 });
        assert.equal(p.load(implementation.pointer + 116), 1);
        await call(start, [nativeID, 0]);
        assert.deepEqual(await call(0x208, [nativeID]), { control: 1, value: 0 });
        await world.objects.release(id);
      }
      assert.deepEqual(await call(0x208, [0]), { control: 1, value: 0 });
      assert.ok(
        (await call(0x208, [0xffffffff])).value,
        'an unwritten missing-route query preserves the original nonzero caller-result address',
      );
      const id = await world.objects.create({
          kind: 38,
          parent: world.root,
          name: 'Retained draw effect',
        }),
        nativeID = world.nativeTaskID(id),
        implementation = world.objects.objects.get(id).implementation,
        p = world.nativeEngine.process;
      await call(0x20f, [nativeID, 12, floatBits(1.5), floatBits(100)]);
      assert.deepEqual(
        [
          p.load(implementation.pointer + 128),
          p.load(implementation.pointer + 132),
          p.load(implementation.pointer + 136),
        ],
        [floatBits(1.5), floatBits(100), 12],
      );
      await call(0x210, [nativeID, 1]);
      const images = world.graphics.images,
        mask = images.create(4, 3, task.id),
        alias = images.alias(mask, task.id),
        bitmapMemory = await world.getNativeFeature('bitmap-memory');
      await images.get(mask).fill(0, 0, 4, 3, 0xff123456);
      const source = await bitmapMemory.pointer(mask),
        wipeID = await world.objects.create({
          kind: 39,
          parent: world.root,
          name: 'KCS owned bitmap wipe',
        }),
        wipeNativeID = world.nativeTaskID(wipeID),
        wipe = world.objects.objects.get(wipeID).implementation;
      await call(0x212, [wipeNativeID, 12, floatBits(1.5), floatBits(100), mask]);
      assert.equal(p.load(wipe.pointer + 140), source);
      assert.equal(p.load(wipe.pointer + 144), 0);
      const firstClone = p.load(wipe.pointer + 296);
      assert.ok(firstClone);
      assert.notEqual(firstClone, source);
      assert.deepEqual(
        [p.load(firstClone + 4), p.load(firstClone + 8), p.load(source + 80)],
        [64, 48, 2],
      );
      await images.get(alias).fill(0, 0, 4, 3, 0xffaabbcc);
      await call(0x389, [wipeNativeID, 20, floatBits(2), floatBits(80), alias]);
      assert.equal(p.load(wipe.pointer + 140), source, 'both KCS handles keep one source bitmap');
      assert.equal(p.load(wipe.pointer + 144), 1, 'the second wrapper retains its distinct flag');
      const ownedMask = p.load(wipe.pointer + 296),
        ownedPixels = p.load(ownedMask + 12);
      assert.deepEqual([...p.read(ownedPixels, 4)], [0xcc, 0xbb, 0xaa, 0xff]);
      await images.release(mask);
      assert.equal(p.load(source + 80), 1);
      const before = p.read(implementation.pointer + 112, 28);
      fresh = make();
      await fresh.restore(structuredClone(world.snapshot()));
      const ft = fresh.main,
        fm = ft.machine,
        invoke = (id, args) => fresh.runtime.native('main', id, args, fm, ft),
        restored = fresh.objects.objects.get(id).implementation,
        fp = fresh.nativeEngine.process;
      assert.equal(restored.pointer, implementation.pointer);
      assert.deepEqual(fp.read(restored.pointer + 112, 28), before);
      assert.deepEqual(await invoke(0x208, [nativeID]), { control: 1, value: 1 });
      const freshWipe = fresh.objects.objects.get(wipeID).implementation;
      assert.equal(freshWipe.pointer, wipe.pointer);
      assert.equal(fp.load(freshWipe.pointer + 140), source);
      assert.equal(fp.load(freshWipe.pointer + 144), 1);
      assert.equal(fp.load(freshWipe.pointer + 296), ownedMask);
      await fresh.graphics.images.get(alias).fill(0, 0, 4, 3, 0xff010203);
      assert.deepEqual([...fp.read(ownedPixels, 4)], [0xcc, 0xbb, 0xaa, 0xff]);
      await invoke(0x212, [wipeNativeID, 10, floatBits(0), floatBits(10), alias]);
      assert.equal(fp.load(freshWipe.pointer + 144), 0);
      const freshMask = fp.load(freshWipe.pointer + 296);
      assert.deepEqual([...fp.read(fp.load(freshMask + 12), 4)], [3, 2, 1, 0xff]);
      assert.deepEqual([...p.read(ownedPixels, 4)], [0xcc, 0xbb, 0xaa, 0xff]);
      await fresh.objects.release(wipeID);
      assert.equal(fp.allocations.has(freshMask), false, 'the receiver destroys its mask clone');
      assert.equal(fp.allocations.has(source), true, 'the KCS image alias owns the source');
      await fresh.graphics.images.release(alias);
      assert.equal(fp.allocations.has(source), false);
      assert.equal(p.allocations.has(source), true);
      await invoke(0x211, [nativeID]);
      assert.equal(fp.load(restored.pointer + 124), 1, 'the original force-completion word is set');
      assert.equal(
        p.load(implementation.pointer + 124),
        0,
        'the original World remains independent',
      );
      await invoke(0x210, [nativeID, 0]);
      assert.deepEqual(await invoke(0x208, [nativeID]), { control: 1, value: 0 });
      await fresh.objects.release(id);
      assert.equal(fp.allocations.has(restored.pointer), false);
      assert.equal(p.allocations.has(implementation.pointer), true);
    } finally {
      await fresh?.close({ flushFiles: false });
      await world.close({ flushFiles: false });
    }
  },
);
