// SPDX-License-Identifier: MPL-2.0
// Main D3DX scalar arithmetic at the normal x87 PC=24 setting.
import { roundX87Single as r } from '../ppi/x87.mjs';
const f = Math.fround;
export function inverseNativeMatrix(m) {
  // Two-column minors retain the original native float32 storage points;
  // eliminating them through a different matrix algorithm changes results.
  const a = [
    f(r(r(m[0] * m[5]) - r(m[4] * m[1]))),
    f(r(r(m[0] * m[9]) - r(m[8] * m[1]))),
    f(r(r(m[0] * m[13]) - r(m[12] * m[1]))),
    f(r(r(m[4] * m[9]) - r(m[8] * m[5]))),
    f(r(r(m[4] * m[13]) - r(m[12] * m[5]))),
    f(r(r(m[8] * m[13]) - r(m[12] * m[9]))),
  ];
  const b = [
    f(r(r(m[2] * m[7]) - r(m[6] * m[3]))),
    f(r(r(m[2] * m[11]) - r(m[10] * m[3]))),
    r(r(m[2] * m[15]) - r(m[14] * m[3])),
    r(r(m[6] * m[11]) - r(m[10] * m[7])),
    r(r(m[6] * m[15]) - r(m[14] * m[7])),
    r(r(m[10] * m[15]) - r(m[14] * m[11])),
  ];
  const cofactor = [
    f(r(r(r(b[5] * m[5]) - r(b[4] * m[9])) + r(b[3] * m[13]))),
    f(r(r(r(b[2] * m[9]) - r(b[1] * m[13])) - r(b[5] * m[1]))),
    f(r(r(r(b[4] * m[1]) - r(b[2] * m[5])) + r(b[0] * m[13]))),
    f(r(r(r(b[1] * m[5]) - r(b[0] * m[9])) - r(b[3] * m[1]))),
    f(r(r(r(b[4] * m[8]) - r(b[3] * m[12])) - r(b[5] * m[4]))),
    f(r(r(r(m[0] * b[5]) - r(b[2] * m[8])) + r(b[1] * m[12]))),
    f(r(r(r(b[2] * m[4]) - r(b[0] * m[12])) - r(b[4] * m[0]))),
    f(r(r(r(b[3] * m[0]) - r(b[1] * m[4])) + r(b[0] * m[8]))),
    f(r(r(r(a[5] * m[7]) - r(a[4] * m[11])) + r(a[3] * m[15]))),
    f(r(r(r(a[2] * m[11]) - r(a[1] * m[15])) - r(a[5] * m[3]))),
    f(r(r(r(a[4] * m[3]) - r(a[2] * m[7])) + r(a[0] * m[15]))),
    f(r(r(r(a[1] * m[7]) - r(a[0] * m[11])) - r(a[3] * m[3]))),
    f(r(r(r(m[10] * a[4]) - r(m[14] * a[3])) - r(m[6] * a[5]))),
    f(r(r(r(m[2] * a[5]) - r(m[10] * a[2])) + r(m[14] * a[1]))),
    f(r(r(r(m[6] * a[2]) - r(m[14] * a[0])) - r(m[2] * a[4]))),
    f(r(r(r(m[2] * a[3]) - r(m[6] * a[1])) + r(m[10] * a[0]))),
  ];
  const determinant = r(
    r(r(r(cofactor[3] * m[12]) + r(cofactor[2] * m[8])) + r(cofactor[1] * m[4])) +
      r(cofactor[0] * m[0]),
  );
  const reciprocal = f(r(1 / determinant));
  if (!determinant || !Number.isFinite(reciprocal)) return null;
  return cofactor.map((n) => f(r(n * reciprocal)));
}

export function multiplyNativeMatrix(a, b) {
  return [
    f(r(r(r(r(a[3] * b[12]) + r(a[0] * b[0])) + r(a[2] * b[8])) + r(b[4] * a[1]))),
    f(r(r(r(r(a[1] * b[5]) + r(a[3] * b[13])) + r(a[2] * b[9])) + r(b[1] * a[0]))),
    f(r(r(r(r(a[3] * b[14]) + r(b[2] * a[0])) + r(a[2] * b[10])) + r(b[6] * a[1]))),
    f(r(r(r(r(a[3] * b[15]) + r(b[11] * a[2])) + r(a[0] * b[3])) + r(b[7] * a[1]))),
    f(r(r(r(r(a[7] * b[12]) + r(a[4] * b[0])) + r(b[4] * a[5])) + r(a[6] * b[8]))),
    f(r(r(r(r(a[6] * b[9]) + r(a[7] * b[13])) + r(b[5] * a[5])) + r(b[1] * a[4]))),
    f(r(r(r(r(b[6] * a[5]) + r(a[7] * b[14])) + r(b[2] * a[4])) + r(a[6] * b[10]))),
    f(r(r(r(r(b[7] * a[5]) + r(a[7] * b[15])) + r(a[6] * b[11])) + r(a[4] * b[3]))),
    f(r(r(r(r(a[11] * b[12]) + r(a[8] * b[0])) + r(b[4] * a[9])) + r(a[10] * b[8]))),
    f(r(r(r(r(a[11] * b[13]) + r(a[10] * b[9])) + r(b[5] * a[9])) + r(b[1] * a[8]))),
    f(r(r(r(r(b[6] * a[9]) + r(b[2] * a[8])) + r(a[11] * b[14])) + r(a[10] * b[10]))),
    f(r(r(r(r(a[11] * b[15]) + r(a[10] * b[11])) + r(b[7] * a[9])) + r(a[8] * b[3]))),
    f(r(r(r(r(a[15] * b[12]) + r(a[14] * b[8])) + r(a[12] * b[0])) + r(b[4] * a[13]))),
    f(r(r(r(r(a[15] * b[13]) + r(b[5] * a[13])) + r(a[14] * b[9])) + r(b[1] * a[12]))),
    f(r(r(r(r(a[14] * b[10]) + r(b[6] * a[13])) + r(b[2] * a[12])) + r(a[15] * b[14]))),
    f(r(r(r(r(a[15] * b[15]) + r(b[7] * a[13])) + r(a[12] * b[3])) + r(b[11] * a[14]))),
  ];
}
