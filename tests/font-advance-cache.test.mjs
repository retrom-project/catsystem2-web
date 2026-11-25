// SPDX-License-Identifier: MPL-2.0
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { NativeTextFonts } from '../src/native/font-backend.mjs';

const profiles = ['sdk-4.01-engine-2.6.1.74', 'nekopara-vol3-engine-2.6.1.76'];
async function open(t, profile) {
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
  return fonts;
}

for (const profile of profiles) {
  test(`${profile} advance reuse preserves sizes and later glyph raster state`, async (t) => {
    const fonts = await open(t, profile);
    if (!fonts) return;
    try {
      const font = { face: 'font.ttf', height: -12 },
        expected = fonts.advance(font, 66);
      assert.equal(expected, profile.includes('.74') ? 7 : 8);
      const firstGlyph = structuredClone(fonts.glyphNative(font, 66));
      for (const height of [-32, -18, 12, -12, -24, 32, -12]) {
        font.height = height;
        const actual = fonts.advance(font, 66),
          direct = fonts.module._cs2_font_advance(
            fonts.fonts.get('font.ttf').face,
            Math.abs(height),
            fonts.code(66),
          );
        assert.equal(actual, direct);
        fonts.glyphNative({ ...font, height: -41 }, 67);
        assert.equal(fonts.advance(font, 66), actual);
      }
      font.height = -12;
      assert.deepEqual(fonts.glyphNative(font, 66), firstGlyph);
      assert.equal(fonts.advance(font, 66), expected);
      assert.equal(fonts.advance({ ...font, face: 'missing.ttf' }, 66), 0);
      assert.equal(fonts.advance(font, 0xffff), 0);
      assert.equal(fonts.advance(font, 0xffff), 0);
      assert(![...fonts.advances.get(fonts.fonts.get('font.ttf')).values.values()].includes(0));
      assert.equal(
        fonts.advance({ ...font, height: 0 }, 66),
        fonts.module._cs2_font_advance(fonts.fonts.get('font.ttf').face, 0, fonts.code(66)),
      );
    } finally {
      fonts.close();
    }
  });

  test(`${profile} close, reopen and cold restore do not retain old metric entries`, async (t) => {
    const fonts = await open(t, profile);
    if (!fonts) return;
    try {
      const font = { face: 'font.ttf', height: -24 },
        expected = fonts.advance(font, 66),
        saved = structuredClone(fonts.snapshot()),
        old = fonts.fonts.get('font.ttf');
      fonts.close();
      assert.equal(fonts.advance(font, 66), 0);
      fonts.restore(saved);
      assert.notStrictEqual(fonts.fonts.get('font.ttf'), old);
      assert.deepEqual(fonts.snapshot(), saved);
      assert.equal(fonts.advance(font, 66), expected);
      fonts.close();
      fonts.open('font.ttf', null);
      assert.equal(fonts.advance(font, 66), 0);
      fonts.restore(saved);
      assert.equal(fonts.advance(font, 66), expected);
    } finally {
      fonts.close();
    }
  });
}

test('unknown metric providers and replaced native functions keep their current calls', () => {
  const fonts = new NativeTextFonts({}, null, profiles[1]),
    calls = [],
    font = { face: 'font.ttf', height: -24 };
  let next = 0;
  fonts.module = {
    _cs2_font_advance(...args) {
      calls.push({ owner: this, args });
      return next++;
    },
  };
  fonts.fonts.set('font.ttf', { face: 123, input: 0, bytes: null });
  assert.equal(fonts.advance(font, 66), 0);
  assert.equal(fonts.advance(font, 66), 1);
  assert.equal(fonts.advance(font, 66), 2);
  assert.equal(calls.length, 3);
  assert(calls.every((call) => call.owner === fonts.module));
  assert(calls.every((call) => JSON.stringify(call.args) === '[123,24,66]'));
});

test('a wrapped or accessor native export is observed even after warming a real metric', async (t) => {
  const fonts = await open(t, profiles[1]);
  if (!fonts) return;
  const module = fonts.module,
    descriptor = Object.getOwnPropertyDescriptor(module, '_cs2_font_advance'),
    font = { face: 'font.ttf', height: -12 };
  try {
    fonts.advance(font, 66);
    let count = 0;
    module._cs2_font_advance = () => ++count;
    assert.equal(fonts.advance(font, 66), 1);
    assert.equal(fonts.advance(font, 66), 2);
    let reads = 0;
    Object.defineProperty(module, '_cs2_font_advance', {
      configurable: true,
      get() {
        reads++;
        return descriptor.value;
      },
    });
    assert.equal(fonts.advance(font, 66), 8);
    assert.equal(fonts.advance(font, 66), 8);
    assert.equal(reads, 2);
    Object.defineProperty(module, '_cs2_font_advance', descriptor);
    const glyph = module._cs2_font_glyph,
      cache = fonts.advances.get(fonts.fonts.get('font.ttf')),
      countBefore = cache.values.size;
    try {
      module._cs2_font_glyph = () => 0;
      assert.equal(
        fonts.advance({ ...font, height: -19 }, 67),
        descriptor.value(fonts.fonts.get('font.ttf').face, 19, 67),
      );
      assert.equal(cache.values.size, countBefore, 'unknown glyph-slot consumers bypass reuse');
    } finally {
      module._cs2_font_glyph = glyph;
    }
  } finally {
    Object.defineProperty(module, '_cs2_font_advance', descriptor);
    fonts.close();
  }
});

test('metric admission stays bounded and eviction recomputes the same real result', async (t) => {
  const fonts = await open(t, profiles[1]);
  if (!fonts) return;
  try {
    const font = { face: 'font.ttf', height: -8 },
      first = fonts.advance(font, 66);
    for (let size = 8; size < 72; size++) {
      font.height = -size;
      for (let code = 48; code < 123; code++) fonts.advance(font, code);
    }
    const record = fonts.fonts.get('font.ttf');
    assert.equal(fonts.advances.get(record).values.size, 4096);
    font.height = -8;
    assert.equal(fonts.advance(font, 66), first);
    assert.equal(fonts.advances.get(record).values.size, 4096);
  } finally {
    fonts.close();
  }
});
