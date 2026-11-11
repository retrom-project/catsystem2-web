// SPDX-License-Identifier: MPL-2.0
// The old Plane receiver exposes button UV/state through the existing message
// interface. No executable instrumentation is installed by this fixture.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { engineFixtureSet } from '../fixtures/oracle-fixtures.mjs';
import { createTextureMemoryWorld } from '../fixtures/texture-clear-fixture.mjs';
import { installGraphicsOracle } from '../fixtures/graphics-oracle-world.mjs';
import { ScreenVectorGPU } from '../fixtures/screen-effects-fixture.mjs';
import { NativeGraphicsPacket } from '../../src/native/graphics-task.mjs';
import { floatBits } from '../../src/kcs.mjs';
import { kcsProgram } from '../helpers.mjs';
for (const fixture of await engineFixtureSet())
  test(
    fixture.profile + ' JS Plane button state preserves original selection and queries',
    {
      skip:
        !fixture.available ||
        (!fixture.profile.startsWith('sdk-') && !process.env.CATSYSTEM2_EMOTE_DLL),
    },
    async () => {
      const files = new Map([
        ['engine.exe', fixture.bytes],
        ['main.kcs', kcsProgram([[37, 1024], [43, 0xd1, 4], [59]])],
      ]);
      if (!fixture.profile.startsWith('sdk-'))
        files.set(
          'emotedriver.dll',
          new Uint8Array(await readFile(process.env.CATSYSTEM2_EMOTE_DLL)),
        );
      const worlds = [
          installGraphicsOracle(createTextureMemoryWorld(fixture.profile, files)),
          createTextureMemoryWorld(fixture.profile, files),
        ],
        ids = [];
      const send = (world, id, msg, words = [], w = 0, l = 0) =>
        world.sendEngine(id, world.main.id, msg, w, l, {
          payload: new NativeGraphicsPacket(words),
        });
      try {
        for (const world of worlds) {
          world.stageRenderer.gpu = new ScreenVectorGPU(16, 16);
          await world.initialize('main.kcs');
          const id = await world.objects.create({
            kind: 2,
            parent: world.root,
            nativeID: 0x300,
            name: 'Button',
          });
          ids.push(id);
          await send(world, id, 41, [0, 0, 0, floatBits(6), floatBits(5), 0, 0, 0xffffffff]);
          await send(world, id, 49, [1, 2, 300].map(floatBits));
          await send(world, id, 51, [8, 9, 0].map(floatBits));
          await send(world, id, 72, [1, 10, 11, 1, 20, 21, 1, 30, 31, 1, 40, 41]);
        }
        for (const [i, world] of worlds.entries()) {
          const hint = await world.objects.create({
            kind: 2,
            parent: world.root,
            nativeID: 0x301,
            name: 'Hint',
          });
          await send(world, hint, 42, [0, 0, 0, floatBits(4), floatBits(2), 0, 0, 0xffffffff]);
          await world.sendEngine(ids[i], world.main.id, 77, 0, 0x301);
          await world.sendEngine(ids[i], world.main.id, 78, 0, 1);
          world.input.x = 10;
          world.input.y = 12;
        }
        for (const phase of [0, 1, 2, 3, 0x80000001, 0x1234]) {
          const results = [];
          for (const [i, world] of worlds.entries()) {
            await world.sendEngine(ids[i], world.main.id, 73, 0, phase);
            const packet = new NativeGraphicsPacket();
            await world.sendEngine(ids[i], world.main.id, 62, 1, 0, { payload: packet });
            const hint = new NativeGraphicsPacket();
            await world.sendNativeEngine(0x301, world.main.id, 62, 0, 0, { payload: hint });
            results.push({
              hint: [hint.load(0), hint.load(4)],
              position: [packet.load(0), packet.load(4)],
              phase: await world.sendEngine(ids[i], world.main.id, 74),
            });
          }
          assert.deepEqual(results[1], results[0], 'phase ' + phase);
        }
      } finally {
        for (const world of worlds) await world.close({ flushFiles: false });
      }
    },
  );
