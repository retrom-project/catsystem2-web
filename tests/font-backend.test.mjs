// SPDX-License-Identifier: MPL-2.0
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { NativeTextFonts } from '../src/native/font-backend.mjs';
import { NATIVE_FREETYPE_SHA256 } from '../src/native/freetype-artifact.mjs';
const fontURL = new URL('../third_party/fonts/noto-sans-jp/NotoSansJP.ttf', import.meta.url);
test('the packaged GDI fallback is the reviewed OFL font', async () => {
  assert.equal(
    createHash('sha256')
      .update(await readFile(fontURL))
      .digest('hex'),
    'c2f3b4d463500a2ddcd3849cded1fceeb9fd6d1c32e6cbecd568453ba50fc68f',
  );
});
test('both pinned FreeType JS backends preserve font bytes and glyphs across restore without WebAssembly', async (t) => {
  for (const [name, hash] of Object.entries(NATIVE_FREETYPE_SHA256)) {
    let bytes;
    try {
      bytes = await readFile(new URL('../.local/vendor/freetype/' + name, import.meta.url));
    } catch (error) {
      if (error.code === 'ENOENT') {
        t.skip('Run scripts/prepare-native-freetype.py to build the fixed JS backends');
        return;
      }
      throw error;
    }
    assert.equal(createHash('sha256').update(bytes).digest('hex'), hash);
  }
  const bytes = new Uint8Array(await readFile(fontURL)),
    original = globalThis.WebAssembly;
  globalThis.WebAssembly = undefined;
  try {
    for (const [profile, width] of [
      ['sdk-4.01-engine-2.6.1.74', 7],
      ['nekopara-vol3-engine-2.6.1.76', 8],
    ]) {
      const first = new NativeTextFonts({}, null, profile),
        fresh = new NativeTextFonts({}, null, profile),
        font = { face: 'font.ttf', height: -12, weight: 400 };
      try {
        await first.ready();
        await fresh.ready();
        first.open('font.ttf', bytes);
        assert.equal(first.advance(font, 66), width);
        const glyph = first.glyphNative(font, 66),
          state = structuredClone(first.snapshot());
        fresh.restore(state);
        assert.deepEqual(fresh.glyphNative(font, 66), glyph);
        assert.deepEqual(fresh.snapshot(), state);
        assert.equal(fresh.advance({ ...font, face: 'missing.ttf' }, 66), 0);
      } finally {
        first.close();
        fresh.close();
      }
    }
  } finally {
    globalThis.WebAssembly = original;
  }
});
