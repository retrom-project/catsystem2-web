// SPDX-License-Identifier: MPL-2.0
import { f, integer, delta, alpha, uv } from './common.mjs';
function reset(i, n) {
  const p = i.particle(n),
    s = i.state.particles[n],
    h = i.host,
    q = i.parameters,
    variant = h.rand() & 3;
  uv(p, (variant & 1) * 0.5, (variant >> 1) * 0.5, 0.5, 0.5);
  p.base.x = f(q.width * 0.5);
  p.base.y = f(q.height * 0.5);
  const span = f(integer(f(q.screenWidth * f(2.8))));
  p.pos.x = f(f(h.frand() * span) - f(f(span - q.screenWidth) * 0.5));
  p.pos.y = -100;
  p.pos.z = f(h.frand() * 10);
  alpha(p, 0);
  p.rot.x = 0;
  p.rot.y = 0;
  p.rot.z = f(f(f(h.frand() * i.state.spread) - f(i.state.spread * 0.5)) + i.state.angle);
  s.age = 0;
  s.mark = 0;
  s.mode = 0;
  s.previous.set(p.pos);
  s.life = f(f(h.frand() * i.state.lifeRange) + i.state.lifeMin);
  s.alpha = f((h.rand() % 70) + 100);
  const angle = f(integer(f(p.rot.z * 1000)) / 1000),
    speed = f(1020 / s.life);
  s.velocity[0] = f(-f(Math.sin(angle)) * speed);
  s.velocity[1] = f(f(Math.cos(angle)) * speed);
  s.velocity[2] = 0;
}
export const rain = {
  name: 'rain-js',
  apiVersion: 0x20001,
  init(i) {
    const r = i.parameters.values,
      s = i.state;
    s.lifeMin = Math.max(1, integer(r[0]));
    s.lifeRange = Math.max(0, integer(r[1]));
    s.angle = Math.max(-1, Math.min(1, f(r[2] / 100)));
    s.spread = Math.max(f(-0.2), Math.min(f(0.2), f(r[3] / 100)));
    s.frequency = Math.max(1, Math.min(60, (61 - integer(r[4])) | 0));
    s.batch = integer(r[5]);
    s.active = integer(r[6]) ? i.count >>> 1 : 0;
    s.particles = Array.from({ length: i.count }, () => ({
      velocity: new Float32Array(3),
      previous: new Float32Array(3),
    }));
    for (let n = 0; n < i.count; n++) {
      reset(i, n);
      if (n < s.active) {
        const p = i.particle(n),
          v = s.particles[n];
        v.age = integer(f(i.host.frand() * v.life));
        p.pos.x = f(f(v.velocity[0] * f(v.age)) + p.pos.x);
        p.pos.y = f(f(v.velocity[1] * f(v.age)) + p.pos.y);
      }
    }
  },
  exec(i) {
    const s = i.state,
      step = delta(i),
      h = i.host;
    if (h.rand() % s.frequency === 0) s.active = (s.active + s.batch) >>> 0;
    s.active = Math.min(s.active, i.count);
    for (let n = 0; n < s.active; n++) {
      const p = i.particle(n),
        v = s.particles[n];
      if (v.mode === 0) {
        p.pos.x = f(p.pos.x + v.velocity[0]);
        p.pos.y = f(p.pos.y + v.velocity[1]);
        alpha(p, h.LinearInt(0, v.alpha, 0, 2, f((v.age - v.mark) | 0)));
        if (p.pos.y >= f(i.parameters.screenHeight + 200)) {
          v.mode = 2;
          v.mark = v.age;
        }
      } else if (v.mode === 1) {
        for (let k = 0; k < 3; k++) p.pos[k] = f(p.pos[k] + v.velocity[k]);
        if (v.age > s.lifeMin) {
          v.mode = 10;
          v.mark = v.age;
        }
      } else reset(i, n);
      v.previous.set(p.pos);
      v.age = (v.age + step) | 0;
    }
  },
};
