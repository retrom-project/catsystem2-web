// SPDX-License-Identifier: MPL-2.0
// Single-precision operation order recovered from native particle handlers.
import { roundX87Single } from './x87.mjs';
const f = Math.fround;
const pi = f(Math.PI);

export const degreeToRadian = (degrees) => f(f(f(degrees) * pi) / 180);
export const radianToDegree = (radians) => f(f(f(radians) * 180) / pi);

export function calcFrame(frame, fps) {
  frame >>>= 0;
  if (!frame || frame & 0x80000000) return frame;
  return Math.max(1, Math.trunc(f(f((fps >>> 0) / 60) * f(frame)))) >>> 0;
}

export function linearInterpolate(areaMin, areaMax, inputMin, inputMax, value) {
  const [a, b, lo, hi, n] = [areaMin, areaMax, inputMin, inputMax, value].map(f);
  if (!(lo < n)) return a;
  if (!(n < hi)) return b;
  return f(f(f(f(n - lo) / f(hi - lo)) * f(b - a)) + a);
}

export function truncateFloat32(value) {
  value = f(value);
  return Number.isFinite(value) && value >= -2147483648 && value < 2147483648
    ? Math.trunc(value) | 0
    : -2147483648;
}

export function roundInteger(value) {
  const n = f(Math.floor(f(f(value) + 0.5)));
  return Number.isFinite(n) && n >= -2147483648 && n < 2147483648 ? n | 0 : -2147483648;
}

// Native triwave is signed and r is a complete period. The old web manual differs.
export function triangleWave(value, period) {
  const n = Math.abs(f(value));
  const r = Math.abs(f(period));
  const phase = n <= 0 ? 0 : f(n % r);
  const quarter = f(r * 0.25);
  const part = phase > 0 ? f(phase % quarter) : 0;
  let wave = f(part / quarter);
  if (quarter <= phase) {
    if (f(quarter * 2) > phase) return f(1 - wave);
    wave = f(quarter * 3) <= phase ? f(wave - 1) : -wave;
  }
  return wave;
}

// Native matrices use this sign convention; do not substitute a DOM rotation.
export function rotateVector(vector, axis, radians) {
  const [x, y, z] = vector.map(f);
  const s = f(Math.sin(f(radians))),
    c = f(Math.cos(f(radians)));
  if (axis === 'x') return [x, f(f(z * s) + f(y * c)), f(f(z * c) - f(y * s))];
  if (axis === 'y') return [f(f(x * c) - f(z * s)), y, f(f(z * c) + f(x * s))];
  if (axis === 'z') return [f(f(x * c) + f(y * s)), f(f(y * c) - f(x * s)), z];
  throw new RangeError(`Unknown particle rotation axis: ${axis}`);
}

export function nativeParticleNear(priority) {
  return f(f(65000 - f(priority)) - 1000);
}

export function projectionBounds(
  z,
  width,
  height,
  priority,
  near = nativeParticleNear(priority),
  precision = 24,
) {
  const halfX = f((width >>> 0) >>> 1),
    halfY = f((height >>> 0) >>> 1),
    depth = f(65000 - f(f(priority) + f(z))),
    denominator = depth === near ? 1 : f(depth - near),
    scale = Math.max(0, f(1000 / denominator)),
    reciprocalW = f(1 / denominator),
    round = precision === 24 ? roundX87Single : (value) => value;
  // The native scalar inverse stores a diagonal cofactor before the
  // determinant. It then stores the reciprocal determinant and the inverse
  // scale separately. Collapsing these steps into 1/scale changes the bounds.
  const cofactor = f(round(round(f(1 / 65000) * reciprocalW) * scale)),
    determinant = round(cofactor * scale),
    reciprocal = f(round(1 / determinant)),
    inverse = determinant && Number.isFinite(reciprocal) ? f(round(cofactor * reciprocal)) : scale;
  const x = f(round(halfX * inverse)),
    y = f(round(halfY * inverse));
  return [f(halfX - x), f(halfY - y), f(halfX + x), f(halfY + y)];
}
