// SPDX-License-Identifier: MPL-2.0
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { NativeTextFonts, nativeGlyphRasterCache } from '../src/native/font-backend.mjs';
import { rasterTextGlyph } from '../src/native/text-raster.mjs';

async function open(t, profile = 'nekopara-vol3-engine-2.6.1.76') {
  const fonts = new NativeTextFonts({}, null, profile);
  try {
    await fonts.ready();
  } catch (error) {
    if (error.code !== 'ERR_MODULE_NOT_FOUND') throw error;
    t.skip('Prepare the pinned FreeType JS artifacts');
    return null;
  }
  fonts.open(
    'font.ttf',
    new Uint8Array(
      await readFile(new URL('../third_party/fonts/noto-sans-jp/NotoSansJP.ttf', import.meta.url)),
    ),
  );
  const parser = {
      glyphs: fonts,
      rasterFont: (row) => ({ face: 'font.ttf', height: -row[7], backend: 1 }),
    },
    // Forward the same current native glyph data through an ordinary unknown
    // provider. It must always take the uncached compositor path.
    reference = {
      ...parser,
      glyphs: { glyphNative: (font, code) => fonts.glyphNative(font, code) },
    },
    row = new Int32Array(22);
  row[1] = 66;
  row[2] = 0xff123456;
  row[3] = 0xff223344;
  row[6] = 25;
  row[7] = 25;
  row[13] = row[14] = 1;
  return { fonts, parser, reference, row };
}
function check(h, options) {
  const expected = rasterTextGlyph(h.reference, h.row, options);
  assert.deepEqual(rasterTextGlyph(h.parser, h.row, options), expected);
  assert.deepEqual(rasterTextGlyph(h.parser, h.row, options), expected);
  return expected;
}

for (const profile of ['sdk-4.01-engine-2.6.1.74', 'nekopara-vol3-engine-2.6.1.76'])
  test(`${profile} native raster reuse preserves colors, shadows and owned output`, async (t) => {
    const h = await open(t, profile);
    if (!h) return;
    try {
      for (const around of [0, 1])
        for (const rightdown of [0, 1])
          for (const padding of [0, 1, 2]) {
            h.row[13] = rightdown;
            h.row[14] = around;
            check(h, { padding });
          }
      for (const color of [0, 0x01123456, 0x7fabcdef, 0xffffffff]) {
        h.row[2] = color;
        h.row[3] = ~color;
        check(h);
      }
      const expected = check(h),
        first = rasterTextGlyph(h.parser, h.row),
        next = rasterTextGlyph(h.parser, h.row);
      first.rgba.fill(0xa3);
      first.rect.fill(-1);
      assert.deepEqual(next, expected);
      assert.deepEqual(rasterTextGlyph(h.parser, h.row), expected);
    } finally {
      h.fonts.close();
    }
  });

test('live alpha bytes, different views, native metrics and size changes are read each time', async (t) => {
  const h = await open(t);
  if (!h) return;
  try {
    check(h);
    const glyph = h.fonts.glyphNative(h.parser.rasterFont(h.row), h.row[1]),
      original = glyph.alpha,
      oldX = glyph.originX,
      index = original.findIndex((value) => value !== 0);
    assert.ok(index >= 0);
    original[index] ^= 255;
    check(h);
    original[index] ^= 255;
    check(h);
    const buffer = new ArrayBuffer(original.length * 2 + 7),
      first = new Uint8Array(buffer, 1, original.length),
      second = new Uint8Array(buffer, original.length + 4, original.length);
    first.set(original);
    second.set(original);
    second[index] ^= 255;
    glyph.alpha = first;
    check(h);
    glyph.alpha = second;
    check(h);
    glyph.alpha = original;
    glyph.originX++;
    check(h);
    glyph.originX = oldX;
    let reads = 0;
    for (const key of ['buffer', 'length', 'slice'])
      Object.defineProperty(original, key, {
        configurable: true,
        get() {
          reads++;
          throw new Error('native alpha metadata must use intrinsic access');
        },
      });
    check(h);
    assert.equal(reads, 0);
    for (const key of ['buffer', 'length', 'slice']) delete original[key];
    for (const size of [12, 18, 32, 25]) {
      h.row[7] = size;
      check(h);
    }
  } finally {
    h.fonts.close();
  }
});

test('unknown callbacks, accessor metrics and shared mutable inputs keep ordinary raster calls', async (t) => {
  const h = await open(t);
  if (!h) return;
  const glyph = h.fonts.glyphNative(h.parser.rasterFont(h.row), h.row[1]),
    original = glyph.alpha;
  try {
    check(h);
    const call = h.fonts.glyphNative;
    let calls = 0;
    h.fonts.glyphNative = function (...args) {
      calls++;
      return call.apply(this, args);
    };
    rasterTextGlyph(h.parser, h.row);
    rasterTextGlyph(h.parser, h.row);
    assert.equal(calls, 2);
    assert.equal(nativeGlyphRasterCache(h.fonts, glyph), null);
    delete h.fonts.glyphNative;
    let reads = 0;
    const x = glyph.originX;
    Object.defineProperty(glyph, 'originX', {
      configurable: true,
      get() {
        reads++;
        return x;
      },
    });
    rasterTextGlyph(h.parser, h.row);
    assert.equal(reads, 1, 'cache admission does not invoke the accessor');
    Object.defineProperty(glyph, 'originX', { configurable: true, writable: true, value: x });
    const shared = new Uint8Array(new SharedArrayBuffer(original.length));
    shared.set(original);
    glyph.alpha = shared;
    check(h);
    shared.fill(0);
    check(h);
    const resizable = new Uint8Array(
      new ArrayBuffer(original.length, { maxByteLength: original.length * 2 }),
    );
    resizable.set(original);
    glyph.alpha = resizable;
    const cache = nativeGlyphRasterCache(h.fonts, glyph),
      before = cache.entries.get(glyph);
    h.row[2] ^= 0x010101;
    check(h);
    assert.strictEqual(cache.entries.get(glyph), before, 'resizable input is not retained');
    glyph.alpha = original;
    h.row = new Int32Array(new SharedArrayBuffer(h.row.byteLength));
    h.row.set([0, 66, 0xff123456, 0xff223344, 0, 0, 25, 25]);
    check(h);
  } finally {
    glyph.alpha = original;
    h.fonts.close();
  }
});

test('close and cold font restore start a fresh native raster lifetime', async (t) => {
  const h = await open(t);
  if (!h) return;
  try {
    const expected = check(h),
      old = h.fonts.glyphNative(h.parser.rasterFont(h.row), h.row[1]),
      saved = h.fonts.snapshot();
    assert(nativeGlyphRasterCache(h.fonts, old).entries.size > 0);
    h.fonts.close();
    assert.equal(nativeGlyphRasterCache(h.fonts, old), null);
    h.fonts.restore(saved);
    const current = h.fonts.glyphNative(h.parser.rasterFont(h.row), h.row[1]);
    assert.notStrictEqual(current, old);
    assert.equal(nativeGlyphRasterCache(h.fonts, current).entries.size, 0);
    assert.deepEqual(check(h), expected);
    assert.deepEqual(h.fonts.snapshot(), saved);
  } finally {
    h.fonts.close();
  }
});

test('native raster content budgets evict and recompute without clipping legal glyphs', async (t) => {
  const h = await open(t);
  if (!h) return;
  try {
    const expected = check(h),
      first = h.fonts.glyphNative(h.parser.rasterFont(h.row), h.row[1]);
    for (let size = 6; size < 14; size++)
      for (let code = 33; code < 127; code++) {
        h.row[7] = size;
        h.row[1] = code;
        rasterTextGlyph(h.parser, h.row);
      }
    const cache = nativeGlyphRasterCache(h.fonts, first);
    assert.equal(cache.entries.size, 512);
    assert.equal(cache.entries.has(first), false);
    h.row[7] = 120;
    h.row[13] = h.row[14] = 0;
    for (let code = 33; code < 127; code++) {
      h.row[1] = code;
      rasterTextGlyph(h.parser, h.row, { padding: 256 });
    }
    assert(cache.bytes <= 4 * 1024 * 1024);
    assert(cache.entries.size < 512);
    h.row[1] = 66;
    h.row[7] = 25;
    h.row[13] = h.row[14] = 1;
    assert.deepEqual(check(h), expected);
    const ordinary = h.fonts.glyphNative(h.parser.rasterFont(h.row), h.row[1]),
      previous = cache.entries.get(ordinary);
    h.row[13] = h.row[14] = 0;
    const large = check(h, { padding: 1100 });
    assert(large.rgba.byteLength > 4 * 1024 * 1024);
    assert.equal(cache.entries.has(ordinary), false);
    assert(previous, 'the prior small raster was replaced rather than retaining a stale style');
  } finally {
    h.fonts.close();
  }
});
