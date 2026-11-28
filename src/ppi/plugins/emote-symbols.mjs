// SPDX-License-Identifier: MPL-2.0
import { f, integer, delta, alpha, centeredQuad, anchorOffset } from './common.mjs';
const size = (value) => Math.max(f(0.001), value);
const durations = (r, start, count) =>
  Array.from({ length: count }, (_, n) => integer(r[start + n]));
const change = (v, state) => {
  v.mode = state;
  v.mark = v.tick;
};
function tails(i, head, fade, limit, grow, step, offset, generate = true) {
  const states = i.state.particles,
    p = i.particle(head);
  if (generate)
    for (let n = 1; n < i.count; n++)
      if (!states[n].active) {
        const tail = i.particle(n),
          s = states[n];
        tail.pos.set(p.pos);
        tail.pos.z = f(tail.pos.z - 1);
        tail.rot.set(p.rot);
        tail.scale.set(p.scale);
        s.pos.set(p.pos);
        s.active = 1;
        break;
      }
  for (let n = 1; n < i.count; n++) {
    const tail = i.particle(n),
      s = states[n];
    if (!s.active) continue;
    tail.pos.x = s.pos[0];
    tail.pos.y = s.pos[1];
    alpha(tail, i.host.LinearInt(30, 0, 0, fade, f(s.tick)));
    if (grow) tail.scale.x = tail.scale.y = f(tail.scale.x * f(1.01));
    s.tick = (s.tick + step) | 0;
    if (s.tick > limit) {
      alpha(tail, 0);
      s.tick = 0;
      s.active = 0;
    }
    tail.pos.x = f(tail.pos.x + offset[0]);
    tail.pos.y = f(tail.pos.y + offset[1]);
  }
}
function initialTails(i) {
  const head = i.particle(0);
  for (let n = 1; n < i.count; n++) {
    const p = i.particle(n);
    p.base.set(head.base);
    p.pos.set(head.pos);
    p.scale.set(head.scale);
    alpha(p, 0);
  }
}
export const em_angry = {
  name: 'em-angry-js',
  apiVersion: 0x20002,
  init(i) {
    const r = i.parameters.values,
      s = i.state;
    s.anchor = [r[0], r[1]];
    s.size = size(f(r[2] / 100));
    s.durations = durations(r, 3, 9);
    s.factor = i.parameters.height > 256 ? 1 : 0.5;
    s.particles = Array.from({ length: i.count }, () => ({
      tick: 0,
      mark: 0,
      mode: 0,
      active: 0,
      pos: new Float32Array(3),
    }));
    if (!i.count) return;
    const p = i.particle(0);
    p.base.x = f(i.parameters.width * 0.5);
    p.base.y = f(i.parameters.height * 0.5);
    p.pos.set([s.anchor[0], s.anchor[1], 0]);
    p.scale.set([f(s.size * f(0.1)), f(s.size * f(0.1)), 1]);
    alpha(p, 0);
    initialTails(i);
  },
  exec(i) {
    if (!i.count) return;
    const s = i.state,
      v = s.particles[0],
      p = i.particle(0),
      d = s.durations,
      S = s.size,
      h = i.host,
      elapsed = f((v.tick - v.mark) | 0),
      step = delta(i),
      offset = anchorOffset(i);
    const position = () => {
      p.pos.x = f(s.anchor[0] + f(f(f(h.TriWave(elapsed, 4) * S) * 4) * s.factor));
      p.pos.y = s.anchor[1];
    };
    p.pos.x = s.anchor[0];
    p.pos.y = s.anchor[1];
    switch (v.mode) {
      case 0:
        p.scale.x = p.scale.y = h.LinearInt(f(S * f(0.1)), f(S * f(1.4)), 0, f(d[0]), elapsed);
        p.rot.z = h.LinearInt(0, 1, 0, f(d[1]), elapsed);
        alpha(p, h.LinearInt(0, 255, 0, f(d[0]), elapsed));
        if (elapsed > d[0]) change(v, 1);
        break;
      case 1:
        p.scale.x = p.scale.y = h.LinearInt(f(S * f(1.4)), S, 0, f(d[1]), elapsed);
        p.rot.z = h.LinearInt(1, f(0.3), 0, f(d[1]), elapsed);
        if (elapsed > d[1]) change(v, 2);
        break;
      case 2:
        position();
        if (elapsed > d[2]) change(v, 3);
        break;
      case 3:
        position();
        p.scale.x = p.scale.y = h.LinearInt(S, f(S * f(1.1)), 0, f(d[3]), elapsed);
        if (elapsed > d[3]) change(v, 4);
        break;
      case 4:
        position();
        p.scale.x = p.scale.y = h.LinearInt(f(S * f(1.2)), S, 0, f(d[4]), elapsed);
        if (elapsed > d[4]) change(v, 2);
        break;
    }
    tails(i, 0, 29, 29, true, step, offset);
    p.pos.x = f(p.pos.x + offset[0]);
    p.pos.y = f(p.pos.y + offset[1]);
    v.tick = (v.tick + step) | 0;
  },
};
function initDouble(i) {
  const s = i.state,
    r = i.parameters.values;
  s.anchor = [r[0], r[1]];
  s.orientation = integer(r[2]);
  s.size = size(f(r[3] / 100));
  s.durations = durations(r, 4, 5);
  s.factor = i.parameters.height > 256 ? 1 : 0.5;
  s.particles = Array.from({ length: i.count }, () => ({ tick: 0, mark: 0, mode: 0 }));
  for (let n = 0; n < i.count; n++) {
    const p = i.particle(n);
    centeredQuad(p, i.parameters.width, i.parameters.height);
    p.pos.set([s.anchor[0], s.anchor[1], 0]);
    p.scale.set([f(s.size * 3), f(s.size * 3), 1]);
    p.rot.z = s.orientation === 0 ? f(-0.4) : f(0.4);
    alpha(p, 0);
  }
}
export const em_double = {
  name: 'em-double-js',
  apiVersion: 0x20002,
  init: initDouble,
  exec(i) {
    const s = i.state,
      S = s.size,
      d = s.durations,
      h = i.host,
      step = delta(i),
      offset = anchorOffset(i);
    for (let n = 0; n < i.count; n++) {
      const p = i.particle(n),
        v = s.particles[n],
        elapsed = f((v.tick - v.mark) | 0);
      if (v.mode === 0) {
        p.pos.x = s.anchor[0];
        p.pos.y = s.anchor[1];
        p.scale.x = p.scale.y = h.LinearInt(f(S * 3), S, 0, f(d[0]), elapsed);
        alpha(p, h.LinearInt(0, 255, 0, f(d[0]), elapsed));
        if (elapsed > d[0]) change(v, 1);
      } else if (v.mode === 1) {
        const q = h.LinearInt(f(f(S * 35) * s.factor), 0, 0, f(d[1]), elapsed),
          k = integer(elapsed) % 4;
        if (k >= 0) {
          p.pos.x = f(s.anchor[0] + (k === 0 || k === 3 ? -q : q));
          p.pos.y = f(s.anchor[1] + (k === 0 || k === 2 ? -q : q));
        }
      } else if (v.mode === 2) {
        p.pos.x = s.anchor[0];
        p.pos.y = s.anchor[1];
        if (elapsed > d[2]) change(v, 1);
      }
      p.pos.x = f(p.pos.x + offset[0]);
      p.pos.y = f(p.pos.y + offset[1]);
      v.tick = (v.tick + step) | 0;
    }
  },
};
function question(wait) {
  return {
    name: wait ? 'em-question-js' : 'em-question-a-js',
    apiVersion: 0x20002,
    init(i) {
      const s = i.state,
        r = i.parameters.values;
      s.anchor = [r[0], r[1]];
      s.size = size(f(r[3] / 100));
      s.rotation = integer(r[2]) === 0 ? f(-0.5) : f(0.5);
      s.durations = durations(r, 4, 5);
      s.particles = Array.from({ length: i.count }, () => ({ tick: 0, mark: 0, mode: 0 }));
      for (const p of i.particles()) {
        centeredQuad(p, i.parameters.width, i.parameters.height);
        p.base.y = f(i.parameters.height * 0.5);
        p.pos.set([s.anchor[0], s.anchor[1], 0]);
        p.scale.set([s.size, s.size, 1]);
        p.rot.z = s.rotation;
        alpha(p, 0);
      }
    },
    exec(i) {
      const s = i.state,
        S = s.size,
        d = s.durations,
        h = i.host,
        step = delta(i),
        offset = anchorOffset(i);
      for (let n = 0; n < i.count; n++) {
        const p = i.particle(n),
          v = s.particles[n],
          elapsed = f((v.tick - v.mark) | 0);
        switch (v.mode) {
          case 0:
            p.scale.y = h.LinearInt(S, f(S * f(1.5)), 0, f(d[0]), elapsed);
            p.scale.x = h.LinearInt(S, f(S * f(0.4)), 0, f(d[0]), elapsed);
            alpha(p, h.LinearInt(0, 128, 0, f(d[0]), elapsed));
            if (elapsed > d[0]) change(v, 1);
            break;
          case 1:
            p.scale.y = h.LinearInt(f(S * f(1.5)), f(S * 0.5), 0, f(d[1]), elapsed);
            p.scale.x = h.LinearInt(f(S * 0.4), f(S * f(2.4)), 0, f(d[1]), elapsed);
            alpha(p, h.LinearInt(128, 255, 0, f(d[1]), elapsed));
            if (elapsed > d[1]) change(v, 2);
            break;
          case 2:
            p.scale.y = h.LinearInt(f(S * 0.5), S, 0, f(d[2]), elapsed);
            p.scale.x = h.LinearInt(f(S * f(2.4)), S, 0, f(d[2]), elapsed);
            if (elapsed > d[2]) change(v, 3);
            break;
          case 3:
            // The A build has no case 3; its ordinary animation remains here.
            if (wait && elapsed > d[3]) change(v, 4);
            break;
          case 4:
            p.rot.z = f(p.rot.z + f(h.cos(f(f(f(Math.PI * 2) / f(d[4])) * elapsed)) / 50));
            if (elapsed > d[4]) {
              p.rot.z = s.rotation;
              change(v, 3);
            }
            break;
        }
        p.pos.x = f(s.anchor[0] + offset[0]);
        p.pos.y = f(s.anchor[1] + offset[1]);
        v.tick = (v.tick + step) | 0;
      }
    },
  };
}
export const em_question = question(true),
  em_question_a = question(false);
export { tails, initialTails };
