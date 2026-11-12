// SPDX-License-Identifier: MPL-2.0
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { PNG } from '../src/formats/png.mjs';
import {
  EFFEKSEER_LEVEL0_PROFILE,
  effekseerLevel0Dimensions,
  convertEffekseerLevel0,
} from '../src/effekseer/texture-level0.mjs';

const fixtureRoot = new URL('./fixtures/effekseer-level0/', import.meta.url),
  fixture = JSON.parse(await readFile(new URL('native-cpu.json', fixtureRoot), 'utf8')),
  hash = (bytes) => createHash('sha256').update(bytes).digest('hex');

for (const item of fixture.cases)
  test(`level0 native CPU byte equality: ${item.name}`, async () => {
    const bytes = await readFile(new URL(item.file, fixtureRoot));
    assert.equal(hash(bytes), item.sourceSHA256);
    const png = new PNG(bytes),
      rgba = await png.decode();
    assert.equal(png.width, item.sourceWidth);
    assert.equal(png.height, item.sourceHeight);
    assert.deepEqual(Array.from(rgba), item.sourceRGBA);
    const result = convertEffekseerLevel0({ width: png.width, height: png.height, rgba });
    assert.equal(result.width, item.width);
    assert.equal(result.height, item.height);
    assert.deepEqual(Array.from(result.rgba), item.rgba);
    assert.deepEqual(Array.from(rgba), item.sourceRGBA);
    // This assertion also pins the fixture's channel reorder to native packed BGRA.
    const bgra = new Uint8Array(result.rgba);
    for (let at = 0; at < bgra.length; at += 4) [bgra[at], bgra[at + 2]] = [bgra[at + 2], bgra[at]];
    assert.equal(hash(bgra), item.nativeBGRA_SHA256);
  });

test('level0 fixture is the fixed six-call CPU capability domain', () => {
  assert.deepEqual(fixture.profile, EFFEKSEER_LEVEL0_PROFILE);
  assert.equal(fixture.provenance.originalCalls, 6);
  assert.equal(fixture.provenance.additionalCalls, 0);
  assert.equal(fixture.cases.length, 6);
  assert.equal(
    fixture.cases.reduce((sum, item) => sum + item.width * item.height, 0),
    57,
  );
  assert.equal(
    fixture.cases.reduce((sum, item) => sum + item.rgba.length, 0),
    228,
  );
});

test('level0 dimensions use upward POT followed by the fixed device limits', () => {
  assert.deepEqual(effekseerLevel0Dimensions(1, 1), { width: 1, height: 1 });
  assert.deepEqual(effekseerLevel0Dimensions(3, 5), { width: 4, height: 8 });
  assert.deepEqual(effekseerLevel0Dimensions(4095, 2049), { width: 4096, height: 4096 });
  assert.deepEqual(effekseerLevel0Dimensions(4097, 8193), { width: 4096, height: 4096 });
});

test('level0 rejects dimensions and device modes outside its declared domain', () => {
  for (const dimension of [0, -1, 0.5, NaN, Infinity, 0x4000001]) {
    assert.throws(() => effekseerLevel0Dimensions(dimension, 1), RangeError);
    assert.throws(() => effekseerLevel0Dimensions(1, dimension), RangeError);
  }
  for (const field of Object.keys(EFFEKSEER_LEVEL0_PROFILE))
    assert.throws(
      () =>
        effekseerLevel0Dimensions(3, 5, {
          ...EFFEKSEER_LEVEL0_PROFILE,
          [field]: EFFEKSEER_LEVEL0_PROFILE[field] + 1,
        }),
      /Unsupported Effekseer level0 device profile/,
    );
  assert.throws(() => effekseerLevel0Dimensions(1, 1, null), /Unsupported/);
});

test('level0 rejects incomplete decoded pixels before filtering', () => {
  for (const rgba of [null, [1, 2, 3, 4], new Uint8Array(3), new Uint8Array(5)])
    assert.throws(() => convertEffekseerLevel0({ width: 1, height: 1, rgba }), RangeError);
  assert.throws(
    () => convertEffekseerLevel0({ width: 8193, height: 8193, rgba: new Uint8Array(0) }),
    RangeError,
  );
});

for (const type of [Uint8Array, Uint8ClampedArray, Buffer])
  test(`level0 POT copy owns plain RGBA8 storage for ${type.name}`, () => {
    const rgba = type.from([255, 17, 93, 0]),
      result = convertEffekseerLevel0({ width: 1, height: 1, rgba });
    assert.equal(Object.getPrototypeOf(result.rgba), Uint8Array.prototype);
    assert.notEqual(result.rgba.buffer, rgba.buffer);
    assert.deepEqual(Array.from(result.rgba), [255, 17, 93, 0]);
    rgba[0] = 0;
    assert.equal(result.rgba[0], 255);
    result.rgba[1] = 255;
    assert.equal(rgba[1], 17);
  });

test('level0 filtered storage is independent of Buffer input and has no cached pixels', () => {
  const item = fixture.cases.find((item) => item.name === 'npot-wide'),
    rgba = Buffer.from(item.sourceRGBA),
    first = convertEffekseerLevel0({ width: item.sourceWidth, height: item.sourceHeight, rgba });
  assert.deepEqual(Array.from(rgba), item.sourceRGBA);
  assert.equal(Object.getPrototypeOf(first.rgba), Uint8Array.prototype);
  assert.notEqual(first.rgba.buffer, rgba.buffer);
  first.rgba.fill(0);
  const next = convertEffekseerLevel0({ width: item.sourceWidth, height: item.sourceHeight, rgba });
  assert.deepEqual(Array.from(next.rgba), item.rgba);
  rgba.fill(255);
  assert.deepEqual(Array.from(next.rgba), item.rgba);
});

test('level0 filtered zero image remains transparent black through repeated edge wrap', () => {
  const result = convertEffekseerLevel0({ width: 1, height: 3, rgba: new Uint8Array(12) });
  assert.deepEqual(result, { width: 1, height: 4, rgba: new Uint8Array(16) });
});
