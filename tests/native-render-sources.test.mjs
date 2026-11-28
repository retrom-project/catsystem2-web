// SPDX-License-Identifier: MPL-2.0
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { NativeWorld } from '../web/transitional-entry.mjs';
import { NativeConfiguration } from '../src/native/config.mjs';
import { MotionLibrary } from '../src/motion/library.mjs';
import { ParticleRandom } from '../src/ppi/random.mjs';
import { memoryGame } from './helpers.mjs';
import { renderSourceWorldFiles } from './fixtures/render-sources-fixture.mjs';
import {
  exerciseBitmapAlpha,
  exerciseRenderSourcesWorld,
  exerciseRenderSourceResize,
} from './fixtures/render-sources-world.mjs';

test(
  'SDK live KCS render sources retain Draw and resize identities through a fresh World',
  { skip: !process.env.CATSYSTEM2_SDK_EXE },
  async () => {
    const profile = 'sdk-4.01-engine-2.6.1.74',
      executable = new Uint8Array(await readFile(process.env.CATSYSTEM2_SDK_EXE)),
      { files, layout, rgba } = await renderSourceWorldFiles(profile, executable),
      make = () => {
        const game = memoryGame(Object.fromEntries(files)),
          configuration = new NativeConfiguration({ profile }),
          random = new ParticleRandom();
        game.width = 64;
        game.height = 48;
        game.nativeResources = { resolve: (name) => name };
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
          profile,
          random,
          configuration,
          images: {},
          host: {},
          motionLibrary: new MotionLibrary(game, { profile, random }),
          storage: { read: async () => null, write: async () => true },
        });
      };
    await exerciseRenderSourcesWorld(make, layout, rgba, assert);
    await exerciseRenderSourceResize(make, layout, assert);
    await exerciseBitmapAlpha(make, assert);
  },
);
