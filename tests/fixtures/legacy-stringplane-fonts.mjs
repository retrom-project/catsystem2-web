// SPDX-License-Identifier: MPL-2.0
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { NativeTextFonts } from '../../src/native/font-backend.mjs';
import { encodeCP932 } from '../../src/kcs/strings.mjs';

// Explicit virtual GDI host input, shared by the original and JS compositors.
// The masks come from the pinned font/FT2.4.8; they do not emulate Windows font selection.
export async function legacyStringPlaneFonts(profile) {
  const bytes = new Uint8Array(
      await readFile(
        new URL('../../third_party/fonts/noto-sans-jp/NotoSansJP.ttf', import.meta.url),
      ),
    ),
    fonts = new NativeTextFonts({}, null, profile),
    calls = [];
  await fonts.ready();
  fonts.open('stringplane.ttf', bytes);
  const normalized = (font) => ({
    ...font,
    face: 'stringplane.ttf',
    height: font.height || -8,
    backend: 1,
  });
  const originalGlyph = (font, character) => {
    assert.equal([...character].length, 1);
    const encoded = encodeCP932(character);
    assert(encoded.length === 1 || encoded.length === 2);
    const code = encoded.length === 2 ? (encoded[0] << 8) | encoded[1] : encoded[0],
      glyph = fonts.glyphNative(normalized(font), code);
    assert(glyph, 'fixed font must contain the requested glyph');
    assert(glyph.width <= 32 && glyph.height <= 32);
    return { ...glyph, advanceY: 0, alpha: glyph.alpha.slice() };
  };
  const port = {
    glyph(font, character) {
      const glyph = originalGlyph(font, character);
      calls.push({
        op: 'glyph',
        font,
        character,
        width: glyph.width,
        height: glyph.height,
        originX: glyph.originX,
        originY: glyph.originY,
        advanceX: glyph.advanceX,
        alphaBase64: Buffer.from(glyph.alpha).toString('base64'),
      });
      return glyph;
    },
    measure(font, text) {
      const records = [...text].map((c) => originalGlyph(font, c)),
        ascent = Math.max(0, ...records.map((g) => g.originY)),
        descent = Math.max(0, ...records.map((g) => g.height - g.originY)),
        result = {
          width: records.reduce((n, g) => n + g.advanceX, 0),
          height: ascent + descent,
          ascent,
          descent,
          averageWidth: originalGlyph(font, 'x').advanceX,
          maximumWidth: originalGlyph(font, 'W').advanceX,
        };
      calls.push({ op: 'measure', font, text, ...result });
      return result;
    },
  };
  return {
    port,
    calls,
    fontSHA256: createHash('sha256').update(bytes).digest('hex'),
    close: () => fonts.close(),
  };
}
