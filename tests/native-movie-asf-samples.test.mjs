// SPDX-License-Identifier: MPL-2.0
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import { asfHeaderSize, nativeASFProfile } from '../src/native/movie-asf.mjs';
import { nativeASFSamples } from '../src/native/movie-asf-samples.mjs';

const fixture = (suffix = '') =>
  readFile(new URL(`./fixtures/native-plane-movie${suffix}.wmv`, import.meta.url));

function profile(bytes) {
  const size = asfHeaderSize(bytes, bytes.length);
  return nativeASFProfile(bytes.subarray(0, size), bytes.subarray(size, size + 50), bytes.length);
}

function sampleDigest(bytes, tracks, samples) {
  const hash = createHash('sha256'),
    header = Buffer.alloc(20);
  for (const track of tracks) {
    for (const { number, time, key, size, spans } of samples) {
      if (number !== track.number) continue;
      header.writeUInt32LE(number);
      header.writeBigInt64LE(time, 4);
      header.writeUInt32LE(Number(key), 12);
      header.writeUInt32LE(size, 16);
      hash.update(header);
      for (const { at, length } of spans) hash.update(bytes.subarray(at, at + length));
    }
  }
  return hash.digest('hex');
}

test('ASF media objects match the x86 synchronous reader in each compressed stream', async () => {
  for (const [suffix, count, fragments, hash] of [
    ['', 124, 0, '72a98c0f0cc3976ee5a9e92a121c7482331119e2e088412f3e4227d33695ac28'],
    ['-wmv-fragmented', 37, 6, 'f2088b13f8bb9d86948d4638e145c95a873623bc090603bb51d6bfd196899ce8'],
    ['-wmv-packed', 5, 0, '161e6b2340ee4e7334a99d3258e90dc48a191b615b913a58a0a799c89a47403c'],
  ]) {
    const bytes = await fixture(suffix),
      info = profile(bytes),
      samples = [...nativeASFSamples(bytes, info)];
    assert.equal(samples.length, count);
    assert.equal(samples.filter((sample) => sample.spans.length > 1).length, fragments);
    assert.equal(sampleDigest(bytes, info.streams, samples), hash);
  }
});

test('ASF packet bounds preserve video key positions and reject a missing first payload', async () => {
  const source = await fixture(),
    keys = [...nativeASFSamples(source, profile(source))].filter(
      (sample) => sample.number === 1 && sample.key,
    );
  assert.deepEqual(
    keys.map(({ time, packet }) => [time, packet]),
    [
      [430000n, 0],
      [6430000n, 3],
      [12430000n, 5],
      [18430000n, 8],
      [24430000n, 11],
    ],
  );
  const packed = await fixture('-wmv-packed'),
    info = profile(packed),
    beforePreroll = Buffer.from(packed),
    broken = Buffer.from(packed);
  // The first payload starts after the 14-byte packet header, and its
  // 8-byte replication record begins after seven payload-header bytes.
  beforePreroll.writeUInt32LE(3090, info.data.start + 25);
  assert.equal(nativeASFSamples(beforePreroll, info).next().value.time, 0n);
  // Each of the four payloads supplies its own length.
  broken.writeUInt16LE(0xffff, info.data.start + 5);
  assert.equal([...nativeASFSamples(broken, info)].length, 5);
  broken[info.data.start + 13] = 0x80;
  assert.throws(() => [...nativeASFSamples(broken, info)], /Invalid ASF packet payload count/);
});
