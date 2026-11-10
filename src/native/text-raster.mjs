// SPDX-License-Identifier: MPL-2.0
import { blendBitmapPixel, resampleBitmap } from './image.mjs';
// GDI gray64, FreeType gray256 and image-font cells share the integer compositor.
export function rasterTextGlyph(parser, r, { image = null, sourceRect = null, padding = 1 } = {}) {
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
    for (let at = 0; at < physical.length; at += 4)
      if (!physical[at + 3]) physical.fill(0, at, at + 3);
    glyph = {
      width: side,
      height: side,
      rgba: resampleBitmap(physical, image.width, image.height, side, side, sourceRect),
    };
  } else if (ft) {
    glyph = parser.glyphs.glyphNative(font, r[1]);
    if (!glyph) return empty();
  } else {
    glyph = parser.glyphs.glyph(font, parser.character(r));
    metric = parser.glyphs.measure(font, 'Hg');
  }
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
    for (let i = 0; i < base.length; i++) blendBitmapPixel(rgba, i * 4, main, i * 4);
  }
  return { width, height, rgba, rect: [0, 0, width, height] };
}
function empty() {
  return { width: 0, height: 0, rgba: new Uint8ClampedArray(), rect: [0, 0, 0, 0] };
}
export function compositeTextGlyph(destination, shape, x, y) {
  const { width, height, rgba } = destination;
  // Source and destination clipping are independent in the original blitter.
  const left = Math.max(0, x),
    top = Math.max(0, y),
    count = Math.min(shape.width, width - left),
    rows = Math.min(shape.height, height - top);
  for (let yy = 0; yy < rows; yy++) {
    const output = ((top + yy) * width + left) * 4,
      start = yy * shape.width * 4;
    if (left > 0 && rgba.subarray(output - 4, output).every((v) => !v))
      rgba.set([shape.rgba[start], shape.rgba[start + 1], shape.rgba[start + 2], 0], output - 4);
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
