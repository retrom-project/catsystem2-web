// SPDX-License-Identifier: MPL-2.0
import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { decodeNativeMSADPCM } from '../src/native/audio-pcm.mjs';

const golden = JSON.parse(
  await readFile(new URL('./fixtures/native-ms-adpcm-golden.json', import.meta.url)),
);
const sha = (bytes) => createHash('sha256').update(bytes).digest('hex');

for (const row of golden.cases)
  test(`native MS ADPCM ${row.name} preserves original PCM and advertised length`, () => {
    const bytes = Buffer.from(row.wav, 'base64'),
      decoded = decodeNativeMSADPCM(bytes);
    assert.equal(sha(bytes), row.wavSha256);
    assert.equal(sha(decoded.pcm), row.pcmSha256);
    assert.equal(decoded.pcm.length, row.pcmBytes);
    assert.equal(decoded.advertisedBytes, row.advertisedBytes);
    assert.equal(
      Math.floor(
        (1000 * Math.floor(decoded.advertisedBytes / decoded.channels / 2)) / decoded.sampleRate,
      ),
      row.queryMilliseconds,
    );
    assert.equal(decoded.precision, 'native-ms-adpcm');
    for (const positioning of row.positioning)
      assert.deepEqual(
        [...decoded.pcm.subarray(0, positioning.count)],
        positioning.head,
        'native positioning restarts regardless of its requested target',
      );
  });

test('native MS ADPCM does not invent samples for an unowned predictor or a partial header', () => {
  const bytes = Buffer.from(golden.cases[0].wav, 'base64'),
    dataAt = bytes.indexOf('data') + 8,
    badPredictor = Buffer.from(bytes);
  badPredictor[dataAt] = 7;
  assert.throws(() => decodeNativeMSADPCM(badPredictor), /no owned coefficient/);
  const partial = bytes.subarray(0, dataAt + 12);
  partial.writeUInt32LE(12, dataAt - 4);
  assert.throws(() => decodeNativeMSADPCM(partial), /partial header has undefined samples/);
  assert.equal(decodeNativeMSADPCM(new Uint8Array(12)), null);
});
