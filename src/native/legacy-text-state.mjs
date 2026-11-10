// SPDX-License-Identifier: MPL-2.0
// Task 8 predates STRING: it owns forty-byte cells and a separate schedule.
import { nativeTextUnits } from './text-scanner.mjs';
import { parseNativeIntegerPrefix } from './standard.mjs';
export class LegacyTextState {
  constructor() {
    this.words = new Int32Array(476);
    this.words[470] = 0xff000000;
    for (let i = 471; i <= 475; i++) this.words[i] = 20;
    this.rows = [];
    this.configured = false;
  }
  w(i, n) {
    if (n !== undefined) this.words[i] = n | 0;
    return this.words[i];
  }
  configure(bytes) {
    const v = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
    for (let i = 0; i < 279; i++) this.words[177 + i] = v.getInt32(i * 4, true);
    this.rows = [];
    this.configured = true;
    for (let i = 471; i <= 475; i++) this.words[i] = this.words[183];
    this.words[46] = this.words[193];
    const kind = this.w(198);
    this.w(466, Number(kind === 1));
    this.w(467, Number(kind === 2 || kind === 3));
  }
  clear() {
    this.rows = [];
    this.w(459, this.w(188));
    this.w(460, this.w(189));
    this.w(461, 0);
    this.w(462, 0);
    this.w(465, 0);
    this.w(46, this.w(193));
    this.w(468, 0);
  }
  control(code) {
    const r = new Int32Array(10);
    r[0] = code & 65535;
    return r;
  }
  newline() {
    this.rows.push(this.control(0));
    this.w(460, this.w(460) + this.w(183) + this.w(186));
    this.w(459, this.w(468) ? this.w(183) + this.w(185) : 0);
    return this.rows.length + 1 < this.w(192);
  }
  glyph(code) {
    if (this.rows.length + 1 >= this.w(192)) return false;
    if (this.w(469) && !this.rows.length && code === 0x8175) this.w(468, 1);
    else if (!code) return this.newline();
    const size = this.w(183),
      advance = code > 255 ? size : Math.trunc((size - 3) / 2) + 4;
    if (this.w(199) && advance + this.w(459) + Math.imul(size, this.w(200)) >= this.w(179)) {
      const forbidden = this.profile(201, 202),
        repeat = this.profile(330, 331);
      if (!forbidden.has(code) && !repeat.has(code)) {
        if (!this.newline()) return false;
      } else if (this.w(459) + advance > this.w(179)) {
        let previous = this.rows.length - 1;
        while (previous >= 0 && repeat.has(this.rows[previous][0])) previous--;
        if (previous >= 0) {
          const at = previous + 1,
            moved = this.rows.length - at;
          this.rows.splice(at, 0, this.control(0));
          this.w(460, this.w(460) + size + this.w(186));
          this.w(459, this.w(468) ? size + this.w(185) : 0);
          for (let i = at + 1; i <= at + moved; i++) {
            this.rows[i][2] = this.w(459);
            this.w(459, this.w(459) + this.w(185) + this.rows[i][4]);
          }
        }
      }
    }
    if (advance + this.w(459) > this.w(179) && !this.newline()) return false;
    if (this.w(183) + this.w(460) + this.w(186) > this.w(180)) return false;
    const r = this.control(code);
    r[1] = this.w(46);
    r[2] = this.w(459);
    r[3] = this.w(460);
    r[4] = advance;
    r[5] = this.w(183);
    this.rows.push(r);
    this.w(459, this.w(459) + advance + this.w(185));
    return true;
  }
  profile(length, index) {
    const bytes = new Uint8Array(
        this.words.buffer,
        index * 4,
        Math.min(Math.max(0, this.w(length)), 256) * 2,
      ),
      v = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
    return new Set(Array.from({ length: bytes.length / 2 }, (_, i) => v.getUint16(i * 2, true)));
  }
  append(bytes) {
    if (!this.configured) return 0;
    const units = nativeTextUnits(bytes),
      start = this.rows.length;
    let at = 0,
      inRuby = false,
      reading = false,
      ruby = [],
      baseStart = 0,
      baseEnd = 0;
    const number = () => {
      const text = String.fromCharCode(...units.slice(at)),
        result = parseNativeIntegerPrefix(text);
      if (!result) return null;
      at += result.count;
      return result.value | 0;
    };
    while (at < units.length) {
      let code = units[at++];
      if (code > 255) {
        if (reading) ruby.push(code);
        else if (!this.glyph(code)) break;
        continue;
      }
      if (!this.w(197)) {
        if (!this.glyph(code)) break;
        continue;
      }
      if (code === 91) {
        baseStart = this.rows.length;
        inRuby = true;
        reading = false;
        ruby = [];
        continue;
      }
      if (code === 92) {
        const c = String.fromCharCode(units[at++] ?? 0).toLowerCase();
        if (c === 'c') {
          const n = number();
          if (n !== null) this.w(46, n);
          if (units[at] === 59) at++;
        } else if (c === 'f') {
          const c2 = String.fromCharCode(units[at] ?? 0).toLowerCase();
          let size;
          if ('lsn'.includes(c2) && c2) {
            at++;
            if (c2 === 'n') size = this.w(473);
            else {
              const doubled = String.fromCharCode(units[at] ?? 0).toLowerCase() === c2;
              if (doubled) at++;
              size = this.w(c2 === 'l' ? (doubled ? 475 : 474) : doubled ? 471 : 472);
            }
          } else {
            const relative = c2 === '+' || c2 === '-',
              n = number();
            size = n === null ? this.w(473) : relative ? this.w(183) + n : n;
          }
          this.w(183, size);
          if (units[at] === 59) at++;
        } else if (c === 'n') this.glyph(0);
        else if (c === '\\') this.glyph(92);
        continue;
      }
      if (code === 93 && reading) {
        this.ruby(baseStart, baseEnd, ruby);
        reading = inRuby = false;
        continue;
      }
      if (inRuby && code === 47) {
        reading = true;
        baseEnd = this.rows.length;
        continue;
      }
      if (reading) ruby.push(code);
      else if (!this.glyph(code)) break;
    }
    this.vertical(this.w(196));
    return Number(this.rows.length !== start);
  }
  ruby(start, end, codes) {
    while (start < this.rows.length && !this.rows[start][0]) start++;
    if (start >= this.rows.length) return 0;
    const first = this.rows.length,
      rubySize = this.w(184),
      size = rubySize - 2;
    for (const code of codes) {
      const r = this.control(code);
      r[1] = this.rows[start][1];
      r[4] = code > 255 ? rubySize : Math.trunc(rubySize / 2) + 1;
      r[5] = rubySize;
      r[6] = 1;
      this.rows.push(r);
    }
    const width =
        this.rows.slice(start, end).reduce((n, r) => n + r[4] + this.w(185), 0) - this.w(185),
      readingWidth = codes.reduce((n, c) => n + (c > 255 ? size : Math.trunc(size / 2)), 0),
      gap = width > readingWidth ? Math.floor(width / (codes.length + 1)) : size - 2;
    let left = Math.trunc((width - gap * (codes.length - 1) - size) / 2),
      relative = left,
      advance = this.rows[start][4];
    if (left + this.rows[start][2] < 0) {
      left = relative = 0;
    }
    let anchor = start;
    for (let i = 0; i < codes.length; i++) {
      if (left >= advance) {
        const last = end - 1;
        while (anchor < last) {
          const previous = anchor;
          do {
            anchor++;
          } while (anchor < last && !this.rows[anchor][0]);
          advance += this.w(185) + this.rows[anchor][4];
          relative -= this.w(185) + this.rows[previous][4];
          if (left < advance) break;
        }
      }
      const r = this.rows[first + i];
      r[7] = anchor;
      r[2] = Math.max(0, relative + this.rows[anchor][2]);
      r[3] = this.rows[anchor][3];
      left += gap;
      relative += gap;
    }
    return 1;
  }
  vertical(mode, minimum = 0) {
    if (mode !== 1 && mode !== 2) return;
    let top = this.w(mode === 1 ? 184 : 189),
      start = 0,
      height = minimum;
    const apply = (end) => {
      for (let i = start; i <= end && i < this.rows.length; i++) {
        const r = this.rows[i];
        if (!r[0]) continue;
        r[3] = r[6]
          ? this.w(187) + (this.rows[r[7]]?.[3] ?? 0)
          : mode === 1
            ? top
            : top + height - r[5];
      }
    };
    for (let i = 0; i < this.rows.length; i++) {
      const r = this.rows[i];
      if (!r[0]) {
        apply(i);
        start = i + 1;
        top += height + this.w(186);
        height = minimum;
      } else if (!r[6]) height = Math.max(height, r[5]);
    }
    apply(this.rows.length - 1);
  }
  schedule(now, rate) {
    let wait = 0;
    for (let i = this.w(461) >>> 0; i < this.rows.length; i++) {
      const r = this.rows[i];
      if (!this.w(194)) r[8] = now;
      else if (this.w(194) === 1) {
        if (r[6]) r[8] = this.rows[r[7]]?.[8] ?? 0;
        else {
          r[8] =
            (now +
              Math.max(1, Math.trunc(Math.fround(Math.fround(Math.imul(wait, rate)) / 60)))) >>>
            0;
          wait = (wait + this.w(195)) | 0;
        }
      }
    }
  }
  mark() {
    if (this.rows.length < this.w(192)) this.rows.push(this.control(65535));
  }
  bytes() {
    const out = new Uint8Array(this.rows.length * 40),
      v = new DataView(out.buffer);
    for (let i = 0; i < this.rows.length; i++)
      for (let j = 0; j < 10; j++) v.setUint32(i * 40 + j * 4, this.rows[i][j] >>> 0, true);
    return out;
  }
  snapshot() {
    return {
      words: this.words.slice(),
      rows: this.rows.map((r) => r.slice()),
      configured: this.configured,
    };
  }
  restore(s) {
    this.words = new Int32Array(s.words);
    this.rows = s.rows.map((r) => new Int32Array(r));
    this.configured = s.configured;
  }
}
