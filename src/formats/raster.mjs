// SPDX-License-Identifier: MPL-2.0
import { Binary } from '../binary.mjs';
import { PNG } from './png.mjs';
import { PSD } from './psd.mjs';
import { decodeNativeJPEG } from './jpeg.mjs';

export class UnsupportedNativeImageFormat extends Error {}
const checkSize = (width, height) => {
  if (
    !Number.isSafeInteger(width) ||
    !Number.isSafeInteger(height) ||
    width < 1 ||
    height < 1 ||
    width * height > 64 * 1024 * 1024
  )
    throw new Error('Raster image unreasonable dimensions');
};
export function rasterFormat(bytes) {
  const b = new Binary(bytes);
  if (b.magic('\x89PNG\r\n\x1a\n')) return 'png';
  if (b.magic('RIFF') && b.magic('WEBP', 8)) return 'webp';
  if (bytes[0] === 255 && bytes[1] === 216) return 'jpeg';
  if (b.magic('BM')) return 'bmp';
  if (b.magic('KCF\0')) return 'kcf';
  if (b.magic('8BPS')) return 'psd';
  return null;
}

export function unpackKCLZ(bytes) {
  const b = new Binary(bytes, 'KCLZ');
  if (!b.magic('KCLZ')) throw new Error('Invalid KCLZ signature');
  const mode = b.u32(4),
    size = b.u32(8);
  if (mode > 4 || size > 256 * 1024 * 1024) throw new Error('Invalid KCLZ mode or size');
  const lengthBits = 3 + mode,
    mask = (1 << lengthBits) - 1,
    out = new Uint8Array(size);
  let flags = b.u32(20),
    data = b.u32(24),
    at = 0,
    bit = 0;
  while (at < size) {
    if (b.u8(flags) & (1 << bit)) {
      const code = b.u16(data),
        length = (code & mask) + 3,
        distance = (code >>> lengthBits) + 1;
      if (distance > at || at + length > size) throw new Error('KCLZ invalid back reference');
      for (let i = 0; i < length; i++, at++) out[at] = out[at - distance];
      data += 2;
    } else out[at++] = b.u8(data++);
    if (++bit === 8) {
      bit = 0;
      flags++;
    }
  }
  return out;
}

export class RasterImage {
  constructor(bytes, format = rasterFormat(bytes)) {
    if (!format) throw new Error('Unknown native image signature');
    Object.assign(this, { bytes, format, frames: [] });
  }
  async initialize() {
    const b = new Binary(this.bytes, this.format);
    let width, height;
    if (this.format === 'png') {
      this.png = new PNG(this.bytes);
      width = this.png.width;
      height = this.png.height;
    } else if (this.format === 'bmp') {
      const header = b.u32(14);
      if (![12, 40].includes(header))
        throw new UnsupportedNativeImageFormat(`Native BMP header ${header}`);
      width = header === 12 ? b.u16(18) : b.i32(18);
      height = header === 12 ? b.u16(20) : b.i32(22);
      this.pixelSize = (header === 12 ? b.u16(24) : b.u16(28)) / 8;
      if (![3, 4].includes(this.pixelSize))
        throw new UnsupportedNativeImageFormat('Native BMP pixel depth');
    } else if (this.format === 'kcf') {
      width = b.u16(4);
      height = b.u16(6);
      this.stride = b.u16(8);
      this.pixelSize = b.u16(10);
      if (![3, 4].includes(this.pixelSize) || this.stride < width * this.pixelSize)
        throw new UnsupportedNativeImageFormat('Native KCF pixel layout');
    } else if (this.format === 'psd') {
      this.psd = new PSD(this.bytes);
      width = this.psd.width;
      height = this.psd.height;
    } else if (this.format === 'jpeg') {
      this.jpeg = decodeNativeJPEG(this.bytes);
      width = this.jpeg.width;
      height = this.jpeg.height;
    } else {
      if (typeof createImageBitmap !== 'function')
        throw new Error(`${this.format} requires a browser image decoder`);
      this.bitmap = await createImageBitmap(
        new Blob([this.bytes], { type: `image/${this.format}` }),
        { premultiplyAlpha: 'none', colorSpaceConversion: 'none', imageOrientation: 'none' },
      );
      width = this.bitmap.width;
      height = this.bitmap.height;
    }
    checkSize(width, height);
    this.frames.push({
      id: 0,
      width,
      height,
      bpp: 32,
      canvasWidth: width,
      canvasHeight: height,
      offsetX: 0,
      offsetY: 0,
      baseX: 0,
      baseY: 0,
    });
    return this;
  }
  frame() {
    return this.frames[0];
  }
  async decode(frame) {
    if (frame.rgba) return frame;
    const { width, height } = frame;
    if (['bmp', 'kcf'].includes(this.format)) {
      const pixelSize = this.pixelSize,
        stride = this.format === 'bmp' ? (width * pixelSize + 3) & ~3 : this.stride,
        raw =
          this.format === 'bmp'
            ? new Binary(this.bytes).range(54, stride * height)
            : unpackKCLZ(this.bytes.subarray(12)),
        rgba = (frame.rgba = new Uint8ClampedArray(width * height * 4));
      if (raw.length < stride * height) throw new Error('Raster image pixel buffer is truncated');
      for (let y = 0; y < height; y++)
        for (let x = 0; x < width; x++) {
          const s = (height - y - 1) * stride + x * pixelSize,
            d = (y * width + x) * 4;
          rgba[d] = raw[s + 2];
          rgba[d + 1] = raw[s + 1];
          rgba[d + 2] = raw[s];
          rgba[d + 3] = pixelSize === 4 ? raw[s + 3] : 255;
        }
    } else if (this.format === 'png') frame.rgba = await this.png.decode();
    else if (this.format === 'psd') frame.rgba = this.psd.decode();
    else if (this.format === 'jpeg') {
      frame.rgba = new Uint8ClampedArray(width * height * 4);
      for (let y = 0; y < height; y++)
        frame.rgba.set(
          this.jpeg.data.subarray(y * width * 4, (y + 1) * width * 4),
          (height - 1 - y) * width * 4,
        );
      this.jpeg = null;
    } else {
      const canvas = new OffscreenCanvas(width, height),
        ctx = canvas.getContext('2d');
      ctx.drawImage(this.bitmap, 0, 0);
      this.bitmap.close();
      this.bitmap = null;
      frame.rgba = ctx.getImageData(0, 0, width, height).data;
    }
    return frame;
  }
}
