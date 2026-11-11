// SPDX-License-Identifier: BSD-3-Clause
// Bezier patch/grid algorithms adapted from motionplayer; see NOTICE.md.
import { BICUBIC_OPERATIONS } from './bicubic-operations.mjs';
const f = Math.fround;
const rowOrder = Object.freeze([1, 0, 2, 3]);
const weights = Object.freeze([1, 3, 3, 1]);

export class EmotePatch {
  constructor() {
    this.u = new Float32Array(4);
    this.v = new Float32Array(4);
    this.accumulator = new Float32Array(4);
    this.registers = new Float32Array(36);
    this.table = new Float32Array(36);
    this.result = new Float32Array(2);
  }
  basis(out, value) {
    value = f(value);
    const q = f(1 - value);
    out[0] = f(q * f(q * q));
    out[1] = f(f(value * f(q * q)) * 3);
    out[2] = f(f(value * f(value * q)) * 3);
    out[3] = f(value * f(value * value));
  }
  evaluate(points, u, v) {
    // Cached Bernstein basis, separate f32 coordinate*U then *V,
    // row accumulation 1,0,2,3 and two pairwise horizontal additions.
    this.basis(this.u, u);
    this.basis(this.v, v);
    const a = this.accumulator,
      bu = this.u,
      bv = this.v;
    for (let axis = 0; axis < 2; axis++) {
      for (let column = 0; column < 4; column++) {
        let acc = 0;
        for (const row of rowOrder) {
          const product = f(f(points[(row * 4 + column) * 2 + axis] * bu[column]) * bv[row]);
          acc = row === 1 ? product : f(acc + product);
        }
        a[column] = acc;
      }
      this.result[axis] = f(f(a[3] + a[2]) + f(a[1] + a[0]));
    }
    return this.result;
  }
  mappedEvaluate(points, u, v) {
    // Reviewed target's packed Bernstein reduction. A row-major scalar sum
    // is mathematically equivalent but changes visible float32 vertices.
    const r = this.registers,
      t = this.table;
    r.fill(0);
    r[8] = 1;
    for (let i = 0; i < 4; i++) r[28 + i] = r[32 + i] = t[i] = weights[i];
    for (let i = 0; i < 16; i++) {
      t[4 + i] = points[i * 2];
      t[20 + i] = points[i * 2 + 1];
    }
    for (const [op, d, a, b] of BICUBIC_OPERATIONS) {
      const dst = d * 4,
        src = a * 4;
      if (op === 'stack') {
        r[dst] = 0;
        r.fill(0, dst + 1, dst + 4);
      } else if (op === 'coordAdd') r[dst] += a ? v : u;
      else if (op === 'control') {
        r[dst] = a === 0 ? 1 : 0;
        r.fill(0, dst + 1, dst + 4);
      } else if (op === 'controlMul') r[dst] *= a === 0 || a === 3 ? 1 : 0;
      else if (op === 'one') {
        r[dst] = 1;
        r.fill(0, dst + 1, dst + 4);
      } else if (op === 'move') r.copyWithin(dst, src, src + 4);
      else if (op === 'table') for (let i = 0; i < 4; i++) r[dst + i] = t[(a - 48) / 4 + i];
      else if (op === 'scalarAdd') r[dst] += r[src];
      else if (op === 'scalarSub') r[dst] -= r[src];
      else if (op === 'scalarMul') r[dst] *= r[src];
      else if (op === 'add') for (let i = 0; i < 4; i++) r[dst + i] += r[src + i];
      else if (op === 'multiply') for (let i = 0; i < 4; i++) r[dst + i] *= r[src + i];
      else if (op === 'shuffle' || op === 'unpack') {
        const x = r[dst + (op === 'unpack' ? 0 : b & 3)],
          y = r[dst + (op === 'unpack' ? 1 : (b >>> 2) & 3)],
          z = r[src + (op === 'unpack' ? 0 : (b >>> 4) & 3)],
          w = r[src + (op === 'unpack' ? 1 : (b >>> 6) & 3)];
        if (op === 'unpack') {
          r[dst] = x;
          r[dst + 1] = z;
          r[dst + 2] = y;
          r[dst + 3] = w;
        } else {
          r[dst] = x;
          r[dst + 1] = y;
          r[dst + 2] = z;
          r[dst + 3] = w;
        }
      } else if (op === 'store') this.result[d] = r[src];
    }
    return this.result;
  }
  mapPosition(points, inverse, x, y) {
    x += inverse[4];
    y += inverse[5];
    return this.mappedEvaluate(
      points,
      f(inverse[0] * x + inverse[2] * y),
      f(inverse[1] * x + inverse[3] * y),
    );
  }
  map(points, inverse, x, y) {
    x = f(x + inverse[4]);
    y = f(y + inverse[5]);
    return this.mappedEvaluate(
      points,
      f(f(inverse[0] * x) + f(inverse[2] * y)),
      f(f(inverse[1] * x) + f(inverse[3] * y)),
    );
  }
}

export function patchDivisions(division, width, height, ratio = 1) {
  division = Math.max(0, Math.min(50, Math.trunc(division * ratio)));
  const x = Math.trunc((division * Math.trunc(width)) / (Math.trunc(width) + Math.trunc(height)));
  return [x + 1, division - x + 1];
}
