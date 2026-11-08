// SPDX-License-Identifier: MPL-2.0
// HG-2 versions 0x10/0x20/0x25 and the native global-file bitmap codec.
// Fixed engine decoder 6A0750 and writer 6A0600/6A0DE0.
import { Binary, inflate } from '../binary.mjs';
import { packHGPixels, unpackHGPixels } from './hg-codec.mjs';
const dimensions = (width, height) => {
  if (
    !Number.isSafeInteger(width) ||
    !Number.isSafeInteger(height) ||
    width < 1 ||
    height < 1 ||
    width * height > 64 * 1024 * 1024
  )
    throw new Error('HG2 unreasonable dimensions');
};
export class HG2 {
  constructor(bytes) {
    const b = (this.binary = new Binary(bytes, 'HG2'));
    if (!b.magic('HG-2')) throw new Error('Expected HG-2');
    this.version = b.u16(8);
    if (![0x10, 0x20, 0x25].includes(this.version))
      throw new Error(`Unsupported HG2 version ${this.version}`);
    this.frames = [];
    let at = 12;
    for (let n = 0; n < 10000; n++) {
      const extended = this.version > 0x10,
        width = b.u32(at),
        height = b.u32(at + 4),
        extensionSize = extended ? b.u32(at + 36) : 0,
        packed = b.u32(at + 20),
        controlPacked = b.u32(at + 28),
        frame = {
          id: extended ? b.u32(at + 40) : 0,
          width,
          height,
          bpp: b.u16(at + 8),
          depth: b.u16(at + 10),
          canvasWidth: extended ? b.u32(at + 44) : width,
          canvasHeight: extended ? b.u32(at + 48) : height,
          offsetX: extended ? b.i32(at + 52) : 0,
          offsetY: extended ? b.i32(at + 56) : 0,
          alpha: extended ? Boolean(b.u32(at + 60)) : undefined,
          baseX: this.version === 0x25 ? b.i32(at + 68) : 0,
          baseY: this.version === 0x25 ? b.i32(at + 72) : 0,
          packed,
          controlPacked,
          unpacked: b.u32(at + 24),
          controlUnpacked: b.u32(at + 32),
          dataAt: at + 36 + extensionSize,
        };
      dimensions(width, height);
      if (![24, 32].includes(frame.bpp) || frame.depth > 7)
        throw new Error('Unsupported HG2 pixel encoding');
      if (extended && extensionSize < (this.version === 0x25 ? 40 : 32))
        throw new Error('HG2 invalid extension size');
      b.range(frame.dataAt, packed + controlPacked);
      this.frames.push(frame);
      const next = extended ? b.u32(at + 64) : 0;
      if (!next) return;
      if (next < 36 + extensionSize + packed + controlPacked)
        throw new Error('HG2 invalid frame link');
      at += next;
    }
    throw new Error('HG2 frame limit exceeded');
  }
  frame(id = 0) {
    return this.version === 0x10 ? this.frames[0] : this.frames.find((f) => f.id === id);
  }
  async decode(frame) {
    if (frame.rgba) return frame;
    const { width, height, bpp, depth, dataAt, packed, controlPacked } = frame,
      b = this.binary;
    const [data, control] = await Promise.all([
      inflate(b.range(dataAt, packed), frame.unpacked),
      inflate(b.range(dataAt + packed, controlPacked), frame.controlUnpacked),
    ]);
    const pixelSize = bpp / 8,
      pixels = unpackHGPixels(data, control, width, height, pixelSize);
    // Match the shipped codec's byte shifts, including alpha; these differ
    // from multiplying a low-depth channel by 255/(2^depth-1).
    if (depth)
      for (let i = 0; i < pixels.length; i++)
        pixels[i] = (pixels[i] << (8 - depth)) | (pixels[i] >>> (depth * 2 - 8));
    const rgba = (frame.rgba = new Uint8ClampedArray(width * height * 4));
    for (let y = 0; y < height; y++)
      for (let x = 0; x < width; x++) {
        const src = (y * width + x) * pixelSize,
          dst = (y * width + x) * 4;
        rgba[dst] = pixels[src + 2];
        rgba[dst + 1] = pixels[src + 1];
        rgba[dst + 2] = pixels[src];
        rgba[dst + 3] = pixelSize === 4 ? pixels[src + 3] : 255;
      }
    return frame;
  }
}
const compress = async (bytes) =>
  new Uint8Array(
    await new Response(
      new Blob([bytes]).stream().pipeThrough(new CompressionStream('deflate')),
    ).arrayBuffer(),
  );

export async function encodeHG2(
  frame,
  { crop = true, clearTransparent = true, id = 0, baseX = 0, baseY = 0 } = {},
) {
  const { width: originalWidth, height: originalHeight, rgba } = frame;
  dimensions(originalWidth, originalHeight);
  if (
    !(rgba instanceof Uint8Array || rgba instanceof Uint8ClampedArray) ||
    rgba.length !== originalWidth * originalHeight * 4
  )
    throw new Error('HG2 invalid RGBA buffer');
  const pixelSize = frame.bpp === 3 || frame.bpp === 24 ? 3 : 4;
  let left = 0,
    top = 0,
    width = originalWidth,
    height = originalHeight;
  if (crop && pixelSize === 4) {
    let right = 0,
      bottom = 0;
    left = width;
    top = height;
    for (let y = 0; y < originalHeight; y++)
      for (let x = 0; x < originalWidth; x++)
        if (rgba[(y * originalWidth + x) * 4 + 3]) {
          left = Math.min(left, x);
          top = Math.min(top, y);
          right = Math.max(right, x + 1);
          bottom = Math.max(bottom, y + 1);
        }
    if (!right || !bottom) {
      left = top = 0;
      right = Math.min(2, originalWidth);
      bottom = Math.min(2, originalHeight);
    }
    width = right - left;
    height = bottom - top;
  }
  const raw = new Uint8Array(width * height * pixelSize);
  let alpha = false;
  for (let y = 0; y < height; y++)
    for (let x = 0; x < width; x++) {
      const src = ((top + y) * originalWidth + left + x) * 4,
        dst = (y * width + x) * pixelSize,
        blank = clearTransparent && pixelSize === 4 && !rgba[src + 3];
      raw[dst] = blank ? 0 : rgba[src + 2];
      raw[dst + 1] = blank ? 0 : rgba[src + 1];
      raw[dst + 2] = blank ? 0 : rgba[src];
      if (pixelSize === 4) {
        raw[dst + 3] = rgba[src + 3];
        alpha ||= rgba[src + 3] !== 255;
      }
    }
  const { data, control } = packHGPixels(raw, width, height, pixelSize),
    [packed, packedControl] = await Promise.all([compress(data), compress(control)]),
    out = new Uint8Array(88 + packed.length + packedControl.length),
    v = new DataView(out.buffer);
  out.set([72, 71, 45, 50]);
  for (const [at, value] of [
    [4, 12],
    [8, 0x25],
    [12, width],
    [16, height],
    [32, packed.length],
    [36, data.length],
    [40, packedControl.length],
    [44, control.length],
    [48, 40],
    [52, id],
    [56, originalWidth],
    [60, originalHeight],
    [64, left],
    [68, top],
    [72, Number(alpha)],
    [80, baseX],
    [84, baseY],
  ])
    v.setUint32(at, value >>> 0, true);
  v.setUint16(20, pixelSize * 8, true);
  out.set(packed, 88);
  out.set(packedControl, 88 + packed.length);
  return out;
}
