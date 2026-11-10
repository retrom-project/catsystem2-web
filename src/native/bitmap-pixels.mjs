// SPDX-License-Identifier: MPL-2.0
// Integer bitmap arithmetic follows the reviewed packed-pixel algorithms.
import { resampleBitmap } from './image.mjs';
const f = Math.fround;
export async function bitmapColor(bitmap, mode, argument) {
  const s = bitmap.state;
  if (
    s.bpp !== 4 ||
    (mode === 'alpha' && argument === 100) ||
    (mode === 'filter' && ![1, 2, 3].includes(argument))
  )
    return;
  const pixels = await bitmap.pixels(),
    packed = argument >>> 0;
  const lut =
    mode === 'alpha'
      ? Uint8Array.from({ length: 256 }, (_, i) =>
          Math.min(255, Math.floor((Math.imul(i, argument) >>> 0) / 100)),
        )
      : null;
  const scales = [0.29891199, 0.58661097, 0.114478].map((v) =>
    Uint8Array.from({ length: 256 }, (_, i) => Math.trunc(f(f(i) * f(v)))),
  );
  for (let at = 0; at < pixels.length; at += 4) {
    if (mode === 'multiply') {
      for (let c = 0; c < 3; c++)
        pixels[at + c] = Math.floor((pixels[at + c] * ((packed >>> (16 - 8 * c)) & 255)) / 255);
      pixels[at + 3] = Math.floor((pixels[at + 3] * (packed >>> 24)) / 255);
    } else if (mode === 'alpha') pixels[at + 3] = lut[pixels[at + 3]];
    else if (argument === 3) for (let c = 0; c < 3; c++) pixels[at + c] = 255 - pixels[at + c];
    else {
      const y = scales[0][pixels[at]] + scales[1][pixels[at + 1]] + scales[2][pixels[at + 2]];
      pixels.set(
        argument === 2
          ? [Math.min(255, y + 30), Math.min(255, y + 5), Math.max(0, y - 35)]
          : [y, y, y],
        at,
      );
    }
  }
  s.source = null;
  await bitmap.changed();
}
export async function bitmapSample(bitmap, x, y, color = false) {
  const s = bitmap.state,
    px = ((x | 0) - s.offsetX) >>> 0,
    py = ((y | 0) - s.offsetY) >>> 0;
  if (!color && s.bpp === 3) return 255;
  if (px >= s.width || py >= s.height) return 0;
  const pixels = await bitmap.pixels(),
    at = ((s.height - 1 - py) * s.width + px) * 4;
  const channels = Array.from(pixels.subarray(at, at + 4));
  if (s.bpp === 2) for (let c = 0; c < 4; c++) channels[c] = Math.floor(channels[c] / 17);
  if (!color) return channels[3];
  if (s.bpp === 2) for (let c = 0; c < 4; c++) channels[c] <<= 4;
  return (
    (((s.bpp === 3 ? 0 : channels[3]) << 24) |
      (channels[0] << 16) |
      (channels[1] << 8) |
      channels[2]) >>>
    0
  );
}
export async function bitmapTransform(bitmap, mode, argument) {
  const s = bitmap.state,
    W = s.width,
    H = s.height,
    CW = s.canvasWidth,
    CH = s.canvasHeight;
  if (mode === 'rotate' && ![90, 180, 270].includes(argument)) return;
  const swap = mode === 'rotate' && argument !== 180,
    nw = swap ? H : W,
    nh = swap ? W : H;
  if (mode === 'rotate' && nw * s.bpp > 4 && (nw * s.bpp) % 4)
    throw new RangeError(
      `Original bitmap rotation cannot fit a ${nw * s.bpp}-byte row in a four-byte stride`,
    );
  const source = await bitmap.pixels(),
    rgba = new Uint8ClampedArray(nw * nh * 4);
  for (let y = 0; y < H; y++)
    for (let x = 0; x < W; x++) {
      const [dx, dy] =
        mode === 'mirror'
          ? argument
            ? [W - 1 - x, y]
            : [x, H - 1 - y]
          : argument === 90
            ? [y, W - 1 - x]
            : argument === 180
              ? [W - 1 - x, H - 1 - y]
              : [H - 1 - y, x];
      rgba.set(source.subarray((y * W + x) * 4, (y * W + x) * 4 + 4), (dy * nw + dx) * 4);
    }
  const transform = (x, y) =>
    mode === 'mirror'
      ? argument
        ? [CW - x, y]
        : [x, CH - y]
      : argument === 90
        ? [CH - y, x]
        : argument === 180
          ? [CW - x, CH - y]
          : [y, CW - x];
  [s.baseX, s.baseY] = transform(s.baseX, s.baseY);
  [s.offsetX, s.offsetY] =
    mode === 'mirror'
      ? argument
        ? [CW - W - s.offsetX, s.offsetY]
        : [s.offsetX, CH - H - s.offsetY]
      : argument === 90
        ? [CH - H - s.offsetY, s.offsetX]
        : argument === 180
          ? [CW - W - s.offsetX, CH - H - s.offsetY]
          : [s.offsetY, CW - W - s.offsetX];
  for (const attr of s.attributes ?? [])
    [attr.rect[0], attr.rect[1]] = transform(attr.rect[0], attr.rect[1]);
  Object.assign(s, { width: nw, height: nh, rgba, source: null });
  if (mode === 'rotate') {
    if (swap) [s.canvasWidth, s.canvasHeight] = [CH, CW];
    s.clip = [0, 0, nw, nh];
  }
  await bitmap.changed();
}
export async function bitmapTransfer(world, destination, source, args, copy, task) {
  if (!destination) {
    const platform = await world.getNativeFeature('graphics-platform');
    await platform.ensureRenderer();
    return platform.withBitmap(
      source,
      (p) => platform.copyBitmap(p, ...args.slice(6, 10), args[1], args[2]),
      task.id,
    );
  }
  let [sx, sy, width, height] = args.slice(6, 10).map((v) => v | 0);
  let dx = (args[1] + source.state.offsetX) | 0,
    dy = (args[2] + source.state.offsetY) | 0;
  const intersect = (r, b) => [
    Math.max(r[0], b[0]),
    Math.max(r[1], b[1]),
    Math.min(r[2], b[2]),
    Math.min(r[3], b[3]),
  ];
  const crop = (r, s) => {
    const ox = s.offsetX,
      oy = s.offsetY,
      b = intersect(r, [ox, oy, ox + s.width, oy + s.height]);
    return [b[0] - ox, b[1] - oy, b[2] - ox, b[3] - oy];
  };
  const clipped = copy || args.operation === 'clipped-blend';
  const sr = clipped
    ? crop([sx, sy, sx + width, sy + height], source.state)
    : intersect([sx, sy, sx + width, sy + height], [0, 0, source.width, source.height]);
  const dr = clipped
    ? crop([dx, dy, dx + (args[3] | 0), dy + (args[4] | 0)], destination.state)
    : intersect([dx, dy, dx + width, dy + height], [0, 0, destination.width, destination.height]);
  if (sr[0] >= sr[2] || sr[1] >= sr[3] || dr[0] >= dr[2] || dr[1] >= dr[3]) return;
  if (copy && (sr[2] - sr[0] !== dr[2] - dr[0] || sr[3] - sr[1] !== dr[3] - dr[1])) {
    const sw = sr[2] - sr[0],
      sh = sr[3] - sr[1],
      dw = dr[2] - dr[0],
      dh = dr[3] - dr[1],
      physical = new Uint8ClampedArray(source.width * source.height * 4),
      input = await source.pixels();
    for (let y = 0; y < source.height; y++)
      physical.set(
        input.subarray(
          (source.height - 1 - y) * source.width * 4,
          (source.height - y) * source.width * 4,
        ),
        y * source.width * 4,
      );
    const scaled = resampleBitmap(physical, source.width, source.height, dw, dh, {
        width: sw,
        height: sh,
        x: sr[0],
        y: sr[1],
      }),
      logical = new Uint8ClampedArray(scaled.length);
    for (let y = 0; y < dh; y++)
      logical.set(scaled.subarray(y * dw * 4, (y + 1) * dw * 4), (dh - 1 - y) * dw * 4);
    return destination.blit(
      { width: dw, height: dh, pixels: async () => logical },
      { dx: dr[0], dy: destination.height - dr[1] - dh, width: dw, height: dh, copy: true },
    );
  }
  width = Math.min(sr[2] - sr[0], dr[2] - dr[0]);
  height = Math.min(sr[3] - sr[1], dr[3] - dr[1]);
  sx = sr[0];
  sy = sr[1];
  dx = dr[0];
  dy = dr[1];
  return destination.blit(source, {
    sx,
    sy: source.height - sy - height,
    dx,
    dy: destination.height - dy - height,
    width,
    height,
    copy,
  });
}
export async function bitmapBlur(bitmap, radiusX, radiusY) {
  const s = bitmap.state;
  if (![3, 4].includes(s.bpp)) return;
  const rx = Math.max(0, Math.min(255, radiusX | 0)),
    ry = Math.max(0, Math.min(255, radiusY | 0));
  const ex = s.bpp === 4 ? rx : radiusX | 0,
    ey = s.bpp === 4 ? ry : radiusY | 0;
  if (ex < 0 || ey < 0 || !s.width || !s.height) return;
  const oldX = s.offsetX,
    oldY = s.offsetY;
  if (!(await bitmapExpand(bitmap, ex, s.bpp === 3 ? ey : ex, s.bpp === 3 ? ex : ey, ey))) return;
  const { width, height } = s,
    input = await bitmap.pixels();
  function pass(source, radius, vertical) {
    if (!radius) return source.slice();
    const output = new Uint8ClampedArray(source.length),
      reciprocal = Math.trunc((s.bpp === 4 ? 65536 : 256) / (radius + 1));
    const weights = Array.from({ length: radius * 2 + 1 }, (_, i) =>
      Math.trunc(((radius + 1 - Math.abs(i - radius)) * 256 + (radius >> 1)) / (radius + 1)),
    );
    for (let y = 0; y < height; y++)
      for (let x = 0; x < width; x++) {
        const samples = [];
        for (let d = -radius; d <= radius; d++) {
          const sx = vertical ? x : Math.max(0, Math.min(width - 1, x + d)),
            sy = vertical ? Math.max(0, Math.min(height - 1, y + d)) : y;
          samples.push((sy * width + sx) * 4);
        }
        const means = [0, 0, 0];
        let nonzero = 0;
        for (const at of samples)
          if (source[at + 3]) {
            nonzero++;
            for (let c = 0; c < 3; c++) means[c] += source[at + c];
          }
        if (nonzero) for (let c = 0; c < 3; c++) means[c] = Math.trunc(means[c] / nonzero);
        if (s.bpp === 4 && !nonzero) continue;
        for (let c = 0; c < (s.bpp === 4 ? 4 : 3); c++) {
          let sum = 0;
          for (let i = 0; i < samples.length; i++) {
            const at = samples[i],
              a = source[at + 3];
            const v =
              s.bpp === 3 || c === 3 || a === 255
                ? source[at + c]
                : a
                  ? (means[c] * (255 - a) + a * source[at + c]) >>> 8
                  : means[c];
            sum = (sum + weights[i] * v) | 0;
          }
          const product = Math.imul(reciprocal, sum) >>> 0;
          const value =
            s.bpp === 4
              ? (product >>> 24) +
                Number(
                  (product &
                    0x800000) /* exe-address-check: non-address - bit 23 is the integer blur rounding bit */ !==
                    0,
                )
              : product >>> 16;
          // The 24-bit horizontal helper writes only its B result to consecutive
          // bytes. Unwritten temporary storage is explicitly zero-initialized.
          if (s.bpp === 3 && !vertical) {
            if (c === 2) {
              const raw = y * width * 3 + x;
              const pixel = Math.trunc(raw / 3),
                channel = 2 - (raw % 3);
              output[pixel * 4 + channel] = value;
            }
          } else output[(y * width + x) * 4 + c] = value;
        }
        if (s.bpp === 3) output[(y * width + x) * 4 + 3] = 255;
      }
    return output;
  }
  const rgba = pass(pass(input, rx, false), ry, true);
  Object.assign(s, {
    baseX: s.baseX + oldX - s.offsetX,
    baseY: s.baseY + oldY - s.offsetY,
    rgba,
    source: null,
  });
  await bitmap.changed();
}

export async function bitmapExpand(bitmap, left, right, bottom, top) {
  const s = bitmap.state;
  if ([left, right, bottom, top].some((v) => v < 0) || !s.width || !s.height) return false;
  left = Math.min(left, s.offsetX);
  bottom = Math.min(bottom, s.offsetY);
  right = Math.min(right, s.canvasWidth - s.width - s.offsetX);
  top = Math.min(top, s.canvasHeight - s.height - s.offsetY);
  const width = s.width + left + right,
    height = s.height + top + bottom;
  if (width < 0 || height < 0)
    throw new RangeError('Bitmap canvas does not contain its physical image');
  const old = await bitmap.pixels(),
    rgba = new Uint8ClampedArray(width * height * 4);
  if (s.bpp === 3) for (let at = 3; at < rgba.length; at += 4) rgba[at] = 255;
  for (let y = 0; y < s.height; y++)
    for (let x = 0; x < s.width; x++) {
      const dx = x + left,
        dy = y + top;
      if (dx >= 0 && dy >= 0 && dx < width && dy < height)
        rgba.set(
          old.subarray((y * s.width + x) * 4, (y * s.width + x) * 4 + 4),
          (dy * width + dx) * 4,
        );
    }
  Object.assign(s, {
    width,
    height,
    offsetX: s.offsetX - left,
    offsetY: s.offsetY - bottom,
    clip: [0, 0, width, height],
    rgba,
    source: null,
  });
  await bitmap.changed();
  return true;
}
