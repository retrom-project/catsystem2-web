// SPDX-License-Identifier: MPL-2.0
import test from 'node:test';
import assert from 'node:assert/strict';
import { NativeWorld } from '../src/native/world.mjs';
import { NativeConfiguration } from '../src/native/config.mjs';
import { MotionLibrary } from '../src/motion/library.mjs';
import { ParticleRandom } from '../src/ppi/random.mjs';
import { NATIVE_UNWRITTEN_WORD } from '../src/native/engine-message.mjs';
import { kcsProgram, memoryGame } from './helpers.mjs';

for (const profile of ['nekopara-vol3-engine-2.6.1.76', 'sdk-4.01-engine-2.6.1.74'])
  test(`${profile} KCS input gates control real routing, preserve auto-hide state and restore`, async () => {
    const game = memoryGame({ 'main.kcs': kcsProgram([[37, 256], [43, 0x47, 4], [59]]) }),
      events = [],
      make = () => {
        const random = new ParticleRandom();
        return new NativeWorld({
          game,
          images: {},
          host: { nativeCursorChanged: (visible) => events.push(visible) },
          profile,
          configuration: new NativeConfiguration({ profile }),
          random,
          motionLibrary: new MotionLibrary(game, { profile, random }),
          storage: { read: async () => null, write: async () => true },
        });
      },
      world = make();
    let restored;
    try {
      await world.initialize('main.kcs');
      const task = world.main,
        m = task.machine;
      assert.equal(world.input.textStatus, 2);
      await world.runtime.native('main', 0x193, [2, 0], m, task);
      world.input.key(2, true, 1);
      await world.input.tick(1);
      assert.equal(world.input.held[8], 0);
      await world.runtime.native('main', 0x194, [], m, task);
      await world.input.tick(2);
      assert.equal(world.input.held[8], 1);
      await world.runtime.native('main', 0x191, [0], m, task);
      assert.equal(world.input.cursorEnabled, 0);
      assert.equal(world.input.cursorVisible, true);
      assert.equal(events.at(-1), false);
      await world.runtime.native('main', 0x193, [79, 0xffffffff], m, task);
      restored = make();
      await restored.restore(structuredClone(world.snapshot()));
      assert.equal(restored.input.enabled[79], 0xffffffff);
      assert.equal(restored.input.cursorEnabled, 0);
      const input = world.objects.objects.get(world.root).implementation.input;
      assert.equal(await world.sendEngine(input, task.id, 148, 0, 128), NATIVE_UNWRITTEN_WORD);
      assert.equal(m.load(128), 1);
      assert.equal(await world.sendEngine(input, task.id, 136, 0, 0), 1);
      await world.runtime.native('main', 0x191, [1], m, task);
      assert.equal(events.at(-1), true);
    } finally {
      await world.close({ flushFiles: false });
      await restored?.close({ flushFiles: false });
    }
  });
