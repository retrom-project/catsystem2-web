// SPDX-License-Identifier: MPL-2.0
// Plane and actor semantics adapted from CatSystemKit ScenePlayer, PlaneStage and EmoteStage (OWCramer).
export function planeNumbers(text) {
  if (/^\d+$/.test(text)) return [Number(text)];
  if (!/^\[.*\]$/.test(text || '')) return [];
  return text
    .slice(1, -1)
    .split(',')
    .flatMap((p) => {
      const m = /^(\d+)-(\d+)$/.exec(p);
      if (m) {
        if (+m[2] < +m[1] || +m[2] - +m[1] > 1024) throw new Error('Invalid plane range');
        return Array.from({ length: +m[2] - +m[1] + 1 }, (_, i) => +m[1] + i);
      }
      if (!/^\d+$/.test(p)) throw new Error('Invalid plane list');
      return [+p];
    });
}
export function curve(t, kind) {
  if (/sin_fs|sin_f$|amove1|ascale1|easeOut/.test(kind)) return Math.sin((t * Math.PI) / 2);
  if (/sin_sf|sin_s$|amove2|ascale2|easeIn$/.test(kind)) return 1 - Math.cos((t * Math.PI) / 2);
  if (/^sin$|sin_ss|amove3|ascale3|easeInOut/.test(kind)) return 0.5 - Math.cos(t * Math.PI) / 2;
  return t;
}
export function tweenValue(t, frame) {
  return (
    t.from +
    (t.to - t.from) *
      curve(t.frames ? Math.max(0, Math.min(1, (frame - t.start) / t.frames)) : 1, t.curve)
  );
}
export function current(o, key, frame) {
  return o.tweens?.[key] ? tweenValue(o.tweens[key], frame) : o[key];
}
export function animate(o, key, to, frames, frame, kind = 'linear', blocking = true, from) {
  o.tweens ||= {};
  o.tweens[key] = {
    from: from ?? current(o, key, frame) ?? 0,
    to,
    frames: Math.max(0, frames),
    start: frame,
    curve: kind,
    blocking,
  };
  o[key] = to;
}
export class Stage {
  constructor(width, height, evaluate) {
    Object.assign(this, {
      width,
      height,
      evaluate,
      frame: 0,
      planes: {},
      actors: {},
      faces: {},
      emitters: {},
      background: 0xff000000,
      unsupported: new Set(),
    });
  }
  plane(n) {
    return (this.planes[n] ||= {
      x: this.width / 2,
      y: this.height / 2,
      baseX: this.width / 2,
      baseY: this.height / 2,
      scaleX: 100,
      scaleY: 100,
      alpha: 255,
      visible: true,
      priority: 3000 + n * 100,
      pictures: [],
      tweens: {},
    });
  }
  actor(n, faces = false) {
    const cast = faces ? this.faces : this.actors;
    return (cast[n] ||= {
      x: this.width / 2,
      y: this.height / 2,
      scaleX: 100,
      scaleY: 100,
      alpha: 255,
      visible: true,
      priority: 5000 + n * 100,
      model: null,
      body: [],
      speeds: {},
      parameterScales: {},
      pausedSprings: [],
      tweens: {},
      generation: 0,
    });
  }
  number(text, old = 0, fallback = old) {
    if (text === undefined || text === '@') return old ?? fallback;
    if (text.startsWith('@'))
      return (old ?? fallback) + this.evaluate(text.slice(1).replace(/^\+/, ''));
    return this.evaluate(text.replace(/%$/, ''));
  }
  value(o, key) {
    return current(o, key, this.frame);
  }
  setMotion(o, sub, args, pictureKind) {
    const n = (i, key, fallback) => this.number(args[i], key ? this.value(o, key) : 0, fallback);
    const blocking = !sub.startsWith('m2'),
      moving = /move|scale|rot/.test(sub) && !['pos', 'scale', 'rot'].includes(sub);
    const frames = moving ? n(0) : 0,
      first = moving ? 1 : 0;
    if (sub === 'stop') {
      for (const key of Object.keys(o.tweens || {})) delete o.tweens[key];
      delete o.quake;
      delete o.arc;
      delete o.shake;
      delete o.path;
      return true;
    }
    if (sub === 'pos' || /move/.test(sub)) {
      if (!args.length && sub === 'pos') {
        o.x = this.width / 2;
        o.y = this.height / 2;
        o.tweens = {};
        return true;
      }
      for (const [i, key] of ['x', 'y'].entries()) {
        if (args[first + i] === undefined) continue;
        const raw = args[first + i],
          origin =
            pictureKind === 'eg' && !raw.startsWith('@') ? (i ? this.height : this.width) / 2 : 0;
        const to = origin + n(first + i, key, (i ? this.height : this.width) / 2);
        animate(o, key, to, frames, this.frame, sub, blocking);
      }
      return true;
    }
    if (/scale/.test(sub)) {
      const x = args[first] === undefined ? 100 : n(first, 'scaleX'),
        y = args[first + 1] === undefined ? x : n(first + 1, 'scaleY');
      animate(o, 'scaleX', x, frames, this.frame, sub, blocking);
      animate(o, 'scaleY', y, frames, this.frame, sub, blocking);
      return true;
    }
    if (sub === 'fade' || sub === 'm2fade') {
      animate(
        o,
        'alpha',
        args.length > 2 ? n(2) : 255,
        n(0),
        this.frame,
        'linear',
        blocking,
        args.length > 1 ? n(1) : 0,
      );
      return true;
    }
    if (sub === 'blend') {
      animate(o, 'alpha', args.length ? n(0) : 255, 0, this.frame);
      return true;
    }
    if (sub === 'disp') {
      o.visible = (args.length ? n(0) : 1) !== 0;
      return true;
    }
    if (sub === 'pri') {
      o.priority = n(0);
      return true;
    }
    if (sub === 'base') {
      o.baseX = n(0, 'baseX');
      o.baseY = n(1, 'baseY');
      return true;
    }
    if (sub === 'bmode') {
      o.blendMode = n(0);
      return true;
    }
    if (sub === 'rot' || sub === 'mrot') {
      animate(o, 'rotation', sub === 'mrot' ? n(3) : n(2), sub === 'mrot' ? n(0) : 0, this.frame);
      return true;
    }
    if (sub === 'arc' || sub === 'mcarc') {
      o.arc = {
        start: this.frame,
        frames: Math.max(1, n(0)),
        from: n(1),
        to: n(2),
        dx: n(3),
        dy: n(4),
        loop: sub === 'mcarc',
      };
      return true;
    }
    if (sub === 'quake' || sub === 'mcquake' || sub === 'spline') {
      o[sub === 'spline' ? 'path' : 'quake'] = {
        start: this.frame,
        steps: args.map((a) => a.split(',').map(Number)).filter((a) => a.length === 3),
      };
      return true;
    }
    if (sub === 'shake' || sub === 'mcshake') {
      o.shake = {
        start: this.frame,
        frames: Math.max(1, n(0)),
        amplitude: n(1),
        count: n(args.length - 1) || 1,
        loop: sub === 'mcshake',
      };
      return true;
    }
    return false;
  }
  place(o) {
    let x = this.value(o, 'x'),
      y = this.value(o, 'y');
    if (o.arc) {
      const a = o.arc,
        t = a.loop
          ? Math.max(0, (this.frame - a.start) / a.frames) % 1
          : Math.max(0, Math.min(1, (this.frame - a.start) / a.frames));
      const v =
        Math.sin(((a.from + (a.to - a.from) * t) * Math.PI) / 180) -
        Math.sin((a.from * Math.PI) / 180);
      x += a.dx * v;
      y += a.dy * v;
    }
    if (o.shake) {
      const a = o.shake,
        t = (this.frame - a.start) / a.frames;
      if (a.loop || t < a.count)
        y += Math.sin(t * Math.PI * 2) * a.amplitude * (a.loop ? 1 : Math.max(0, 1 - t / a.count));
    }
    for (const key of ['quake', 'path'])
      if (o[key]) {
        let t = this.frame - o[key].start,
          fromX = 0,
          fromY = 0;
        for (const [frames, toX, toY] of o[key].steps) {
          if (frames > 0 && t < frames) {
            x += fromX + ((toX - fromX) * t) / frames;
            y += fromY + ((toY - fromY) * t) / frames;
            break;
          }
          t -= frames;
          fromX = toX;
          fromY = toY;
        }
      }
    return {
      ...o,
      x,
      y,
      alpha: this.value(o, 'alpha'),
      scaleX: this.value(o, 'scaleX'),
      scaleY: this.value(o, 'scaleY'),
      rotation: this.value(o, 'rotation') || 0,
    };
  }
  busy(group = '') {
    const objects = [
      ...(!group || group === 'pl' ? Object.values(this.planes) : []),
      ...(!group || group === 'mpl' ? Object.values(this.actors) : []),
    ];
    return objects.some(
      (o) =>
        Object.values(o.tweens || {}).some((t) => t.blocking && this.frame < t.start + t.frames) ||
        (o.arc && this.frame < o.arc.start + o.arc.frames) ||
        (o.quake && this.frame < o.quake.start + o.quake.steps.reduce((s, a) => s + a[0], 0)),
    );
  }
  finish(group = '') {
    for (const o of [
      ...(!group || group === 'pl' ? Object.values(this.planes) : []),
      ...(!group || group === 'mpl' ? Object.values(this.actors) : []),
    ])
      this.setMotion(o, 'stop', []);
  }
  pictures(kind, args) {
    const slots = planeNumbers(args[0]);
    if (!args.length || (slots.length && args.length === 1)) {
      for (const p of Object.values(this.planes))
        p.pictures = p.pictures.filter(
          (p) => p.kind !== kind || (slots.length && !slots.includes(p.slot)),
        );
      return;
    }
    if (!slots.length) {
      if (['tone', 'mode', 'blur'].includes(args[0]))
        for (const plane of Object.values(this.planes))
          for (const p of plane.pictures) if (p.kind === kind) delete p[args[0]];
      return;
    }
    const verbs = new Set([
      'pos',
      'scale',
      'move',
      'amove1',
      'amove2',
      'amove3',
      'ascale1',
      'ascale2',
      'ascale3',
      'fade',
      'blend',
      'mode',
      'tone',
      'blur',
    ]);
    for (const slot of slots) {
      const old = Object.values(this.planes)
          .flatMap((p) => p.pictures)
          .find((p) => p.kind === kind && p.slot === slot),
        sub = args[1];
      if (verbs.has(sub)) {
        if (old) {
          if (['mode', 'tone', 'blur'].includes(sub)) old[sub] = args.slice(2);
          else this.setMotion(old, sub, args.slice(2), kind);
        }
        continue;
      }
      const values = args.slice(2).filter((a) => !a.startsWith('\\')),
        flags = new Set(args.slice(2).filter((a) => a.startsWith('\\')));
      const center = !sub.startsWith('$') && !['bg', 'cg'].includes(kind),
        x = center ? this.width / 2 : 0,
        y = center ? this.height / 2 : 0;
      const p = {
        kind,
        slot,
        file: sub.startsWith('$') ? null : sub,
        color: sub.startsWith('$') ? parseInt(sub.slice(1), 16) >>> 0 : null,
        x,
        y,
        scaleX: 100,
        scaleY: 100,
        alpha: 255,
        flipX: flags.has('\\lr'),
        flipY: flags.has('\\ud'),
        mask: flags.has('\\ma'),
        frameID: 0,
        tweens: {},
        mode: old?.mode,
        tone: old?.tone,
        blur: old?.blur,
      };
      p.x =
        this.number(values[0], x) +
        (kind === 'eg' && values[0] && !values[0].startsWith('@') ? this.width / 2 : 0);
      p.y =
        this.number(values[1], y) +
        (kind === 'eg' && values[1] && !values[1].startsWith('@') ? this.height / 2 : 0);
      if (values[2] && values[2] !== '@') p.frameID = this.number(values[2]);
      for (const plane of Object.values(this.planes))
        plane.pictures = plane.pictures.filter((p) => p.kind !== kind || p.slot !== slot);
      this.plane(values[3] && values[3] !== '@' ? this.number(values[3]) : slot).pictures.push(p);
    }
  }
  planeCommand(args) {
    if (!args.length) {
      for (const n of Object.keys(this.planes)) this.resetPlane(n);
      return;
    }
    const slots = planeNumbers(args[0]);
    if (!slots.length) {
      if (args[0] === 'stop') this.finish('pl');
      else if (args[0] === 'quake')
        for (const p of Object.values(this.planes)) this.setMotion(p, 'quake', args.slice(1));
      return;
    }
    for (const n of slots) {
      if (args.length === 1) {
        this.resetPlane(n);
        continue;
      }
      const exists = !!this.planes[n],
        p = this.plane(n),
        sub = args[1];
      if (sub.startsWith('$')) {
        p.color = (parseInt(sub.slice(1), 16) | 0xff000000) >>> 0;
        if (!exists) p.visible = false;
      } else if (sub === 'clone') {
        const source = this.planes[this.number(args[2])];
        if (source) this.planes[n] = structuredClone(source);
      } else if (!this.setMotion(p, sub, args.slice(2))) this.unsupported.add(`pl.${sub}`);
    }
  }
  resetPlane(n) {
    const pictures = this.planes[n]?.pictures || [];
    delete this.planes[n];
    if (pictures.length) this.plane(n).pictures = pictures;
  }
  characterCommand(args, faces = false) {
    const cast = faces ? this.faces : this.actors;
    if (!args.length) {
      if (faces) this.faces = {};
      else this.actors = {};
      return;
    }
    const slots = planeNumbers(args[0]);
    if (!slots.length) {
      if (args[0] === 'stop') for (const c of Object.values(cast)) this.setMotion(c, 'stop', []);
      return;
    }
    for (const n of slots) {
      if (args.length === 1) {
        delete cast[n];
        continue;
      }
      const sub = args[1],
        c = this.actor(n, faces);
      if (sub.includes(',') && /^[a-z]/i.test(sub)) {
        c.model = sub;
        c.generation++;
      } else if (sub === 'm2body') {
        for (const [i, d] of (args[2] || '').split(',').entries()) {
          while (c.body.length <= i) c.body.push('@');
          if (d && d !== '@') c.body[i] = d;
        }
        c.generation++;
      } else if (sub === 'm2fspeed' || sub === 'm2prmscale')
        for (const key of args.slice(3))
          c[sub === 'm2fspeed' ? 'speeds' : 'parameterScales'][key] = this.number(args[2]);
      else if (sub === 'm2iner') {
        if (args[2] === 'pause') c.pausedSprings = args.length > 3 ? args.slice(3) : ['*'];
        else c.pausedSprings = [];
      } else if (sub === 'm2enable_lip') c.lipEnabled = !!this.number(args[2]);
      else if (sub === 'm2enable_blink') c.blinkEnabled = !!this.number(args[2]);
      else if (sub === 'touch') c.touch = !!this.number(args[2]);
      else if (sub === 'mode') c.mode = args.slice(2);
      else if (sub === 'tone') c.tone = args.slice(2).map((a) => this.number(a));
      else if (!this.setMotion(c, sub, args.slice(2)))
        this.unsupported.add(`${faces ? 'fmpl' : 'mpl'}.${sub}`);
    }
  }
  snapshot() {
    return structuredClone({
      frame: this.frame,
      planes: this.planes,
      actors: this.actors,
      faces: this.faces,
      emitters: this.emitters,
    });
  }
  restore(state) {
    for (const key of ['frame', 'planes', 'actors', 'faces', 'emitters'])
      this[key] = structuredClone(state[key]);
  }
}
