// SPDX-License-Identifier: MPL-2.0
import assert from 'node:assert/strict';
import { BlobFile, GameFiles } from '../../src/files.mjs';
import { NativeWorld } from '../../src/native/world.mjs';
import { NativeConfiguration } from '../../src/native/config.mjs';
import { parseNativeXML } from '../../src/native/xml.mjs';
import { ParticleRandom } from '../../src/ppi/random.mjs';
import { MotionLibrary } from '../../src/motion/library.mjs';
import { matchedPrimaryAudio } from './modern-primary-sound-world.mjs';

// Current typed counterpart of the original legacy Settings producer and
// Sound task. It does not claim a native PE/full Application host.
export async function legacyPrimaryLoopWorld(files, checkpoint) {
  const profile = 'rebellions-jp-engine-2.6.1.63',
    game = new GameFiles(
      new Map(
        Object.entries(files).map(([name, bytes]) => [name, new BlobFile(new Blob([bytes]))]),
      ),
    );
  await game.open();
  const configuration = new NativeConfiguration({
      profile,
      startup: parseNativeXML(files['startup.xml']),
      uiLanguage: 0x411,
    }),
    random = new ParticleRandom(),
    w = new NativeWorld({
      profile,
      game,
      configuration,
      random,
      images: {},
      host: {},
      motionLibrary: new MotionLibrary(game, { profile, random }),
      storage: { read: async () => null, write: async () => true },
      prepareSceneWorkers: false,
    }),
    audio = matchedPrimaryAudio(w);
  w.ensureNativeEngine = () => {
    throw new Error('Legacy primary current fixture attempted PE');
  };
  if (checkpoint) await w.restore(checkpoint);
  else {
    await w.initialize('main.kcs');
    await w.spawnScript('source.kcs');
  }
  const task = [...w.objects.objects.values()].find(
    (record) => record.kind === 12 && record.name === 'source.kcs',
  )?.implementation;
  assert(task);
  return { w, ...audio, task };
}
