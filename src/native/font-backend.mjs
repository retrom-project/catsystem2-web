// SPDX-License-Identifier: MPL-2.0
import { nativeABI } from './abi/index.mjs';
import { NativeTextParser } from './text-parser.mjs';
import { nativeCategoryFilename, readNativeResource } from './resource-file.mjs';
const pending = new Map();
export function loadNativeFreeType(version) {
  const filename = version === '2.4.8' ? 'native_freetype_248.mjs' : 'native_freetype.mjs';
  if (!pending.has(version))
    pending.set(
      version,
      (async () => {
        let module;
        try {
          module = await import(new URL('../../vendor/' + filename, import.meta.url));
        } catch (error) {
          if (typeof document !== 'undefined' || error.code !== 'ERR_MODULE_NOT_FOUND') throw error;
          module = await import(
            new URL('../../.local/vendor/freetype/' + filename, import.meta.url)
          );
        }
        return module.default();
      })().catch((error) => {
        pending.delete(version);
        throw error;
      }),
    );
  return pending.get(version);
}
export class NativeTextFonts {
  constructor(source, world, profile) {
    Object.assign(this, { source, world, profile });
    this.fonts = new Map();
    this.glyphs = new Map();
  }
  async ready() {
    this.module ??= await loadNativeFreeType(nativeABI(this.profile).text.freeTypeVersion);
    await this.source.ready?.();
  }
  async prepareConfiguration(profile, mode, config) {
    await this.ready();
    const parser = new NativeTextParser({ profile, mode, glyphs: this });
    parser.config = config;
    const font = parser.font(new Int32Array(22));
    if (!font.backend) return;
    const key = font.face || 'default.ttf';
    if (this.fonts.has(key)) return;
    let bytes = null;
    if (this.world) {
      const path = nativeCategoryFilename(this.world.game, key, 'font');
      if (path !== null) bytes = await readNativeResource(this.world, path);
    }
    this.open(key, bytes);
  }
  open(key, bytes) {
    const m = this.module;
    if (!bytes) {
      this.fonts.set(key, { bytes: null, face: 0, input: 0 });
      return;
    }
    const input = m._malloc(bytes.length);
    m.HEAPU8.set(bytes, input);
    const face = m._cs2_font_open(input, bytes.length, 0);
    if (!face) {
      m._free(input);
      this.fonts.set(key, { bytes: bytes.slice(), face: 0, input: 0 });
    } else this.fonts.set(key, { bytes: bytes.slice(), face, input });
  }
  measure(font, text) {
    return this.source.measure(font, text);
  }
  glyph(font, character) {
    return this.source.glyph(font, character);
  }
  code(code) {
    if (nativeABI(this.profile).text.freeTypeCharacterEncoding !== 'cp932') return code & 65535;
    return (
      new TextDecoder('shift_jis')
        .decode(Uint8Array.from(code > 255 ? [code >>> 8, code & 255] : [code]))
        .charCodeAt(0) || 0
    );
  }
  advance(font, code) {
    const f = this.fonts.get(font.face || 'default.ttf');
    return f?.face
      ? this.module._cs2_font_advance(f.face, Math.abs(font.height), this.code(code))
      : 0;
  }
  glyphNative(font, code) {
    const key = JSON.stringify([font.face, font.height, code]);
    if (this.glyphs.has(key)) return this.glyphs.get(key);
    const f = this.fonts.get(font.face || 'default.ttf'),
      m = this.module;
    let glyph = null;
    if (f?.face) {
      const out = m._malloc(32);
      try {
        if (m._cs2_font_glyph(f.face, Math.abs(font.height), this.code(code), out)) {
          const [width, height, originX, originY, advanceX, pointer, pitch, pixelMode] =
              m.HEAP32.slice(out >>> 2, (out >>> 2) + 8),
            alpha = new Uint8Array(width * height);
          for (let y = 0; y < height; y++)
            for (let x = 0; x < width; x++)
              alpha[y * width + x] =
                pixelMode === 1
                  ? m.HEAPU8[pointer + y * pitch + (x >>> 3)] & (0x80 >>> (x & 7))
                    ? 255
                    : 0
                  : m.HEAPU8[pointer + y * pitch + x];
          glyph = { width, height, originX, originY, advanceX, alpha };
        }
      } finally {
        m._free(out);
      }
    }
    this.glyphs.set(key, glyph);
    while (this.glyphs.size > 4096) this.glyphs.delete(this.glyphs.keys().next().value);
    return glyph;
  }
  snapshot() {
    return [...this.fonts].map(([key, f]) => [key, f.bytes]);
  }
  restore(state) {
    this.close();
    for (const [key, bytes] of state) this.open(key, bytes);
  }
  close() {
    for (const f of this.fonts.values()) {
      if (f.face) this.module._cs2_font_close(f.face);
      if (f.input) this.module._free(f.input);
    }
    this.fonts.clear();
    this.glyphs.clear();
  }
}
