// SPDX-License-Identifier: MPL-2.0
// The original Graph receiver computes a hit rectangle in scalar SSE.
const f = Math.fround;
const integer = (value) =>
  value >= -0x80000000 && value < 0x80000000 ? Math.trunc(value) | 0 : -0x80000000;

export function nativePlaneInputGeometry(base, position, [width, height]) {
  const x = f(f(position[0]) - f(base[0])),
    y = f(f(position[1]) - f(base[1]));
  return {
    bounds: [integer(x), integer(y), integer(f(x + f(width))), integer(f(y + f(height)))],
    priority: integer(f(base[2])),
  };
}
