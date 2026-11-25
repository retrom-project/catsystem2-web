// SPDX-License-Identifier: MPL-2.0
import { bitsFloat, floatBits } from '../kcs/vm.mjs';
import { nativeTrigWord } from '../native/scalar-math.mjs';
import { multiplyNativeMatrix } from '../native/calculation-math.mjs';
import { quietFloat32Bits, x87BinaryNaNWord } from '../ppi/numeric.mjs';
import { roundX87Single as r } from '../ppi/x87.mjs';
import { sseFloat32Arithmetic } from './native-sse.mjs';

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
  return coefficients
    .slice(1)
    .reduce(
      (value, coefficient) => sseAdd(sseMultiply(value, square), coefficient),
      coefficients[0],
    );
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

function quaternionArithmetic(left, right, value) {
  if (!Number.isNaN(value)) return r(value);
  return bitsFloat(x87BinaryNaNWord(floatBits(left), floatBits(right)) ?? 0xffc00000);
}

const quaternionMultiply = (left, right) => quaternionArithmetic(left, right, left * right);
const quaternionAdd = (left, right) => quaternionArithmetic(left, right, left + right);
const quaternionSubtract = (left, right) => quaternionArithmetic(left, right, left - right);

function matrixFromQuaternion([x, y, z, w]) {
  // Both D3DX paths convert the quaternion with the same x87 arithmetic.
  const x2 = f(quaternionMultiply(x, 2)),
    y2 = f(quaternionMultiply(y, 2)),
    z2 = quaternionMultiply(z, 2),
    xx = f(quaternionMultiply(x2, x)),
    xy = f(quaternionMultiply(y2, x)),
    xz = f(quaternionMultiply(z2, x)),
    yy = f(quaternionMultiply(y2, y)),
    yz = f(quaternionMultiply(z2, y)),
    zz = quaternionMultiply(z2, z),
    xw = quaternionMultiply(x2, w),
    yw = quaternionMultiply(y2, w),
    zw = quaternionMultiply(z2, w),
    remaining = f(quaternionSubtract(1, xx));
  return [
    f(quaternionSubtract(quaternionSubtract(1, yy), zz)),
    f(quaternionAdd(xy, zw)),
    f(quaternionSubtract(xz, yw)),
    0,
    f(quaternionSubtract(xy, zw)),
    f(quaternionSubtract(remaining, zz)),
    f(quaternionAdd(yz, xw)),
    0,
    f(quaternionAdd(xz, yw)),
    f(quaternionSubtract(yz, xw)),
    f(quaternionSubtract(remaining, yy)),
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

function rotationAxis(input, angle, useNativeReduction) {
  const [x, y, z] = normalize(input.slice(0, 3)),
    [sin, cos] = sinCos(angle, useNativeReduction),
    t = f(r(1 - cos)),
    xy = f(product(product(y, x), t)),
    yz = product(product(y, z), t),
    zx = product(product(z, x), t),
    sx = product(x, sin),
    sy = product(y, sin),
    sz = product(z, sin);
  return [
    f(r(product(product(x, x), t) + cos)),
    f(r(xy + sz)),
    f(r(zx - sy)),
    0,
    f(r(xy - sz)),
    f(r(product(product(y, y), t) + cos)),
    f(r(sx + yz)),
    0,
    f(r(f(sy) + zx)),
    f(r(yz - sx)),
    f(r(product(product(z, z), t) + cos)),
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
