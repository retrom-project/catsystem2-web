// SPDX-License-Identifier: MPL-2.0
import { f } from './common.mjs';
export function normalize(out, x, y, z, guard = false) {
  const length = f(Math.sqrt(f(f(f(x * x) + f(y * y)) + f(z * z))));
  for (let k = 0; k < 3; k++) out[k] = guard && !length ? 0 : f([x, y, z][k] / length);
  return out;
}
export function spline(capacity = 20) {
  return {
    count: 0,
    total: 0,
    duration: 0,
    positions: new Float32Array(capacity * 3),
    tangents: new Float32Array(capacity * 3),
    lengths: new Float32Array(capacity),
    output: new Float32Array(3),
  };
}
export function clearSpline(s) {
  s.count = 0;
  s.total = 0;
  s.duration = 0;
  s.positions.fill(0);
  s.tangents.fill(0);
  s.lengths.fill(0);
}
export function addPoint(s, point) {
  const n = s.count++,
    at = n * 3;
  s.positions.set(point, at);
  if (n) {
    const x = f(point[0] - s.positions[at - 3]),
      y = f(point[1] - s.positions[at - 2]),
      z = f(point[2] - s.positions[at - 1]);
    s.lengths[n] = f(Math.sqrt(f(f(f(x * x) + f(y * y)) + f(z * z))));
    s.total = f(s.total + s.lengths[n]);
  }
}
export function prepareSpline(s, duration, magnitude) {
  if (!duration || s.count < 2) return;
  s.duration = f(duration);
  const p = s.positions,
    t = s.tangents,
    out = s.output;
  for (let n = 0; n < s.count; n++) {
    let x, y, z;
    const a = n === 0 ? 0 : n - 1,
      b = n === s.count - 1 ? n : n + 1;
    if (n > 0 && n < s.count - 1) {
      x = f(f(p[b * 3] - p[n * 3]) - f(p[a * 3] - p[n * 3]));
      y = f(f(p[b * 3 + 1] - p[n * 3 + 1]) - f(p[a * 3 + 1] - p[n * 3 + 1]));
      z = f(f(p[b * 3 + 2] - p[n * 3 + 2]) - f(p[a * 3 + 2] - p[n * 3 + 2]));
    } else {
      x = f(p[b * 3] - p[a * 3]);
      y = f(p[b * 3 + 1] - p[a * 3 + 1]);
      z = f(p[b * 3 + 2] - p[a * 3 + 2]);
    }
    normalize(out, x, y, z);
    for (let k = 0; k < 3; k++) t[n * 3 + k] = f(out[k] * magnitude);
  }
}
export function sampleSpline(s, time, out = s.output) {
  const p = s.positions,
    t = s.tangents;
  if (s.count < 2 || time <= 0) {
    for (let k = 0; k < 3; k++) out[k] = p[k];
    return out;
  }
  time = Math.min(time, s.duration);
  const target = f(f(time / s.duration) * s.total);
  let before = 0,
    n = 1;
  for (; n < s.count; n++) {
    const end = f(before + s.lengths[n]);
    if (end > target) break;
    before = end;
  }
  if (n === s.count) {
    for (let k = 0; k < 3; k++) out[k] = p[(n - 1) * 3 + k];
    return out;
  }
  const u = f(f(target - before) / s.lengths[n]),
    u2 = f(u * u),
    u3 = f(u2 * u);
  for (let k = 0; k < 3; k++) {
    const a = p[(n - 1) * 3 + k],
      b = p[n * 3 + k],
      m = t[(n - 1) * 3 + k],
      v = t[n * 3 + k];
    const c0 = f(f(f(f(a * 2) + f(b * -2)) + m) + v);
    const c1 = f(f(f(f(a * -3) + f(b * 3)) + f(m * -2)) - v);
    const c2 = f(f(f(f(a * 0) + f(b * 0)) + m) + f(v * 0));
    const c3 = f(f(f(a + f(b * 0)) + f(m * 0)) + f(v * 0));
    out[k] = f(f(f(f(u3 * c0) + f(u2 * c1)) + f(u * c2)) + c3);
  }
  return out;
}
