// SPDX-License-Identifier: MPL-2.0
import { f, integer, delta, alpha, uv } from './common.mjs';
import {
  spline,
  clearSpline,
  addPoint,
  prepareSpline,
  sampleSpline,
  normalize,
} from './spline.mjs';
function rotate(out, v, angle) {
  const q = f(integer(f(angle * 1000)) / 1000),
    c = f(Math.cos(q)),
    s = f(Math.sin(q));
  out[0] = f(f(v[0] * c) - f(v[1] * s));
  out[1] = f(f(v[1] * c) + f(v[0] * s));
  out[2] = v[2];
  return out;
}
function reset(i, n) {
  const s = i.state,
    v = s.particles[n],
    p = i.particle(n),
    h = i.host,
    r = h.frand,
    q = i.parameters,
    variant = h.rand() & 3;
  p.base.x = f(q.width * 0.5);
  p.base.y = f(q.height * 0.5);
  uv(p, (variant & 1) * 0.5, (variant >> 1) * 0.5, 0.5, 0.5);
  const scale = f(f(f(r() * s.scaleVar) - f(s.scaleVar * 0.5)) + s.scale);
  p.scale.set([scale, scale, 1]);
  alpha(p, 0);
  const start = sampleSpline(s.line, f(r() * 100));
  clearSpline(v.path);
  addPoint(v.path, start);
  p.pos.set(start);
  const point = s.point;
  point.set(start);
  for (let k = 0; k < 4; k++) {
    if (k > 0 && h.rand() % 5 === 0) continue;
    const angle = f(f(f(r() * s.angleVar) - f(s.angleVar * 0.5)) + s.angle),
      speed = f(f(f(r() * s.speedVar) + f(s.speedVar * 0.5)) + s.speedBase);
    rotate(s.vector, s.direction, angle);
    for (let axis = 0; axis < 3; axis++) point[axis] = f(point[axis] + f(s.vector[axis] * speed));
    addPoint(v.path, point);
  }
  const duration = f((s.durations[0] + s.durations[1] + s.durations[2]) | 0);
  prepareSpline(v.path, duration, f(duration * f(0.4)));
  v.alpha = f(f(f(r() * s.alphaVar) - f(s.alphaVar * 0.5)) + s.alpha);
  v.tick = 0;
  v.mark ??= 0;
  v.mode = 0;
  v.previous.set(p.pos);
}
export const steam = {
  name: 'steam-js',
  apiVersion: 0x20001,
  init(i) {
    const s = i.state,
      r = i.parameters.values,
      pi = f(Math.PI);
    s.speedBase = Math.max(10, r[0]);
    s.speedVar = Math.max(0, r[1]);
    s.angle = Math.max(-pi, Math.min(pi, f(r[2] / 100)));
    s.angleVar = Math.max(-pi, Math.min(pi, f(r[3] / 100)));
    s.scale = Math.max(f(0.01), f(r[4] / 100));
    s.scaleVar = Math.max(0, f(r[5] / 100));
    s.alpha = Math.max(0, r[6]);
    s.alphaVar = Math.max(0, r[7]);
    s.durations = [
      Math.max(0, integer(r[8])),
      Math.max(0, integer(r[9])),
      Math.max(0, integer(r[10])),
    ];
    s.frequency = Math.max(1, Math.min(60, (61 - integer(r[15])) | 0));
    s.batch = Math.max(1, integer(r[16]));
    s.line = spline(2);
    addPoint(s.line, [r[11], r[12], 0]);
    addPoint(s.line, [r[13], r[14], 0]);
    prepareSpline(s.line, 100, 1);
    s.direction = new Float32Array(3);
    s.vector = new Float32Array(3);
    s.point = new Float32Array(3);
    s.vector.set([f(r[11] - r[13]), f(r[12] - r[14]), 0]);
    rotate(s.direction, s.vector, f(pi * 0.5));
    normalize(s.direction, ...s.direction, true);
    s.warm = integer(r[17]) !== 0;
    s.active = s.warm ? i.count >>> 1 : 1;
    i.blendMode = 1;
    s.particles = Array.from({ length: i.count }, () => ({
      path: spline(),
      previous: new Float32Array(3),
    }));
    for (let n = 0; n < i.count; n++) {
      reset(i, n);
      if (s.warm && n < s.active) {
        const v = s.particles[n];
        v.tick = integer(
          f(i.host.frand() * f((s.durations[0] + s.durations[1] + s.durations[2]) | 0)),
        );
        if (v.tick > s.durations[0]) {
          v.mode++;
          v.mark += s.durations[0];
          alpha(i.particle(n), 128);
          if (v.tick > s.durations[1]) {
            v.mode++;
            v.mark += s.durations[1];
          }
        }
      }
    }
  },
  exec(i) {
    const s = i.state,
      d = s.durations,
      step = delta(i);
    if (i.host.rand() % s.frequency === 0) s.active = (s.active + s.batch) >>> 0;
    s.active = Math.min(i.count, s.active);
    for (let n = 0; n < s.active; n++) {
      const v = s.particles[n],
        p = i.particle(n),
        elapsed = f((v.tick - v.mark) | 0);
      if (v.mode === 0) {
        alpha(p, i.host.LinearInt(0, v.alpha, 0, f(d[0]), f(v.tick)));
        p.pos.set(sampleSpline(v.path, f(v.tick)));
        if (v.tick >= d[0]) {
          v.mode = 1;
          v.mark = v.tick;
        }
      } else if (v.mode === 1) {
        alpha(p, v.alpha);
        p.pos.set(sampleSpline(v.path, f(v.tick)));
        if (elapsed >= d[1]) {
          v.mode = 2;
          v.mark = v.tick;
        }
      } else if (v.mode === 2) {
        alpha(p, i.host.LinearInt(v.alpha, 0, 0, f(d[2]), elapsed));
        p.pos.set(sampleSpline(v.path, f(v.tick)));
        if (elapsed > d[2]) {
          v.mode = 3;
          v.mark = v.tick;
        }
      } else reset(i, n);
      v.previous.set(p.pos);
      v.tick = (v.tick + step) | 0;
    }
  },
};
