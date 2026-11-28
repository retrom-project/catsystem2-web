// SPDX-License-Identifier: MIT
// Aliased line coverage follows the llvmpipe rasterizer in the pinned D3D9
// reference environment. Endpoint adjustment is adapted from Mesa 22.3.6,
// src/gallium/drivers/llvmpipe/lp_setup_line.c.
//
// Copyright 2007 VMware, Inc. All Rights Reserved.
//
// Permission is hereby granted, free of charge, to any person obtaining a
// copy of this software and associated documentation files (the "Software"),
// to deal in the Software without restriction, including without limitation
// the rights to use, copy, modify, merge, publish, distribute, sub license,
// and/or sell copies of the Software, and to permit persons to whom the
// Software is furnished to do so, subject to the following conditions:
//
// The above copyright notice and this permission notice (including the next
// paragraph) shall be included in all copies or substantial portions of the
// Software.
//
// THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
// IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
// FITNESS FOR A PARTICULAR PURPOSE AND NON-INFRINGEMENT. IN NO EVENT SHALL
// VMWARE AND/OR ITS SUPPLIERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
// LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING
// FROM, OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER
// DEALINGS IN THE SOFTWARE.

const f = Math.fround;
const positive = (value) => value >= 0;
const fraction = (value) => f(value - Math.floor(value));

function snap(value) {
  const fixed = value * 256,
    floor = Math.floor(fixed);
  return fixed - floor === 0.5 ? floor + (floor & 1) : Math.round(fixed);
}

function capDisplacement(major, minor, travel, rise, slope, horizontal, ending) {
  const x = f(fraction(major) - 0.5);
  let y = f(fraction(minor) - 0.5);
  if (ending && y === -0.5 && rise < 0) y = 0.5;

  const inside = Math.abs(x) + Math.abs(y) < 0.5,
    towardEnd = horizontal ? positive(x) === positive(-travel) : positive(-x) === positive(travel),
    entersMinorSide = horizontal
      ? positive(-y) === positive(rise)
      : positive(y) === positive(-rise),
    crossing = f(fraction(minor) + f(x * slope)),
    crossesCenter = (crossing > 0 || (!horizontal && ending && crossing === 0)) && crossing < 1,
    draw = ending
      ? !inside && towardEnd && (entersMinorSide || crossesCenter)
      : inside || (!towardEnd && (!entersMinorSide || crossesCenter)),
    alreadyCovered = ending
      ? towardEnd || x === 0
      : horizontal
        ? positive(-x) !== positive(travel)
        : positive(x) === positive(travel);
  return alreadyCovered === draw ? 0 : f((travel < 0 ? -0.5 : 0.5) - x);
}

const channel = (color, shift) => ((color >>> shift) & 255) / 255;

export function appendNativeLinePixels(pixels, a, b, flat, bounds) {
  const horizontal = Math.abs(a.x - b.x) >= Math.abs(a.y - b.y),
    major = horizontal ? 'x' : 'y',
    minor = horizontal ? 'y' : 'x',
    axis = horizontal ? 0 : 1,
    start = f(a[major] + 0.5),
    end = f(b[major] + 0.5),
    acrossStart = f(a[minor] + 0.5),
    acrossEnd = f(b[minor] + 0.5),
    travel = f(start - end),
    slope = f(f(acrossStart - acrossEnd) / travel);
  if (!Number.isFinite(slope)) return;

  const rise = f(acrossStart - acrossEnd),
    cap = (along, across, ending) => {
      const offset = capDisplacement(along, across, travel, rise, slope, horizontal, ending);
      return [snap(f(f(along + offset) - 0.5)), snap(f(f(across + f(offset * slope)) - 0.5)) - 128];
    },
    startCap = cap(start, acrossStart, false),
    endCap = cap(end, acrossEnd, true),
    [first, last] = startCap[0] <= endCap[0] ? [startCap, endCap] : [endCap, startCap],
    length = last[0] - first[0],
    lo = Math.max(bounds[axis], Math.ceil(first[0] / 256)),
    hi = Math.min(bounds[axis + 2], Math.ceil(last[0] / 256)),
    // A rising x-major edge excludes its lower boundary. Horizontal and
    // y-major edges include that boundary under the original top-left rule.
    row = horizontal && first[1] < last[1] ? (at) => Math.floor(at) + 1 : Math.ceil,
    constantColor = flat || a.color === b.color;
  for (let at = lo; at < hi; at++) {
    const along = at * 256 - first[0],
      across = row((first[1] * (length - along) + last[1] * along) / (length * 256));
    if (across < bounds[1 - axis] || across >= bounds[3 - axis]) continue;
    // Coverage uses the adjusted caps, while shading uses the original
    // endpoints and interpolates along the major screen axis.
    const t = (at - a[major]) / (b[major] - a[major]),
      left = (1 - t) * a.w,
      right = t * b.w,
      w = left + right,
      z = a.z + (b.z - a.z) * t,
      diffuse = constantColor
        ? undefined
        : [16, 8, 0, 24].map(
            (shift) => (channel(a.color, shift) * left + channel(b.color, shift) * right) / w,
          );
    if (w && Number.isFinite(w) && Number.isFinite(z))
      pixels.push({
        [major]: at,
        [minor]: across,
        z,
        w,
        color: a.color,
        diffuse,
        u: 0,
        v: 0,
      });
  }
}
