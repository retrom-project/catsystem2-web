// SPDX-License-Identifier: MPL-2.0
import { bitsFloat, floatBits } from '../kcs/vm.mjs';
const quietNaNBit = 1 << 22;
const fractionMask = (1 << 23) - 1;

export function sseFloat32Arithmetic(operation, left, right) {
  if ((left & 0x7fffffff) > 0x7f800000) return (left | quietNaNBit) >>> 0;
  if ((right & 0x7fffffff) > 0x7f800000) return (right | quietNaNBit) >>> 0;
  const a = bitsFloat(left),
    b = bitsFloat(right),
    value = operation === 'multiply' ? a * b : operation === 'subtract' ? a - b : a + b;
  return Number.isNaN(value) ? 0xffc00000 : floatBits(value);
}

// The selected SSE2 helpers use quantized midpoint seeds, then one Newton
// correction. Keep that seed precision and the unconditional denormal flush.
function approximate(word, squareRoot) {
  const sign = word & 0x80000000,
    magnitude = word & 0x7fffffff,
    exponent = magnitude >>> 23;
  if (magnitude > 0x7f800000) return (word | quietNaNBit) >>> 0;
  if (!exponent) return (sign | 0x7f800000) >>> 0;
  if (squareRoot && sign) return 0xffc00000;
  if (exponent === 255) return sign >>> 0;
  const fractionBits = squareRoot ? 10 : 11,
    bucket = (magnitude & fractionMask) >>> (23 - fractionBits),
    center = (1 + (bucket + 0.5) / 2 ** fractionBits) * 2 ** (exponent - 127),
    value = squareRoot ? 1 / Math.sqrt(center) : 1 / center,
    step = 2 ** (Math.floor(Math.log2(value)) - 12),
    rounded = Math.round(value / step) * step;
  return (sign | (rounded < 2 ** -126 ? 0 : floatBits(rounded))) >>> 0;
}

export function reciprocalSSEWord(word) {
  return approximate(word, false);
}

export function reciprocalSquareRootSSEWord(word) {
  return approximate(word, true);
}

export function normalizeSSEWords(vector) {
  const squares = vector.map((word) => sseFloat32Arithmetic('multiply', word, word)),
    squared = sseFloat32Arithmetic(
      'add',
      sseFloat32Arithmetic('add', squares[0], squares[1]),
      sseFloat32Arithmetic('add', squares[2], squares[3]),
    ),
    seed = reciprocalSquareRootSSEWord(squared),
    correction = sseFloat32Arithmetic(
      'subtract',
      floatBits(3),
      sseFloat32Arithmetic('multiply', squared, sseFloat32Arithmetic('multiply', seed, seed)),
    ),
    factor = sseFloat32Arithmetic(
      'multiply',
      sseFloat32Arithmetic('multiply', correction, floatBits(0.5)),
      seed,
    );
  return vector.map((word) => sseFloat32Arithmetic('multiply', word, factor));
}

const vectorArithmetic = (operation, left, right) =>
  left.map((word, i) => sseFloat32Arithmetic(operation, word, right[i]));
const multiply = (left, right) => vectorArithmetic('multiply', left, right);
const add = (left, right) => vectorArithmetic('add', left, right);
const subtract = (left, right) => vectorArithmetic('subtract', left, right);
const swapPairs = ([a, b, c, d]) => [b, a, d, c];
const rotateHalves = ([a, b, c, d]) => [c, d, a, b];

export function normalizeAxisSSEWords(vector) {
  const squares = vector.map((word) => sseFloat32Arithmetic('multiply', word, word)),
    squared = sseFloat32Arithmetic(
      'add',
      sseFloat32Arithmetic('add', squares[0], squares[1]),
      squares[2],
    );
  if (!(bitsFloat(squared) >= 2 ** -46)) return [0, 0, 0];
  const seed = reciprocalSquareRootSSEWord(squared),
    correction = sseFloat32Arithmetic(
      'subtract',
      floatBits(3),
      sseFloat32Arithmetic('multiply', sseFloat32Arithmetic('multiply', seed, squared), seed),
    ),
    factor = sseFloat32Arithmetic(
      'multiply',
      correction,
      sseFloat32Arithmetic('multiply', seed, floatBits(0.5)),
    );
  return vector.map((word) => sseFloat32Arithmetic('multiply', word, factor));
}

export function inverseSSEWords(matrix) {
  // Form four adjugate rows from the original packed column products.
  // Keep each subtraction and addition separate: reassociation changes f32.
  const x = [matrix[0], matrix[4], matrix[8], matrix[12]],
    y = [matrix[9], matrix[13], matrix[1], matrix[5]],
    z = [matrix[2], matrix[6], matrix[10], matrix[14]],
    w = [matrix[11], matrix[15], matrix[3], matrix[7]],
    zr = rotateHalves(z),
    zw = swapPairs(multiply(w, z)),
    zwr = rotateHalves(zw),
    yzDifference = subtract(multiply(y, zwr), multiply(y, zw)),
    yz = swapPairs(multiply(y, z)),
    yzr = rotateHalves(yz),
    first = subtract(add(multiply(w, yz), yzDifference), multiply(w, yzr)),
    yw = swapPairs(multiply(rotateHalves(y), w)),
    ywr = rotateHalves(yw),
    row0 = subtract(add(multiply(zr, yw), first), multiply(zr, ywr)),
    remaining = rotateHalves(subtract(multiply(ywr, x), multiply(yw, x))),
    yx = swapPairs(multiply(y, x)),
    yxr = rotateHalves(yx),
    second = subtract(multiply(w, yxr), add(multiply(w, yx), remaining)),
    wx = swapPairs(multiply(w, x)),
    wxr = rotateHalves(wx),
    row2 = subtract(add(multiply(wx, y), second), multiply(y, wxr)),
    zwDifference = rotateHalves(subtract(multiply(zwr, x), multiply(zw, x))),
    third = add(multiply(wxr, zr), subtract(zwDifference, multiply(wx, zr))),
    xz = swapPairs(multiply(x, zr)),
    xzr = rotateHalves(xz),
    row1 = subtract(add(multiply(w, xz), third), multiply(w, xzr)),
    yzRemaining = rotateHalves(subtract(multiply(yzr, x), multiply(yz, x))),
    fourth = subtract(
      subtract(subtract(multiply(yx, zr), yzRemaining), multiply(zr, yxr)),
      multiply(xz, y),
    ),
    row3 = add(multiply(y, xzr), fourth),
    determinantProducts = multiply(x, row0),
    determinantPairs = add(rotateHalves(determinantProducts), determinantProducts),
    determinant = sseFloat32Arithmetic('add', determinantPairs[1], determinantPairs[0]),
    value = bitsFloat(determinant);
  if (value === 0 || Number.isNaN(value)) return null;
  const seed = reciprocalSSEWord(determinant),
    factor = sseFloat32Arithmetic(
      'subtract',
      sseFloat32Arithmetic('add', seed, seed),
      sseFloat32Arithmetic('multiply', determinant, sseFloat32Arithmetic('multiply', seed, seed)),
    ),
    scale = Array(4).fill(factor);
  return [
    ...multiply(row0, scale),
    ...multiply(row1, scale),
    ...multiply(row2, scale),
    ...multiply(scale, row3),
  ];
}

export function transformSSEWords(vector, matrix) {
  return Array.from({ length: 4 }, (_, column) => {
    // Each matrix row is the destination operand of MULPS. Both sums keep
    // their left NaN payload before the final XY + ZW operation.
    const products = vector.map((word, row) =>
      sseFloat32Arithmetic('multiply', matrix[row * 4 + column], word),
    );
    return sseFloat32Arithmetic(
      'add',
      sseFloat32Arithmetic('add', products[0], products[1]),
      sseFloat32Arithmetic('add', products[2], products[3]),
    );
  });
}

export function multiplyMatrixSSEWords(left, right) {
  // The first and fourth rows reduce in pairs. The fourth row also reverses
  // the multiply operands, which controls the retained NaN payload.
  return Array.from({ length: 16 }, (_, index) => {
    const row = index >> 2,
      column = index & 3;
    const products = [0, 1, 2, 3].map((i) => {
      const a = left[row * 4 + i],
        b = right[i * 4 + column];
      return row === 3
        ? sseFloat32Arithmetic('multiply', b, a)
        : sseFloat32Arithmetic('multiply', a, b);
    });
    const add = (a, b) => sseFloat32Arithmetic('add', a, b);
    const [x, y, z, w] = products;
    if (row === 1 || row === 2) return add(add(add(x, y), z), w);
    return add(add(x, y), add(z, w));
  });
}
