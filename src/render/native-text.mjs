// SPDX-License-Identifier: MPL-2.0
// Canvas supplies glyph masks; the JS parser owns layout and reveal.
// The fallback is a pinned OFL font, never a host system font.
export const FIXED_TEXT_FAMILY = 'CatSystem2 Noto Sans JP';
let fixedFontLoading;
export class CanvasTextGlyphs {
  constructor({ family = () => FIXED_TEXT_FAMILY, canvas = () => new OffscreenCanvas(1, 1) } = {}) {
    Object.assign(this, { family, canvasFactory: canvas });
    this.canvas = null;
    this.ctx = null;
    this.cache = new Map();
  }
  async ready() {
    if (typeof FontFace === 'undefined') return;
    fixedFontLoading ??= (async () => {
      const bytes = await (
        await fetch(new URL('../../third_party/fonts/noto-sans-jp/NotoSansJP.ttf', import.meta.url))
      ).arrayBuffer();
      const face = new FontFace(FIXED_TEXT_FAMILY, bytes, { weight: '100 900' });
      await face.load();
      (globalThis.document?.fonts ?? globalThis.fonts).add(face);
      return face;
    })();
    await fixedFontLoading;
  }
  prepare(font, context) {
    if (!this.ctx) {
      this.canvas = this.canvasFactory();
      this.ctx = this.canvas.getContext('2d', { willReadFrequently: true });
      if (!this.ctx) throw new Error('Native text requires a Canvas2D glyph context');
    }
    context ||= this.ctx;
    if (font.escapement || font.orientation)
      throw new Error('Native text GDI rotated font orientation is not recovered');
    const face = this.family(font.face || '') || FIXED_TEXT_FAMILY;
    if (typeof face !== 'string' || !face)
      throw new Error(`Native text font family ${font.face} is unavailable`);
    const size = Math.abs(font.height) || 16;
    context.font = `${font.italic ? 'italic ' : ''}${font.weight || 400} ${size}px ${JSON.stringify(face)}`;
    context.fontKerning = 'none';
    context.textBaseline = 'alphabetic';
    context.textAlign = 'left';
    return size;
  }
  measure(font, text) {
    const size = this.prepare(font),
      metric = this.ctx.measureText(text),
      ascent = Math.ceil(metric.fontBoundingBoxAscent ?? metric.actualBoundingBoxAscent ?? size),
      descent = Math.ceil(metric.fontBoundingBoxDescent ?? metric.actualBoundingBoxDescent ?? 0);
    return {
      width: Math.round(metric.width),
      height: ascent + descent,
      ascent,
      descent,
      averageWidth: Math.round(this.ctx.measureText('x').width),
      maximumWidth: Math.round(this.ctx.measureText('W').width),
    };
  }
  glyph(font, character) {
    const key = JSON.stringify([font, character]);
    if (this.cache.has(key)) return this.cache.get(key);
    this.prepare(font);
    const metric = this.ctx.measureText(character),
      left = Math.floor(-metric.actualBoundingBoxLeft),
      right = Math.ceil(metric.actualBoundingBoxRight),
      top = Math.ceil(metric.actualBoundingBoxAscent),
      bottom = Math.ceil(metric.actualBoundingBoxDescent),
      width = Math.max(0, right - left),
      height = Math.max(0, top + bottom),
      alpha = new Uint8Array(width * height);
    if (width && height) {
      this.canvas.width = width;
      this.canvas.height = height;
      this.prepare(font);
      this.ctx.clearRect(0, 0, width, height);
      this.ctx.fillStyle = 'white';
      this.ctx.fillText(character, -left, top);
      const rgba = this.ctx.getImageData(0, 0, width, height).data;
      for (let i = 0; i < alpha.length; i++) alpha[i] = rgba[i * 4 + 3];
    }
    const glyph = {
      width,
      height,
      originX: left,
      originY: top,
      advanceX: Math.round(metric.width),
      advanceY: 0,
      alpha,
    };
    this.cache.set(key, glyph);
    if (this.cache.size > 4096) this.cache.delete(this.cache.keys().next().value);
    return glyph;
  }
}
