// SPDX-License-Identifier: MPL-2.0
import test from 'node:test';
import assert from 'node:assert/strict';
import { NativeWorld } from '../src/native/world.mjs';
import { NativeConfiguration } from '../src/native/config.mjs';
import { MotionLibrary } from '../src/motion/library.mjs';
import { ParticleRandom } from '../src/ppi/random.mjs';
import { floatBits } from '../src/kcs.mjs';
import { kcsProgram, memoryGame } from './helpers.mjs';

for (const profile of ['sdk-4.01-engine-2.6.1.74', 'nekopara-vol3-engine-2.6.1.76'])
  test(`${profile} task command routing retains nested Top state, raw strings and draw queries after restore`, async () => {
    const create = () => {
        const game = memoryGame({
            'main.kcs': kcsProgram([[37, 1024], [43, 0x47, 4], [59]]),
          }),
          random = new ParticleRandom();
        return new NativeWorld({
          game,
          images: {},
          host: {},
          profile,
          random,
          configuration: new NativeConfiguration({ profile }),
          motionLibrary: new MotionLibrary(game, { profile, random }),
          storage: { read: async () => null, write: async () => true },
        });
      },
      world = create();
    let fresh;
    try {
      await world.initialize('main.kcs');
      const outerPlane = await world.objects.create({ kind: 2, parent: world.root }),
        innerTop = await world.objects.create({ kind: 1, nativeID: 0 }),
        inner = await world.spawnScript('main.kcs', { parent: innerTop }),
        innerPlane = await world.objects.create({ kind: 2, parent: innerTop }),
        nativePlane = world.nativeTaskID(innerPlane),
        call = (task, id, args) => world.runtime.native('main', id, args, task.machine, task),
        outer = world.objects.objects.get(world.root),
        nested = world.objects.objects.get(innerTop);
      assert.equal(world.nativeTaskID(outerPlane), nativePlane);
      assert.notEqual(outerPlane, innerPlane);
      await call(world.main, 0x28d, [nativePlane, 17]);
      await call(inner, 0x28d, [nativePlane, 29]);
      assert.equal(world.graphics.get(outerPlane).state.vramType, 17);
      assert.equal(world.graphics.get(innerPlane).state.vramType, 29);
      outer.exitCode = 72;
      nested.exitCode = 73;
      const rootMessage = nested.implementation.message.bind(nested.implementation),
        zeroMessages = [];
      nested.implementation.message = (words, context) => {
        zeroMessages.push(words);
        return rootMessage(words, context);
      };
      assert.deepEqual(await call(inner, 0x28b, [0]), { control: 2 });
      assert.deepEqual(
        zeroMessages,
        [[inner.nativeID ?? world.nativeTaskID(inner.id), 24, 0, 0xffffffff]],
        'zero routes to the caller Top',
      );
      assert.equal(nested.exitCode, 73, 'Top consumes this message without BaseTask mutation');
      assert.equal(outer.exitCode, 72);
      world.objects.objects.get(innerPlane).exitCode = 32;
      await call(inner, 0x28b, [nativePlane]);
      assert.equal(world.objects.objects.get(innerPlane).exitCode, -1);
      const observed = [],
        implementation = world.objects.objects.get(innerPlane).implementation,
        original = implementation.message.bind(implementation),
        raw = (memory, address) => {
          const out = [];
          for (let i = 0; ; i++) {
            const b = memory.bytes(address + i, 1)[0];
            if (!b) return out;
            out.push(b);
          }
        };
      implementation.message = async (words, context) => {
        if (words[1] === 85)
          observed.push([raw(context.payload, words[2]), raw(context.payload, words[3])]);
        if (words[1] === 86) observed.push(raw(context.payload, words[3]));
        return original(words, context);
      };
      const prefix = new TextEncoder().encode('中文 %s[H512]'),
        suffix = Uint8Array.of(0x81, 0xff, 37, 0x25);
      inner.machine.bytes(64, prefix.length + 1).set([...prefix, 0]);
      inner.machine.bytes(0x80000200, suffix.length + 1).set([...suffix, 0]);
      inner.machine.writeString('', 256);
      const state = structuredClone(implementation.snapshot());
      await call(inner, 0x28e, [nativePlane, 64, 256]);
      await call(inner, 0x28f, [nativePlane, 256]);
      assert.deepEqual(observed, [
        [[...new TextEncoder().encode('中文 '), 0x81, 0xff, 37], []],
        [],
      ]);
      assert.deepEqual(
        implementation.snapshot(),
        state,
        'simple plane has explicit empty 85/86 branches',
      );
      await call(inner, 0x28d, [0xffffffff, 0x12345678]);
      const drawing = await world.objects.create({ kind: 15, parent: innerTop }),
        drawID = world.nativeTaskID(drawing),
        image = world.graphics.images.create(1, 1);
      await call(inner, 0x100, [drawID, 8, 6]);
      await call(inner, 0x101, [
        drawID,
        7,
        image,
        0,
        0,
        0,
        0,
        0,
        floatBits(1),
        floatBits(1),
        255,
        1,
        0,
      ]);
      const auxiliary = (await call(inner, 0x291, [drawID, 7])).value;
      assert.notEqual(auxiliary, image, 'retained item owns a separate bitmap wrapper');
      assert.equal(
        world.graphics.images.get(auxiliary).dataHandle,
        world.graphics.images.get(image).dataHandle,
      );
      assert.deepEqual(await call(world.main, 0x291, [drawID, 7]), { control: 1, value: 0 });
      const saved = structuredClone(world.snapshot());
      fresh = create();
      await fresh.restore(saved);
      const restored = fresh.runtime.scheduler.tasks.get(inner.id),
        invoke = (id, args) => fresh.runtime.native('main', id, args, restored.machine, restored);
      assert.equal(fresh.graphics.get(outerPlane).state.vramType, 17);
      assert.equal(fresh.graphics.get(innerPlane).state.vramType, 29);
      assert.equal(fresh.objects.objects.get(innerTop).exitCode, 73);
      assert.equal(fresh.objects.objects.get(innerPlane).exitCode, -1);
      assert.deepEqual(await invoke(0x291, [drawID, 7]), { control: 1, value: auxiliary });
      await invoke(0x28d, [nativePlane, 31]);
      assert.equal(fresh.graphics.get(innerPlane).state.vramType, 31);
      assert.equal(world.graphics.get(innerPlane).state.vramType, 29);
      await invoke(0x28e, [nativePlane, 64, 256]);
    } finally {
      await fresh?.close({ flushFiles: false });
      await world.close({ flushFiles: false });
    }
  });
