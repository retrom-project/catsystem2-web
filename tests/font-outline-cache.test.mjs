// SPDX-License-Identifier: MPL-2.0
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { NativeTextFonts, loadNativeFreeType } from '../src/native/font-backend.mjs';
import {
  fontOutlineProbe,
  fontOutlineBackend,
  glyphSummary,
} from './fixtures/font-outline-backend.mjs';
import { authoredOutlineCFF } from './fixtures/font-outline-cff.mjs';
import { authoredOutlineTTF } from './fixtures/font-outline-ttf.mjs';

const font = new Uint8Array(
    await readFile(new URL('../third_party/fonts/noto-sans-jp/NotoSansJP.ttf', import.meta.url)),
  ),
  bitmap = new Uint8Array(
    await readFile(new URL('./fixtures/font-outline-bitmap.bdf', import.meta.url)),
  ),
  golden = JSON.parse(
    await readFile(new URL('./fixtures/font-outline-golden.json', import.meta.url)),
  ),
  hash = (bytes) => createHash('sha256').update(bytes).digest('hex');
assert.equal(hash(font), golden.fontSHA256);
assert.equal(hash(bitmap), golden.bitmapSHA256);

for (const version of ['2.4.8', '2.7.1']) {
  test(`${version} six production exports preserve every glyph field and alpha hash`, async (t) => {
    let module;
    try {
      module = await loadNativeFreeType(version);
    } catch (error) {
      if (error.code !== 'ERR_MODULE_NOT_FOUND') throw error;
      t.skip('Prepare the pinned FreeType JS backends');
      return;
    }
    const backend = fontOutlineBackend(module),
      face = backend.open(font),
      mono = backend.open(bitmap);
    try {
      assert.equal(
        Object.keys(module).filter(
          (key) => key.startsWith('_cs2_font_') || ['_malloc', '_free'].includes(key),
        ).length,
        6,
      );
      for (const row of golden.versions.find((entry) => entry.version === version).rows) {
        const record = row.bitmap ? mono : face;
        assert.equal(backend.advance(record, row.size, row.code), row.advance);
        assert.deepEqual(glyphSummary(backend.glyph(record, row.size, row.code)), row.glyph);
      }
    } finally {
      backend.dispose();
    }
  });

  test(`${version} measurement keeps rendering late and close releases all owned glyphs`, async (t) => {
    const b = await fontOutlineProbe(t, version);
    if (!b) return;
    try {
      const face = b.open(font),
        codes = [65, 66, 32, 0x3042, 0x5b57];
      for (const code of codes) b.advance(face, 19, code);
      assert.equal(b.stats().entries, codes.length);
      assert.equal(b.stats().bitmapCalls, 0);
      assert.equal(b.stats().outputs, 0);
      for (const code of codes.reverse()) {
        const expected = golden.versions
          .find((entry) => entry.version === version)
          .rows.find((row) => row.size === 19 && row.code === code);
        assert.deepEqual(glyphSummary(b.glyph(face, 19, code)), expected.glyph);
      }
      assert.equal(b.stats().defaultLoads, 5);
      assert.equal(b.stats().renderLoads, 0);
      assert.equal(b.stats().bitmapCalls, 5);
      assert.equal(b.stats().entries, 0);
      b.close(face);
      assert.equal(b.stats().bytes, 0);
      assert.equal(b.stats().outputs, 0);
    } finally {
      b.dispose();
    }
  });

  test(`${version} sizes, matrices and charmaps invalidate measured outlines`, async (t) => {
    const b = await fontOutlineProbe(t, version);
    if (!b) return;
    try {
      const face = b.open(font),
        reference = b.open(font);
      b.advance(face, 19, 65);
      b.advance(face, 24, 66);
      assert.equal(b.stats().entries, 1);
      assert.deepEqual(
        glyphSummary(b.glyph(face, 19, 65)),
        glyphSummary(b.glyph(reference, 19, 65)),
      );
      assert.equal(b.stats().entries, 0);
      for (const matrix of [1, 2, 3]) {
        b.transform(face, matrix);
        b.transform(reference, matrix);
        b.advance(face, 19, 65);
        assert.equal(b.stats().entries, 0);
        assert.deepEqual(
          glyphSummary(b.glyph(face, 19, 65)),
          glyphSummary(b.glyph(reference, 19, 65)),
        );
      }
      b.transform(face, 0);
      b.transform(reference, 0);
      const valid = [];
      for (let index = 0; index < b.charmapCount(face); index++)
        if (b.charmap(face, index) === 0) valid.push(index);
      assert(valid.length >= 2);
      b.charmap(face, valid[0]);
      b.advance(face, 19, 65);
      b.charmap(face, valid[1]);
      b.charmap(reference, valid[1]);
      assert.deepEqual(
        glyphSummary(b.glyph(face, 19, 65)),
        glyphSummary(b.glyph(reference, 19, 65)),
      );
      assert.equal(b.stats().entries, 0);
      assert.equal(b.stats().bitmapCalls, 0);
    } finally {
      b.dispose();
    }
  });

  test(`${version} unsupported drivers retain their real load and render operations`, async (t) => {
    const b = await fontOutlineProbe(t, version);
    if (!b) return;
    try {
      const mono = b.open(bitmap),
        cff = b.open(authoredOutlineCFF()),
        reference = b.open(authoredOutlineCFF());
      assert.equal(b.driver(mono), 3);
      b.advance(mono, 8, 65);
      assert.equal(b.stats().entries, 0);
      assert.equal(b.glyph(mono, 8, 65).alpha.length, 64);
      assert.equal(b.stats().renderLoads, 1);
      assert.equal(b.driver(cff), 2);
      b.reset();
      b.advance(cff, 19, 65);
      assert.equal(b.stats().entries, version === '2.4.8' ? 0 : 1);
      assert.deepEqual(
        glyphSummary(b.glyph(cff, 19, 65)),
        glyphSummary(b.glyph(reference, 19, 65)),
      );
      assert.equal(b.stats().bitmapCalls, version === '2.4.8' ? 0 : 1);
      assert.equal(b.stats().renderLoads, version === '2.4.8' ? 2 : 1);
      if (version === '2.4.8') {
        b.reset();
        b.advance(cff, 19, 66);
        assert.equal(b.stats().entries, 0);
        assert(b.glyph(cff, 19, 66));
        assert.equal(b.stats().defaultLoads, 1);
        assert.equal(b.stats().renderLoads, 1);
        assert.equal(b.stats().bitmapCalls, 0);
        // The old interpreter derives random from stack addresses. Preserve
        // its actual path; no cross-call pixel equality is claimed for B.
      }
      const tt = b.open(font);
      b.advance(tt, 19, 65);
      assert.equal(b.stats().entries, 1);
      b.advance(mono, 8, 65);
      b.glyph(mono, 8, 65);
      assert.equal(b.stats().entries, 1);
      b.advance(cff, 19, 65);
      b.glyph(cff, 19, 65);
      assert.equal(b.stats().entries, 1);
      assert.deepEqual(
        glyphSummary(b.glyph(tt, 19, 65)),
        golden.versions
          .find((entry) => entry.version === version)
          .rows.find((row) => row.size === 19 && row.code === 65).glyph,
      );
      assert.equal(b.stats().entries, 0);
    } finally {
      b.dispose();
    }
  });

  test(`${version} allocation and cached-render failures recompute the complete request`, async (t) => {
    const b = await fontOutlineProbe(t, version);
    if (!b) return;
    const expected = golden.versions
      .find((entry) => entry.version === version)
      .rows.find((row) => row.size === 19 && row.code === 65).glyph;
    try {
      for (const failure of [1, 2, 3]) {
        const face = b.open(font);
        b.reset();
        if (failure !== 3) b.fault(failure);
        b.advance(face, 19, 65);
        if (failure === 3) b.fault(failure);
        assert.deepEqual(glyphSummary(b.glyph(face, 19, 65)), expected);
        assert.equal(b.stats().injectedFaults, 1);
        assert.equal(b.stats().renderLoads, 1);
        b.close(face);
        assert.equal(b.stats().entries, 0);
        assert.equal(b.stats().outputs, 0);
      }
      const face = b.open(font);
      b.advance(face, 19, 66);
      b.fault(4);
      assert.equal(b.advance(face, 19, 65), expected.advanceX);
      assert.deepEqual(glyphSummary(b.glyph(face, 19, 65)), expected);
      b.close(face);
      const empty = b.open(font);
      b.fault(4);
      assert.equal(b.advance(empty, 19, 65), 0);
      b.fault(4);
      assert.equal(b.glyph(empty, 19, 65), null);
    } finally {
      b.dispose();
    }
  });

  test(`${version} bounded eviction and independent face output lifetimes preserve pixels`, async (t) => {
    const b = await fontOutlineProbe(t, version);
    if (!b) return;
    try {
      const capacityFont = authoredOutlineTTF(),
        face = b.open(capacityFont),
        reference = b.open(capacityFont);
      let peakEntries = 0,
        rendered = 0;
      for (let index = 0; index < 180; index++) {
        const advance = b.advance(face, 19, 0x4e00 + index);
        if (index === 179) assert.equal(advance, 0); // Valid zero advance still owns an outline.
        peakEntries = Math.max(peakEntries, b.stats().entries);
        assert(b.stats().entries <= 128 && b.stats().bytes <= 2 * 1024 * 1024);
      }
      assert.equal(peakEntries, 128);
      for (let index = 0; index < 180; index++) {
        const cached = b.glyph(face, 19, 0x4e00 + index);
        if (cached) rendered++;
        assert.deepEqual(
          glyphSummary(cached),
          glyphSummary(b.glyph(reference, 19, 0x4e00 + index)),
        );
      }
      // Unicode entries can be missing or alias one glyph index. The cache
      // owns glyphs, not code points; compare every result and all real loads.
      const hits = b.stats().bitmapCalls;
      assert.equal(rendered, 180);
      assert.equal(hits, 128);
      assert.equal(b.stats().renderLoads, rendered * 2 - hits);
      b.advance(face, 19, 0x4e00);
      const a = b.glyph(face, 19, 0x4e00),
        pixels = glyphSummary(a);
      await Promise.resolve();
      b.advance(reference, 32, 0x4e01);
      b.glyph(reference, 32, 0x4e01);
      b.close(reference);
      assert.deepEqual(glyphSummary(a.held()), pixels);
      b.close(face);
      assert.equal(b.stats().entries, 0);
      assert.equal(b.stats().bytes, 0);
      assert.equal(b.stats().outputs, 0);
      const fresh = b.open(capacityFont);
      assert.deepEqual(glyphSummary(b.glyph(fresh, 19, 0x4e00)), pixels);
    } finally {
      b.dispose();
    }
  });
}

test('font public maps, replaced providers and cold state keep their observable order', async (t) => {
  const fonts = new NativeTextFonts({}, null, 'nekopara-vol3-engine-2.6.1.76'),
    f = { face: 'font.ttf', height: -19 },
    key = JSON.stringify([f.face, f.height, 65]);
  try {
    await fonts.ready();
  } catch (error) {
    if (error.code !== 'ERR_MODULE_NOT_FOUND') throw error;
    t.skip('Prepare the pinned FreeType JS backends');
    return;
  }
  fonts.open(f.face, font);
  const module = fonts.module,
    original = module._cs2_font_glyph;
  try {
    fonts.advance(f, 65);
    assert.equal(fonts.glyphs.size, 0);
    const injected = { marker: 'public entry' };
    fonts.glyphs.set(key, injected);
    assert.equal(fonts.glyphNative(f, 65), injected);
    fonts.glyphs.delete(key);
    const calls = [];
    module._cs2_font_glyph = function (...args) {
      calls.push('glyph');
      return Reflect.apply(original, this, args);
    };
    const glyph = fonts.glyphNative(f, 65);
    assert.deepEqual(calls, ['glyph']);
    assert(glyph.alpha.length > 0);
    const state = structuredClone(fonts.snapshot());
    fonts.restore(state);
    assert.deepEqual(fonts.snapshot(), state);
    assert.equal(fonts.glyphs.size, 0);
    assert.deepEqual(fonts.glyphNative(f, 65), glyph);
  } finally {
    module._cs2_font_glyph = original;
    fonts.close();
  }
});
