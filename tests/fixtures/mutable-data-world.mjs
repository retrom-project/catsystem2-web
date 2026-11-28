// SPDX-License-Identifier: MPL-2.0
import { GameFiles } from '../../src/files.mjs';
import { NativeWorld } from '../../src/native/world.mjs';
import { NativeConfiguration } from '../../src/native/config.mjs';
import { parseNativeXML } from '../../src/native/xml.mjs';
import { ParticleRandom } from '../../src/ppi/random.mjs';
import { MotionLibrary } from '../../src/motion/library.mjs';
import { kcsProgram } from '../helpers.mjs';

export async function mutableDataWorld(
  profile,
  resources,
  { startup, storage, initialize = true } = {},
) {
  const files = new Map([['main.kcs', kcsProgram([[37, 240], [43, 71, 4], [59]])], ...resources]);
  const game = new GameFiles(
    new Map(
      [...files].map(([name]) => [
        name,
        {
          get size() {
            return files.get(name).length;
          },
          async read(offset, length) {
            return new Uint8Array(files.get(name).slice(offset, offset + length));
          },
        },
      ]),
    ),
  );
  await game.open();
  const random = new ParticleRandom();
  const world = new NativeWorld({
    profile,
    game,
    random,
    images: {},
    host: {},
    storage,
    configuration: new NativeConfiguration({
      profile,
      startup: parseNativeXML(new TextEncoder().encode(startup)),
      uiLanguage: 1033,
    }),
    motionLibrary: new MotionLibrary(game, { profile, random }),
    prepareSceneWorkers: false,
  });
  world.ensureNativeEngine = () => {
    throw new Error('Current data fixture cannot invoke an EXE');
  };
  if (initialize) await world.initialize('main.kcs');
  return { world, files };
}
