// SPDX-License-Identifier: MPL-2.0
// Single-precision operation order recovered from native particle handlers.
import { bitsFloat, floatBits } from '../kcs/vm.mjs';
import { roundX87Single } from './x87.mjs';
const f = Math.fround;
const pi = f(Math.PI);
const quietNaNBit = 1 << 22;

export const degreeToRadian = (degrees) => f(f(f(degrees) * pi) / 180);
export const radianToDegree = (radians) => f(f(f(radians) * 180) / pi);
export function x87AngleConversion(angle, toRadians) {
  const product = roundX87Single(f(angle) * (toRadians ? pi : 180));
  return f(roundX87Single(product / (toRadians ? 180 : pi)));
}

function x87BinaryNaNWord(left, right) {
  const infinity = 0x7f800000,
    magnitudeLeft = left & 0x7fffffff,
    magnitudeRight = right & 0x7fffffff;
  if (magnitudeLeft > infinity && magnitudeRight > infinity) {
    // Both operands are quieted by FLD. FADDP selects the larger payload,
    // with a positive sign winning identical payloads.
    const payloadLeft = magnitudeLeft | quietNaNBit,
      payloadRight = magnitudeRight | quietNaNBit;
    const selected =
      payloadLeft === payloadRight ? left & right : payloadLeft > payloadRight ? left : right;
    return (selected | quietNaNBit) >>> 0;
  }
  if (magnitudeLeft > infinity) return (left | quietNaNBit) >>> 0;
  if (magnitudeRight > infinity) return (right | quietNaNBit) >>> 0;
}

export function x87Atan2Word(y, x) {
  const nan = x87BinaryNaNWord(y, x);
  if (nan !== undefined) return nan;
  const valueY = bitsFloat(y),
    valueX = bitsFloat(x);
  if (!Number.isFinite(valueY) && !Number.isFinite(valueX)) return 0xffc00000;
  return floatBits(Math.atan2(valueY, valueX));
}

export function x87RemainderWord(dividend, divisor) {
  const nan = x87BinaryNaNWord(dividend, divisor);
  if (nan !== undefined) return nan;
  const a = bitsFloat(dividend),
    b = bitsFloat(divisor);
  if (!Number.isFinite(a) || !Number.isFinite(b) || b === 0) return 0xffc00000;
  // The CRT's zero-dividend branch loads positive zero. A nonzero dividend
  // reaches FPREM, where a zero remainder retains the dividend's sign.
  return a === 0 ? 0 : floatBits(a % b);
}

function scaleFrameX87(frame, rate) {
  // FILD keeps the integer exact until FMUL. A wider product can fall on the
  // wrong side of a float32 midpoint if it is rounded to double first.
  if (frame < 2 ** 29 || rate === 0) return f(frame * rate);
  const unit = 2 ** (Math.floor(Math.log2(rate)) - 23);
  const exactProduct = BigInt(frame) * BigInt(rate / unit);
  const shift = BigInt(exactProduct.toString(2).length - 24);
  const significand = exactProduct >> shift;
  const remainder = exactProduct - (significand << shift);
  const halfway = 1n << (shift - 1n);
  const roundUp = remainder > halfway || (remainder === halfway && (significand & 1n) !== 0n);
  return Number(significand + BigInt(roundUp)) * unit * 2 ** Number(shift);
}

export function calcFrame(frame, fps, scale) {
  frame >>>= 0;
  if (!frame || frame & 0x80000000) return frame;
  const rate = fps >>> 0;
  if (scale === 'x87-uint32') {
    // The unsigned rate uses x87 FADD before FDIV when its high bit is set.
    const unsignedRate = rate & 0x80000000 ? f(rate) : rate;
    const frames = scaleFrameX87(frame, f(unsignedRate / 60));
    return Math.max(1, frames >>> 0);
  }
  return Math.max(1, Math.trunc(f(f(rate / 60) * f(frame)))) >>> 0;
}

export function linearInterpolate(areaMin, areaMax, inputMin, inputMax, value) {
  const [a, b, lo, hi, n] = [areaMin, areaMax, inputMin, inputMax, value].map(f);
  if (!(lo < n)) return a;
  if (!(n < hi)) return b;
  return f(f(f(f(n - lo) / f(hi - lo)) * f(b - a)) + a);
}
export function x87LinearInterpolate(a, b, lo, hi, n) {
  // The original unordered comparisons fall through to the calculation.
  if (lo >= n) return a;
  if (hi <= n) return b;
  const fraction = roundX87Single(roundX87Single(n - lo) / f(hi - lo));
  const offset = f(roundX87Single(fraction * f(b - a)));
  return f(a + offset);
}

export function truncateFloat32(value) {
  value = f(value);
  return Number.isFinite(value) && value >= -2147483648 && value < 2147483648
    ? Math.trunc(value) | 0
    : -2147483648;
}

export function roundInteger(value, result) {
  const n = f(Math.floor(f(f(value) + 0.5)));
  if (result === 'int64-low-word') return n >= -(2 ** 63) && n < 2 ** 63 ? n >>> 0 : 0;
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

export function x87TriangleWaveWord(value, period) {
  value &= 0x7fffffff;
  period &= 0x7fffffff;
  const quarter = f(bitsFloat(period) * 0.25);
  if (Number.isNaN(quarter)) return period | quietNaNBit;
  if (quarter === 0) return 0xffc00000;
  const phase = bitsFloat(value) > 0 ? bitsFloat(x87RemainderWord(value, period)) : 0;
  const part = phase > 0 ? bitsFloat(x87RemainderWord(floatBits(phase), floatBits(quarter))) : 0;
  const wave = f(roundX87Single(part / quarter));
  if (quarter > phase) return floatBits(wave);
  if (quarter + quarter > phase) return floatBits(1 - wave);
  if (roundX87Single(3 * quarter) > phase) return floatBits(-wave);
  return floatBits(wave - 1);
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
