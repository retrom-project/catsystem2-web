// SPDX-License-Identifier: MPL-2.0
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { PNG } from '../src/formats/png.mjs';
import { convertEffekseerLevel0 } from '../src/effekseer/texture-level0.mjs';

const fixtureRoot = new URL('./fixtures/effekseer-level0-holdout/', import.meta.url),
  fixture = JSON.parse(await readFile(new URL('native-cpu.json', fixtureRoot), 'utf8')),
  hash = (bytes) => createHash('sha256').update(bytes).digest('hex');

for (const item of fixture.cases)
  test(`level0 independent native CPU holdout: ${item.name}`, async () => {
    const bytes = await readFile(new URL(item.file, fixtureRoot));
    assert.equal(hash(bytes), item.sourceSHA256);
    const png = new PNG(bytes),
      rgba = await png.decode();
    assert.equal(png.width, item.sourceWidth);
    assert.equal(png.height, item.sourceHeight);
    assert.deepEqual(Array.from(rgba), item.sourceRGBA);
    assert.deepEqual(
      [...new Set(Array.from(rgba).filter((_, i) => i % 4 === 3))].sort((a, b) => a - b),
      [0, 1, 126, 129, 254, 255],
    );
    const result = convertEffekseerLevel0({ width: png.width, height: png.height, rgba });
    assert.equal(result.width, item.width);
    assert.equal(result.height, item.height);
    assert.deepEqual(Array.from(result.rgba), item.rgba);
    assert.deepEqual(Array.from(rgba), item.sourceRGBA);
    const bgra = new Uint8Array(result.rgba);
    for (let at = 0; at < bgra.length; at += 4) [bgra[at], bgra[at + 2]] = [bgra[at + 2], bgra[at]];
    assert.equal(hash(bgra), item.nativeBGRA_SHA256);
  });
