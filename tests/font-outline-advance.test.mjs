// SPDX-License-Identifier: MPL-2.0
import test from 'node:test';
import assert from 'node:assert/strict';
import { loadNativeFreeType } from '../src/native/font-backend.mjs';
import {
  fontOutlineBackend,
  fontOutlineProbe,
  glyphSummary,
} from './fixtures/font-outline-backend.mjs';
import { authoredOutlineTTF } from './fixtures/font-outline-ttf.mjs';

for (const version of ['2.4.8', '2.7.1']) {
  test(`${version} cached glyphs retain the full original advance domain and quantization`, async (t) => {
    let module;
    try {
      module = await loadNativeFreeType(version);
    } catch (error) {
      if (error.code !== 'ERR_MODULE_NOT_FOUND') throw error;
      t.skip('Prepare the pinned FreeType JS backends');
      return;
    }
    const backend = fontOutlineBackend(module);
    try {
      for (const [unitsPerEm, advanceWidth, size, expected] of [
        [1000, 0, 19, 0],
        [1000, 32767, 1000, 32767],
        [1000, 32768, 1000, 32768],
        [1000, 50000, 1000, 50000],
        [16, 60000, 9, 33750],
        [1000, 1234, 19, null],
        [1000, 65535, 9, null],
      ]) {
        const font = authoredOutlineTTF(2, { unitsPerEm, advanceWidth }),
          face = backend.open(font),
          reference = backend.open(font),
          code = 0x4e00,
          ordinary = glyphSummary(backend.glyph(reference, size, code));
        assert(ordinary.width > 0 && ordinary.height > 0);
        if (expected !== null) assert.equal(ordinary.advanceX, expected);
        if (expected === 50000)
          assert.equal(
            ordinary.alphaSHA256,
            '0c6f92942485cd442a5af6dc2ea7e84098a6375d1216bafcad7b66b845510dfd',
          );
        if (expected === 33750)
          assert.equal(
            ordinary.alphaSHA256,
            '52383dcb80999361080a9c58a049abbae36dc00b63a3495b5f7779d906ea3aaa',
          );
        // Measure populates the outline, but no public bitmap is produced.
        assert.equal(backend.advance(face, size, code), ordinary.advanceX);
        const hit = backend.glyph(face, size, code);
        assert.deepEqual(glyphSummary(hit), ordinary);
        await Promise.resolve();
        backend.glyph(reference, size, code + 1);
        assert.deepEqual(glyphSummary(hit.held()), ordinary);
        // The owned entry was consumed; a later uncached request is identical.
        assert.deepEqual(glyphSummary(backend.glyph(face, size, code)), ordinary);
        assert.equal(backend.advance(face, size, code), ordinary.advanceX);
        assert.deepEqual(glyphSummary(backend.glyph(face, size, code)), ordinary);
        backend.close(face);
        backend.close(reference);
        const fresh = backend.open(font);
        assert.equal(backend.advance(fresh, size, code), ordinary.advanceX);
        assert.deepEqual(glyphSummary(backend.glyph(fresh, size, code)), ordinary);
        backend.close(fresh);
      }
    } finally {
      backend.dispose();
    }
  });

  test(`${version} large advances use the owned hit and release its original metric`, async (t) => {
    const backend = await fontOutlineProbe(t, version);
    if (!backend) return;
    try {
      for (const [unitsPerEm, advanceWidth, size, expected] of [
        [1000, 50000, 1000, 50000],
        [16, 60000, 9, 33750],
      ]) {
        backend.reset();
        const face = backend.open(authoredOutlineTTF(2, { unitsPerEm, advanceWidth }));
        assert.equal(backend.advance(face, size, 0x4e00), expected);
        assert.equal(backend.stats().entries, 1);
        assert.equal(backend.stats().bitmapCalls, 0);
        assert.equal(backend.glyph(face, size, 0x4e00).advanceX, expected);
        assert.equal(backend.stats().bitmapCalls, 1);
        assert.equal(backend.stats().renderLoads, 0);
        assert.equal(backend.stats().entries, 0);
        assert.equal(backend.glyph(face, size, 0x4e00).advanceX, expected);
        assert.equal(backend.stats().renderLoads, 1);
        backend.close(face);
        assert.equal(backend.stats().outputs, 0);
        assert.equal(backend.stats().bytes, 0);
      }
    } finally {
      backend.dispose();
    }
  });
}
