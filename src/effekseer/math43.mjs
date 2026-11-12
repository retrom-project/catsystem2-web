// SPDX-License-Identifier: MIT
// Copyright (c) 2011 Effekseer Project.
// Algorithms adapted from Effekseer 1.23, commit
// 5239bb1e416cbf55b4d3c8170594cbdc7815f263. See ../../licenses/effekseer-MIT.txt.
// Matrices are row-major Value[4][3], with translation in elements 9..11.
// Each operation accepts a reusable output buffer. No hidden simulation state.
import { EffekseerNumericError } from './numerical.mjs';
const f = Math.fround;
const add = (a, b) => f(f(a) + f(b));
const sub = (a, b) => f(f(a) - f(b));
const mul = (a, b) => f(f(a) * f(b));
const div = (a, b) => f(f(a) / f(b));
const bitStorage = new ArrayBuffer(4);
const bitsI32 = new Int32Array(bitStorage);
const bitsF32 = new Float32Array(bitStorage);
function fail(field, reason) {
  throw new EffekseerNumericError(field, reason);
}
function finite(value, field) {
  value = f(value);
  if (!Number.isFinite(value)) fail(field, `nonfinite float ${value}`);
  return value;
}
function buffer(value, length, field) {
  if (!value || value.length !== length) fail(field, `requires ${length} components`);
  return value;
}
function output(value, length) {
  return value == null ? new Float32Array(length) : buffer(value, length, 'out');
}
export function floatBits(value) {
  bitsF32[0] = value;
  return bitsI32[0] >>> 0;
}
function bitsFloat(value) {
  bitsI32[0] = value;
  return bitsF32[0];
}

// Base.Pre.h::NormalizeAngle and SinCos; this is the old polynomial, not libm.
export function normalizeAngle(angle) {
  angle = finite(angle, 'angle');
  const half = floatBits(angle) & 0x80000000 ? -0.5 : 0.5;
  const revolutions = Math.trunc(add(mul(angle, f(0.159154943)), half)) || 0;
  if (revolutions < -2147483648 || revolutions > 2147483647)
    fail('angle', 'source float-to-int overflow is uncalibrated');
  return finite(sub(angle, mul(revolutions, f(6.283185307))), 'angle.normalized');
}
export function customSinCos(angle, out) {
  const result = output(out, 2);
  const x = normalizeAngle(angle);
  const x2 = mul(x, x);
  const x4 = mul(mul(mul(x, x), x), x);
  const x6 = mul(mul(x4, x), x);
  const x8 = mul(mul(x6, x), x);
  const x10 = mul(mul(x8, x), x);
  let s = sub(1, div(x2, 6));
  s = add(s, div(x4, 120));
  s = sub(s, div(x6, 5040));
  s = add(s, div(x8, 362880));
  s = sub(s, div(x10, 39916800));
  let c = sub(1, div(x2, 2));
  c = add(c, div(x4, 24));
  c = sub(c, div(x6, 720));
  c = add(c, div(x8, 40320));
  c = sub(c, div(x10, 3628800));
  result[0] = finite(mul(x, s), 'sin');
  result[1] = finite(c, 'cos');
  return result;
}

// Vector3D::Rsqrt portable two-Newton branch is also observed in game76
// It performs two Newton iterations rather than a hardware rsqrt estimate.
export function reciprocalSqrt(value) {
  const x = finite(value, 'rsqrt');
  if (x < 0) fail('rsqrt', `negative input ${x}`);
  const half = mul(0.5, x);
  const signedBits = floatBits(x) | 0;
  let estimate = bitsFloat((0x5f3759df - (signedBits >> 1)) | 0);
  estimate = mul(estimate, sub(1.5, mul(mul(half, estimate), estimate)));
  estimate = mul(estimate, sub(1.5, mul(mul(half, estimate), estimate)));
  return finite(estimate, 'rsqrt.result');
}
export function vectorDot(a, b) {
  buffer(a, 3, 'dot.a');
  buffer(b, 3, 'dot.b');
  return finite(add(add(mul(a[0], b[0]), mul(a[1], b[1])), mul(a[2], b[2])), 'dot');
}
export function vectorLengthSquared(a) {
  return vectorDot(a, a);
}
export function vectorLength(a) {
  return finite(Math.sqrt(vectorLengthSquared(a)), 'length');
}
export function normalizeVector(a, out) {
  buffer(a, 3, 'normal.a');
  const inverse = reciprocalSqrt(vectorLengthSquared(a));
  const x = mul(a[0], inverse),
    y = mul(a[1], inverse),
    z = mul(a[2], inverse);
  const result = output(out, 3);
  result[0] = x;
  result[1] = y;
  result[2] = z;
  return result;
}
export function vectorAdd(a, b, out) {
  buffer(a, 3, 'add.a');
  buffer(b, 3, 'add.b');
  const result = output(out, 3);
  for (let i = 0; i < 3; i++) result[i] = finite(add(a[i], b[i]), 'add');
  return result;
}
export function vectorSub(a, b, out) {
  buffer(a, 3, 'sub.a');
  buffer(b, 3, 'sub.b');
  const result = output(out, 3);
  for (let i = 0; i < 3; i++) result[i] = finite(sub(a[i], b[i]), 'sub');
  return result;
}
export function vectorScale(a, scale, out) {
  buffer(a, 3, 'scale.a');
  scale = finite(scale, 'scale');
  const result = output(out, 3);
  for (let i = 0; i < 3; i++) result[i] = finite(mul(a[i], scale), 'scale');
  return result;
}
export function vectorCross(a, b, out) {
  buffer(a, 3, 'cross.a');
  buffer(b, 3, 'cross.b');
  const x = sub(mul(a[1], b[2]), mul(a[2], b[1]));
  const y = sub(mul(a[2], b[0]), mul(a[0], b[2]));
  const z = sub(mul(a[0], b[1]), mul(a[1], b[0]));
  const result = output(out, 3);
  result[0] = finite(x, 'cross.x');
  result[1] = finite(y, 'cross.y');
  result[2] = finite(z, 'cross.z');
  return result;
}

export function identity43(out) {
  const result = output(out, 12);
  result.fill(0);
  result[0] = 1;
  result[4] = 1;
  result[8] = 1;
  return result;
}
export function scaling43(x, y, z, out) {
  const result = output(out, 12);
  result.fill(0);
  result[0] = finite(x, 'scaling.x');
  result[4] = finite(y, 'scaling.y');
  result[8] = finite(z, 'scaling.z');
  return result;
}
export function translation43(x, y, z, out) {
  const result = identity43(out);
  result[9] = finite(x, 'translation.x');
  result[10] = finite(y, 'translation.y');
  result[11] = finite(z, 'translation.z');
  return result;
}
export function rotationX43(angle, out, trigOut) {
  const [s, c] = customSinCos(angle, trigOut);
  const result = output(out, 12);
  result[0] = 1;
  result[1] = 0;
  result[2] = 0;
  result[3] = 0;
  result[4] = c;
  result[5] = s;
  result[6] = 0;
  result[7] = -s;
  result[8] = c;
  result[9] = 0;
  result[10] = 0;
  result[11] = 0;
  return result;
}
export function rotationY43(angle, out, trigOut) {
  const [s, c] = customSinCos(angle, trigOut);
  const result = output(out, 12);
  result[0] = c;
  result[1] = 0;
  result[2] = -s;
  result[3] = 0;
  result[4] = 1;
  result[5] = 0;
  result[6] = s;
  result[7] = 0;
  result[8] = c;
  result[9] = 0;
  result[10] = 0;
  result[11] = 0;
  return result;
}
export function rotationZ43(angle, out, trigOut) {
  const [s, c] = customSinCos(angle, trigOut);
  const result = output(out, 12);
  result[0] = c;
  result[1] = s;
  result[2] = 0;
  result[3] = -s;
  result[4] = c;
  result[5] = 0;
  result[6] = 0;
  result[7] = 0;
  result[8] = 1;
  result[9] = 0;
  result[10] = 0;
  result[11] = 0;
  return result;
}
export function rotationZXY43(rz, rx, ry, out, trigOut) {
  rz = finite(rz, 'rz');
  rx = finite(rx, 'rx');
  ry = finite(ry, 'ry');
  let sx = 0,
    cx = 1,
    sy = 0,
    cy = 1,
    sz = 0,
    cz = 1;
  if (rx !== 0) [sx, cx] = customSinCos(rx, trigOut);
  if (ry !== 0) [sy, cy] = customSinCos(ry, trigOut);
  if (rz !== 0) [sz, cz] = customSinCos(rz, trigOut);
  const result = output(out, 12);
  result[0] = add(mul(cz, cy), mul(mul(sz, sx), sy));
  result[1] = mul(sz, cx);
  result[2] = add(mul(cz, -sy), mul(mul(sz, sx), cy));
  result[3] = add(mul(-sz, cy), mul(mul(cz, sx), sy));
  result[4] = mul(cz, cx);
  result[5] = add(mul(-sz, -sy), mul(mul(cz, sx), cy));
  result[6] = mul(cx, sy);
  result[7] = -sx;
  result[8] = mul(cx, cy);
  result[9] = 0;
  result[10] = 0;
  result[11] = 0;
  return result;
}

// Old Matrix43::RotationAxis uses libm sinf/cosf, unlike the Euler methods.
// Math.sin/cos rounded to float32 are a source-level port; equivalence to the
// shipped CRT's transcendental rounding is still a native calibration obligation.
// The sampled axis is deliberately NOT normalized here (nor in old source).
export function rotationAxis43(axis, angle, out) {
  angle = finite(angle, 'axis.angle');
  return rotationAxisSinCos43(axis, f(Math.sin(angle)), f(Math.cos(angle)), out);
}
export function rotationAxisSinCos43(axis, s, c, out) {
  buffer(axis, 3, 'axis');
  const x = finite(axis[0], 'axis.x'),
    y = finite(axis[1], 'axis.y'),
    z = finite(axis[2], 'axis.z');
  s = finite(s, 'axis.sin');
  c = finite(c, 'axis.cos');
  const cc = sub(1, c),
    result = output(out, 12);
  result[0] = add(mul(cc, mul(x, x)), c);
  result[1] = add(mul(cc, mul(x, y)), mul(z, s));
  result[2] = sub(mul(cc, mul(z, x)), mul(y, s));
  result[3] = sub(mul(cc, mul(x, y)), mul(z, s));
  result[4] = add(mul(cc, mul(y, y)), c);
  result[5] = add(mul(cc, mul(y, z)), mul(x, s));
  result[6] = add(mul(cc, mul(z, x)), mul(y, s));
  result[7] = sub(mul(cc, mul(y, z)), mul(x, s));
  result[8] = add(mul(cc, mul(z, z)), c);
  result[9] = 0;
  result[10] = 0;
  result[11] = 0;
  for (let i = 0; i < 9; i++) result[i] = finite(result[i], `axis.matrix[${i}]`);
  return result;
}

// Matrix43::Multiple active #if 1 branch, row-vector affine order.
export function multiply43(left, right, out) {
  buffer(left, 12, 'multiply.left');
  buffer(right, 12, 'multiply.right');
  const result = output(out, 12);
  const a = result === left ? Array.from(left) : left;
  const b = result === right ? Array.from(right) : right;
  for (let row = 0; row < 4; row++) {
    const offset = row * 3;
    for (let column = 0; column < 3; column++) {
      let value = add(
        add(mul(a[offset], b[column]), mul(a[offset + 1], b[3 + column])),
        mul(a[offset + 2], b[6 + column]),
      );
      if (row === 3) value = add(value, b[9 + column]);
      result[offset + column] = finite(value, 'multiply.result');
    }
  }
  return result;
}
export function transformVector43(vector, matrix, out) {
  buffer(vector, 3, 'transform.vector');
  buffer(matrix, 12, 'transform.matrix');
  const x = finite(vector[0], 'transform.x'),
    y = finite(vector[1], 'transform.y'),
    z = finite(vector[2], 'transform.z');
  const result = output(out, 3);
  for (let i = 0; i < 3; i++) {
    let value = add(0, mul(x, matrix[i]));
    value = add(value, mul(y, matrix[3 + i]));
    value = add(value, mul(z, matrix[6 + i]));
    result[i] = finite(add(value, matrix[9 + i]), 'transform.result');
  }
  return result;
}
export function getScale43(matrix, out) {
  buffer(matrix, 12, 'getScale.matrix');
  const result = output(out, 3);
  for (let row = 0; row < 3; row++) {
    const i = row * 3;
    const lengthSquared = add(
      add(mul(matrix[i], matrix[i]), mul(matrix[i + 1], matrix[i + 1])),
      mul(matrix[i + 2], matrix[i + 2]),
    );
    result[row] = finite(Math.sqrt(lengthSquared), 'getScale.result');
  }
  return result;
}
export function getRotation43(matrix, out, scaleOut) {
  buffer(matrix, 12, 'getRotation.matrix');
  const scale = getScale43(matrix, scaleOut),
    result = output(out, 12);
  for (let row = 0; row < 3; row++) {
    if (scale[row] === 0)
      fail('getRotation', 'zero-length row produces a nonfinite source rotation');
    for (let column = 0; column < 3; column++)
      result[row * 3 + column] = finite(
        div(matrix[row * 3 + column], scale[row]),
        'getRotation.result',
      );
  }
  result[9] = 0;
  result[10] = 0;
  result[11] = 0;
  return result;
}
export function setSRT43(scale, rotation, translation, out, scaleMatrixOut) {
  buffer(scale, 3, 'srt.scale');
  buffer(rotation, 12, 'srt.rotation');
  buffer(translation, 3, 'srt.translation');
  const scaleMatrix = scaling43(scale[0], scale[1], scale[2], scaleMatrixOut);
  const result = multiply43(scaleMatrix, rotation, out);
  result[9] = finite(translation[0], 'srt.x');
  result[10] = finite(translation[1], 'srt.y');
  result[11] = finite(translation[2], 'srt.z');
  return result;
}
