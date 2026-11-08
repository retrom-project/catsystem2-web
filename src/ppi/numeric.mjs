// SPDX-License-Identifier: MPL-2.0
// Single-precision operation order recovered from native particle handlers.
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

export function projectionBounds(z, width, height, priority) {
  const halfX = f((width >>> 0) >>> 1),
    halfY = f((height >>> 0) >>> 1);
  const origin = f(65000 - f(priority));
  const depth = f(65000 - f(f(priority) + f(z)));
  const near = f(origin - 1000);
  const denominator = depth === near ? 1 : f(depth - near);
  const scale = Math.max(0, f(1000 / denominator));
  const inverse = scale > 0 ? f(1 / scale) : 0;
  const x = f(halfX * inverse),
    y = f(halfY * inverse);
  return [f(halfX - x), f(halfY - y), f(halfX + x), f(halfY + y)];
}
