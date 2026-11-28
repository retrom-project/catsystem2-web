// SPDX-License-Identifier: MPL-2.0
import { f, delta, uv } from './common.mjs';
function reset(i, n) {
  const p = i.particle(n),
    v = i.state.particles[n],
    h = i.host,
    q = i.parameters;
  p.base.x = f(q.width * 0.5);
  p.base.y = f(q.height * 0.5);
  if (n < 2) {
    uv(p, 0, n * 0.5, 0.625, 0.3125);
    p.pos.set([640, 360, 20]);
    p.scale.set([1.25, f(0.8), 0]);
    for (const vertex of p.vertices) vertex.color = 0x05ffffff;
    p.disp = 0;
    v.variant = n;
    v.mode = n === 0 ? 1 : 0;
    v.tick = 0;
  } else if (n === 2) {
    uv(p, 0.75, 0.5, 0.25, 0.5);
    p.scale.set([1, 1, 1]);
    p.pos.set([f(h.frand() * 1280), 200, 10]);
    p.scale.x = f(f(h.frand() * f(0.1)) + 0.1);
    for (const vertex of p.vertices) vertex.color = (((h.rand() & 255) << 24) | 0xffffff) >>> 0;
    v.life = f((h.rand() % 5) + 1);
    p.disp = 1;
    v.tick = 0;
    v.mark = 0;
    v.mode = 0;
  } else {
    uv(p, 0.75, 0, 0.25, 0.25);
    p.pos.set([f(h.frand() * 1280), f(h.frand() * 720), f(n - 2)]);
    p.rot.z = f(h.frand() * f(Math.PI));
    p.scale.x = p.scale.y = f(f(h.frand() * f(0.01)) + f(0.005));
    p.scale.z = 1;
    for (const vertex of p.vertices) vertex.color = ((h.rand() % 200 << 24) | 0xffffff) >>> 0;
    v.life = f(h.rand() & 7);
    p.disp = 0;
    v.tick = 0;
    v.mark = 0;
    v.mode = 0;
  }
}
export const filmnoise = {
  name: 'filmnoise-js',
  apiVersion: 0x20001,
  init(i) {
    i.state.active = 3;
    i.state.particles = Array.from({ length: i.count }, () => ({
      tick: 0,
      mark: 0,
      mode: 0,
      variant: 0,
      life: 0,
    }));
    for (let n = 0; n < i.count; n++) reset(i, n);
  },
  exec(i) {
    const s = i.state,
      step = delta(i);
    if (i.host.rand() % 30 === 0) s.active++;
    s.active = Math.min(s.active, i.count);
    for (let n = 0; n < s.active; n++) {
      const p = i.particle(n),
        v = s.particles[n];
      if (n < 2) {
        if (v.mode === 0 || v.mode === 1) {
          p.disp = v.mode === 0 ? +(v.variant === 0) : +(v.variant !== 0);
          if (((v.tick - v.mark) | 0) > 1) {
            v.mark = v.tick;
            v.mode = 1 - v.mode;
          }
        } else reset(i, n);
      } else if (v.mode !== 0) reset(i, n);
      else {
        if (n >= 3) p.disp = 1;
        if (f((v.tick - v.mark) | 0) > v.life) {
          v.mode = 1;
          v.mark = v.tick;
        }
      }
      v.tick = (v.tick + step) | 0;
    }
  },
};
