// SPDX-License-Identifier: MPL-2.0
import { blendBitmapPixel, resampleBitmap } from './image.mjs';
import { blendPackedRow, packedBitmapWords } from './raster-kernel.mjs';
import { nativeGlyphRasterCache } from './font-backend.mjs';

const MAX_RASTER_BYTES = 4 * 1024 * 1024,
  MAX_RASTER_ENTRIES = 512,
  typedArray = Object.getPrototypeOf(Uint8Array.prototype),
  typedBuffer = Object.getOwnPropertyDescriptor(typedArray, 'buffer').get,
  typedLength = Object.getOwnPropertyDescriptor(typedArray, 'length').get,
  resizable = Object.getOwnPropertyDescriptor(ArrayBuffer.prototype, 'resizable')?.get;
function ordinaryBuffer(view) {
  const buffer = Reflect.apply(typedBuffer, view, []);
  return buffer instanceof ArrayBuffer && !(resizable && Reflect.apply(resizable, buffer, []));
}
function rasterIdentity(glyph, r, padding) {
  if (
    !ArrayBuffer.isView(r) ||
    Object.getPrototypeOf(r) !== Int32Array.prototype ||
    !ordinaryBuffer(r)
  )
    return null;
  const metrics = ['width', 'height', 'originX', 'originY', 'advanceX'];
  if (
    metrics.some(
      (key) => !Object.hasOwn(Object.getOwnPropertyDescriptor(glyph, key) ?? {}, 'value'),
    )
  )
    return null;
  const values = [...metrics.map((key) => glyph[key]), r[2], r[3], r[7], r[13], r[14], padding];
  if (!values.every(Number.isFinite)) return null;
  const alpha = Object.getOwnPropertyDescriptor(glyph, 'alpha')?.value;
  if (
    !ArrayBuffer.isView(alpha) ||
    Object.getPrototypeOf(alpha) !== Uint8Array.prototype ||
    !ordinaryBuffer(alpha) ||
    Reflect.apply(typedLength, alpha, []) !== glyph.width * glyph.height
  )
    return null;
  return { alpha, values, length: Reflect.apply(typedLength, alpha, []) };
}
function sameRaster(cached, current) {
  if (
    !cached ||
    cached.alpha.length !== current.length ||
    cached.values.some((value, index) => !Object.is(value, current.values[index]))
  )
    return false;
  for (let i = 0; i < current.length; i++) if (cached.alpha[i] !== current.alpha[i]) return false;
  return true;
}
function keepRaster(cache, glyph, identity, shape) {
  const bytes = shape.rgba.byteLength + identity.alpha.byteLength + identity.values.length * 8 + 32,
    previous = cache.entries.get(glyph);
  if (previous) {
    cache.bytes -= previous.bytes;
    cache.entries.delete(glyph);
  }
  if (bytes > MAX_RASTER_BYTES) return;
  cache.entries.set(glyph, {
    values: identity.values,
    alpha: Reflect.apply(Uint8Array.prototype.slice, identity.alpha, []),
    shape: { ...shape, rgba: shape.rgba.slice(), rect: [...shape.rect] },
    bytes,
  });
  cache.bytes += bytes;
  while (cache.bytes > MAX_RASTER_BYTES || cache.entries.size > MAX_RASTER_ENTRIES) {
    const key = cache.entries.keys().next().value;
    cache.bytes -= cache.entries.get(key).bytes;
    cache.entries.delete(key);
  }
}
// GDI gray64, FreeType gray256 and image-font cells share the integer compositor.
export function rasterTextGlyph(
  parser,
  r,
  {
    image = null,
    sourceRect = null,
    padding = 1,
    legacyImageAtlas = false,
    legacyKeepsTransparentRgb = false,
  } = {},
) {
  const font = parser.rasterFont?.(r) ?? parser.font(r),
    ft = Boolean(font.backend);
  if (!image && (r[1] === 32 || r[1] === 0x8140) && !ft) return empty();
  let glyph, metric;
  if (image) {
    const side = Math.max(0, r[7]);
    const physical = new Uint8ClampedArray(image.rgba.length);
    for (let y = 0; y < image.height; y++)
      physical.set(
        image.rgba.subarray(
          (image.height - 1 - y) * image.width * 4,
          (image.height - y) * image.width * 4,
        ),
        y * image.width * 4,
      );
    if (!legacyImageAtlas)
      for (let at = 0; at < physical.length; at += 4)
        if (!physical[at + 3]) physical.fill(0, at, at + 3);
    glyph = {
      width: side,
      height: side,
      rgba: resampleBitmap(
        physical,
        image.width,
        image.height,
        side,
        side,
        legacyImageAtlas && sourceRect ? { ...sourceRect, boundedSource: true } : sourceRect,
      ),
    };
  } else if (ft) {
    glyph = parser.glyphs.glyphNative(font, r[1]);
    if (!glyph) return empty();
  } else {
    glyph = parser.glyphs.glyph(font, parser.character(r));
    metric = parser.glyphs.measure(font, 'Hg');
  }
  // Native lookup still runs on every invocation. Reuse only the pure shape
  // after checking all live alpha bytes, metrics, colors and shadow inputs.
  const cache = !image && ft ? nativeGlyphRasterCache(parser.glyphs, glyph) : null,
    identity = cache && rasterIdentity(glyph, r, padding),
    cached = identity && cache.entries.get(glyph);
  if (identity && sameRaster(cached, identity))
    return { ...cached.shape, rgba: cached.shape.rgba.slice(), rect: [...cached.shape.rect] };
  const fixed = !ft && font.fixed && r[6] > glyph.advanceX,
    x = image
      ? 1
      : ft
        ? Math.max(0, glyph.originX + 1)
        : (fixed ? (r[6] - glyph.width) >>> 1 : glyph.originX) + 1,
    y = image
      ? 1
      : ft
        ? r[7] - glyph.originY + 1
        : metric.ascent - glyph.originY - Math.max(0, metric.ascent - Math.abs(r[7])) + 1,
    gw = Math.max(0, Math.min(glyph.width, 128 - x - 1)),
    gh = Math.max(0, Math.min(glyph.height, 128 - y - 1)),
    width = image ? r[7] + padding + 2 : Math.max(0, x + gw + padding + 2),
    height = image ? r[7] + padding + 2 : Math.max(0, y + gh + padding + 2),
    rgba = new Uint8ClampedArray(width * height * 4),
    base = new Uint8Array(width * height);
  for (let yy = 0; yy < gh; yy++)
    for (let xx = 0; xx < gw; xx++) {
      const px = x + xx,
        py = y + yy;
      if (px < 0 || py < 0 || px >= width || py >= height) continue;
      const out = (py * width + px) * 4,
        source = (yy * glyph.width + xx) * 4;
      let alpha = image ? glyph.rgba[source + 3] : glyph.alpha[yy * glyph.width + xx];
      if (image && legacyImageAtlas && !legacyKeepsTransparentRgb && !alpha) continue;
      if (!image && !ft) {
        alpha = Math.floor((Math.round((alpha * 64) / 255) * 255) / 64);
        if (font.weight === 700) alpha = Math.min(255, alpha * 2);
      }
      base[py * width + px] = alpha;
      for (let c = 0; c < 3; c++)
        rgba[out + c] = image ? glyph.rgba[source + c] : (r[2] >>> (8 * c)) & 255;
      rgba[out + 3] = alpha;
    }
  const main = rgba.slice(),
    around = r[14] !== 0,
    rightdown = r[13] !== 0;
  if (around || rightdown) {
    rgba.fill(0);
    const shadow = (at, alpha) => {
      for (let c = 0; c < 3; c++) rgba[at + c] = (r[3] >>> (8 * c)) & 255;
      rgba[at + 3] = Math.min(255, alpha);
    };
    if (around)
      for (let yy = 0; yy < height; yy++)
        for (let xx = 0; xx < width; xx++) {
          let alpha = 0;
          for (let dy = -1; dy <= 1; dy++)
            for (let dx = -1; dx <= 1; dx++) {
              const nx = xx + dx,
                ny = yy + dy;
              if (nx >= 0 && ny >= 0 && nx < width && ny < height) alpha += base[ny * width + nx];
            }
          shadow((yy * width + xx) * 4, alpha);
        }
    const offset = r[7] < 20 ? (padding + 1) >>> 1 : padding;
    if (rightdown)
      for (let yy = height - offset - 1; yy >= 0; yy--)
        for (let xx = width - offset - 1; xx >= 0; xx--) {
          const from = yy * width + xx,
            to = (yy + offset) * width + xx + offset;
          shadow(to * 4, rgba[to * 4 + 3] + rgba[from * 4 + 3] + base[from]);
        }
    const outputWords = packedBitmapWords(rgba),
      inputWords = packedBitmapWords(main);
    if (outputWords && inputWords)
      blendPackedRow(rgba, 0, main, 0, base.length, outputWords, inputWords, 255);
    else for (let i = 0; i < base.length; i++) blendBitmapPixel(rgba, i * 4, main, i * 4);
  }
  const shape = { width, height, rgba, rect: [0, 0, width, height] };
  if (identity) keepRaster(cache, glyph, identity, shape);
  return shape;
}
function empty() {
  return { width: 0, height: 0, rgba: new Uint8ClampedArray(), rect: [0, 0, 0, 0] };
}
export function compositeTextGlyph(destination, shape, x, y, bottomUp = false) {
  const { width, height, rgba } = destination;
  // Source and destination clipping are independent in the original blitter.
  const left = Math.max(0, x),
    top = Math.max(0, y),
    count = Math.min(shape.width, width - left),
    rows = Math.min(shape.height, height - top),
    packed =
      count > 0 &&
      rows > 0 &&
      rgba.buffer !== shape.rgba.buffer &&
      [width, height, shape.width, shape.height, left, top].every(Number.isInteger) &&
      rgba.length === width * height * 4 &&
      shape.rgba.length === shape.width * shape.height * 4,
    outputWords = packed ? packedBitmapWords(rgba) : null,
    inputWords = packed ? packedBitmapWords(shape.rgba) : null;
  for (let yy = 0; yy < rows; yy++) {
    const row = bottomUp ? height - 1 - top - yy : top + yy,
      output = (row * width + left) * 4,
      start = yy * shape.width * 4;
    if (left > 0 && rgba.subarray(output - 4, output).every((v) => !v))
      rgba.set([shape.rgba[start], shape.rgba[start + 1], shape.rgba[start + 2], 0], output - 4);
    if (outputWords && inputWords)
      blendPackedRow(rgba, output, shape.rgba, start, count, outputWords, inputWords, 255);
    else
      for (let xx = 0; xx < count; xx++)
        blendBitmapPixel(rgba, output + xx * 4, shape.rgba, start + xx * 4);
    if (
      left + count < width &&
      rgba.subarray(output + count * 4, output + count * 4 + 4).every((v) => !v)
    ) {
      const last = start + (count - 1) * 4;
      rgba.set(
        [shape.rgba[last], shape.rgba[last + 1], shape.rgba[last + 2], 0],
        output + count * 4,
      );
    }
  }
}
