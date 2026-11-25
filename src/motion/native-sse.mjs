// SPDX-License-Identifier: MPL-2.0
import { bitsFloat, floatBits } from '../kcs/vm.mjs';
const quietNaNBit = 1 << 22;

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
    bucket = (magnitude & 0x7fffff) >>> (23 - fractionBits),
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
