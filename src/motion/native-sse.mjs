// SPDX-License-Identifier: MPL-2.0
import { bitsFloat, floatBits } from '../kcs/vm.mjs';
const quietNaNBit = 1 << 22;

function arithmetic(operation, left, right) {
  if ((left & 0x7fffffff) > 0x7f800000) return (left | quietNaNBit) >>> 0;
  if ((right & 0x7fffffff) > 0x7f800000) return (right | quietNaNBit) >>> 0;
  const a = bitsFloat(left),
    b = bitsFloat(right),
    value = operation === 'multiply' ? a * b : a + b;
  return Number.isNaN(value) ? 0xffc00000 : floatBits(value);
}

export function transformSSEWords(vector, matrix) {
  return Array.from({ length: 4 }, (_, column) => {
    // Each matrix row is the destination operand of MULPS. Both sums keep
    // their left NaN payload before the final XY + ZW operation.
    const products = vector.map((word, row) =>
      arithmetic('multiply', matrix[row * 4 + column], word),
    );
    return arithmetic(
      'add',
      arithmetic('add', products[0], products[1]),
      arithmetic('add', products[2], products[3]),
    );
  });
}
