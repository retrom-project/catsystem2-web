// SPDX-License-Identifier: MPL-2.0
import { multiplyNativeMatrix } from '../native/calculation-math.mjs';
import { roundX87Single as r } from '../ppi/x87.mjs';

const f = Math.fround;
const product = (a, b) => r(a * b);

function sinCos(angle) {
  if (!Number.isFinite(angle) || Math.abs(angle) >= 2 ** 63)
    throw new RangeError('D3DX rotation angle is outside the scalar FSINCOS range');
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

function yawQuaternion(yaw, pitch, roll) {
  const [sy, cy] = sinCos(f(product(yaw, 0.5))),
    [sp, cp] = sinCos(f(product(pitch, 0.5))),
    [sr, cr] = sinCos(f(product(roll, 0.5))),
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

export function yawPitchRollX87(yaw, pitch, roll) {
  const [x, y, z, w] = yawQuaternion(yaw, pitch, roll),
    x2 = f(product(x, 2)),
    y2 = f(product(y, 2)),
    z2 = product(z, 2),
    xx = f(product(x2, x)),
    xy = f(product(y2, x)),
    xz = f(product(z2, x)),
    yy = f(product(y2, y)),
    yz = f(product(z2, y)),
    zz = product(z2, z),
    xw = product(x2, w),
    yw = product(y2, w),
    zw = product(z2, w),
    remaining = f(r(1 - xx));
  return [
    f(r(r(1 - yy) - zz)),
    f(r(xy + zw)),
    f(r(xz - yw)),
    0,
    f(r(xy - zw)),
    f(r(remaining - zz)),
    f(r(yz + xw)),
    0,
    f(r(xz + yw)),
    f(r(yz - xw)),
    f(r(remaining - yy)),
    0,
    0,
    0,
    0,
    1,
  ];
}

function rotationAxis(input, angle) {
  const [x, y, z] = normalize(input.slice(0, 3)),
    [sin, cos] = sinCos(angle),
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

export function rotateRelativeX87(matrix, reference, angles) {
  const x = transform([-1, 0, 0, 0], reference),
    z = transform([0, 0, -1, 0], reference);
  x[1] = 0;
  // The reference direction is normalized in four dimensions. The axis
  // operation then normalizes its first three components independently.
  const axes = [normalize(x), [0, -1, 0, 0], normalize(z)];
  return axes.reduce(
    (value, axis, i) => multiplyNativeMatrix(value, rotationAxis(axis, angles[i])),
    matrix,
  );
}
