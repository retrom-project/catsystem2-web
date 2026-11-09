// SPDX-License-Identifier: MPL-2.0
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { NativeWorld } from '../web/transitional-entry.mjs';
import { NativeConfiguration } from '../src/native/config.mjs';
import { NATIVE_SOUND_CONTROL as C } from '../src/native/sound.mjs';
import { MotionLibrary } from '../src/motion/library.mjs';
import { ParticleRandom } from '../src/ppi/random.mjs';
import { memoryGame, kcsProgram } from './helpers.mjs';

test(
  'SDK World PLV follows the unified 75 FPS clock and an external clock after fresh World restore',
  { skip: !process.env.CATSYSTEM2_SDK_EXE },
  async () => {
    const profile = 'sdk-4.01-engine-2.6.1.74',
      executable = new Uint8Array(await readFile(process.env.CATSYSTEM2_SDK_EXE)),
      make = (provider, mediaTime) => {
        const game = memoryGame({
            'engine.exe': executable,
            'main.kcs': kcsProgram([[37, 1024], [43, 0x47, 4], [59]]),
          }),
          random = new ParticleRandom(),
          configuration = new NativeConfiguration({ profile }),
          audio = { context: { currentTime: mediaTime }, channels: new Map(), stop() {} };
        configuration.screen.fps = 75;
        return new NativeWorld({
          game,
          random,
          configuration,
          audio,
          images: {},
          profile,
          host: provider ? { nativeTimeGetTime: provider } : {},
          motionLibrary: new MotionLibrary(game, { profile, random }),
          storage: { read: async () => null, write: async () => true },
        });
      },
      setPLV = (world) => {
        const control = world.sound.primary(world.main.id).controls[0],
          bytes = new Uint8Array(256),
          view = new DataView(bytes.buffer);
        for (let i = 0; i < 128; i++) view.setUint16(i * 2, 10 + i, true);
        control.plv = bytes;
        control.word(C.hasPLV, 1);
        control.word(C.plvCount, 128);
        control.word(C.plvStep, 10);
        control.word(C.wallStart, 0xffffffff);
        return control;
      },
      send = (world, message) =>
        world.sound.primary(world.main.id).message([world.main.id, message - 2, 0, 0]),
      virtual = make(null, 12345);
    let external,
      fresh,
      sourceTime = 0xfffffff0,
      restoredTime = 8000000;
    try {
      await virtual.initialize('main.kcs');
      const control = setPLV(virtual);
      await send(virtual, 217);
      const initial = virtual.clock.tickCount();
      assert.equal(control.word(C.wallStart), initial);
      for (let i = 0; i < 75; i++) await virtual.tick();
      assert.equal(virtual.clock.tickCount() - initial, 1000);
      assert.equal(await send(virtual, 212), 110);

      external = make(() => sourceTime, 2);
      await external.initialize('main.kcs');
      setPLV(external);
      await send(external, 217);
      sourceTime = 0x12;
      assert.equal(await send(external, 212), 13);
      const state = structuredClone(external.snapshot());
      fresh = make(() => restoredTime, 900000);
      await fresh.restore(state);
      assert.equal(fresh.sound.primary(fresh.main.id).controls[0].word(C.wallStart), 0xfffffff0);
      assert.equal(await send(fresh, 212), 13);
      restoredTime += 20;
      assert.equal(await send(fresh, 212), 15);
      assert.equal(await send(external, 212), 13);
    } finally {
      await fresh?.close({ flushFiles: false });
      await external?.close({ flushFiles: false });
      await virtual.close({ flushFiles: false });
    }
  },
);
