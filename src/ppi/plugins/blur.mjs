// SPDX-License-Identifier: MPL-2.0
import { f, integer, delta, anchorOffset } from './common.mjs';
function identity(out) {
  out.fill(0);
  out[0] = out[5] = out[10] = out[15] = 1;
}
function multiply(out, a, b) {
  for (let row = 0; row < 4; row++)
    for (let col = 0; col < 4; col++) {
      const k = row * 4;
      out[k + col] = f(
        f(f(f(a[k] * b[col]) + f(a[k + 1] * b[col + 4])) + f(a[k + 2] * b[col + 8])) +
          f(a[k + 3] * b[col + 12]),
      );
    }
}
function matrix(i, offset) {
  const s = i.state,
    m = s.matrix,
    r = s.rotation,
    temp = s.temporary;
  identity(m);
  m[0] = s.scale[0];
  m[5] = s.scale[1];
  for (let axis = 0; axis < 3; axis++) {
    identity(r);
    const q = f(integer(f(s.angles[axis] * 1000)) / 1000),
      c = f(Math.cos(q)),
      sn = f(Math.sin(q));
    if (axis === 0) {
      r[5] = c;
      r[6] = sn;
      r[9] = -sn;
      r[10] = c;
    } else if (axis === 1) {
      r[0] = c;
      r[2] = -sn;
      r[8] = sn;
      r[10] = c;
    } else {
      r[0] = c;
      r[1] = sn;
      r[4] = -sn;
      r[5] = c;
    }
    multiply(temp, r, m);
    m.set(temp);
  }
  m[12] = f(m[12] + f(i.parameters.values[1] + offset[0]));
  m[13] = f(m[13] + f(i.parameters.values[2] + offset[1]));
}
function channel(i, base, variation) {
  let c = f(f(i.host.frand() * f(variation)) + f(base));
  c = Math.max(Math.min(base, 255), Math.min(Math.max(base, 255), c));
  return integer(c) & 255;
}
export const blur = {
  name: 'blur-js',
  apiVersion: 0x20002,
  init(i) {
    const s = i.state,
      r = i.parameters.values;
    s.scale = [f(r[4] / 100), f(r[5] / 100), 1];
    s.angles = [f(i.host.Deg2Rad(r[6])), f(i.host.Deg2Rad(r[7])), f(i.host.Deg2Rad(r[8]))];
    s.base = [integer(r[9]) & 255, integer(r[10]) & 255, integer(r[11]) & 255];
    s.variation = [integer(r[12]) & 255, integer(r[13]) & 255, integer(r[14]) & 255];
    s.config = r[3];
    if (integer(r[15])) i.blendMode = 1;
    s.matrix = new Float32Array(16);
    s.rotation = new Float32Array(16);
    s.temporary = new Float32Array(16);
    s.age = 0;
    s.particles = [];
    const step = f(i.parameters.width / f(i.count)),
      inv = f(1 / f(i.count)),
      half = f(i.parameters.width * 0.5);
    for (let n = 0; n < i.count; n++) {
      const p = i.particle(n),
        y = f(f(n) * step),
        next = f(y + step),
        u = f(f(n) * inv),
        v = {
          tick: 0,
          local: new Float32Array([-half, y, 0, half, y, 0, -half, next, 0, half, next, 0]),
          randomDelay: 0,
          fade: 0,
        };
      const b = channel(i, s.base[0], s.variation[0]),
        g = channel(i, s.base[0], s.variation[0]),
        r = channel(i, s.base[0], s.variation[0]);
      for (const vertex of p.vertices) vertex.color = ((r << 16) | (g << 8) | b) >>> 0;
      p.vertices[0].u = 0;
      p.vertices[0].v = u;
      p.vertices[1].u = 1;
      p.vertices[1].v = u;
      p.vertices[2].u = 0;
      p.vertices[2].v = f(u + inv);
      p.vertices[3].u = 1;
      p.vertices[3].v = f(u + inv);
      v.randomDelay = integer(f(f(i.host.frand() * 10) + 10));
      v.fade = integer(f(f(i.host.frand() * 20) + 20));
      s.particles.push(v);
    }
  },
  exec(i) {
    const s = i.state,
      h = i.host,
      random = integer(i.parameters.values[0]),
      step = delta(i),
      offset = anchorOffset(i);
    matrix(i, offset);
    const m = s.matrix;
    for (let n = 0; n < i.count; n++) {
      const p = i.particle(n),
        v = s.particles[n],
        b = channel(i, s.base[0], s.variation[0]),
        g = channel(i, s.base[1], s.variation[1]),
        r = channel(i, s.base[2], s.variation[2]),
        color = (0xff000000 | (r << 16) | (g << 8) | b) >>> 0;
      for (let vertex = 0; vertex < 4; vertex++) {
        let x = v.local[vertex * 3];
        const y = v.local[vertex * 3 + 1],
          z = v.local[vertex * 3 + 2];
        if (random) {
          const amplitude = (h.rand() & 127) === 0 ? f(s.config * 50) : s.config;
          x = f(x + f(f(f(h.frand() * 2) - 1) * amplitude));
        }
        const out = p.vertices[vertex];
        out.x = f(f(f(f(x * m[0]) + f(y * m[4])) + f(z * m[8])) + m[12]);
        out.y = f(f(f(f(x * m[1]) + f(y * m[5])) + f(z * m[9])) + m[13]);
        out.z = f(f(f(f(x * m[2]) + f(y * m[6])) + f(z * m[10])) + m[14]);
        out.color = color;
      }
      v.tick = (v.tick + step) | 0;
    }
    s.age = f(s.age + f(step));
  },
};
