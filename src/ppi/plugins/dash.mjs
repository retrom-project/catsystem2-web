// SPDX-License-Identifier: MPL-2.0
import { f, integer, delta, alpha, uv } from './common.mjs';
import { normalize } from './spline.mjs';
const length = (v) => f(Math.sqrt(f(f(f(v[0] * v[0]) + f(v[1] * v[1])) + f(v[2] * v[2]))));
function reset(i, n) {
  const s = i.state,
    v = s.particles[n],
    p = i.particle(n),
    h = i.host,
    r = h.frand,
    variant = h.rand() & 3;
  p.base.x = f(i.parameters.width * 0.5);
  p.base.y = f(i.parameters.height * 0.5);
  uv(p, variant * 0.25, 0, 0.25, 1);
  p.scale.set([f(f(f(r() * s.scale) * f(0.8)) + f(s.scale * f(0.2))), 1, 1]);
  alpha(p, 0);
  let speed = s.speed,
    a = 0;
  for (let k = 1; k <= 5; k++) {
    a = f(a + f(f(f(r() * f(0.9)) + f(0.1)) * f(f(k * f(0.1)) * s.spread)));
    speed = f(speed * f(f(r() * f(0.1)) + f(0.85)));
    if (h.rand() % 5 === 0) break;
  }
  a = n % 2 === 0 ? f(f(s.distance * 0.5) - a) : f(a - f(s.distance * 0.5));
  p.rot.z = f(h.Deg2Rad(s.degree));
  const q = f(integer(f(p.rot.z * 1000)) / 1000),
    c = f(Math.cos(q)),
    sn = f(Math.sin(q)),
    startY = -s.distance,
    endY = f(s.distance + i.parameters.height);
  v.start[0] = f(f(f(-sn * startY) + f(c * a)) + 640);
  v.start[1] = f(f(f(startY * c) + f(sn * a)) + 360);
  v.start[2] = 0;
  v.end[0] = f(f(f(-sn * endY) + f(c * a)) + 640);
  v.end[1] = f(f(f(endY * c) + f(sn * a)) + 360);
  v.end[2] = 0;
  for (let k = 0; k < 3; k++) v.velocity[k] = f(v.end[k] - v.start[k]);
  v.threshold = length(v.velocity);
  if (!(0 >= v.threshold))
    for (let k = 0; k < 3; k++) v.velocity[k] = f(v.velocity[k] / v.threshold);
  for (let k = 0; k < 3; k++) v.velocity[k] = f(v.velocity[k] * speed);
  v.point.set(v.start);
  v.tick = 0;
  v.mode = 0;
  v.previous.set(p.pos);
  for (let t = 0; t < s.tailCount; t++) {
    const at = s.heads + n * s.tailCount + t,
      tail = i.particle(at),
      state = s.particles[at];
    state.tick = 0;
    state.mode = 0;
    tail.pos.set(p.pos);
    alpha(tail, 0);
  }
}
export const dash = {
  name: 'dash-js',
  apiVersion: 0x20001,
  construct(i) {
    if (i.module.shared.active == null) i.module.shared.active = 1;
  },
  init(i) {
    const s = i.state,
      r = i.parameters.values,
      divisor = integer(r[0]) >>> 0;
    s.heads = divisor ? Math.floor(i.count / divisor) : i.count;
    s.tailCount = divisor ? divisor - 1 : 0;
    s.speed = r[1];
    s.scale = f(r[2] / 100);
    s.degree = r[3];
    s.distance = r[4];
    s.spread = r[5];
    s.alpha = integer(r[6]) & 255;
    s.particles = Array.from({ length: i.count }, () => ({
      tick: 0,
      mark: 0,
      mode: 0,
      previous: new Float32Array(3),
      start: new Float32Array(3),
      end: new Float32Array(3),
      point: new Float32Array(3),
      velocity: new Float32Array(3),
    }));
    s.vector = new Float32Array(3);
    i.blendMode = 1;
    for (let n = 0; n < s.heads; n++) reset(i, n);
  },
  exec(i) {
    const s = i.state,
      h = i.host,
      step = delta(i),
      shared = i.module.shared;
    shared.active = Math.min((shared.active + 1) | 0, s.heads);
    for (let n = 0; n < shared.active; n++) {
      const p = i.particle(n),
        v = s.particles[n];
      if (v.mode !== 0) reset(i, n);
      else {
        v.point[0] = f(v.point[0] + v.velocity[0]);
        v.point[1] = f(v.point[1] + v.velocity[1]);
        p.pos.set(v.point);
        alpha(p, s.alpha);
        for (let k = 0; k < 3; k++) s.vector[k] = f(v.point[k] - v.start[k]);
        if (length(s.vector) > v.threshold) {
          v.mode = 2;
          v.mark = v.tick;
        }
      }
      if (v.mode === 0)
        for (let t = 0; t < s.tailCount; t++) {
          const at = s.heads + n * s.tailCount + t,
            tail = i.particle(at),
            state = s.particles[at];
          if (state.mode !== 0) continue;
          for (let k = 0; k < 3; k++) s.vector[k] = f(p.pos[k] - v.previous[k]);
          const distance = length(s.vector);
          if (distance === 0) {
            tail.pos.set(p.pos);
            tail.base.set(p.base);
            tail.scale.set(p.scale);
          } else {
            normalize(s.vector, ...s.vector, true);
            let angle = f(h.acos(s.vector[1]));
            if (s.vector[0] > 0) angle = -angle;
            tail.rot.z = angle;
            for (let k = 0; k < 3; k++) tail.pos[k] = f(f(p.pos[k] + v.previous[k]) * 0.5);
            tail.base.set(p.base);
            tail.scale.set(p.scale);
            tail.scale.y = f(f(distance * f(0.7)) * p.scale.y);
          }
          state.mode = 1;
          break;
        }
      for (let t = 0; t < s.tailCount; t++) {
        const at = s.heads + n * s.tailCount + t,
          tail = i.particle(at),
          state = s.particles[at];
        if (!state.mode) continue;
        alpha(tail, h.LinearInt(255, 0, 0, f(s.tailCount), f(state.tick)));
        state.tick = (state.tick + step) | 0;
        if (state.tick >>> 0 >= s.tailCount) {
          state.tick = 0;
          state.mode = 0;
          alpha(tail, 0);
        }
      }
      v.previous.set(p.pos);
      v.tick = (v.tick + step) | 0;
    }
  },
};
