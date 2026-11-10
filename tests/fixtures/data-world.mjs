// SPDX-License-Identifier: MPL-2.0
import { NativeWorld } from '../../src/native/world.mjs';
import { NativeConfiguration } from '../../src/native/config.mjs';
import { MotionLibrary } from '../../src/motion/library.mjs';
import { ParticleRandom } from '../../src/ppi/random.mjs';
import { kcsProgram, memoryGame } from '../helpers.mjs';

export async function dataWorld(
  profile,
  files = {},
  { initialize = true, storage = { read: async () => null, write: async () => true } } = {},
) {
  const game = memoryGame({
      'case.kcs': kcsProgram([[37, 240], [43, 0x47, 4], [59]]),
      ...files,
    }),
    random = new ParticleRandom(),
    world = new NativeWorld({
      profile,
      game,
      random,
      host: {},
      images: {},
      configuration: new NativeConfiguration({ profile }),
      motionLibrary: new MotionLibrary(game, { profile, random }),
      storage,
    });
  world.ensureNativeEngine = () => {
    throw new Error('JS data native attempted to load the EXE');
  };
  if (initialize) await world.initialize('case.kcs');
  return world;
}
