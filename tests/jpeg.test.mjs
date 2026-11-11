// SPDX-License-Identifier: MPL-2.0
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { decodeNativeJPEG } from '../src/formats/jpeg.mjs';
import { openImage } from '../src/formats/hg3.mjs';
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
