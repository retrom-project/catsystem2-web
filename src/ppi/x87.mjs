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
