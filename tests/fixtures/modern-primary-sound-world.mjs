// SPDX-License-Identifier: MPL-2.0
import assert from 'node:assert/strict';
import { BlobFile, GameFiles } from '../../src/files.mjs';
import { NativeWorld } from '../../src/native/world.mjs';
import { NativeConfiguration } from '../../src/native/config.mjs';
import { NativeSoundConfiguration } from '../../src/native/sound-config.mjs';
import { ParticleRandom } from '../../src/ppi/random.mjs';
import { MotionLibrary } from '../../src/motion/library.mjs';
import { AudioMixer } from '../../src/audio.mjs';
import { encodeCP932 } from '../../src/kcs/strings.mjs';
import { parseNativeXML } from '../../src/native/xml.mjs';
import { modernParticleMessageWorld } from './modern-particle-message-world.mjs';
import { audioFixture, fixtureAudioBuffer } from './audio-context.mjs';
import { kcsProgram } from '../helpers.mjs';

export function primaryWAV(seed = 23) {
  const bytes = Buffer.alloc(64044);
  bytes.write('RIFF');
  bytes.writeUInt32LE(bytes.length - 8, 4);
  bytes.write('WAVEfmt ', 8);
  bytes.writeUInt32LE(16, 16);
  bytes.writeUInt16LE(1, 20);
  bytes.writeUInt16LE(1, 22);
  bytes.writeUInt32LE(8000, 24);
  bytes.writeUInt32LE(8000, 28);
  bytes.writeUInt16LE(1, 32);
  bytes.writeUInt16LE(8, 34);
  bytes.write('data', 36);
  bytes.writeUInt32LE(64000, 40);
  for (let i = 0; i < 64000; i++) bytes[44 + i] = (i * 17 + seed) & 255;
  return bytes;
}
export async function primarySoundWorld(version, program, checkpoint) {
  const profile = version === '74' ? 'sdk-4.01-engine-2.6.1.74' : 'nekopara-vol3-engine-2.6.1.76',
    source =
      '<?xml version="1.0" encoding="' +
      (version === '74' ? 'Shift_JIS' : 'UTF-8') +
      '"?><document><INT><int00><name>kcs</name><int></int><ext>kcs</ext><dir>scripts-loose</dir></int00>' +
      '<int01><name>sound</name><int></int><ext>wav</ext><dir>sound-loose</dir></int01></INT></document>',
    startup = version === '74' ? encodeCP932(source) : new TextEncoder().encode(source),
    wait = kcsProgram([[37, 240], [43, 71, 4], [59]]),
    w = await modernParticleMessageWorld(
      profile,
      {
        'main.kcs': wait,
        'scripts-loose/main.kcs': wait,
        'source.kcs': program,
        'scripts-loose/source.kcs': program,
        'startup.xml': startup,
        'config/startup.xml': startup,
        'sound-loose/owned.wav': primaryWAV(),
        'sound-loose/other.wav': primaryWAV(93),
      },
      { initialize: false, startup: parseNativeXML(startup) },
    ),
    audio = matchedPrimaryAudio(w);
  if (checkpoint) await w.restore(checkpoint);
  else {
    await w.initialize('main.kcs');
    await w.spawnScript('source.kcs');
  }
  const record = [...w.objects.objects.values()].find(
    (r) => r.kind === 12 && r.name === 'source.kcs',
  );
  assert(record);
  return { w, ...audio, task: record.implementation };
}

export function matchedPrimaryAudio(w) {
  const { context } = audioFixture(),
    decoded = [];
  // The independent native decoder produced these exact finite PCM8 samples.
  // This browser-context port supplies the same samples and an explicit media clock.
  context.decodeAudioData = async (data) => {
    const bytes = new Uint8Array(data),
      view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
    assert.equal(Buffer.from(bytes.subarray(0, 4)).toString(), 'RIFF');
    assert.equal(view.getUint16(20, true), 1);
    assert.equal(view.getUint16(22, true), 1);
    assert.equal(view.getUint16(34, true), 8);
    const frames = view.getUint32(40, true),
      rate = view.getUint32(24, true),
      buffer = fixtureAudioBuffer(1, frames, rate);
    assert.equal(bytes.length, frames + 44);
    for (let i = 0; i < frames; i++) buffer.getChannelData(0)[i] = (bytes[i + 44] - 128) / 128;
    decoded.push(bytes.slice(44));
    return buffer;
  };
  w.audio = w.sound.audio = new AudioMixer(w.game, context);
  return { context, decoded };
}

// A data-only World receives the same resource-authored initialized owner that
// the original Engine-class SoundConfig reader constructs in the native group.
export async function configuredPrimarySoundWorld(version, inputs, checkpoint) {
  const profile = version === '74' ? 'sdk-4.01-engine-2.6.1.74' : 'nekopara-vol3-engine-2.6.1.76',
    game = new GameFiles(
      new Map(
        Object.entries(inputs).map(([name, bytes]) => [name, new BlobFile(new Blob([bytes]))]),
      ),
    );
  await game.open();
  const source = await game.readCategory('primary.xml', 'config');
  assert(source);
  const configuration = new NativeConfiguration({
      profile,
      startup: parseNativeXML(inputs['startup.xml']),
      uiLanguage: 0x409,
    }),
    soundConfiguration = new NativeSoundConfiguration({
      profile,
      filename: 'primary.xml',
      document: parseNativeXML(source),
    }),
    random = new ParticleRandom(),
    w = new NativeWorld({
      profile,
      game,
      configuration,
      soundConfiguration,
      random,
      images: {},
      host: {},
      motionLibrary: new MotionLibrary(game, { profile, random }),
      storage: { read: async () => null, write: async () => true },
      prepareSceneWorkers: false,
    }),
    audio = matchedPrimaryAudio(w);
  w.ensureNativeEngine = () => {
    throw new Error('Current primary resource fixture attempted native PE');
  };
  if (checkpoint) await w.restore(checkpoint);
  else {
    await w.initialize('main.kcs');
    await w.spawnScript('source.kcs');
  }
  const record = [...w.objects.objects.values()].find(
    (r) => r.kind === 12 && r.name === 'source.kcs',
  );
  assert(record);
  return { w, ...audio, source, task: record.implementation };
}
