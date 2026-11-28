// SPDX-License-Identifier: MPL-2.0
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { deflateSync } from 'node:zlib';
import { decodeEffekseerTexture } from '../src/effekseer/texture-decoder.mjs';
import { EFFEKSEER_LEVEL0_PROFILE } from '../src/effekseer/texture-level0.mjs';

for (const directory of ['effekseer-level0', 'effekseer-level0-holdout']) {
  const root = new URL(`./fixtures/${directory}/`, import.meta.url),
    fixture = JSON.parse(await readFile(new URL('native-cpu.json', root)));
  for (const item of fixture.cases)
    test(`EFK PNG decoder follows recorded RGBA8 level0 bytes: ${item.name}`, async () => {
      const bytes = await readFile(new URL(item.file, root)),
        before = Buffer.from(bytes),
        frame = await decodeEffekseerTexture(bytes);
      assert.deepEqual(frame, {
        width: item.width,
        height: item.height,
        format: 21,
        rgba: Uint8Array.from(item.rgba),
      });
      assert.equal(Object.getPrototypeOf(frame.rgba), Uint8Array.prototype);
      assert.deepEqual(bytes, before);
    });
}

test('EFK default PNG decoder uses the real RGB source metadata and explicit format22', async () => {
  const bytes = await readFile(
      new URL('./fixtures/effekseer/public-1.23/LaserMain01.png', import.meta.url),
    ),
    frame = await decodeEffekseerTexture(bytes);
  assert.equal(bytes[24], 8);
  assert.equal(bytes[25], 2);
  assert.equal(frame.format, 22);
  assert.equal(frame.width, 64);
  assert.equal(frame.height, 256);
  for (let i = 3; i < frame.rgba.length; i += 4) assert.equal(frame.rgba[i], 255);
});

test('EFK PNG decoder rejects unknown profiles before any image decode', async () => {
  const profile = EFFEKSEER_LEVEL0_PROFILE;
  for (const field of Object.keys(profile))
    await assert.rejects(
      decodeEffekseerTexture(new Uint8Array(0), {
        profile: { ...profile, [field]: profile[field] + (field === 'format' ? 2 : 1) },
      }),
      /Unsupported Effekseer texture device profile/,
    );
  for (const value of [null, {}, { ...profile, unknown: 1 }])
    await assert.rejects(
      decodeEffekseerTexture(new Uint8Array(0), { profile: value }),
      /Unsupported Effekseer texture device profile/,
    );
});

test('EFK PNG decoder rejects unknown codecs and non-byte inputs', async () => {
  await assert.rejects(decodeEffekseerTexture(Uint8Array.from([66, 77, 0, 0, 0, 0, 0, 0])));
  for (const bytes of [null, new ArrayBuffer(8), []])
    await assert.rejects(decodeEffekseerTexture(bytes), TypeError);
});

function chunk(type, data) {
  const tag = Buffer.from(type),
    body = Buffer.concat([tag, data]),
    result = Buffer.alloc(data.length + 12);
  let crc = 0xffffffff;
  for (const byte of body) {
    crc ^= byte;
    for (let bit = 0; bit < 8; bit++) crc = crc & 1 ? 0xedb88320 ^ (crc >>> 1) : crc >>> 1;
  }
  result.writeUInt32BE(data.length);
  body.copy(result, 4);
  result.writeUInt32BE((crc ^ 0xffffffff) >>> 0, result.length - 4);
  return result;
}
test('EFK PNG decoder rejects valid but unproved 16-bit RGBA input', async () => {
  // Authored one-pixel PNG data, not a private/native source or output.
  const header = Buffer.alloc(13);
  header.writeUInt32BE(1);
  header.writeUInt32BE(1, 4);
  header[8] = 16;
  header[9] = 6;
  const bytes = Buffer.concat([
    Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
    chunk('IHDR', header),
    chunk('IDAT', deflateSync(Buffer.from([0, 0, 17, 0, 34, 0, 51, 0, 68]))),
    chunk('IEND', Buffer.alloc(0)),
  ]);
  await assert.rejects(
    decodeEffekseerTexture(bytes),
    /Unsupported Effekseer PNG layout: 16-bit\/type6/,
  );
});

test('EFK PNG decoder reports malformed image bytes without a fallback frame', async () => {
  const bytes = await readFile(
    new URL('./fixtures/effekseer-level0/npot-wide.png', import.meta.url),
  );
  bytes[bytes.length - 1] ^= 1;
  await assert.rejects(decodeEffekseerTexture(bytes), /checksum/);
});
