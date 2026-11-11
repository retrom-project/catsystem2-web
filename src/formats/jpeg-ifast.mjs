// SPDX-License-Identifier: IJG
// AA&N integer inverse DCT, adapted from IJG jidctfst.c/jddctmgr.c.
// Copyright (C) 1994-1998, Thomas G. Lane. Modified 2002-2010 by Guido Vollbeding.
// libjpeg-turbo modifications copyright 2009 Pierre Ossman for Cendio AB,
// 2010/2015/2022 D. R. Commander and 2013 MIPS Technologies, Inc., California.
// This JS port shares the two-pass kernel and uses explicit integer shifts.
// See licenses/jpeg-ijg.txt.
const scales = [
  16384, 22725, 21407, 19266, 16384, 12873, 8867, 4520, 22725, 31521, 29692, 26722, 22725, 17855,
  12299, 6270, 21407, 29692, 27969, 25172, 21407, 16819, 11585, 5906, 19266, 26722, 25172, 22654,
  19266, 15137, 10426, 5315, 16384, 22725, 21407, 19266, 16384, 12873, 8867, 4520, 12873, 17855,
  16819, 15137, 12873, 10114, 6967, 3552, 8867, 12299, 11585, 10426, 8867, 6967, 4799, 2446, 4520,
  6270, 5906, 5315, 4520, 3552, 2446, 1247,
];
export function jpegFastQuantizers(table) {
  return Int32Array.from(table, (n, i) => (Math.imul(n, scales[i]) + 2048) >> 12);
}
const multiply = (value, constant) => Math.imul(value, constant) >> 8;
function inverse(vector) {
  const evenSum = vector[0] + vector[4],
    evenDifference = vector[0] - vector[4],
    evenPair = vector[2] + vector[6],
    evenRotated = multiply(vector[2] - vector[6], 362) - evenPair,
    even0 = evenSum + evenPair,
    even3 = evenSum - evenPair,
    even1 = evenDifference + evenRotated,
    even2 = evenDifference - evenRotated,
    oddA = vector[5] + vector[3],
    oddB = vector[5] - vector[3],
    oddC = vector[1] + vector[7],
    oddD = vector[1] - vector[7],
    odd7 = oddC + oddA,
    oddRotation = multiply(oddC - oddA, 362),
    sharedRotation = multiply(oddB + oddD, 473),
    odd10 = multiply(oddD, 277) - sharedRotation,
    odd12 = multiply(oddB, -669) + sharedRotation,
    odd6 = odd12 - odd7,
    odd5 = oddRotation - odd6,
    odd4 = odd10 + odd5;
  return [
    even0 + odd7,
    even1 + odd6,
    even2 + odd5,
    even3 - odd4,
    even3 + odd4,
    even2 - odd5,
    even1 - odd6,
    even0 - odd7,
  ];
}
export function inverseJPEGFast(coefficients, quantizers, output, workspace) {
  for (let column = 0; column < 8; column++) {
    const values = inverse(
      Array.from({ length: 8 }, (_, row) =>
        Math.imul(coefficients[row * 8 + column], quantizers[row * 8 + column]),
      ),
    );
    for (let row = 0; row < 8; row++) workspace[row * 8 + column] = values[row];
  }
  for (let row = 0; row < 8; row++) {
    const values = inverse(workspace.subarray(row * 8, row * 8 + 8));
    for (let column = 0; column < 8; column++)
      output[row * 8 + column] = Math.max(0, Math.min(255, 128 + (values[column] >> 5)));
  }
}
