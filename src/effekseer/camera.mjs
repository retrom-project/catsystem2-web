// SPDX-License-Identifier: MIT
// Copyright (c) 2011 Effekseer Project. See ../../licenses/effekseer-MIT.txt.
// Matrix44 camera algorithms from fixed official Effekseer1.23.
// Camera arithmetic owns no device, native execution or RNG state.
import { normalizeVector, vectorDot, vectorSub, vectorCross } from './math43.mjs';
export { floatBits, transformVector43 } from './math43.mjs';
const f = Math.fround;
function input(a, n, name) {
  if (!a || a.length < n) throw new TypeError('Effekseer camera ' + name + ' lacks elements');
  for (let i = 0; i < n; i++)
    if (typeof a[i] !== 'number' || !Number.isFinite(f(a[i])))
      throw new TypeError('Effekseer camera ' + name + ' requires finite float32');
  return a;
}
function scalar(x, name) {
  if (typeof x !== 'number' || !Number.isFinite(f(x)))
    throw new TypeError('Effekseer camera ' + name + ' requires finite float32');
  return f(x);
}
function output(out) {
  if (out === undefined) return new Float32Array(16);
  if (!(out instanceof Float32Array) || out.length !== 16)
    throw new TypeError('Effekseer camera output requires16 float32 slots');
  return out;
}
export function identity44(out) {
  const result = output(out);
  result.fill(0);
  result[0] = result[5] = result[10] = result[15] = 1;
  return result;
}
export function createLookAtScratch() {
  return { front: new Float32Array(3), right: new Float32Array(3), up: new Float32Array(3) };
}
export function lookAtRH(eye, at, up, out = identity44(), scratch = createLookAtScratch()) {
  input(eye, 3, 'eye');
  input(at, 3, 'at');
  input(up, 3, 'up');
  output(out);
  const F = normalizeVector(vectorSub(eye, at, scratch.front), scratch.front),
    R = normalizeVector(vectorCross(up, F, scratch.right), scratch.right),
    U = normalizeVector(vectorCross(F, R, scratch.up), scratch.up);
  for (let i = 0; i < 3; i++) {
    out[i * 4] = R[i];
    out[i * 4 + 1] = U[i];
    out[i * 4 + 2] = F[i];
  }
  // Fixed source leaves indices3,7,11 intact; Matrix44 ctor initializes them
  // before the actual wrapper call. Never normalize this side effect away.
  out[12] = 0;
  out[13] = 0;
  out[14] = 0;
  out[12] = -vectorDot(R, eye);
  out[13] = -vectorDot(U, eye);
  out[14] = -vectorDot(F, eye);
  out[15] = 1;
  return out;
}
export function perspectiveFovRH(fovy, aspect, near, far, out) {
  fovy = scalar(fovy, 'fovy');
  aspect = scalar(aspect, 'aspect');
  near = scalar(near, 'near');
  far = scalar(far, 'far');
  if (fovy <= 0 || fovy >= Math.PI || aspect <= 0 || near <= 0 || far <= near)
    throw new RangeError('Unverified Effekseer camera perspective domain');
  const tan = f(Math.tan(f(fovy * 0.5))),
    y = scalar(f(1 / tan), 'yScale'),
    x = scalar(f(y / aspect), 'xScale'),
    dz = f(near - far),
    result = output(out);
  result.fill(0);
  result[0] = x;
  result[5] = y;
  result[10] = scalar(f(far / dz), 'depthScale');
  result[11] = -1;
  result[14] = scalar(f(f(near * far) / dz), 'depthTranslation');
  return result;
}
