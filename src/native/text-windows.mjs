// SPDX-License-Identifier: MPL-2.0
import { PPIWindowsServices } from '../ppi/native-services.mjs';
import { CanvasTextGlyphs } from '../render/native-text.mjs';
import { nativeRectangleDefinitions } from './windows-rectangles.mjs';
import { installNativeDIBs } from './windows-dib.mjs';
import { installNativeGDIBitmaps } from './windows-gdi.mjs';
import { installNativeFontEnumeration } from './windows-fonts.mjs';

export class NativeTextWindows {
  constructor(
    process,
    { glyphs = new CanvasTextGlyphs(), fontFamilies = () => [], now = () => 0, kernel } = {},
  ) {
    Object.assign(this, { process, glyphs, fontFamilies });
    this.kernel = kernel || new PPIWindowsServices(process, { now, epoch: 0 });
    this.definitions = new Map();
    this.functions = new Map();
    this.objects = new Map();
    this.nextObject = 0x60000000;
    this.calls = new Map();
    const p = process,
      def = (name, count, fn) => this.definitions.set(name, { count, fn });
    for (const suffix of ['A', 'W']) {
      const wide = suffix === 'W';
      def(`lstrcpy${suffix}`, 2, ([out, input]) => {
        p.write(out, p.stringBytes(input, wide, true));
        return out;
      });
      def(`lstrlen${suffix}`, 1, ([input]) =>
        input ? p.stringBytes(input, wide).length / (wide ? 2 : 1) : 0,
      );
      for (const insensitive of [false, true])
        def(`lstrcmp${insensitive ? 'i' : ''}${suffix}`, 2, ([a, b]) => {
          a = p.string(a, wide);
          b = p.string(b, wide);
          if (insensitive) {
            a = a.toLowerCase();
            b = b.toLowerCase();
          }
          return a === b ? 0 : a < b ? -1 : 1;
        });
      def(`CreateFontIndirect${suffix}`, 1, ([at]) =>
        this.createObject('font', {
          height: p.load(at) | 0,
          width: p.load(at + 4) | 0,
          escapement: p.load(at + 8) | 0,
          orientation: p.load(at + 12) | 0,
          weight: p.load(at + 16) | 0,
          italic: p.read(at + 20, 1)[0],
          underline: p.read(at + 21, 1)[0],
          strikeout: p.read(at + 22, 1)[0],
          charset: p.read(at + 23, 1)[0],
          quality: p.read(at + 26, 1)[0],
          face: p.string(at + 28, wide),
        }),
      );
      def(`GetTextExtentPoint32${suffix}`, 4, ([dc, at, count, out]) => {
        const bytes = p.read(at, count * (wide ? 2 : 1)),
          text = new TextDecoder(wide ? 'utf-16le' : 'shift_jis').decode(bytes),
          metrics = this.glyphs.measure(this.font(dc), text);
        p.store(out, metrics.width);
        p.store(out + 4, metrics.height);
        return 1;
      });
      def(`GetTextMetrics${suffix}`, 2, ([dc, out]) => {
        const font = this.font(dc),
          metrics = this.glyphs.measure(font, 'Hg');
        p.zero(out, wide ? 60 : 56);
        [
          metrics.height,
          metrics.ascent,
          metrics.descent,
          0,
          0,
          metrics.averageWidth,
          metrics.maximumWidth,
          font.weight,
          0,
          96,
          96,
        ].forEach((v, i) => p.store(out + i * 4, v));
        return 1;
      });
      def(`GetGlyphOutline${suffix}`, 7, (args) => this.glyphOutline(args, wide));
    }
    for (const [name, definition] of nativeRectangleDefinitions(p))
      this.definitions.set(name, definition);
    def('GetDC', 1, () => this.createObject('dc', { font: 0 }));
    def('ReleaseDC', 2, ([, dc]) => Number(this.objects.delete(dc)));
    def('CreateCompatibleDC', 1, () => this.createObject('dc', { font: 0 }));
    def('DeleteDC', 1, ([dc]) => Number(this.objects.delete(dc)));
    def('DeleteObject', 1, ([id]) => Number(this.objects.delete(id)));
    def('SelectObject', 2, ([dc, object]) => {
      const context = this.object(dc, 'dc'),
        previous = context.font;
      if (object && this.object(object).kind !== 'font')
        throw new Error('Native text selected a non-font GDI resource');
      context.font = object;
      return previous;
    });
    for (const name of ['SetMapMode', 'SetTextColor', 'SetBkColor', 'SetTextAlign', 'SetBkMode'])
      def(name, 2, ([dc, value]) => {
        const context = this.object(dc, 'dc'),
          previous = context[name] ?? (name === 'SetMapMode' ? 1 : name === 'SetBkMode' ? 2 : 0);
        context[name] = value;
        return previous;
      });
    installNativeDIBs(this);
    installNativeGDIBitmaps(this);
    installNativeFontEnumeration(this);
  }
  createObject(kind, values) {
    const handle = this.nextObject++;
    this.objects.set(handle, { kind, ...values });
    return handle;
  }
  object(handle, kind) {
    const object = this.objects.get(handle);
    if (!object || (kind && object.kind !== kind))
      throw new Error(`Invalid native text GDI ${kind || 'object'} ${handle}`);
    return object;
  }
  font(dc) {
    const id = this.object(dc, 'dc').font;
    return id
      ? this.object(id, 'font')
      : { face: 'sans-serif', height: -16, width: 0, weight: 400, escapement: 0, orientation: 0 };
  }
  resolve(symbol) {
    const key = `${symbol.dll.toLowerCase()}!${symbol.name || '#' + symbol.ordinal}`;
    if (this.functions.has(key)) return this.functions.get(key);
    const definition = this.definitions.get(symbol.name);
    if (!definition) return this.kernel.resolve(symbol);
    const address = this.process.trap(`text:${key}`, definition.count, (args) => {
      this.calls.set(key, (this.calls.get(key) || 0) + 1);
      return definition.fn(args);
    });
    this.functions.set(key, address);
    return address;
  }
  glyphOutline([dc, code, format, metrics, capacity, output, matrix], wide) {
    const p = this.process,
      transform = new DataView(p.read(matrix, 16).buffer);
    if ([0x00010000, 0, 0, 0x00010000].some((v, i) => transform.getUint32(i * 4, true) !== v))
      throw new Error('Native text GDI glyph matrix requires its recovered identity transform');
    if (![0, 1, 4, 5, 6].includes(format))
      throw new Error(`Unsupported native text GDI glyph format ${format}`);
    const character = wide
        ? String.fromCharCode(code)
        : new TextDecoder('shift_jis').decode(
            Uint8Array.from(code > 255 ? [code >>> 8, code & 255] : [code]),
          ),
      glyph = this.glyphs.glyph(this.font(dc), character),
      stride = format === 1 ? Math.ceil(glyph.width / 32) * 4 : Math.ceil(glyph.width / 4) * 4,
      bytes = new Uint8Array(stride * glyph.height);
    [glyph.width, glyph.height, glyph.originX, glyph.originY].forEach((v, i) =>
      p.store(metrics + i * 4, v),
    );
    const advance = new Uint8Array(4),
      view = new DataView(advance.buffer);
    view.setInt16(0, glyph.advanceX, true);
    view.setInt16(2, glyph.advanceY, true);
    p.write(metrics + 16, advance);
    if (!format) return 0;
    if (!output || !capacity) return bytes.length;
    if (capacity < bytes.length) return 0xffffffff;
    const levels = format === 4 ? 4 : format === 5 ? 16 : 64;
    for (let y = 0; y < glyph.height; y++)
      for (let x = 0; x < glyph.width; x++) {
        const alpha = glyph.alpha[y * glyph.width + x];
        if (format === 1) {
          if (alpha >= 128) bytes[y * stride + (x >>> 3)] |= 0x80 >>> (x & 7);
        } else bytes[y * stride + x] = Math.round((alpha * levels) / 255);
      }
    p.write(output, bytes);
    return bytes.length;
  }
  snapshot() {
    return { nextObject: this.nextObject, objects: structuredClone([...this.objects]) };
  }
  restore(state) {
    this.nextObject = state.nextObject;
    this.objects = new Map(structuredClone(state.objects));
  }
}
