// SPDX-License-Identifier: MPL-2.0
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { deflateSync } from 'node:zlib';
import { PNG } from '../src/formats/png.mjs';
import { decodeEffekseerTexture } from '../src/effekseer/texture-decoder.mjs';
import {
  convertEffekseerLevel0,
  EFFEKSEER_LEVEL0_PROFILE,
  effekseerLevel0Profile,
} from '../src/effekseer/texture-level0.mjs';

const fixtureRoot = new URL('./fixtures/effekseer-rgb-level0/', import.meta.url),
  fixture = JSON.parse(await readFile(new URL('native-cpu.json', fixtureRoot))),
  rgbProfile = { ...EFFEKSEER_LEVEL0_PROFILE, format: 22 };

for (const item of fixture.cases)
  test(`EFK RGB22 defined samples match the recorded discovery case: ${item.name}`, async () => {
    const source = await readFile(new URL(item.file, fixtureRoot)),
      before = Buffer.from(source),
      frame = await decodeEffekseerTexture(source);
    assert.equal(createHash('sha256').update(source).digest('hex'), item.sourceSHA256);
    assert.deepEqual(frame, {
      width: item.width,
      height: item.height,
      format: 22,
      rgba: Uint8Array.from(item.rgba),
    });
    assert.equal(Object.getPrototypeOf(frame.rgba), Uint8Array.prototype);
    assert.deepEqual(source, before);
  });

test('EFK RGB22 conversion ignores incoming fourth components, owns pixels and always samples opaque', async () => {
  for (const item of fixture.cases) {
    const png = new PNG(await readFile(new URL(item.file, fixtureRoot))),
      rgba = new Uint8Array(await png.decode());
    for (let i = 3; i < rgba.length; i += 4) rgba[i] = (i * 17) & 255;
    const before = new Uint8Array(rgba),
      frame = convertEffekseerLevel0({ width: png.width, height: png.height, rgba }, rgbProfile);
    assert.deepEqual(frame, {
      width: item.width,
      height: item.height,
      rgba: Uint8Array.from(item.rgba),
    });
    assert.notEqual(frame.rgba.buffer, rgba.buffer);
    assert.deepEqual(rgba, before);
  }
});

function chunk(type, data, validCRC = true) {
  const body = Buffer.concat([Buffer.from(type), data]),
    result = Buffer.alloc(data.length + 12);
  let crc = 0xffffffff;
  for (const byte of body) {
    crc ^= byte;
    for (let bit = 0; bit < 8; bit++) crc = crc & 1 ? 0xedb88320 ^ (crc >>> 1) : crc >>> 1;
  }
  result.writeUInt32BE(data.length);
  body.copy(result, 4);
  result.writeUInt32BE((crc ^ 0xffffffff ^ (validCRC ? 0 : 1)) >>> 0, result.length - 4);
  return result;
}
const word = (value) => {
  const b = Buffer.alloc(4);
  b.writeUInt32BE(value);
  return b;
};
function authoredPNG({ type = 6, before = [], after = [], interlace = 0 } = {}) {
  const header = Buffer.alloc(13);
  header.writeUInt32BE(1);
  header.writeUInt32BE(1, 4);
  header[8] = 8;
  header[9] = type;
  header[12] = interlace;
  return Buffer.concat([
    Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
    chunk('IHDR', header),
    ...before,
    chunk('IDAT', deflateSync(Buffer.from(type === 2 ? [0, 17, 93, 201] : [0, 17, 93, 201, 129]))),
    ...after,
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

test('generic PNG projects color metadata without applying a color transform to raw samples', async () => {
  const png = new PNG(authoredPNG({ before: [chunk('gAMA', word(100000))] }));
  assert.deepEqual(png.colorChunks, [
    { type: 'gAMA', size: 4, validCRC: true, afterPalette: false, afterData: false, value: 100000 },
  ]);
  assert.deepEqual(Array.from(await png.decode()), [17, 93, 201, 129]);
});

for (const type of [2, 6]) {
  test(`EFK type${type} admits the numeric no-gamma interval, including both integer boundaries`, async () => {
    for (const value of [43182, 44123, 45500, 47727]) {
      const frame = await decodeEffekseerTexture(
        authoredPNG({ type, before: [chunk('gAMA', word(value))] }),
      );
      assert.equal(frame.format, type === 2 ? 22 : 21);
      assert.deepEqual(Array.from(frame.rgba), [17, 93, 201, type === 2 ? 255 : 129]);
    }
  });
  test(`EFK type${type} rejects gamma transformation and the adjacent unsafe integers`, async () => {
    for (const value of [1, 43181, 47728, 100000, 0xffffffff])
      await assert.rejects(
        decodeEffekseerTexture(authoredPNG({ type, before: [chunk('gAMA', word(value))] })),
        /Unsupported Effekseer PNG color metadata/,
      );
  });
}

test('EFK rejects unresolved zero gamma, sRGB, duplicates, malformed length and ancillary CRC', async () => {
  for (const before of [
    [chunk('gAMA', word(0))],
    [chunk('sRGB', Buffer.from([0]))],
    [chunk('gAMA', word(45000)), chunk('sRGB', Buffer.from([0]))],
    [chunk('gAMA', word(45000)), chunk('gAMA', word(45000))],
    [chunk('gAMA', Buffer.from([1, 2, 3]))],
    [chunk('gAMA', word(45000), false)],
  ])
    await assert.rejects(
      decodeEffekseerTexture(authoredPNG({ before })),
      /Unsupported Effekseer PNG color metadata/,
    );
});

test('EFK rejects unproved color-chunk ordering after palette or image data', async () => {
  for (const options of [
    { before: [chunk('PLTE', Buffer.from([17, 93, 201])), chunk('gAMA', word(45000))] },
    { after: [chunk('gAMA', word(45000))] },
    { after: [chunk('sRGB', Buffer.from([0]))] },
  ])
    await assert.rejects(
      decodeEffekseerTexture(authoredPNG(options)),
      /Unsupported Effekseer PNG color metadata/,
    );
});

test('EFK RGB tRNS and unproved RGB Adam7 are explicit unsupported source domains', async () => {
  await assert.rejects(
    decodeEffekseerTexture(authoredPNG({ type: 2, before: [chunk('tRNS', Buffer.alloc(6))] })),
    /Unsupported Effekseer PNG transparency/,
  );
  await assert.rejects(
    decodeEffekseerTexture(authoredPNG({ type: 2, interlace: 1 })),
    /Unsupported Effekseer RGB interlace/,
  );
});

test('explicit texture profiles cannot reinterpret a source as the other physical format', async () => {
  await assert.rejects(
    decodeEffekseerTexture(authoredPNG({ type: 2 }), { profile: EFFEKSEER_LEVEL0_PROFILE }),
    /source format/,
  );
  await assert.rejects(
    decodeEffekseerTexture(authoredPNG(), { profile: rgbProfile }),
    /source format/,
  );
  await assert.rejects(
    decodeEffekseerTexture(new Uint8Array(0), { profile: { ...rgbProfile, format: 23 } }),
    /Unsupported Effekseer texture device profile/,
  );
});

test('the four current RGBA consumers retain raw samples in their proved no-transform metadata domain', async () => {
  for (const file of [
    'authored-spark.png',
    'public-1.23/Particle01.png',
    'public-1.23/Particle04_clear_hard.png',
    'public-1.23/Particle04_clear_soft.png',
  ]) {
    const bytes = await readFile(new URL(`./fixtures/effekseer/${file}`, import.meta.url)),
      png = new PNG(bytes),
      frame = await decodeEffekseerTexture(bytes);
    assert.equal(frame.format, 21);
    assert.equal(frame.width, png.width);
    assert.equal(frame.height, png.height);
    assert.deepEqual(frame.rgba, new Uint8Array(await png.decode()));
  }
});

// Expected RGB hash is from one original call after the implementation freeze.
test('EFK independent LaserMain02 RGB CPU holdout matches every defined channel hash', async () => {
  const recorded = JSON.parse(await readFile(new URL('holdout.json', fixtureRoot))),
    bytes = await readFile(new URL(recorded.file, fixtureRoot)),
    frame = await decodeEffekseerTexture(bytes),
    profile = effekseerLevel0Profile(frame.format),
    rgb = new Uint8Array(frame.width * frame.height * 3);
  assert.equal(createHash('sha256').update(bytes).digest('hex'), recorded.sourceSHA256);
  for (const field of ['width', 'height', 'format'])
    assert.equal(frame[field], recorded.descriptor[field]);
  for (const field of ['pool', 'usage', 'levels'])
    assert.equal(profile[field], recorded.descriptor[field]);
  assert.equal(frame.width * 4, recorded.descriptor.pitch);
  for (let pixel = 0; pixel < frame.width * frame.height; pixel++) {
    rgb.set(frame.rgba.subarray(pixel * 4, pixel * 4 + 3), pixel * 3);
    // This is the defined sample projection, never an observation of native X.
    assert.equal(frame.rgba[pixel * 4 + 3], recorded.sampledAlpha.value);
  }
  assert.equal(rgb.length, recorded.nativeRGBBytes);
  assert.equal(createHash('sha256').update(rgb).digest('hex'), recorded.nativeRGBSHA256);
  assert.equal(recorded.sampledAlpha.count, frame.width * frame.height);
  assert.equal(recorded.sampledAlpha.nativeAlphaObservations, 0);
  assert.equal(recorded.sampledAlpha.nativeGPUObserved, false);
});
