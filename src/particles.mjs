// SPDX-License-Identifier: MPL-2.0
// Browser-native emotion effects adapted from CatSystemKit ParticleStage (OWCramer).
// These reproduce the effect types; they do not execute or exactly emulate Windows PPI plug-ins.
export class Particles {
  constructor(stage) {
    this.stage = stage;
    this.unsupported = new Set();
  }
  command(verb, args) {
    const emitters = this.stage.emitters,
      frame = this.stage.frame;
    if (!args.length || args[0] === 'stop') {
      for (const key of Object.keys(emitters)) if (key.startsWith(`${verb}:`)) delete emitters[key];
      return;
    }
    const key = `${verb}:${args[0]}`,
      sub = args[1];
    if (args.length < 2 || sub === 'stop' || sub === 'end') {
      delete emitters[key];
      return;
    }
    if (sub === 'fade') {
      if (emitters[key])
        emitters[key].fade = {
          start: frame,
          frames: Math.max(1, +args[2] || 1),
          from: (+args[3] || 0) / 255,
          to: (+args[4] || 0) / 255,
        };
      return;
    }
    if (!['em_note', 'em_question', 'em_double', 'em_sweat', 'em_angry'].includes(sub)) {
      this.unsupported.add(sub);
      return;
    }
    const n = args.slice(3).map(Number),
      bank = n[2],
      actor = this.stage.actors[bank];
    let i = sub === 'em_note' ? 4 : 3;
    const x = n[i++],
      y = n[i++],
      side = ['em_sweat', 'em_angry'].includes(sub) ? 1 : n[i++] === 0 ? -1 : 1,
      size = Math.max(0.1, (n[i] || 100) / 100);
    emitters[key] = {
      kind: sub,
      texture: args[2],
      count: Math.max(1, n[0] || 1),
      bank,
      x,
      y,
      side,
      size,
      start: frame,
      anchor: actor ? { x: this.stage.place(actor).x, y: this.stage.place(actor).y } : null,
    };
  }
  sprites() {
    const out = [],
      frame = this.stage.frame;
    const pop = (t, frames) => {
      const u = Math.min(1, t / frames);
      return u < 0.7 ? 1.15 * Math.sin(((u / 0.7) * Math.PI) / 2) : 1.15 - (0.15 * (u - 0.7)) / 0.3;
    };
    for (const [key, e] of Object.entries(this.stage.emitters)) {
      const t = frame - e.start,
        s = e.size;
      let alpha = 1;
      if (e.fade) {
        const f = e.fade,
          u = Math.max(0, Math.min(1, (frame - f.start) / f.frames));
        alpha = f.from + (f.to - f.from) * u;
        if (u === 1 && alpha <= 0) {
          delete this.stage.emitters[key];
          continue;
        }
      }
      const a = this.stage.actors[e.bank],
        p = a ? this.stage.place(a) : null,
        dx = p && e.anchor ? p.x - e.anchor.x : 0,
        dy = p && e.anchor ? p.y - e.anchor.y : 0;
      const add = (x, y, scale, opacity) =>
        out.push({ texture: e.texture, x: x + dx, y: y + dy, scale, alpha: alpha * opacity });
      if (e.kind === 'em_note') {
        const spawned = Math.floor(t / 18) + 1;
        for (let k = Math.max(0, spawned - 5); k < spawned; k++) {
          const age = t - k * 18,
            u = age / 60,
            lane = (k % e.count) - (e.count - 1) / 2;
          if (age < 0 || age >= 60) continue;
          add(
            e.x + e.side * (u * 40 + lane * 22) * s + Math.sin(age / 9) * 8 * s,
            e.y - u * 90 * s + lane * 6 * s,
            s * (0.55 + 0.2 * Math.min(1, age / 10)),
            Math.min(1, age / 8) * (u > 0.65 ? (1 - u) / 0.35 : 1),
          );
        }
      } else if (e.kind === 'em_question')
        add(
          e.x + Math.sin(t / 14) * 4 * s,
          e.y - Math.min(1, t / 10) * 12 * s,
          s * pop(t, 10) * 0.6,
          Math.min(1, t / 4),
        );
      else if (e.kind === 'em_double')
        add(
          e.x + (t < 14 ? Math.sin(t * 1.4) * (1 - t / 14) * 6 * s : 0),
          e.y - Math.min(1, t / 7) * 10 * s,
          s * pop(t, 7) * 0.6,
          Math.min(1, t / 3),
        );
      else if (e.kind === 'em_sweat') {
        const u = (t % 50) / 50;
        add(e.x, e.y + u * 24 * s, s * 0.55, Math.min(1, u / 0.15) * (u > 0.7 ? (1 - u) / 0.3 : 1));
      } else
        add(
          e.x,
          e.y,
          s * 0.55 * (1 + 0.12 * Math.max(0, Math.sin(((t / 6) * Math.PI) / 2))) * pop(t, 8),
          Math.min(1, t / 4),
        );
    }
    return out;
  }
  async render(renderer) {
    for (const s of this.sprites()) {
      if (s.alpha <= 0.004) continue;
      const f = await renderer.images.frame(s.texture);
      await renderer.image(
        s.texture,
        f.id,
        s.x - (f.width * s.scale) / 2,
        s.y - (f.height * s.scale) / 2,
        s.alpha,
        { width: f.width * s.scale, height: f.height * s.scale },
      );
    }
  }
}
