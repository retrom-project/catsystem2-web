// SPDX-License-Identifier: MPL-2.0
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { M2LipSamples } from '../src/emote/m2-lip-samples.mjs';
import { nativeLPB, nativeLV } from './fixtures/native-lip.mjs';
const golden = JSON.parse(
  await readFile(new URL('./fixtures/native-lip-golden.json', import.meta.url)),
);
const words = (array) => [...new Uint32Array(array.buffer, array.byteOffset, array.length)];
test('JS lip sidecars match the existing original parser fixture, including ordered f32 smoothing', () => {
  for (const [kind, bytes] of [
    ['lpb', nativeLPB()],
    ['lv', nativeLV()],
  ]) {
    const sample = M2LipSamples.open(bytes, kind);
    assert.deepEqual(words(sample.values), golden[kind].values, kind);
    assert.deepEqual(words(sample.backup), golden[kind].backup, kind);
    sample.start = 12;
    assert.equal(sample.value(11), 0);
    assert.equal(sample.value(20), 0);
    assert.deepEqual(M2LipSamples.restore(sample.snapshot()).snapshot(), sample.snapshot());
  }
});
