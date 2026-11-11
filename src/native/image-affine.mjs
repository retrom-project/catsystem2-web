// SPDX-License-Identifier: MPL-2.0
// Original CPU affine pipeline: 8742A0 / 7482E0 / 874680 / 874BD0.
// Matrices use signed 15-bit fixed point; each native multiply has its own shift.
import { blendBitmapPixel } from './image.mjs';

const f = Math.fround;
const i32 = (n) => Number(BigInt.asIntN(32, n));
const i64 = (n) => BigInt.asIntN(64, n);
const product = (a, b) => BigInt(a) * BigInt(b);
const shiftedProduct = (a, b) => i32(product(a, b) >> 15n);
const sine = Int32Array.from({ length: 32769 }, (_, i) =>
  Math.trunc(Math.sin(i * ((2 * Math.PI) / 32768)) * 32768),
);

export function fixed15(value) {
  value = f(value);
  const whole = f(Math.floor(value));
  return (Math.trunc(whole) << 15) | Math.trunc(f(f(value - whole) * 32768));
}
function sineAt(angle) {
  return angle >= 0 ? sine[angle & 32767] : sine[32768 - (Math.abs(angle) & 32767)];
}
function transform(matrix, x, y) {
  return [
    (matrix[6] + shiftedProduct(matrix[0], x) + shiftedProduct(matrix[3], y)) | 0,
    (matrix[7] + shiftedProduct(matrix[1], x) + shiftedProduct(matrix[4], y)) | 0,
  ];
}
function bounds(points) {
  const rect = [points[0][0], points[0][1], (points[0][0] + 1) | 0, (points[0][1] + 1) | 0];
  for (const [x, y] of points.slice(1)) {
    rect[0] = Math.min(rect[0], x);
    rect[1] = Math.min(rect[1], y);
    rect[2] = Math.max(rect[2], x);
    rect[3] = Math.max(rect[3], y);
  }
  return rect;
}
function inverse(matrix) {
  const m = matrix.map(BigInt);
  const cofactor = (a, b, c, d) => i64(i64(m[a] * m[b] - m[c] * m[d]) >> 15n);
  const c = [
    cofactor(4, 8, 5, 7),
    cofactor(2, 7, 1, 8),
    cofactor(1, 5, 2, 4),
    cofactor(6, 5, 3, 8),
    cofactor(0, 8, 6, 2),
    cofactor(3, 2, 0, 5),
    cofactor(3, 7, 6, 4),
    cofactor(6, 1, 0, 7),
    cofactor(0, 4, 3, 1),
  ];
  const determinant = i64(i64(m[6] * c[2] + m[3] * c[1] + m[0] * c[0]) >> 15n);
  // The original deliberately retains the forward matrix when singular.
  if (!determinant) return matrix;
  const scale = BigInt(i32(0x40000000n / determinant));
  return c.map((value) => i32(i64(value * scale) >> 15n));
}

export function prepareBitmapAffine({
  width,
  height,
  sourceWidth,
  sourceHeight,
  position = [0, 0],
  base = [0, 0],
  rotation = 0,
  scale = [1, 1],
  clip = [0, 0, width, height],
}) {
  const angle = Math.trunc(f(f(f(rotation) / f(2 * Math.PI)) * 32768)) & 65535;
  const sin = sineAt(angle),
    cos = sineAt(8192 - angle);
  const sx = fixed15(scale[0]),
    sy = fixed15(scale[1]);
  const forward = [
    shiftedProduct(sx, cos),
    i32(-product(sy, sin) >> 15n),
    0,
    shiftedProduct(sx, sin),
    shiftedProduct(sy, cos),
    0,
    0,
    0,
    32768,
  ];
  const x = fixed15(-f(base[0])),
    y = fixed15(-f(base[1]));
  const right = (x + (sourceWidth << 15)) | 0,
    bottom = (y + (sourceHeight << 15)) | 0;
  const corners = [
    [x, y],
    [right, y],
    [x, bottom],
    [right, bottom],
  ].map(([a, b]) => transform(forward, a, b));
  const fixedBounds = bounds(corners),
    rounded = bounds(corners.map(([a, b]) => [a >> 15, b >> 15]));
  const px = Math.trunc(f(position[0])),
    py = Math.trunc(f(position[1]));
  const area = [
    Math.max(0, clip[0], rounded[0] + px - Number(!!(fixedBounds[0] & 32767))),
    Math.max(0, clip[1], rounded[1] + py - Number(!!(fixedBounds[1] & 32767))),
    Math.min(width, clip[2], rounded[2] + px + Number(!!(fixedBounds[2] & 32767))),
    Math.min(height, clip[3], rounded[3] + py + Number(!!(fixedBounds[3] & 32767))),
  ];
  if (area[0] >= area[2] || area[1] >= area[3]) area.fill(0);
  const transformedBase = transform(forward, fixed15(base[0]), fixed15(base[1])).map(
    (v) => v >> 15,
  );
  return {
    area,
    matrix: inverse(forward),
    transformedBase,
    position: position.map(fixed15),
    base: base.map((v) => Math.trunc(f(v))),
  };
}

export function affineBitmap(
  destination,
  width,
  height,
  source,
  sourceWidth,
  sourceHeight,
  options = {},
) {
  const prepared = prepareBitmapAffine({ ...options, width, height, sourceWidth, sourceHeight });
  const { area, matrix, transformedBase, position, base } = prepared;
  const alpha = options.alpha ?? 255;
  if (!alpha) return prepared;
  const sample = new Uint8ClampedArray(4);
  for (let y = area[1]; y < area[3]; y++) {
    for (let x = area[0]; x < area[2]; x++) {
      const px = ((x << 15) - position[0] + transformedBase[0]) | 0;
      const py = ((y << 15) - position[1] + transformedBase[1]) | 0;
      const [u, v] = transform(matrix, px, py);
      const ix = ((u >> 15) + base[0]) | 0,
        iy = ((v >> 15) + base[1]) | 0;
      if (ix >>> 0 >= sourceWidth || iy >>> 0 >= sourceHeight) continue;
      const a = (iy * sourceWidth + ix) * 4;
      const b = ix < sourceWidth - 1 ? a + 4 : a;
      const c = iy < sourceHeight - 1 ? a + sourceWidth * 4 : a;
      const d = ix < sourceWidth - 1 && iy < sourceHeight - 1 ? c + 4 : a;
      if (!(source[a + 3] + source[b + 3] + source[c + 3] + source[d + 3])) continue;
      const dx = u & 32767,
        dy = v & 32767;
      const weights = [
        ((32768 - dx) * (32768 - dy)) >> 15,
        (dx * (32768 - dy)) >> 15,
        ((32768 - dx) * dy) >> 15,
        (dx * dy) >> 15,
      ];
      for (let channel = 0; channel < 4; channel++)
        sample[channel] =
          (source[a + channel] * weights[0] +
            source[b + channel] * weights[1] +
            source[c + channel] * weights[2] +
            source[d + channel] * weights[3]) >>>
          15;
      const at = (y * width + x) * 4;
      // This path tests destination alpha, whereas the untransformed blit
      // tests the entire destination DWORD before copying zero-alpha RGB.
      const effective = (((sample[3] + 1) * (alpha & 65535)) >>> 8) & 255;
      if (options.blendPixel) options.blendPixel(destination, at, sample, 0, alpha);
      else if (!effective && !destination[at + 3])
        destination.set([sample[0], sample[1], sample[2], 0], at);
      else blendBitmapPixel(destination, at, sample, 0, alpha);
    }
  }
  return prepared;
}
