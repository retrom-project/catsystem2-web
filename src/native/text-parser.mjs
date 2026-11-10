// SPDX-License-Identifier: MPL-2.0
// Incremental source decoding, style state and integer glyph layout.
import { textProfiles, utf8TextProfiles } from './text-profile-data.mjs';
import { scanNativeText, nativeTextUnits } from './text-scanner.mjs';
import { layoutText, textControl, textVisible } from './text-layout.mjs';
import { encodeCP932 } from '../kcs/strings.mjs';
import { nativeABI } from './abi/index.mjs';
const join = (a, b) => {
  const out = new Uint8Array(a.length + b.length);
  out.set(a);
  out.set(b, a.length);
  return out;
};
const narrow = new TextDecoder('shift_jis');
export function parserDefaults(profile, mode = 'cp932') {
  const bytes = new Uint8Array(
      nativeABI(profile).layouts.textCores[mode === 'nv' ? 'cp932' : mode].configSize,
    ),
    v = new DataView(bytes.buffer),
    set = (i, n) => v.setUint32(i * 4, n >>> 0, true);
  set(1, 800);
  set(2, 600);
  set(3, -1);
  set(4, 0xff000000);
  set(5, -1);
  for (let i = 6; i <= 10; i++) set(i, 20);
  for (let i = 11; i <= 15; i++) set(i, 10);
  set(23, 2);
  set(24, 1);
  set(25, 1);
  return bytes;
}
export class NativeTextParser {
  constructor({ profile, mode = 'cp932', glyphs, rate = 0, config } = {}) {
    Object.assign(this, { profile, mode, glyphs, rate });
    this.config = parserDefaults(profile, mode);
    this.source = new Uint8Array();
    this.rawCursor = 0;
    this.units = [];
    this.rows = [];
    this.shift = [0, 0];
    this.cachedEnd = [0, 0];
    this.highest = 0;
    this.dirty = true;
    this.scanner = null;
    this.profiles = (this.utf8 ? utf8TextProfiles : textProfiles).map((values) => new Set(values));
    if (config) this.configure(config);
  }
  c(index) {
    return index >= 3
      ? new DataView(this.config.buffer, this.config.byteOffset, this.config.byteLength).getInt32(
          (index - 3) * 4,
          true,
        )
      : 0;
  }
  get utf8() {
    return this.mode === 'utf8';
  }
  font(record) {
    const wide = nativeABI(this.profile).text.settingsCharacterBytes === 2,
      bytes = this.config.subarray(128, 128 + (this.utf8 ? 128 : wide ? 64 : 32));
    let face = '';
    if (wide) {
      const v = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
      for (let i = 0; i + 1 < bytes.length; i += 2) {
        const n = v.getUint16(i, true);
        if (!n) break;
        face += String.fromCharCode(n);
      }
    } else
      face = narrow.decode(bytes.subarray(0, bytes.includes(0) ? bytes.indexOf(0) : bytes.length));
    const at = 128 + bytes.length,
      v = new DataView(this.config.buffer, this.config.byteOffset, this.config.byteLength);
    return {
      face,
      height: -record[7],
      width: 0,
      weight: v.getInt32(at, true),
      escapement: 0,
      orientation: 0,
      italic: 0,
      backend: v.getInt32(at + 20, true),
      fixed: v.getInt32(at + 12, true),
    };
  }
  resetStyle() {
    this.scanner = null;
    this.cachedEnd = [0, 0];
    this.highest = 0;
    this.dirty = true;
  }
  configure(bytes) {
    if (bytes.length !== this.config.length)
      throw new Error('Native text parser configuration size differs');
    this.config = bytes.slice();
    this.rawCursor = 0;
    this.resetStyle();
    this.rows = [];
    this.scan();
    this.layout();
  }
  append(bytes) {
    bytes = bytes.subarray(0, bytes.includes(0) ? bytes.indexOf(0) : bytes.length);
    this.source = join(this.source, bytes);
    const decoded = nativeTextUnits(this.source.subarray(this.rawCursor), this.utf8);
    this.units.push(...decoded);
    this.rawCursor = this.source.length;
    this.dirty = true;
  }
  appendText(text) {
    return this.append(this.utf8 ? new TextEncoder().encode(text) : encodeCP932(text));
  }
  scan() {
    const config = [
        0,
        0,
        0,
        ...new Int32Array(this.config.buffer, this.config.byteOffset, this.config.length / 4),
      ],
      result = scanNativeText(this.units, {
        utf8: this.utf8,
        parse: Boolean(this.c(27)),
        ruby: Boolean(this.c(28)),
        config,
        rate: this.rate,
        state: this.scanner,
      });
    for (const r of result.records) {
      const row = textControl(r.code);
      row[2] = r.color;
      row[3] = r.shadow;
      row[4] = r.x;
      row[5] = r.y;
      row[7] = r.size;
      row[9] = Number(r.mode === 2);
      row[10] = r.group;
      row[11] = r.revealTime;
      row[13] = this.shadow(0);
      row[14] = this.shadow(1);
      row[20] = r.depth;
      row[21] = r.unicode;
      this.rows.push(row);
    }
    this.scanner = result.state;
  }
  rasterFont(r) {
    const font = this.font(r);
    if (!font.backend && r[20] > 0) {
      const units = this.scanner?.contexts?.[r[20] - 1];
      if (units?.length) {
        if (this.utf8) font.face = String.fromCharCode(...units);
        else {
          const bytes = [];
          for (const n of units) {
            if (n > 255) bytes.push(n >> 8);
            bytes.push(n & 255);
          }
          font.face = narrow.decode(Uint8Array.from(bytes));
        }
      }
    }
    return font;
  }
  shadow(index) {
    const wide = nativeABI(this.profile).text.settingsCharacterBytes === 2,
      fontBytes = this.utf8 ? 128 : wide ? 64 : 32;
    return new DataView(
      this.config.buffer,
      this.config.byteOffset,
      this.config.byteLength,
    ).getInt32(128 + fontBytes + 4 + index * 4, true);
  }
  character(r) {
    return r[21]
      ? String.fromCharCode(r[1])
      : narrow.decode(Uint8Array.from(r[1] > 255 ? [r[1] >>> 8, r[1] & 255] : [r[1]]));
  }
  width(r) {
    if (!textVisible(r) && !(this.utf8 && this.hasASCII && r[21])) return 0;
    const font = this.font(r),
      double = r[1] > 255,
      fixed = double ? !this.c(34) || font.fixed : font.fixed;
    if (font.backend) return this.glyphs.advance(font, r[1]);
    if (double && fixed) return r[7];
    const measuredCharacter =
      this.utf8 && !double
        ? String.fromCharCode(r[1])
        : narrow.decode(Uint8Array.from(r[1] > 255 ? [r[1] >>> 8, r[1] & 255] : [r[1]]));
    const metric = this.glyphs.measure(font, measuredCharacter);
    const measured = metric?.width;
    return Number.isFinite(measured)
      ? fixed
        ? Math.max(measured, (r[7] + 1) >>> 1)
        : measured
      : double
        ? r[7]
        : (r[7] + 1) >>> 1;
  }
  layout() {
    this.hasASCII = this.rows.some((r) => textVisible(r) && r[1] < 256);
    for (const r of this.rows) r[6] = this.width(r);
    const result = layoutText(this.rows, (i) => this.c(i), {
      shift: this.shift,
      profiles: this.profiles,
      cachedEnd: this.cachedEnd,
    });
    this.cachedEnd = result.cachedEnd;
    this.highest = result.highest;
    this.dirty = false;
  }
  reflow() {
    const states = this.rows.map((r) => r[15]);
    this.scanner = null;
    this.rows = [];
    this.scan();
    this.layout();
    if (states.length === this.rows.length)
      states.forEach((state, i) => (this.rows[i][15] = state));
  }
  parse() {
    if (!this.dirty) return false;
    this.scan();
    this.layout();
    return true;
  }
  mark() {
    this.scan();
    this.rows.push(textControl(65535));
    this.dirty = true;
  }
  clear() {
    this.source = new Uint8Array();
    this.rawCursor = 0;
    this.units = [];
    this.rows = [];
    this.resetStyle();
  }
  lineCount() {
    this.parse();
    let count = 1,
      last = false;
    for (const r of this.rows)
      if (r[1] === 0) {
        count++;
        last = true;
      } else if (textVisible(r)) last = false;
    return count - Number(last);
  }
  bytes() {
    const out = new Uint8Array(this.rows.length * 88),
      v = new DataView(out.buffer);
    this.rows.forEach((r, i) => r.forEach((n, j) => v.setUint32(i * 88 + j * 4, n >>> 0, true)));
    return out;
  }
  snapshot() {
    const { glyphs, ...data } = this;
    void glyphs;
    return structuredClone({
      ...data,
      profiles: this.profiles.map((s) => [...s]),
      rows: this.rows.map((r) => [...r]),
    });
  }
  restore(saved) {
    Object.assign(this, structuredClone(saved));
    this.rows = saved.rows.map((r) => Int32Array.from(r));
    this.profiles = saved.profiles.map((r) => new Set(r));
  }
}
