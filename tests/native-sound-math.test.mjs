// SPDX-License-Identifier: MPL-2.0
import test from 'node:test';
import assert from 'node:assert/strict';
import {
  nativeSoundDecibels,
  nativeSoundGain,
  nativeLoopFrames,
} from '../src/native/sound-math.mjs';

test('DirectSound volume uses integer composition, single precision and logarithmic attenuation', () => {
  assert.deepEqual(
    [0, 1, 25, 50, 75, 99, 100, 200].map((value) => nativeSoundDecibels(value)),
    [-10000, -6644, -2000, -1000, -415, -14, 0, 0],
  );
  assert.equal(nativeSoundDecibels(100, 50), -1000);
  assert.equal(nativeSoundDecibels(-1), 0);
  assert.equal(nativeSoundDecibels(0x40000000, 4), -10000);
  assert.equal(nativeSoundDecibels(1, 100, -123, -10), -123);
  assert.equal(nativeSoundDecibels(100, 100, -123, -10), -10);
  assert.equal(nativeSoundGain(50), 10 ** -0.5);
});

test('loop positions retain signed 64 bits and the native 22050 Hz special case', () => {
  assert.deepEqual(nativeLoopFrames(7n, 101n, 22050), { start: 3n, end: 50n });
  assert.deepEqual(nativeLoopFrames(-7n, -1n, 22050), { start: -3n, end: -1n });
  assert.deepEqual(nativeLoopFrames(7n, 101n, 44100), { start: 7n, end: 101n });
  assert.deepEqual(nativeLoopFrames(7n, 101n, 48000), { start: 7n, end: 101n });
  assert.deepEqual(nativeLoopFrames(0xffffffffffffffffn, 101n, 44100), { start: -1n, end: 101n });
});
