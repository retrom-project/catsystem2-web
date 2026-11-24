// SPDX-License-Identifier: MPL-2.0
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { deflateSync } from 'node:zlib';
import { decodeNativeJPEG } from '../src/formats/jpeg.mjs';
import { HG3, openImage } from '../src/formats/hg3.mjs';
import { ascii, u32 } from './helpers.mjs';
const fixture = JSON.parse(
  await readFile(new URL('./fixtures/native-jpeg-cases.json', import.meta.url)),
);
for (const sample of fixture.cases)
  test('native JPEG integer IFAST, physical BGR and logical rows ' + sample.name, async () => {
    const bytes = new Uint8Array(Buffer.from(sample.jpeg, 'base64')),
      expected = new Uint8Array(Buffer.from(sample.rgba, 'base64')),
      decoded = decodeNativeJPEG(bytes);
    assert.equal(decoded.width, sample.width);
    assert.equal(decoded.height, sample.height);
    assert.deepEqual(decoded.data, expected);
    const image = await openImage(bytes),
      frame = await image.decode(image.frame(0));
    for (let y = 0; y < sample.height; y++)
      assert.deepEqual(
        frame.rgba.slice(y * sample.width * 4, (y + 1) * sample.width * 4),
        new Uint8ClampedArray(
          expected.slice(
            (sample.height - 1 - y) * sample.width * 4,
            (sample.height - y) * sample.width * 4,
          ),
        ),
      );
    assert.throws(() => decodeNativeJPEG(bytes.subarray(0, bytes.length / 2)));
  });

test('HG3 JPEG applies alpha only when the original inflate count matches the frame', async () => {
  const sample = fixture.cases[0],
    { width, height } = sample,
    count = width * height,
    jpeg = Buffer.from(sample.jpeg, 'base64'),
    expected = Buffer.from(sample.rgba, 'base64'),
    alpha = Uint8Array.from({ length: count }, (_, i) => (i * 23) & 255);
  const tag = (name, bytes, final = false) => [
    ...ascii(name.padEnd(8, '\0')),
    ...u32(final ? 0 : bytes.length + 16),
    ...u32(bytes.length),
    ...bytes,
  ];
  const pixels = async (packed) => {
    const image = new HG3(
      Uint8Array.from([
        ...ascii('HG-3'),
        ...[12, 0x300, 0, 0].flatMap(u32),
        ...tag('stdinfo', [width, height, 32, 0, 0, width, height, 1, 0, 0].flatMap(u32)),
        ...tag('img_jpg', jpeg),
        ...tag('img_al', [...u32(packed.length), ...u32(count), ...packed], true),
      ]),
    );
    return (await image.decode(image.frame())).rgba;
  };
  const matching = deflateSync(alpha),
    noChecksum = matching.subarray(0, -4),
    mismatched = deflateSync(new Uint8Array(count + 5));
  for (const [packed, applyAlpha] of [
    [matching, true],
    [noChecksum, true],
    [mismatched, false],
  ]) {
    const rgba = await pixels(packed);
    for (let y = 0; y < height; y++)
      for (let x = 0; x < width; x++) {
        const source = (height - 1 - y) * width + x,
          offset = (y * width + x) * 4;
        assert.deepEqual(
          [...rgba.subarray(offset, offset + 4)],
          [
            ...expected.subarray(source * 4, source * 4 + 3),
            applyAlpha ? alpha[source] : expected[source * 4 + 3],
          ],
        );
      }
  }
});
