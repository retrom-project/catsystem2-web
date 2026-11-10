// SPDX-License-Identifier: MPL-2.0
// Adapted from CatSystemKit HGImage (OWCramer); HG decoding derives from GARbro (MIT, see NOTICE).
import { Binary, inflate } from '../binary.mjs';
import { unpackHGPixels } from './hg-codec.mjs';
import { HG2 } from './hg2.mjs';
import { RasterImage } from './raster.mjs';

export class HG3 {
  constructor(bytes) {
    this.binary = new Binary(bytes, 'HG3');
    const b = this.binary;
    if (!b.magic('HG-3')) throw new Error('Expected HG-3');
    this.frames = [];
    let at = b.u32(4);
    for (let i = 0; i < 10000; i++) {
      const next = b.u32(at),
        id = b.u32(at + 4),
        sections = new Map();
      let tag = at + 8;
      for (let j = 0; j < 10000; j++) {
        const name = b.str(tag, 8, 'utf-8'),
          step = b.u32(tag + 8),
          size = b.u32(tag + 12);
        b.range(tag + 16, size);
        sections.set(name, { at: tag + 16, size });
        if (!step) break;
        if (step < 16) throw new Error('HG3 invalid section link');
        tag += step;
      }
      const info = sections.get('stdinfo');
      if (!info || info.size < 40) throw new Error('HG3 missing stdinfo');
      const p = info.at,
        frame = {
          id,
          width: b.u32(p),
          height: b.u32(p + 4),
          bpp: b.u32(p + 8),
          offsetX: b.i32(p + 12),
          offsetY: b.i32(p + 16),
          canvasWidth: b.u32(p + 20),
          canvasHeight: b.u32(p + 24),
          baseX: b.i32(p + 32),
          baseY: b.i32(p + 36),
          sections,
        };
      if (frame.width < 1 || frame.height < 1 || frame.width * frame.height > 64 * 1024 * 1024)
        throw new Error('HG3 unreasonable dimensions');
      this.frames.push(frame);
      if (!next) return;
      if (next < 8) throw new Error('HG3 invalid frame link');
      at += next;
    }
    throw new Error('HG3 frame limit exceeded');
  }
  frame(id = 0) {
    return this.frames.find((f) => f.id === id);
  }
  async decode(frame) {
    if (frame.rgba) return frame;
    const b = this.binary,
      { width, height, sections } = frame;
    if (sections.has('img_jpg')) {
      const jpg = sections.get('img_jpg');
      if (typeof createImageBitmap === 'undefined')
        throw new Error('JPEG decoding needs a browser image decoder');
      const image = await createImageBitmap(
        new Blob([b.range(jpg.at, jpg.size)], { type: 'image/jpeg' }),
        { premultiplyAlpha: 'none' },
      );
      const canvas = new OffscreenCanvas(width, height),
        context = canvas.getContext('2d');
      context.drawImage(image, 0, 0);
      image.close();
      const rgba = context.getImageData(0, 0, width, height).data;
      const alpha = sections.get('img_al');
      if (alpha) {
        const values = await inflate(b.range(alpha.at + 8, b.u32(alpha.at)), b.u32(alpha.at + 4));
        if (values.length !== width * height) throw new Error('HG3 invalid alpha dimensions');
        for (let i = 0; i < values.length; i++) rgba[i * 4 + 3] = values[i];
      }
      frame.rgba = rgba;
    } else {
      frame.rgba = new Uint8ClampedArray(width * height * 4);
      const parts = [...sections].filter(([name]) => /^img\d+$/.test(name));
      if (!parts.length) throw new Error('HG3 missing pixels');
      for (const [, part] of parts) await this.decodePart(frame, part);
    }
    return frame;
  }
  async decodePart(frame, part) {
    const b = this.binary,
      p = part.at;
    if (part.size < 24 || ![24, 32].includes(frame.bpp))
      throw new Error('Unsupported HG3 pixel encoding');
    const top = b.u32(p),
      rows = b.u32(p + 4),
      packed = b.u32(p + 8),
      controlPacked = b.u32(p + 16);
    const [data, control] = await Promise.all([
      inflate(b.range(p + 24, packed), b.u32(p + 12)),
      inflate(b.range(p + 24 + packed, controlPacked), b.u32(p + 20)),
    ]);
    if (!rows || top + rows > frame.height || 24 + packed + controlPacked > part.size)
      throw new Error('HG3 part bounds');
    const pixelSize = frame.bpp / 8,
      stride = frame.width * pixelSize,
      pixels = unpackHGPixels(data, control, frame.width, rows, pixelSize);
    for (let y = 0; y < rows; y++)
      for (let x = 0; x < frame.width; x++) {
        // The native HG3 decoder writes the first expanded row through its
        // logical (0, partTop) accessor, then advances down the image. Its DIB
        // storage is bottom-up; the public RGBA frame already uses logical rows.
        const src = y * stride + x * pixelSize,
          dst = ((top + y) * frame.width + x) * 4;
        frame.rgba[dst] = pixels[src + 2];
        frame.rgba[dst + 1] = pixels[src + 1];
        frame.rgba[dst + 2] = pixels[src];
        frame.rgba[dst + 3] = pixelSize === 4 ? pixels[src + 3] : 255;
      }
  }
}

export async function openImage(bytes) {
  const b = new Binary(bytes);
  if (b.magic('HG-2')) return new HG2(bytes);
  if (b.magic('HG-3')) return new HG3(bytes);
  return new RasterImage(bytes).initialize();
}

export class ImageStore {
  constructor(game, budget = 128 * 1024 * 1024) {
    this.game = game;
    this.images = new Map();
    this.pending = new Map();
    this.budget = budget;
    this.memory = 0;
  }
  resolve(name) {
    return this.game.resolveCategory
      ? this.game.resolveCategory(name, 'image')
      : this.game.resolve?.(name, [
          'hg3',
          'hg2',
          'png',
          'jpg',
          'jpeg',
          'bmp',
          'kcf',
          'webp',
          'psd',
        ]) || name;
  }
  async load(name) {
    const file = this.resolve(name);
    if (file === null) throw new Error(`Missing image resource: ${name}`);
    const key = file.toLowerCase();
    if (this.images.has(key)) {
      const image = this.images.get(key);
      this.images.delete(key);
      this.images.set(key, image);
      return image;
    }
    if (!this.pending.has(key))
      this.pending.set(
        key,
        this.game
          .require(file)
          .then(async (b) => {
            const image = await openImage(b);
            this.images.set(key, image);
            return image;
          })
          .finally(() => this.pending.delete(key)),
      );
    return this.pending.get(key);
  }
  async frame(name, id = 0) {
    const image = await this.load(name),
      frame = image.frame(id) || image.frames[0];
    if (!frame.rgba) {
      await image.decode(frame);
      this.memory += frame.rgba.byteLength;
    }
    while (this.memory > this.budget && this.images.size > 1) {
      const first = this.images.keys().next().value,
        old = this.images.get(first);
      this.images.delete(first);
      for (const f of old.frames) this.memory -= f.rgba?.byteLength || 0;
    }
    return frame;
  }
}
