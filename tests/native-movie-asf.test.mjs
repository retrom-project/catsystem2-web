// SPDX-License-Identifier: MPL-2.0
import assert from 'node:assert/strict';
import test from 'node:test';
import { readFile } from 'node:fs/promises';
import { asfHeaderSize, nativeASFProfile } from '../src/native/movie-asf.mjs';

const fixture = () => readFile(new URL('./fixtures/native-plane-movie.wmv', import.meta.url));
const profile = (source) => {
  const size = asfHeaderSize(source, source.length);
  return nativeASFProfile(
    source.subarray(0, size),
    source.subarray(size, size + 50),
    BigInt(source.length),
  );
};

test('the ASF stream directory preserves the Windows Media compressed video and audio formats', async () => {
  const source = await fixture(),
    { duration, streams } = profile(source),
    [video, audio] = streams;
  assert.equal(duration, 28930000n);
  assert.deepEqual(
    streams.map(({ number, kind, name, selected, maxSample, width, height }) => [
      number,
      kind,
      name,
      selected,
      maxSample,
      width,
      height,
    ]),
    [
      [1, 'video', 'video 1', true, 2304, 32, 24],
      [2, 'audio', 'audio 2', true, 512, 0, 0],
    ],
  );
  const format = (major, subtype, flags, type, length) => {
    const tail = [0x00100000, 0xaa000080, 0x719b3800];
    return [
      major,
      ...tail,
      subtype,
      ...tail,
      ...flags,
      type,
      0x11cec356,
      0xaa0001bf,
      0x5a595500,
      0,
      length,
      0,
    ];
  };
  assert.deepEqual(video.words, format(0x73646976, 0x32564d57, [0, 1, 0], 0x05589f80, 92));
  assert.deepEqual(audio.words, format(0x73647561, 0x161, [1, 0, 512], 0x05589f81, 28));
  assert.equal(
    Buffer.from(video.format).toString('hex'),
    '0000000000000000200000001800000000000000000000002000000018000000' +
      '801a06000000000000000000000000002c000000200000001800000001001800' +
      '574d56320000000000000000000000000000000000000000a186b480',
  );
  assert.equal(
    Buffer.from(audio.format).toString('hex'),
    '6101010080bb0000e02e0000000210000a0000000000010000000000',
  );
});

test('ASF requires complete bounded headers and a matching file ID on the data object', async () => {
  const source = await fixture(),
    headerSize = asfHeaderSize(source, source.length);
  assert.throws(() => asfHeaderSize(source.subarray(0, 29), source.length), /Missing ASF header/);
  assert.throws(() => asfHeaderSize(source, headerSize + 49), /Invalid ASF header size/);
  const withMismatch = Buffer.from(source);
  withMismatch[headerSize + 24] ^= 0xff;
  assert.throws(() => profile(withMismatch), /Mismatched ASF data file ID/);
  const withShortObject = Buffer.from(source);
  withShortObject.writeBigUInt64LE(23n, 30 + 16);
  assert.throws(() => profile(withShortObject), /Invalid ASF object size/);
});
