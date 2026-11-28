// SPDX-License-Identifier: MPL-2.0
import test from 'node:test';
import assert from 'node:assert/strict';
import { deflateSync, crc32 } from 'node:zlib';
import { PNG } from '../src/formats/png.mjs';
import { openImage } from '../src/formats/hg3.mjs';
import { unpackKCLZ } from '../src/formats/raster.mjs';
const be32 = (value) => [value >>> 24, (value >>> 16) & 255, (value >>> 8) & 255, value & 255];
function chunk(type, bytes) {
  const body = Uint8Array.from([...new TextEncoder().encode(type), ...bytes]);
  return [...be32(bytes.length), ...body, ...be32(crc32(body))];
}
function png(width, height, depth, type, data, { interlace = 0, palette, transparency } = {}) {
  return Uint8Array.from([
    137,
    80,
    78,
    71,
    13,
    10,
    26,
    10,
    ...chunk('IHDR', [...be32(width), ...be32(height), depth, type, 0, 0, interlace]),
    ...(palette ? chunk('PLTE', palette) : []),
    ...(transparency ? chunk('tRNS', transparency) : []),
    ...chunk('IDAT', deflateSync(Uint8Array.from(data))),
    ...chunk('IEND', []),
  ]);
}
test('PNG preserves all RGBA samples through the five scanline filters, including transparent RGB', async () => {
  const bytes = png(
      2,
      5,
      8,
      6,
      [
        0, 255, 0, 0, 0, 0, 255, 0, 127, 1, 0, 0, 255, 255, 255, 255, 0, 2, 2, 1, 2, 4, 5, 11, 21,
        31, 39, 3, 2, 3, 5, 6, 14, 28, 42, 56, 4, 2, 4, 6, 8, 20, 40, 60, 80,
      ],
    ),
    image = await openImage(bytes),
    frame = await image.decode(image.frame());
  assert.deepEqual(
    [...frame.rgba],
    [
      255, 0, 0, 0, 0, 255, 0, 127, 0, 0, 255, 255, 255, 255, 255, 1, 1, 2, 3, 4, 10, 20, 30, 40, 2,
      4, 6, 8, 20, 40, 60, 80, 4, 8, 12, 16, 40, 80, 120, 160,
    ],
  );
});
test('PNG unpacks palettes and low-depth grayscale, compares transparency before truncating 16-bit samples', async () => {
  const palette = new PNG(
    png(4, 1, 2, 3, [0, 0x1b], {
      palette: [255, 0, 0, 0, 255, 0, 0, 0, 255, 255, 255, 255],
      transparency: [0, 128, 255],
    }),
  );
  assert.deepEqual(
    [...(await palette.decode())],
    [255, 0, 0, 0, 0, 255, 0, 128, 0, 0, 255, 255, 255, 255, 255, 255],
  );
  assert.deepEqual(
    [...(await new PNG(png(8, 1, 1, 0, [0, 0xaa])).decode())].filter((_, i) => i % 4 === 0),
    [255, 0, 255, 0, 255, 0, 255, 0],
  );
  assert.deepEqual(
    [
      ...(await new PNG(
        png(2, 1, 16, 0, [0, 0x12, 0x34, 0xab, 0xcd], { transparency: [0x12, 0x34] }),
      ).decode()),
    ],
    [0x12, 0x12, 0x12, 0, 0xab, 0xab, 0xab, 255],
  );
});
test('PNG Adam7 places the seven passes in the image without changing row order', async () => {
  const row = (ids) => [0, ...ids.flatMap((id) => [id, 0, 0, 255])],
    bytes = png(
      3,
      3,
      8,
      6,
      [...row([1]), ...row([3]), ...row([7, 9]), ...row([2]), ...row([8]), ...row([4, 5, 6])],
      { interlace: 1 },
    ),
    pixels = await new PNG(bytes).decode();
  assert.deepEqual(
    [...pixels].filter((_, i) => i % 4 === 0),
    [1, 2, 3, 4, 5, 6, 7, 8, 9],
  );
  const bad = bytes.slice();
  bad[17] ^= 1;
  assert.throws(() => new PNG(bad), /checksum/);
  await assert.rejects(new PNG(png(2, 2, 8, 6, [0, 1, 2, 3, 4])).decode(), /Inflated size/);
});
test('native BMP reads bottom-up rows with padding and its fixed pixel offset', async () => {
  const bytes = new Uint8Array(62),
    view = new DataView(bytes.buffer);
  bytes.set([66, 77]);
  view.setUint32(10, 100, true);
  view.setUint32(14, 40, true);
  view.setUint32(18, 1, true);
  view.setUint32(22, 2, true);
  view.setUint16(26, 1, true);
  view.setUint16(28, 24, true);
  bytes.set([255, 0, 0, 99, 0, 0, 255, 99], 54);
  const image = await openImage(bytes);
  assert.deepEqual([...(await image.decode(image.frame())).rgba], [255, 0, 0, 255, 0, 0, 255, 255]);
});
test('KCLZ decodes overlapping copies in every native length mode and rejects reads before its output', () => {
  for (let mode = 0; mode < 5; mode++) {
    const bytes = new Uint8Array(34),
      v = new DataView(bytes.buffer),
      code = (2 << (3 + mode)) | 3;
    bytes.set([75, 67, 76, 90]);
    v.setUint32(4, mode, true);
    v.setUint32(8, 9, true);
    v.setUint32(20, 28, true);
    v.setUint32(24, 29, true);
    bytes.set([8, 1, 2, 3, code & 255, code >>> 8], 28);
    assert.deepEqual([...unpackKCLZ(bytes)], [1, 2, 3, 1, 2, 3, 1, 2, 3]);
    bytes[28] = 1;
    assert.throws(() => unpackKCLZ(bytes), /back reference/);
  }
});
