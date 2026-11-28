// SPDX-License-Identifier: MPL-2.0
export function roundX87Single(value) {
  const magnitude = Math.abs(value);
  // x87 PC=24 rounds the significand and retains the extended exponent.
  // The particle dot products and inverse use float32 inputs. Rescale
  // their extended products, sums and reciprocal before float32 rounding.
  if (magnitude && magnitude < 2 ** -126) return Math.fround(value * 2 ** 192) * 2 ** -192;
  if (magnitude >= 2 ** 127 && Number.isFinite(value))
    return Math.fround(value * 2 ** -192) * 2 ** 192;
  return Math.fround(value);
}

export function multiplyX87Integer(integer, factor) {
  // FILD keeps the integer exact until FMUL rounds the product.
  const absolute = Math.abs(integer);
  if (absolute < 2 ** 29 || factor === 0 || !Number.isFinite(factor))
    return roundX87Single(integer * factor);
  const magnitude = Math.abs(factor),
    unit = 2 ** (Math.floor(Math.log2(magnitude)) - 23),
    product = BigInt(absolute) * BigInt(magnitude / unit),
    shift = BigInt(product.toString(2).length - 24),
    significand = product >> shift,
    remainder = product - (significand << shift),
    halfway = 1n << (shift - 1n),
    roundUp = remainder > halfway || (remainder === halfway && (significand & 1n) !== 0n);
  const rounded = Number(significand + BigInt(roundUp)) * unit * 2 ** Number(shift);
  return integer < 0 !== factor < 0 ? -rounded : rounded;
}
