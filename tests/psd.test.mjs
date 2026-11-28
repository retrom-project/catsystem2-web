// SPDX-License-Identifier: MPL-2.0
import test from 'node:test';
import assert from 'node:assert/strict';
import { PSD } from '../src/formats/psd.mjs';
import { openImage } from '../src/formats/hg3.mjs';

function composite({
  width = 3,
  height = 1,
  channels = 4,
  compression = 0,
  rows,
  depth = 8,
  mode = 3,
  version = 1,
  highDimensions = false,
  rowLength = 0xbeef,
} = {}) {
  const color = Uint8Array.of(7, 8),
    resources = Uint8Array.of(9, 10, 11),
    layers = Uint8Array.of(0, 0, 0, 2, 0, 0, 0, 0, 0, 0),
    body = rows ?? [10, 20, 30, 40, 50, 60, 70, 80, 90, 0, 127, 255],
    bytes = new Uint8Array(
      40 +
        color.length +
        resources.length +
        layers.length +
        (compression === 1 ? channels * height * 2 : 0) +
        body.length,
    ),
    view = new DataView(bytes.buffer);
  bytes.set([56, 66, 80, 83]);
  view.setUint16(4, version);
  view.setUint16(12, channels);
  view.setUint32(14, height + (highDimensions ? 0x10000 : 0));
  view.setUint32(18, width + (highDimensions ? 0x10000 : 0));
  view.setUint16(22, depth);
  view.setUint16(24, mode);
  let at = 26;
  for (const section of [color, resources, layers]) {
    view.setUint32(at, section.length);
    bytes.set(section, at + 4);
    at += section.length + 4;
  }
  view.setUint16(at, compression);
  at += 2;
  if (compression === 1)
    for (let n = 0; n < channels * height; n++, at += 2) view.setUint16(at, rowLength);
  bytes.set(body, at);
  return bytes;
}
const rgb = [10, 40, 70, 255, 20, 50, 80, 255, 30, 60, 90, 255];

test('PSD uses the merged RGB composite and the native opaque alpha despite a merged alpha channel', async () => {
  const image = await openImage(composite()),
    frame = await image.decode(image.frame());
  assert.deepEqual([frame.width, frame.height], [3, 1]);
  assert.deepEqual([...frame.rgba], rgb);
  // Both fixed original readers accept these header values and consume byte planes.
  for (const options of [
    { depth: 16 },
    { mode: 8 },
    { version: 99 },
    { highDimensions: true },
    { compression: 2 },
  ])
    assert.deepEqual([...new PSD(composite(options)).decode()], rgb);
});

test('native PSD PackBits ignores row-table lengths, consumes overflowing runs and treats 0x80 as repeat 129', () => {
  const image = new PSD(
    composite({
      compression: 1,
      channels: 3,
      width: 3,
      height: 2,
      rows: [0x80, 10, 2, 20, 21, 22, 0xfe, 40, 2, 50, 51, 52, 4, 70, 70, 70, 111, 112, 0xfe, 80],
    }),
  );
  assert.deepEqual(
    [...image.decode()],
    [
      10, 40, 70, 255, 10, 40, 70, 255, 10, 40, 70, 255, 20, 50, 80, 255, 21, 51, 80, 255, 22, 52,
      80, 255,
    ],
  );
  assert.equal(image.decode(), image.decode());
});

test('PSD rejects unsupported native headers and truncated sections or pixel runs', () => {
  assert.throws(() => new PSD(composite({ mode: 0 })), /color header/);
  assert.throws(() => new PSD(composite({ width: 0 })), /dimensions/);
  const bytes = composite();
  new DataView(bytes.buffer).setUint32(26, 0xffff);
  assert.throws(() => new PSD(bytes), /bounds|truncated|range/i);
  assert.throws(() => new PSD(composite({ rows: [1] })).decode(), /bounds|truncated|range/i);
  assert.throws(
    () => new PSD(composite({ compression: 1, rows: [0x80] })).decode(),
    /bounds|truncated|range/i,
  );
});
