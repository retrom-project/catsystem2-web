// SPDX-License-Identifier: MPL-2.0
import test from 'node:test';
import assert from 'node:assert/strict';
import { NativeConfiguration } from '../src/native/config.mjs';
import { encodeCP932 } from '../src/kcs/strings.mjs';
import {
  nativeSoundPan,
  nativeSoundPanDecibels,
  nativeSoundPanGains,
  nativeSoundPanPosition,
  nativeSoundPositionPan,
  nativeSoundDecoderQuery,
  nativeLegacySoundIndex,
  nativeLegacySoundCategory,
  nativeLegacySoundGroup,
  nativePCMLevel,
} from '../src/native/sound-values.mjs';

test('native pan attenuates one channel and preserves the 3D position float path', () => {
  assert.equal(nativeSoundPan(150), 100);
  assert.equal(nativeSoundPan(-150), -100);
  assert.equal(nativeSoundPanDecibels(50), 1000);
  assert.equal(nativeSoundPanDecibels(-50), -1000);
  assert.deepEqual(nativeSoundPanGains(0), [1, 1]);
  assert.deepEqual(nativeSoundPanGains(50), [10 ** -0.5, 1]);
  assert.deepEqual(nativeSoundPanGains(-100), [1, 0.00001]);
  assert.deepEqual(nativeSoundPanPosition(100), [1, 0, 0]);
  const center = nativeSoundPanPosition(0);
  assert.equal(center[0], Math.fround(Math.cos(Math.fround(Math.PI / 2))));
  assert.equal(center[2], -1);
  assert.equal(nativeSoundPositionPan(1, 0), 100);
  assert.equal(nativeSoundPositionPan(-1, 0), -100);
  assert.equal(nativeSoundPositionPan(0, 1), 0);
});

test('native PCM level measures successive-frame differences with integer stereo averaging', () => {
  assert.equal(nativePCMLevel(Uint8Array.of(128, 128, 128, 128), 1, 8), 0);
  assert.equal(nativePCMLevel(Uint8Array.of(0, 255, 0, 255), 1, 8), 48960);
  const bytes = new Uint8Array(12),
    view = new DataView(bytes.buffer);
  [-32768, 0, 32767, 100, 0, -100].forEach((v, i) => view.setInt16(i * 2, v, true));
  assert.equal(nativePCMLevel(bytes, 2, 16), 16433);
  assert.equal(nativePCMLevel(bytes, 3, 16), 0);
  assert.throws(() => nativePCMLevel(new Uint8Array(0), 1, 16), /outside/);
});

test('native codec query preserves the original frame-versus-millisecond distinction', () => {
  const format = { pcmBytes: 176400, channels: 2, bitsPerSample: 16, sampleRate: 44100 };
  assert.equal(nativeSoundDecoderQuery({ codec: 'wav', ...format }), 44100);
  assert.equal(nativeSoundDecoderQuery({ codec: 'adpcm', ...format }), 1000);
  assert.equal(nativeSoundDecoderQuery({ codec: 'ogg', durationSeconds: 1.2349 }), 1234);
  assert.equal(nativeSoundDecoderQuery({ codec: 'adpcm', ...format, pcmBytes: 0xffffffff }), 97391);
  assert.throws(
    () => nativeSoundDecoderQuery({ codec: 'wav', ...format, channels: 0 }),
    /divides by zero/,
  );
  assert.throws(() => nativeSoundDecoderQuery({ codec: 'unknown' }), /Unrecovered/);
});

test('legacy sound classification prioritizes archive directory, then exact head prefixes', () => {
  for (const profile of ['sdk-4.01-engine-2.6.1.74', 'nekopara-vol3-engine-2.6.1.76']) {
    const config = new NativeConfiguration({ profile });
    const row = (i, head, category) => {
      config.blocks[0].set(encodeCP932(head), 20 + i * 116 + 40);
      config.blocks[0].set(encodeCP932(category), 20 + i * 116 + 84);
    };
    row(0, 'a_', 'pcm_a');
    row(1, 'a', 'bgm');
    row(2, 'B_', 'se');
    row(3, '声_', '音声');
    new DataView(config.blocks[0].buffer).setInt32(100, 23, true);
    new DataView(config.blocks[0].buffer).setInt32(216, 42, true);
    assert.equal(nativeLegacySoundIndex(config, 'A_file.ogg'), 0);
    assert.equal(nativeLegacySoundCategory(config, 'BGM.INT/a_file.ogg'), 'bgm');
    assert.equal(nativeLegacySoundCategory(config, 'PCM_A.INT\\unknown.ogg'), 'pcm_a');
    assert.equal(nativeLegacySoundCategory(config, './pcm_a/unknown.ogg'), '');
    assert.equal(nativeLegacySoundCategory(config, 'b_file.ogg'), '');
    assert.equal(nativeLegacySoundCategory(config, 'other/a_file.ogg'), '');
    assert.equal(nativeLegacySoundCategory(config, '声_file.ogg'), '音声');
    assert.equal(nativeLegacySoundCategory(config, '音声/unknown.ogg'), '音声');
    assert.equal(nativeLegacySoundGroup(config, 'other/A_file.ogg'), 23);
    assert.equal(nativeLegacySoundGroup(config, 'BGM.INT/unknown.ogg'), 42);
    assert.equal(nativeLegacySoundGroup(config, 'unknown.ogg'), -1);
  }
});
