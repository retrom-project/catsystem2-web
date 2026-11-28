// SPDX-License-Identifier: MPL-2.0
import { f, integer, delta, alpha, centeredQuad, anchorOffset } from './common.mjs';
import {
  spline,
  clearSpline,
  addPoint,
  prepareSpline,
  sampleSpline,
  normalize,
} from './spline.mjs';
function reset(i, n) {
  const s = i.state,
    v = s.particles[n],
    p = i.particle(n),
    h = i.host,
    r = h.frand;
  p.scale.set([f(f(r() * s.size) * 0.4 + f(s.size * f(0.6))), 0, 1]);
  p.scale.y = p.scale.x;
  for (let k = 0; k < 3; k++)
    v.durations[k] = integer(f(f(f(r() * f(s.durations[k])) * 0.5) + f(f(s.durations[k]) * 0.5)));
  p.rot.z = f(r() - 0.5);
  alpha(p, 0);
  centeredQuad(p, i.parameters.width, i.parameters.height);
  p.pos.set([s.anchor[0], s.anchor[1], 0]);
  const d = f(f(s.size * 80) * s.factor),
    initial = s.vector,
    point = s.point;
  normalize(initial, s.orientation === 0 ? -1 : 1, -1, 0);
  let length = f(f(r() * d) + d);
  for (let k = 0; k < 3; k++) point[k] = f(f(initial[k] * length) + (k < 2 ? s.anchor[k] : 0));
  normalize(initial, f(point[0] - s.anchor[0]), f(point[1] - s.anchor[1]), point[2]);
  const plus = s.plus,
    minus = s.minus;
  for (const [out, degrees] of [
    [plus, 50],
    [minus, -50],
  ]) {
    const theta = f(h.Deg2Rad(degrees)),
      c = h.cos(theta),
      sn = h.sin(theta);
    out[0] = f(f(c * initial[0]) - f(sn * initial[1]));
    out[1] = f(f(sn * initial[0]) + f(c * initial[1]));
  }
  const rangeX = f(Math.sqrt(f(Math.pow(f(plus[0] - minus[0]), 2)))),
    rangeY = f(Math.sqrt(f(Math.pow(f(plus[1] - minus[1]), 2))));
  clearSpline(v.path);
  for (let k = 0; k < 4; k++) {
    const x = f(initial[0] + f(f(r() * rangeX) - f(rangeX * 0.5))),
      y = f(initial[1] + f(f(r() * rangeY) - f(rangeY * 0.5)));
    normalize(s.direction, x, y, initial[2]);
    length = f(f(r() * d) + d);
    for (let axis = 0; axis < 3; axis++)
      point[axis] = f(point[axis] + f(s.direction[axis] * length));
    addPoint(v.path, point);
  }
  prepareSpline(
    v.path,
    f((v.durations[0] + v.durations[1] + v.durations[2]) | 0),
    f(f(s.size * 120) * s.factor),
  );
  v.tick = 0;
  v.mark = 0;
  v.mode = 0;
}
export const em_note = {
  name: 'em-note-js',
  apiVersion: 0x20002,
  init(i) {
    const s = i.state,
      r = i.parameters.values,
      divisor = integer(r[0]) >>> 0;
    s.heads = divisor ? Math.floor(i.count / divisor) : i.count;
    s.tailCount = divisor ? divisor - 1 : 0;
    s.anchor = [r[1], r[2]];
    s.orientation = integer(r[3]);
    s.size = Math.max(f(0.001), f(r[4] / 100));
    s.durations = [integer(r[5]), integer(r[6]), integer(r[7])];
    s.factor = i.parameters.height > 256 ? 1 : 0.5;
    s.active = 1;
    for (const key of ['vector', 'point', 'plus', 'minus', 'direction'])
      s[key] = new Float32Array(3);
    s.particles = Array.from({ length: i.count }, () => ({
      tick: 0,
      mark: 0,
      mode: 0,
      durations: new Int32Array(3),
      path: spline(),
    }));
    for (let n = 0; n < s.heads; n++) reset(i, n);
  },
  exec(i) {
    const s = i.state,
      step = delta(i),
      offset = anchorOffset(i);
    if (i.host.rand() % 51 === 0) s.active++;
    s.active = Math.min(s.active, s.heads);
    for (let n = 0; n < s.active; n++) {
      const p = i.particle(n),
        v = s.particles[n],
        e = f((v.tick - v.mark) | 0),
        d = v.durations;
      if (v.mode === 0) {
        p.pos.set(sampleSpline(v.path, f(v.tick)));
        alpha(p, i.host.LinearInt(0, 255, 0, f(d[0]), e));
        if (e > d[0]) {
          v.mode = 1;
          v.mark = v.tick;
        }
      } else if (v.mode === 1) {
        p.pos.set(sampleSpline(v.path, f(v.tick)));
        if (e > d[1]) {
          v.mode = 2;
          v.mark = v.tick;
        }
      } else if (v.mode === 2) {
        p.pos.set(sampleSpline(v.path, f(v.tick)));
        alpha(p, i.host.LinearInt(255, 0, 0, f(d[2]), e));
        if (e > d[2]) {
          v.mode = 10;
          v.mark = v.tick;
        }
      } else reset(i, n);
      p.pos.x = f(p.pos.x + offset[0]);
      p.pos.y = f(p.pos.y + offset[1]);
      v.tick = (v.tick + step) | 0;
    }
  },
};
