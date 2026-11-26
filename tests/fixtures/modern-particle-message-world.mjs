// SPDX-License-Identifier: MPL-2.0
import { GameFiles, BlobFile } from '../../src/files.mjs';
import { NativeWorld } from '../../src/native/world.mjs';
import { NativeConfiguration } from '../../src/native/config.mjs';
import { ParticleRandom } from '../../src/ppi/random.mjs';
import { MotionLibrary } from '../../src/motion/library.mjs';
import { kcsProgram } from '../helpers.mjs';

export async function modernParticleMessageWorld(
  profile,
  files = {},
  { initialize = true, sceneLanguages = [] } = {},
) {
  const game = new GameFiles(
    new Map(
      Object.entries({
        'main.kcs': kcsProgram([[37, 240], [43, 71, 4], [59]]),
        ...files,
      }).map(([name, bytes]) => [name, new BlobFile(new Blob([bytes]))]),
    ),
  );
  await game.open();
  const random = new ParticleRandom(),
    world = new NativeWorld({
      profile,
      game,
      random,
      images: {},
      host: {},
      configuration: new NativeConfiguration({ profile }),
      sceneLanguages,
      motionLibrary: new MotionLibrary(game, { profile, random }),
      storage: { read: async () => null, write: async () => true },
      prepareSceneWorkers: false,
    });
  world.ensureNativeEngine = () => {
    throw Error('Particle message fixture attempted original EXE');
  };
  if (initialize) await world.initialize('main.kcs');
  return world;
}
