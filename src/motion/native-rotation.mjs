// SPDX-License-Identifier: MPL-2.0
import { bitsFloat, floatBits } from '../kcs/vm.mjs';
import { nativeTrigWord } from '../native/scalar-math.mjs';
import { multiplyNativeMatrix } from '../native/calculation-math.mjs';
import { quietFloat32Bits, x87BinaryNaNWord } from '../ppi/numeric.mjs';
import { roundX87Single as r } from '../ppi/x87.mjs';
import {
  multiplyMatrixSSEWords,
  normalizeAxisSSEWords,
  normalizeSSEWords,
  sseFloat32Arithmetic,
  transformSSEWords,
} from './native-sse.mjs';

const f = Math.fround;
const product = (a, b) => r(a * b);

function sinCos(angle, useNativeReduction) {
  if (!Number.isFinite(angle) || Math.abs(angle) >= 2 ** 63)
    throw new RangeError('D3DX rotation angle is outside the scalar FSINCOS range');
  if (useNativeReduction) {
    const word = floatBits(angle);
    return [
      bitsFloat(nativeTrigWord('sin', word, true)),
      bitsFloat(nativeTrigWord('cos', word, true)),
    ];
  }
  return [f(Math.sin(angle)), f(Math.cos(angle))];
}

export function nativeAxisSinCosWords(word) {
  const angle = bitsFloat(word);
  // A finite input outside the hardware range leaves ST0 untouched. The
  // second store reads the empty register and writes the x87 indefinite.
  if (Number.isFinite(angle) && Math.abs(angle) >= 2 ** 63) return [0xffc00000, word];
  return [nativeTrigWord('sin', word, true), nativeTrigWord('cos', word, true)];
}

function normalize(input) {
  const squared = f(input.map((value) => product(value, value)).reduce((a, b) => r(a + b)));
  if (Math.abs(squared - 1) <= 2 ** -23) return input;
  if (!(squared > 2 ** -126)) return input.map(() => 0);
  const scale = r(1 / r(Math.sqrt(squared)));
  return input.map((value) => f(product(value, scale)));
}

function transform([x, y, z, w], matrix) {
  return Array.from({ length: 4 }, (_, i) => {
    const fromX = product(x, matrix[i]),
      fromY = product(y, matrix[4 + i]),
      fromZ = product(z, matrix[8 + i]),
      fromW = product(w, matrix[12 + i]),
      first = r(fromW + fromY);
    return i === 0 ? f(r(r(first + fromZ) + fromX)) : f(r(r(first + fromX) + fromZ));
  });
}

function yawQuaternion(yaw, pitch, roll, useNativeReduction) {
  const [sy, cy] = sinCos(f(product(yaw, 0.5)), useNativeReduction),
    [sp, cp] = sinCos(f(product(pitch, 0.5)), useNativeReduction),
    [sr, cr] = sinCos(f(product(roll, 0.5)), useNativeReduction),
    spcy = product(sp, cy),
    cpsy = product(cp, sy),
    cpcy = product(cp, cy),
    spsy = product(sp, sy);
  return [
    f(r(product(spcy, cr) + product(cpsy, sr))),
    f(r(product(cpsy, cr) - product(spcy, sr))),
    f(r(product(cpcy, sr) - product(spsy, cr))),
    f(r(product(spsy, sr) + product(cpcy, cr))),
  ];
}

const quadrantBias = 0x4b000000;
const inverseHalfPi = 0x3f22f983;
const halfPiSegments = [0x3fc90000, 0x39fda000, 0x33a22000, 0x2c34611a];
const sineCoefficients = [0xb94ca1f0, 0x3c08839d, 0xbe2aaaa3, 0x3f800000];
const cosineCoefficients = [0x37ccf5ce, 0xbab6061a, 0x3d2aaaa5, 0xbf000000, 0x3f800000];
const sseAdd = (left, right) => sseFloat32Arithmetic('add', left, right);
const sseSubtract = (left, right) => sseFloat32Arithmetic('subtract', left, right);
const sseMultiply = (left, right) => sseFloat32Arithmetic('multiply', left, right);
const negateWord = (word) => (word ^ 0x80000000) >>> 0;

function evaluatePolynomial(square, coefficients) {
  let value = coefficients[0];
  for (let i = 1; i < coefficients.length; i++)
    value = sseAdd(sseMultiply(value, square), coefficients[i]);
  return value;
}

function halfAngleSinCosSSE(angle) {
  const half = sseMultiply(quietFloat32Bits(angle), 0x3f000000),
    magnitude = half & 0x7fffffff;
  // D3DX stores the rounded multiple of pi/2 in the low bits of a biased float.
  const rounded = sseAdd(sseMultiply(magnitude, inverseHalfPi), quadrantBias),
    quadrant = rounded & 3,
    turns = sseSubtract(rounded, quadrantBias);
  const reduced = halfPiSegments.reduce(
      (value, segment) => sseSubtract(value, sseMultiply(segment, turns)),
      magnitude,
    ),
    square = sseMultiply(reduced, reduced),
    sin = sseMultiply(evaluatePolynomial(square, sineCoefficients), reduced),
    cos = evaluatePolynomial(square, cosineCoefficients),
    odd = quadrant & 1,
    sinSign = (half & 0x80000000) ^ ((quadrant & 2) << 30),
    cosSign = ((quadrant + odd) & 2) << 30;
  return [((odd ? cos : sin) ^ sinSign) >>> 0, ((odd ? sin : cos) ^ cosSign) >>> 0];
}

function yawQuaternionSSE(yaw, pitch, roll) {
  const [sy, cy] = halfAngleSinCosSSE(yaw),
    [sp, cp] = halfAngleSinCosSSE(pitch),
    [sr, cr] = halfAngleSinCosSSE(roll);
  const triple = (a, b, c) => sseMultiply(sseMultiply(a, b), c);
  return [
    sseAdd(triple(cr, cy, sp), triple(sr, sy, cp)),
    sseAdd(triple(cr, sy, cp), negateWord(triple(sr, cy, sp))),
    sseAdd(triple(sr, cy, cp), negateWord(triple(cr, sy, sp))),
    sseAdd(triple(cr, cy, cp), triple(sr, sy, sp)),
  ];
}

function x87Arithmetic(left, right, value) {
  if (!Number.isNaN(value)) return r(value);
  return bitsFloat(x87BinaryNaNWord(floatBits(left), floatBits(right)) ?? 0xffc00000);
}

const x87Multiply = (left, right) => x87Arithmetic(left, right, left * right);
const x87Add = (left, right) => x87Arithmetic(left, right, left + right);
const x87Subtract = (left, right) => x87Arithmetic(left, right, left - right);

function matrixFromQuaternion([x, y, z, w]) {
  // Both D3DX paths convert the quaternion with the same x87 arithmetic.
  const x2 = f(x87Multiply(x, 2)),
    y2 = f(x87Multiply(y, 2)),
    z2 = x87Multiply(z, 2),
    xx = f(x87Multiply(x2, x)),
    xy = f(x87Multiply(y2, x)),
    xz = f(x87Multiply(z2, x)),
    yy = f(x87Multiply(y2, y)),
    yz = f(x87Multiply(z2, y)),
    zz = x87Multiply(z2, z),
    xw = x87Multiply(x2, w),
    yw = x87Multiply(y2, w),
    zw = x87Multiply(z2, w),
    remaining = f(x87Subtract(1, xx));
  return [
    f(x87Subtract(x87Subtract(1, yy), zz)),
    f(x87Add(xy, zw)),
    f(x87Subtract(xz, yw)),
    0,
    f(x87Subtract(xy, zw)),
    f(x87Subtract(remaining, zz)),
    f(x87Add(yz, xw)),
    0,
    f(x87Add(xz, yw)),
    f(x87Subtract(yz, xw)),
    f(x87Subtract(remaining, yy)),
    0,
    0,
    0,
    0,
    1,
  ];
}

export function yawPitchRollX87(yaw, pitch, roll, useNativeReduction = false) {
  return matrixFromQuaternion(yawQuaternion(yaw, pitch, roll, useNativeReduction));
}

export function yawPitchRollSSE(yaw, pitch, roll) {
  return matrixFromQuaternion(yawQuaternionSSE(yaw, pitch, roll).map(bitsFloat));
}

function rotationAxis(
  input,
  angle,
  useNativeReduction,
  normalizeVector = normalize,
  nativeAngles = false,
) {
  const [x, y, z] = normalizeVector(input.slice(0, 3)),
    [sin, cos] = nativeAngles
      ? nativeAxisSinCosWords(floatBits(angle)).map(bitsFloat)
      : sinCos(angle, useNativeReduction),
    t = f(x87Subtract(1, cos)),
    xy = f(x87Multiply(x87Multiply(y, x), t)),
    yz = x87Multiply(x87Multiply(y, z), t),
    zx = x87Multiply(x87Multiply(z, x), t),
    sx = x87Multiply(x, sin),
    sy = x87Multiply(y, sin),
    sz = x87Multiply(z, sin);
  return [
    f(x87Add(x87Multiply(x87Multiply(x, x), t), cos)),
    f(x87Add(xy, sz)),
    f(x87Subtract(zx, sy)),
    0,
    f(x87Subtract(xy, sz)),
    f(x87Add(x87Multiply(x87Multiply(y, y), t), cos)),
    f(x87Add(sx, yz)),
    0,
    f(x87Add(f(sy), zx)),
    f(x87Subtract(yz, sx)),
    f(x87Add(x87Multiply(x87Multiply(z, z), t), cos)),
    0,
    0,
    0,
    0,
    1,
  ];
}

export function rotateRelativeX87(matrix, reference, angles, useNativeReduction = false) {
  const x = transform([-1, 0, 0, 0], reference),
    z = transform([0, 0, -1, 0], reference);
  x[1] = 0;
  // The reference direction is normalized in four dimensions. The axis
  // operation then normalizes its first three components independently.
  const axes = [normalize(x), [0, -1, 0, 0], normalize(z)];
  return axes.reduce(
    (value, axis, i) =>
      multiplyNativeMatrix(value, rotationAxis(axis, angles[i], useNativeReduction)),
    matrix,
  );
}

export function rotateRelativeSSEWords(matrix, reference, angles, nativeAngles = false) {
  const x = transformSSEWords([-1, 0, 0, 0].map(floatBits), reference),
    z = transformSSEWords([0, 0, -1, 0].map(floatBits), reference);
  x[1] = 0;
  const axes = [normalizeSSEWords(x), [0, floatBits(-1), 0, 0], normalizeSSEWords(z)],
    normalizeAxis = (values) => normalizeAxisSSEWords(values.map(floatBits)).map(bitsFloat);
  return axes.reduce(
    (value, axis, i) =>
      multiplyMatrixSSEWords(
        value,
        rotationAxis(
          axis.map(bitsFloat),
          bitsFloat(angles[i]),
          true,
          normalizeAxis,
          nativeAngles,
        ).map(floatBits),
      ),
    matrix,
  );
}
