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
      '6be405000000000000000000000000002c000000200000001800000001001800' +
      '574d56320000000000000000000000000000000000000000a186b480',
  );
  assert.equal(
    Buffer.from(audio.format).toString('hex'),
    '6101010080bb0000e02e0000000210000a0000000000010000000000',
  );
});

function profileFixture(source) {
  const originalSize = asfHeaderSize(source, source.length),
    objects = [];
  for (let at = 30; at < originalSize; ) {
    const end = at + Number(source.readBigUInt64LE(at + 16));
    objects.push(source.subarray(at, end));
    at = end;
  }
  return {
    objects,
    withObjects(parts, bitrate = 496000, maxPacket = 3200) {
      const headerSize = 30 + parts.reduce((sum, object) => sum + object.length, 0),
        bytes = Buffer.concat([source.subarray(0, 30), ...parts, source.subarray(originalSize)]);
      bytes.writeBigUInt64LE(BigInt(headerSize), 16);
      bytes.writeUInt32LE(parts.length, 24);
      bytes.writeBigUInt64LE(BigInt(bytes.length), 70);
      bytes.writeUInt32LE(maxPacket, 126);
      bytes.writeUInt32LE(bitrate, 130);
      return bytes;
    },
  };
}

const videoRates = (source) =>
  profile(source)
    .streams.filter((stream) => stream.kind === 'video')
    .map(({ number, format }) => [number, Buffer.from(format).readUInt32LE(32)]);

test('WMASF budgets packets and video frames in the original stream order', async () => {
  const { objects, withObjects } = profileFixture(await fixture()),
    [file, extension, tags, video, audio, codecs] = objects,
    silent = [file, extension, tags, video, codecs],
    secondVideo = Buffer.from(video),
    secondAudio = Buffer.from(audio);
  secondVideo.writeUInt16LE(3, 72);
  secondAudio.writeUInt16LE(3, 72);
  secondAudio.writeUInt32LE(8000, 86);
  for (const [parts, bitrate, packet, expected] of [
    [objects, 496000, 1000, [[1, 364672]]],
    [objects, 496000, 4096, [[1, 388293]]],
    [objects, 496000, 65536, [[1, 395445]]],
    [objects, 0, 3200, [[1, 250]]],
    [objects, 100000, 3200, [[1, 1547]]],
    [objects, 96000, 3200, [[1, 44940]]],
    [objects, 4294967295, 65536, [[1, 4290738450]]],
    [silent, 150000, 3200, [[1, 146368]]],
    [silent, 150001, 3200, [[1, 144329]]],
    [
      [file, extension, tags, secondVideo, video, audio, codecs],
      496000,
      3200,
      [
        [3, 386155],
        [1, 376805],
      ],
    ],
    [[file, extension, tags, video, secondAudio, audio, codecs], 496000, 3200, [[1, 386155]]],
    [[file, extension, tags, video, audio, secondAudio, codecs], 496000, 3200, [[1, 418155]]],
  ]) {
    assert.deepEqual(videoRates(withObjects(parts, bitrate, packet)), expected);
  }
});

test('WMASF subtracts packet overhead from a rate table and then applies extended stream data', async () => {
  const { objects, withObjects } = profileFixture(await fixture()),
    [file, extension, ...tracks] = objects,
    asfObject = (guid, body) => {
      const header = Buffer.alloc(24);
      Buffer.from(guid, 'hex').copy(header);
      header.writeBigUInt64LE(BigInt(header.length + body.length), 16);
      return Buffer.concat([header, body]);
    },
    rateTable = (...entries) => {
      const body = Buffer.alloc(2 + 6 * entries.length);
      body.writeUInt16LE(entries.length);
      entries.forEach(([stream, rate], i) => {
        body.writeUInt16LE(stream, 2 + 6 * i);
        body.writeUInt32LE(rate, 4 + 6 * i);
      });
      return asfObject('ce75f87b8d46d1118d82006097c9a2b2', body);
    },
    withExtension = (object) => {
      const body = Buffer.concat([extension.subarray(24), object]);
      body.writeUInt32LE(body.length - 22, 18);
      return asfObject('b503bf5f2ea9cf118ee300c00c205365', body);
    };
  for (const [entries, expected] of [
    [[], 0],
    [[[1, 600]], 0],
    [[[2, 22000]], 0],
    [[[1, 150000]], 142690],
    [[[1, 175000]], 165650],
    [
      [
        [1, 360000],
        [2, 22000],
      ],
      350650,
    ],
    [
      [
        [1, 360000],
        [1, 400000],
      ],
      390650,
    ],
  ]) {
    assert.deepEqual(videoRates(withObjects([...objects, rateTable(...entries)])), [[1, expected]]);
  }
  const rates = rateTable([1, 360000], [2, 22000]);
  assert.deepEqual(videoRates(withObjects([file, withExtension(rates), ...tracks])), [[1, 350650]]);
  for (const rate of [0, 123456, 387000]) {
    const extended = Buffer.alloc(64);
    extended.writeUInt32LE(rate, 16);
    extended.writeUInt16LE(1, 48);
    const object = asfObject('cba5e61472c632438399a96952065b5a', extended);
    assert.deepEqual(videoRates(withObjects([file, withExtension(object), ...tracks, rates])), [
      [1, rate],
    ]);
  }
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
