// SPDX-License-Identifier: MPL-2.0
import { f, integer, delta, alpha, anchorOffset } from './common.mjs';
import { spline, addPoint, prepareSpline, sampleSpline } from './spline.mjs';
import { tails, initialTails } from './emote-symbols.mjs';
export const em_sweat = {
  name: 'em-sweat-js',
  apiVersion: 0x20002,
  init(i) {
    const s = i.state,
      r = i.parameters.values,
      S = Math.max(f(0.001), f(r[2] / 100)),
      factor = i.parameters.height > 256 ? 1 : 0.5;
    s.durations = [integer(r[3]), integer(r[4])];
    s.particles = Array.from({ length: i.count }, () => ({
      tick: 0,
      mark: 0,
      mode: 0,
      active: 0,
      pos: new Float32Array(3),
    }));
    if (!i.count) return;
    const p = i.particle(0);
    p.base.set([f(i.parameters.width * 0.5), f(i.parameters.height * 0.5), 0]);
    p.pos.set([r[0], r[1], 0]);
    p.scale.set([S, S, 1]);
    alpha(p, 0);
    s.path = spline(2);
    addPoint(s.path, [r[0], r[1], 0]);
    addPoint(s.path, [r[0], f(r[1] + f(f(S * 150) * factor)), 0]);
    prepareSpline(s.path, f((s.durations[0] + s.durations[1]) | 0), 10);
    initialTails(i);
  },
  exec(i) {
    if (!i.count) return;
    const s = i.state,
      v = s.particles[0],
      p = i.particle(0),
      e = f((v.tick - v.mark) | 0),
      d = s.durations,
      step = delta(i),
      offset = anchorOffset(i);
    p.pos.set(sampleSpline(s.path, f(v.tick)));
    if (v.mode === 0) {
      alpha(p, i.host.LinearInt(0, 255, 0, f(d[0]), e));
      if (e > d[0]) {
        v.mode = 1;
        v.mark = v.tick;
      }
    } else if (v.mode === 1 && e > d[1]) {
      v.mode = 10;
      v.mark = v.tick;
    }
    tails(i, 0, 22, 25, false, step, offset, v.mode <= 1);
    p.pos.x = f(p.pos.x + offset[0]);
    p.pos.y = f(p.pos.y + offset[1]);
    v.tick = (v.tick + step) | 0;
  },
};
