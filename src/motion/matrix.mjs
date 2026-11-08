// SPDX-License-Identifier: MPL-2.0
// Row-vector D3DX baseline contracts, independently implemented and checked
// against the fixed generic-native PE oracle. Intermediate stores are float32.
const f = Math.fround;
export const identity = () => [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1];

export function multiply(left, right) {
  return Array.from({ length: 16 }, (_, i) => {
    const row = i >> 2,
      col = i & 3;
    return f(
      left[row * 4] * right[col] +
        left[row * 4 + 1] * right[col + 4] +
        left[row * 4 + 2] * right[col + 8] +
        left[row * 4 + 3] * right[col + 12],
    );
  });
}
export function transform(vector, matrix) {
  return Array.from({ length: 4 }, (_, i) =>
    f(
      vector[0] * matrix[i] +
        vector[1] * matrix[i + 4] +
        vector[2] * matrix[i + 8] +
        vector[3] * matrix[i + 12],
    ),
  );
}
export function normalize(vector) {
  const squared = f(vector.reduce((sum, n) => sum + n * n, 0));
  if (Math.abs(squared - 1) <= 2 ** -23) return [...vector];
  if (squared <= 2 ** -126) return vector.map(() => 0);
  const length = Math.sqrt(squared);
  return vector.map((n) => f(n / length));
}
export function lengthSquared(vector) {
  const products = vector.map((n) => f(n * n));
  return f(f(f(products[0] + products[1]) + products[2]) + products[3]);
}
export function translation(x, y, z) {
  const matrix = identity();
  matrix.splice(12, 3, f(x), f(y), f(z));
  return matrix;
}
export function scaling(x, y, z) {
  const matrix = identity();
  [matrix[0], matrix[5], matrix[10]] = [f(x), f(y), f(z)];
  return matrix;
}
export function rotation(axis, radians) {
  const c = f(Math.cos(f(radians))),
    s = f(Math.sin(f(radians))),
    matrix = identity();
  if (axis === 'x') [matrix[5], matrix[6], matrix[9], matrix[10]] = [c, s, -s, c];
  else if (axis === 'y') [matrix[0], matrix[2], matrix[8], matrix[10]] = [c, -s, s, c];
  else if (axis === 'z') [matrix[0], matrix[1], matrix[4], matrix[5]] = [c, s, -s, c];
  else throw new Error(`Invalid MOT rotation axis ${axis}`);
  return matrix;
}
export function rotationAxis(axis, radians) {
  const [x, y, z] = normalize([...axis, 0]),
    c = f(Math.cos(f(radians))),
    s = f(Math.sin(f(radians))),
    t = f(1 - c),
    xy = f(y * x * t),
    yz = y * z * t,
    zx = z * x * t;
  return [
    f(x * x * t + c),
    f(xy + z * s),
    f(zx - y * s),
    0,
    f(xy - z * s),
    f(y * y * t + c),
    f(x * s + yz),
    0,
    f(f(y * s) + zx),
    f(yz - x * s),
    f(z * z * t + c),
    0,
    0,
    0,
    0,
    1,
  ];
}
export function yawPitchRoll(yaw, pitch, roll) {
  const cy = f(Math.cos(f(f(yaw) * 0.5))),
    sy = f(Math.sin(f(f(yaw) * 0.5))),
    cp = f(Math.cos(f(f(pitch) * 0.5))),
    sp = f(Math.sin(f(f(pitch) * 0.5))),
    cr = f(Math.cos(f(f(roll) * 0.5))),
    sr = f(Math.sin(f(f(roll) * 0.5))),
    x = f(cy * sp * cr + sy * cp * sr),
    y = f(sy * cp * cr - cy * sp * sr),
    z = f(cy * cp * sr - sy * sp * cr),
    w = f(cy * cp * cr + sy * sp * sr);
  const x2 = f(2 * x),
    y2 = f(2 * y),
    z2 = 2 * z,
    xx = f(x2 * x),
    xy = f(y2 * x),
    xz = f(z2 * x),
    yy = f(y2 * y),
    yz = f(z2 * y),
    zz = z2 * z;
  return [
    f(1 - yy - zz),
    f(xy + z2 * w),
    f(xz - y2 * w),
    0,
    f(xy - z2 * w),
    f(1 - xx - zz),
    f(yz + x2 * w),
    0,
    f(xz + y2 * w),
    f(yz - x2 * w),
    f(f(1 - xx) - yy),
    0,
    0,
    0,
    0,
    1,
  ];
}

export function inverse(m) {
  // Two-column minors retain the original native float32 storage points;
  // eliminating them through a different matrix algorithm changes results.
  const a = [
    f(m[0] * m[5] - m[4] * m[1]),
    f(m[0] * m[9] - m[8] * m[1]),
    f(m[0] * m[13] - m[12] * m[1]),
    f(m[4] * m[9] - m[8] * m[5]),
    f(m[4] * m[13] - m[12] * m[5]),
    f(m[8] * m[13] - m[12] * m[9]),
  ];
  const b = [
    f(m[2] * m[7] - m[6] * m[3]),
    f(m[2] * m[11] - m[10] * m[3]),
    m[2] * m[15] - m[14] * m[3],
    m[6] * m[11] - m[10] * m[7],
    m[6] * m[15] - m[14] * m[7],
    m[10] * m[15] - m[14] * m[11],
  ];
  const cofactor = [
    f(b[5] * m[5] - b[4] * m[9] + b[3] * m[13]),
    f(b[2] * m[9] - b[1] * m[13] - b[5] * m[1]),
    f(b[4] * m[1] - b[2] * m[5] + b[0] * m[13]),
    f(b[1] * m[5] - b[0] * m[9] - b[3] * m[1]),
    f(b[4] * m[8] - b[3] * m[12] - b[5] * m[4]),
    f(m[0] * b[5] - b[2] * m[8] + b[1] * m[12]),
    f(b[2] * m[4] - b[0] * m[12] - b[4] * m[0]),
    f(b[3] * m[0] - b[1] * m[4] + b[0] * m[8]),
    f(a[5] * m[7] - a[4] * m[11] + a[3] * m[15]),
    f(a[2] * m[11] - a[1] * m[15] - a[5] * m[3]),
    f(a[4] * m[3] - a[2] * m[7] + a[0] * m[15]),
    f(a[1] * m[7] - a[0] * m[11] - a[3] * m[3]),
    f(m[10] * a[4] - m[14] * a[3] - m[6] * a[5]),
    f(m[2] * a[5] - m[10] * a[2] + m[14] * a[1]),
    f(m[6] * a[2] - m[14] * a[0] - m[2] * a[4]),
    f(m[2] * a[3] - m[6] * a[1] + m[10] * a[0]),
  ];
  const determinant =
    cofactor[3] * m[12] + cofactor[2] * m[8] + cofactor[1] * m[4] + cofactor[0] * m[0];
  const reciprocal = f(1 / determinant);
  if (!determinant || !Number.isFinite(reciprocal)) return null;
  return cofactor.map((n) => f(n * reciprocal));
}
