// SPDX-License-Identifier: MPL-2.0
import { nativeABI } from './abi/index.mjs';
import { NativeTextParser } from './text-parser.mjs';
import { textVisible } from './text-layout.mjs';
import { textConfig, textPacket } from './text-config.mjs';
import { NativeTextFonts } from './font-backend.mjs';
import { CanvasTextGlyphs } from '../render/native-text.mjs';
import { NativeTextWindows } from './text-windows.mjs';
import { rasterTextGlyph, compositeTextGlyph } from './text-raster.mjs';
import { openImage } from '../formats/hg3.mjs';
import { nativeTextUnits } from './text-scanner.mjs';
const join = (arrays) => {
  const out = new Uint8Array(arrays.reduce((n, a) => n + a.length, 0));
  let at = 0;
  for (const a of arrays) {
    out.set(a, at);
    at += a.length;
  }
  return out;
};
export class JSTextRuntime {
  constructor(engine, { world, glyphs, rate } = {}) {
    Object.assign(this, { engine, world, profile: engine.profile, process: engine.process });
    this.glyphs = new NativeTextFonts(
      glyphs ?? engine.textWindows?.glyphs ?? new CanvasTextGlyphs(),
      world,
      engine.profile,
    );
    this.rate = rate ?? world?.configuration?.getField?.('scene.textFrame') ?? 0;
    this.writers = new Map();
    this.nextWriter = 1;
    this.windows =
      engine.textWindows ??
      new NativeTextWindows(engine.process, { glyphs: this.glyphs, kernel: engine.kernel });
    for (const [name, definition] of this.windows.definitions)
      engine.registerWindows?.(
        /^(?:SetRect|CopyRect|IsRect|EqualRect|IntersectRect|UnionRect|OffsetRect|InflateRect|GetDC|ReleaseDC|FillRect)/.test(
          name,
        )
          ? 'USER32.dll'
          : /^lstr/.test(name)
            ? 'KERNEL32.dll'
            : 'GDI32.dll',
        name,
        definition,
      );
    engine.registerFeature?.('text', this);
  }
  async ready() {
    await this.glyphs.ready();
  }
  async fromHost(fn) {
    return fn();
  }
  bindings(mode) {
    const b = nativeABI(this.profile).layouts.textCores[mode];
    if (!b) throw new Error(`Unavailable text mode ${mode}`);
    return b;
  }
  async create(mode, config) {
    this.bindings(mode);
    await this.glyphs.ready?.();
    const writer = new (mode === 'nv' ? JSNVTextWriter : JSTextWriter)(this, {
      pointer: this.nextWriter++,
      mode,
    });
    this.writers.set(writer.pointer, writer);
    if (config) await writer.configure(config);
    return writer;
  }
  get(id) {
    const writer = this.writers.get(id);
    if (!writer) throw new Error(`Text writer ${id} is not active`);
    return writer;
  }
  async defaultPacket(mode) {
    return textPacket(this.profile, mode, this.world?.configuration);
  }
  snapshot() {
    return {
      nextWriter: this.nextWriter,
      writers: [...this.writers.values()].map((w) => w.snapshot()),
      windows: this.windows.snapshot(),
      fonts: this.glyphs.snapshot(),
    };
  }
  restore(saved) {
    this.glyphs.restore(saved.fonts ?? []);
    this.nextWriter = saved.nextWriter;
    this.windows.restore(saved.windows);
    this.writers = new Map(
      saved.writers.map((s) => {
        const w = new (s.mode === 'nv' ? JSNVTextWriter : JSTextWriter)(this, s);
        w.restore(s);
        return [w.pointer, w];
      }),
    );
  }
  async close() {
    for (const w of [...this.writers.values()]) await w.close();
    this.glyphs.close();
  }
  async fesLayout(type) {
    const { NativeFESTextLayout } = await import('./fes-text-layout.mjs');
    const layout = new NativeFESTextLayout({ profile: this.profile, type });
    layout.bytes.set(
      textConfig(this.profile, type === 37 ? 'utf8' : 'cp932', this.world?.configuration, {
        fes: true,
      }),
      764,
    );
    return layout;
  }
}
export class JSTextWriter {
  constructor(runtime, { pointer, mode }) {
    Object.assign(this, { runtime, pointer, mode });
    this.parser = this.newParser();
    this.config = null;
    this.pixels = null;
    this.damage = [0, 0, 0, 0];
    this.speedValue = 10;
    this.maximumTime = 0;
    this.lastFrame = 0;
    this.baseTime = 0;
    this.baseFrame = 0;
    this.fontImages = new Map();
    this.categories = new Map();
  }
  newParser(config) {
    return new NativeTextParser({
      profile: this.runtime.profile,
      mode: this.mode === 'nv' ? 'cp932' : this.mode,
      glyphs: this.runtime.glyphs,
      rate: this.runtime.rate,
      config,
    });
  }
  get bindings() {
    return this.runtime.bindings(this.mode);
  }
  get process() {
    return this.runtime.process;
  }
  enginePointer() {
    return this.pointer;
  }
  defaultConfig() {
    return this.parser.config.slice();
  }
  async configure(config) {
    if (config.length !== this.bindings.configSize)
      throw new Error('Text configuration size differs');
    await this.runtime.glyphs.prepareConfiguration(this.runtime.profile, this.mode, config);
    this.config = config.slice();
    this.parser.configure(config);
    this.maximumTime = this.lastFrame = this.baseTime = this.baseFrame = 0;
    this.completePixels = null;
    this.pixels = {
      width: this.parser.c(4),
      height: this.parser.c(5),
      rgba: new Uint8ClampedArray(this.parser.c(4) * this.parser.c(5) * 4),
    };
    this.damage = [0, 0, this.pixels.width, this.pixels.height];
    return this.config.slice();
  }
  async append(text) {
    this.parser.appendText(String(text));
  }
  async appendSource(text) {
    return this.append(text);
  }
  async appendEncoded(bytes) {
    this.parser.append(bytes);
    return this.mode === 'utf8' ? new TextDecoder().decode(bytes) : '';
  }
  async parse() {
    this.parser.parse();
  }
  async clear() {
    this.parser.clear();
    this.maximumTime = this.lastFrame = this.baseTime = this.baseFrame = 0;
    if (this.pixels) this.pixels.rgba.fill(0);
    this.completePixels = null;
  }
  async mark() {
    this.parser.mark();
  }
  async remaining(page = -1) {
    if (this.parser.dirty) return -1;
    let pages = 0,
      count = 0;
    for (const r of this.parser.rows) {
      if (r[1] === 65535) {
        if (page !== -1 && page <= pages) return count;
        pages++;
      } else if (textVisible(r) && r[15] !== 1) count++;
    }
    return count;
  }
  async speed(value) {
    value >>>= 0;
    let result = value;
    if (this.speedValue !== value) {
      this.speedValue = value;
      this.baseTime = this.maximumTime;
      result = this.lastFrame;
      this.baseFrame = result;
    }
    return result;
  }
  async lineCount() {
    return this.parser.lineCount();
  }
  async shift(y) {
    const delta = (y | 0) - this.parser.shift[1];
    for (const r of this.parser.rows) r[5] += delta;
    this.parser.shift[1] = y | 0;
    this.repaint();
  }
  repaint() {
    if (!this.pixels) return;
    this.pixels.rgba.fill(0);
    for (const r of this.parser.rows) if (r[15] === 1) this.raster(r);
    this.damage = [0, 0, this.pixels.width, this.pixels.height];
  }
  shape(parser, record) {
    const selector = this.fontImages.get(record[1]),
      image = selector === undefined ? null : this.decodedFonts?.find((f) => f.id === selector);
    if (selector !== undefined && (!image || image.bpp !== 4)) {
      const space = record.slice();
      space[1] =
        nativeABI(this.runtime.profile).text.freeTypeCharacterEncoding === 'cp932'
          ? 0x8140
          : 0x3000;
      if (!parser.font(record).backend) space[1] = 0x8140;
      return rasterTextGlyph(parser, space);
    }
    return rasterTextGlyph(parser, record, { image });
  }
  raster(record, parser = this.parser, offset = [0, 0]) {
    if (!this.pixels) return;
    const shape = this.shape(parser, record);
    record.set(shape.rect, 16);
    compositeTextGlyph(this.pixels, shape, record[4] + offset[0], record[5] + offset[1]);
    this.touch([
      record[4] + offset[0],
      record[5] + offset[1],
      record[4] + offset[0] + shape.width,
      record[5] + offset[1] + shape.height,
    ]);
  }
  touch(rect) {
    const d = this.damage;
    if (d[0] >= d[2] || d[1] >= d[3]) this.damage = rect.slice();
    else
      this.damage = [
        Math.min(d[0], rect[0]),
        Math.min(d[1], rect[1]),
        Math.max(d[2], rect[2]),
        Math.max(d[3], rect[3]),
      ];
  }
  async draw(frame, page = -1) {
    frame >>>= 0;
    page |= 0;
    this.parser.parse();
    let done = true,
      pages = 0;
    const mode = this.parser.c(3),
      rows = this.parser.rows,
      elapsed = ((Math.imul(this.speedValue, (frame - this.baseFrame) >>> 0) >>> 0) / 10) | 0;
    if (mode === 0) {
      for (const r of rows) {
        if (!textVisible(r)) {
          if (r[1] === 65535 && page !== -1 && page < ++pages) return done;
        } else if ((r[11] - this.baseTime) >>> 0 <= elapsed >>> 0 || frame === 0xffffffff) {
          if (!r[15]) {
            this.raster(r);
            r[15] = 1;
          }
          this.maximumTime = Math.max(this.maximumTime, r[11] >>> 0);
        } else done = false;
      }
    }
    if (mode === 1) {
      const pending = [];
      for (const r of rows) {
        if (!textVisible(r)) {
          if (r[1] === 65535 && page !== -1 && page < ++pages) break;
        } else if (!r[15]) {
          r[15] = 2;
          pending.push(r);
        }
      }
      if (pending.length && this.pixels) {
        const visible = this.pixels;
        this.pixels = { ...visible, rgba: this.completePixels ?? visible.rgba.slice() };
        for (const r of pending) this.raster(r);
        this.completePixels = this.pixels.rgba;
        this.pixels = visible;
        // The backing image supplies RGB; incremental appends preserve the
        // alpha already exposed by the wipe in the visible image.
        for (let i = 0; i < visible.rgba.length; i += 4)
          visible.rgba.set(this.completePixels.subarray(i, i + 3), i);
      }
      const wipe = new DataView(this.parser.config.buffer).getUint32(
          this.parser.config.length - (this.mode === 'utf8' ? 12 : 8),
          true,
        ),
        rate = this.parser.c(31),
        cursor =
          frame < 0x80000000
            ? rate
              ? ((Math.imul(Math.imul(2, frame), this.parser.c(11)) >>> 0) / rate) >>> 0
              : 0x7fffffff
            : 0x7fffffff;
      pages = 0;
      for (const r of rows) {
        if (!textVisible(r)) {
          if (r[1] === 65535 && page !== -1 && page < ++pages) return done;
          continue;
        }
        if (r[15] === 2) {
          const complete = cursor >= r[12] + r[18] + Math.max(0, wipe);
          if (complete) r[15] = 1;
          else done = false;
          this.applyWipe(r, cursor, wipe);
        } else if (!r[15]) done = false;
      }
    }
    this.lastFrame = frame;
    return done;
  }
  applyWipe(r, cursor, wipe) {
    if (!this.pixels || !this.completePixels || cursor < r[12]) return;
    const { width, height, rgba } = this.pixels;
    for (let y = Math.max(0, r[5] + r[17]); y < Math.min(height - 1, r[5] + r[19]); y++)
      for (let x = Math.max(0, r[4] + r[16]); x < Math.min(width - 1, r[4] + r[18]); x++) {
        const at = (y * width + x) * 4,
          relative = r[12] + x - r[4] - (cursor - wipe);
        if (relative < 0) rgba[at + 3] = this.completePixels[at + 3];
        else if (relative < wipe)
          rgba[at + 3] =
            (this.completePixels[at + 3] * (256 - Math.floor((relative * 255) / wipe))) >>> 8;
      }
    this.touch([r[4], r[5], r[4] + r[18], r[5] + r[19]]);
  }
  async userFont(bytes) {
    this.imageFont = bytes?.slice() ?? null;
    this.decodedFonts = [];
    if (bytes?.length) {
      try {
        const image = await openImage(bytes);
        for (const frame of image.frames) {
          await image.decode(frame);
          this.decodedFonts.push({
            id: frame.id,
            bpp: frame.bpp / 8,
            width: frame.width,
            height: frame.height,
            canvasWidth: frame.canvasWidth,
            canvasHeight: frame.canvasHeight,
            offsetX: frame.offsetX,
            offsetY: frame.offsetY,
            rgba: frame.rgba.slice(),
          });
        }
      } catch {
        /* A readable invalid resource clears the old glyph image. */
      }
    }
  }
  async profile(category, text) {
    const units = nativeTextUnits(
      this.mode === 'utf8' ? new TextEncoder().encode(text) : new Uint8Array(),
      this.mode === 'utf8',
    );
    if (category < 5) {
      if (this.mode === 'utf8')
        for (let i = 0; i < units.length; i += 3) this.parser.profiles[category].add(units[i]);
      else {
        const { encodeCP932 } = await import('../kcs/strings.mjs');
        for (const code of nativeTextUnits(encodeCP932(text)))
          this.parser.profiles[category].add(code);
      }
    }
  }
  async category(category, bytes) {
    // d_prof removes members. Its narrow wrapper inspects the following byte
    // even for SBCS, so "AB" removes 0x4142 and 0x42 rather than 0x41.
    const target = this.parser.profiles[category];
    if (!target) return;
    for (let i = 0; i < bytes.length && bytes[i]; ) {
      const first = bytes[i],
        next = bytes[i + 1] ?? 0;
      target.delete(next ? (first << 8) | next : first >= 128 ? first | 0xff00 : first);
      i += (first >= 0x81 && first <= 0x9f) || (first >= 0xe0 && first <= 0xfc) ? 2 : 1;
    }
  }
  async resourceMessage(operation, w, l) {
    if (operation === 19) {
      this.parser.profiles[w]?.clear();
      this.categories.delete(w);
      return 0;
    }
    if (operation === 10) {
      this.fontImages.set(w, l);
      return 0;
    }
    if (operation === 9 && !l) {
      this.imageFont = null;
      this.decodedFonts = [];
      return 0;
    }
    if (operation === 13) {
      const bytes = this.process.stringBytes(l);
      await this.category(w, bytes);
      return 0;
    }
    throw new Error('Text resource bytes must be supplied by their JS owner');
  }
  async input(bytes, fn) {
    const p = this.process,
      at = p.allocate(bytes.length, true);
    try {
      p.write(at, bytes);
      return await fn(at);
    } finally {
      p.free(at);
    }
  }
  async endPosition() {
    return this.parser.cachedEnd.slice();
  }
  records() {
    return this.parser.bytes();
  }
  dirty() {
    return this.damage.slice();
  }
  clearDirty() {
    this.damage = [0, 0, 0, 0];
  }
  frame() {
    if (!this.pixels) throw new Error('Text writer has no configured bitmap');
    return { ...this.pixels, rgba: this.pixels.rgba.slice() };
  }
  snapshot() {
    return structuredClone({
      pointer: this.pointer,
      mode: this.mode,
      config: this.config,
      parser: this.parser.snapshot(),
      pixels: this.pixels,
      damage: this.damage,
      speedValue: this.speedValue,
      maximumTime: this.maximumTime,
      lastFrame: this.lastFrame,
      baseTime: this.baseTime,
      baseFrame: this.baseFrame,
      completePixels: this.completePixels,
      imageFont: this.imageFont,
      decodedFonts: this.decodedFonts,
      fontImages: [...this.fontImages],
      categories: [...this.categories],
    });
  }
  restore(s) {
    for (const k of [
      'config',
      'pixels',
      'damage',
      'speedValue',
      'maximumTime',
      'lastFrame',
      'baseTime',
      'baseFrame',
      'completePixels',
      'imageFont',
      'decodedFonts',
    ])
      this[k] = structuredClone(s[k]);
    this.parser.restore(s.parser);
    this.fontImages = new Map(s.fontImages);
    this.categories = new Map(s.categories);
  }
  async close() {
    this.runtime.writers.delete(this.pointer);
  }
}
export class JSNVTextWriter extends JSTextWriter {
  constructor(runtime, state) {
    super(runtime, state);
    this.main = [];
    this.sub = [];
    this.nextReset = false;
    this.pendingCR = false;
    this.crCount = 0;
  }
  sections(secondary = false) {
    return (secondary ? this.sub : this.main).map((s) => ({ ...s, parser: s.parser }));
  }
  defaultConfig() {
    if (!this.config) throw new Error('NV text has no configuration');
    return this.config.slice();
  }
  current(secondary = false) {
    return (secondary ? this.sub : this.main).at(-1)?.parser;
  }
  get configView() {
    return new DataView(this.config.buffer);
  }
  get parserSize() {
    return nativeABI(this.runtime.profile).layouts.textCores.cp932.configSize;
  }
  get subEnabled() {
    const at = 24 + this.parserSize,
      v = this.configView;
    return (
      v.getInt32(at, true) < v.getInt32(at + 8, true) &&
      v.getInt32(at + 4, true) < v.getInt32(at + 12, true)
    );
  }
  resetClock() {
    this.maximumTime = this.lastFrame = this.baseTime = this.baseFrame = 0;
  }
  async configure(config) {
    if (config.length !== this.bindings.configSize)
      throw new Error('NV configuration size differs');
    await this.runtime.glyphs.prepareConfiguration(
      this.runtime.profile,
      'cp932',
      config.slice(24, 24 + this.parserSize),
    );
    await this.runtime.glyphs.prepareConfiguration(
      this.runtime.profile,
      'cp932',
      config.slice(24 + this.parserSize + 16),
    );
    this.config = config.slice();
    const v = this.configView,
      w = v.getUint32(0, true),
      h = v.getUint32(4, true);
    this.pixels = { width: w, height: h, rgba: new Uint8ClampedArray(w * h * 4) };
    this.resetClock();
    for (const s of [...this.main, ...(this.subEnabled ? this.sub : [])]) s.parser.reflow();
    this.damage = [0, 0, w, h];
    return this.config.slice();
  }
  async section() {
    const empty = this.main.length === 0,
      last = this.main.at(-1),
      x = last?.x ?? 0,
      y = last ? last.y + last.parser.highest + last.parser.c(24) : 0;
    for (const [secondary, offset] of [
      [false, 24],
      ...(this.subEnabled ? [[true, 24 + this.parserSize + 16]] : []),
    ]) {
      const cfg = this.config.slice(offset, offset + this.parserSize),
        v = new DataView(cfg.buffer);
      if (secondary) {
        v.setUint32(64, 0, true);
        v.setUint32(72, 0, true);
      }
      if (!empty) v.setUint32(68, 0, true);
      const parser = this.newParser(cfg);
      parser.dirty = true;
      (secondary ? this.sub : this.main).push({ x, y, parser });
    }
    this.parser = this.main.at(-1).parser;
    this.resetClock();
    this.nextReset = true;
  }
  async append(text) {
    const { encodeCP932 } = await import('../kcs/strings.mjs');
    return this.appendEncoded(encodeCP932(String(text)));
  }
  async appendEncoded(bytes) {
    const p = this.current();
    if (!p) return '';
    let count = 0;
    while (bytes[count * 2] === 92 && (bytes[count * 2 + 1] === 114 || bytes[count * 2 + 1] === 82))
      count++;
    if (count) {
      this.pendingCR = true;
      this.crCount = count;
      bytes = bytes.subarray((count - 1) * 2);
    }
    p.append(bytes);
    return '';
  }
  async appendSecondary(text) {
    const { encodeCP932 } = await import('../kcs/strings.mjs');
    return this.appendSecondaryEncoded(encodeCP932(String(text)));
  }
  async appendSecondaryEncoded(bytes) {
    const p = this.current(true);
    if (!p) return;
    if (this.pendingCR) {
      for (let i = 0; i < this.crCount; i++) {
        this.current()?.append(Uint8Array.of(92, 110));
        p.append(Uint8Array.of(92, 110));
      }
      this.pendingCR = false;
      this.crCount = 0;
    }
    p.append(bytes);
  }
  async clear() {
    this.main = [];
    if (this.config && this.subEnabled) this.sub = [];
    this.resetClock();
    this.nextReset = false;
    this.pendingCR = false;
    this.crCount = 0;
    if (this.pixels) this.pixels.rgba.fill(0);
  }
  async parse() {
    for (const s of [...this.main, ...this.sub]) s.parser.parse();
  }
  async mark() {
    this.current()?.mark();
  }
  async remaining() {
    const p = this.current();
    return !p ? 0 : p.dirty ? -1 : p.rows.filter((r) => textVisible(r) && !r[15]).length;
  }
  async endPosition() {
    const s = this.main.at(-1);
    if (!s) return [0, 0];
    const v = this.configView;
    return [
      s.parser.cachedEnd[0] + s.x + v.getInt32(8, true),
      s.parser.cachedEnd[1] + s.y + v.getInt32(12, true),
    ];
  }
  rasterNV(record, section, secondary) {
    const main = this.current();
    if (!main || !this.pixels) return;
    const parser = section.parser,
      mainFont = main.font(record),
      context = {
        glyphs: parser.glyphs,
        character: (r) =>
          new TextDecoder('shift_jis').decode(
            Uint8Array.from(r[1] > 255 ? [r[1] >> 8, r[1] & 255] : [r[1]]),
          ),
        font: (r) => ({ ...parser.font(r), weight: mainFont.weight, fixed: mainFont.fixed }),
      },
      shape = this.shape(context, record),
      at = secondary ? 24 + this.parserSize : 8,
      v = this.configView,
      x = record[4] + section.x + v.getInt32(at, true),
      y = record[5] + section.y + v.getInt32(at + 4, true);
    compositeTextGlyph(this.pixels, shape, x, y);
    this.touch([x, y, x + shape.width, y + shape.height]);
  }
  async draw(frame, page = -1) {
    frame >>>= 0;
    page |= 0;
    let done = true;
    if (this.nextReset) {
      this.maximumTime = this.lastFrame = 0;
      this.nextReset = false;
    }
    for (const [secondary, list] of [
      [false, this.main],
      ...(this.config && this.subEnabled ? [[true, this.sub]] : []),
    ]) {
      const s = list.at(-1);
      if (!s) continue;
      s.parser.parse();
      const elapsed = Math.floor(
        (Math.imul(this.speedValue, (frame - this.baseFrame) >>> 0) >>> 0) / 10,
      );
      let pages = 0,
        early = false,
        complete = true;
      for (const r of s.parser.rows) {
        if (!textVisible(r)) {
          if (r[1] === 65535 && page !== -1 && page < ++pages) {
            early = true;
            break;
          }
        } else if ((r[11] - this.baseTime) >>> 0 <= elapsed || frame === 0xffffffff) {
          if (!r[15]) {
            this.rasterNV(r, s, secondary);
            r[15] = 1;
          }
          this.maximumTime = Math.max(this.maximumTime, r[11] >>> 0);
        } else complete = false;
      }
      if (!early) this.lastFrame = frame;
      done = complete && done;
    }
    return done;
  }
  async erase() {
    this.pixels?.rgba.fill(0);
  }
  async repaintNV(all) {
    for (const [secondary, list] of [
      [false, this.main],
      ...(this.config && this.subEnabled ? [[true, this.sub]] : []),
    ])
      for (const s of list)
        for (const r of s.parser.rows)
          if (all ? textVisible(r) : r[15] === 1) {
            this.rasterNV(r, s, secondary);
            if (all) r[15] = 1;
          }
  }
  async redraw() {
    return this.repaintNV(true);
  }
  async reflow() {
    return this.repaintNV(false);
  }
  records() {
    return join([...this.main, ...this.sub].map((s) => s.parser.bytes()));
  }
  snapshot() {
    return {
      ...super.snapshot(),
      nextReset: this.nextReset,
      pendingCR: this.pendingCR,
      crCount: this.crCount,
      main: this.main.map((s) => ({ ...s, parser: s.parser.snapshot() })),
      sub: this.sub.map((s) => ({ ...s, parser: s.parser.snapshot() })),
    };
  }
  restore(s) {
    super.restore(s);
    this.nextReset = s.nextReset;
    this.pendingCR = s.pendingCR;
    this.crCount = s.crCount;
    for (const key of ['main', 'sub'])
      this[key] = s[key].map((section) => {
        const parser = this.newParser();
        parser.restore(section.parser);
        return { ...section, parser };
      });
    this.parser = this.main.at(-1)?.parser ?? this.parser;
  }
}
