// SPDX-License-Identifier: MPL-2.0
import test from 'node:test';
import assert from 'node:assert/strict';
import { JSTextWriter } from '../src/native/text-core.mjs';

function glyph(code) {
  const record = new Int32Array(22);
  record[1] = code;
  record[12] = 100000;
  return record;
}
function writer(rgba, complete) {
  const value = Object.create(JSTextWriter.prototype),
    config = new Uint8Array(256),
    rows = [glyph(65)];
  Object.assign(value, {
    mode: 'utf8',
    pixels: { width: rgba.length / 4, height: 1, rgba },
    completePixels: complete,
    damage: [0, 0, 0, 0],
    baseFrame: 0,
    speedValue: 10,
    parser: { config, rows, parse() {}, c: (index) => ([3, 11, 31].includes(index) ? 1 : 0) },
    raster(record) {
      this.pixels.rgba.set([record[1], 83, 141, 190], 4);
      this.touch([1, 0, 2, 1]);
    },
  });
  return value;
}

for (const shared of [false, true])
  for (const offset of [0, 1])
    test(`text wipe RGB publication preserves the complete image and every exposed alpha: shared=${shared}, offset=${offset}`, async () => {
      const size = 36,
        backing = shared ? SharedArrayBuffer : ArrayBuffer,
        rgba = new Uint8ClampedArray(new backing(size + offset + 4), offset, size),
        complete = new Uint8ClampedArray(new backing(size + offset + 4), offset, size);
      for (let index = 0; index < size; index++) {
        rgba[index] = (index * 17 + 11) & 255;
        complete[index] = (index * 23 + 197) & 255;
      }
      for (let pixel = 0; pixel < size / 4; pixel++)
        rgba[pixel * 4 + 3] = [0, 1, 127, 128, 254, 255][pixel % 6];
      const visible = rgba.slice(),
        value = writer(rgba, complete);
      await value.draw(0);
      for (let pixel = 0; pixel < size; pixel += 4) {
        assert.deepEqual(
          rgba.subarray(pixel, pixel + 3),
          value.completePixels.subarray(pixel, pixel + 3),
        );
        assert.equal(rgba[pixel + 3], visible[pixel + 3]);
      }
      assert.deepEqual(value.damage, [1, 0, 2, 1]);
      // A later append still publishes complete RGB outside the glyph damage
      // while retaining independently changed visible alpha there.
      rgba.set([9, 8, 7, 6], size - 4);
      value.parser.rows.push(glyph(66));
      await value.draw(0);
      assert.deepEqual(rgba.subarray(size - 4, size - 1), complete.subarray(size - 4, size - 1));
      assert.equal(rgba[size - 1], 6);
      assert.equal(rgba[7], visible[7]);
      assert.equal(rgba[4], 66);
    });

test('first text wipe publication owns a complete backing and preserves a live visible image', async () => {
  const rgba = Uint8ClampedArray.of(21, 22, 23, 24, 31, 32, 33, 34, 41, 42, 43, 44),
    value = writer(rgba, null);
  await value.draw(0);
  assert.deepEqual(rgba, Uint8ClampedArray.of(21, 22, 23, 24, 65, 83, 141, 34, 41, 42, 43, 44));
  assert.notEqual(value.completePixels.buffer, rgba.buffer);
  assert.equal(value.completePixels[7], 190);
});
