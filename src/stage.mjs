// SPDX-License-Identifier: MPL-2.0
// Plane and actor semantics adapted from CatSystemKit ScenePlayer, PlaneStage and EmoteStage (OWCramer).
import { MotionTarget, objectMotionState, applyObjectMotionState } from './motion/target.mjs';
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
export const IMAGE_COMMANDS = new Set(
  (
    'init base pos scale blend disp delay get clone shift load def blur mode tone stop rot color ' +
    'move amove1 amove2 amove3 ascale1 ascale2 ascale3 fade fade2 cfade mcdisp mcmove mcfade mcarc ' +
    'arc quake mcquake shake mcshake spline mcSpline spline_s spline_r mscale mcscalecos mcscalesin ' +
    'mrot mcrot pend mcpend vram pri bmode after video vcom clip coordmode'
  ).split(' '),
);
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
      planeDefaults: {},
      imageDefaults: {},
      imageSettings: {},
      configuredVRAM: false,
      toneTables: {},
      motionPending: new Set(),
    });
  }
  configureVRAM(xml) {
    if (Object.values(this.planes).some((p) => p.pictures.length))
      throw new Error('VRAM defaults must be configured before scene image commands');
    const value = (node, fallback, ...field) => {
      const text = node.value(...field);
      if (!text) return fallback;
      const result = Number(text);
      if (!Number.isFinite(result)) throw new Error(`Invalid VRAM field ${field.join('.')}`);
      return result;
    };
    this.planeDefaults = {};
    this.imageDefaults = {};
    for (const node of xml.node('plane')?.children || []) {
      const match = /^pl(\d+)$/i.exec(node.name);
      if (!match) continue;
      const n = Number(match[1]);
      const width = value(node, this.width, 'width'),
        height = value(node, this.height, 'height');
      this.planeDefaults[n] = {
        vramX: value(node, 0, 'x'),
        vramY: value(node, 0, 'y'),
        width,
        height,
        visible: value(node, 1, 'disp') !== 0,
        shiftX: value(node, 0, 'shift_x'),
        shiftY: value(node, 0, 'shift_y'),
        baseX: value(node, width / 2, 'base', 'x'),
        baseY: value(node, height / 2, 'base', 'y'),
        baseZ: value(node, 0, 'base', 'z'),
        x: value(node, this.width / 2, 'pos', 'x'),
        y: value(node, this.height / 2, 'pos', 'y'),
        z: value(node, 0, 'pos', 'z'),
      };
    }
    for (const node of xml.node('image')?.children || []) {
      const match = /^(bg|cg|eg|fg|fw)(\d+)$/i.exec(node.name);
      if (!match) continue;
      const kind = match[1].toLowerCase(),
        slot = Number(match[2]);
      this.imageDefaults[kind] ||= {};
      this.imageDefaults[kind][slot] = {
        plane: value(node, 0, 'pl'),
        shiftX: value(node, 0, 'shift_x'),
        shiftY: value(node, 0, 'shift_y'),
        baseX: value(node, 0, 'base', 'x'),
        baseY: value(node, 0, 'base', 'y'),
        baseZ: value(node, 0, 'base', 'z'),
        x: value(node, 0, 'pos', 'x'),
        y: value(node, 0, 'pos', 'y'),
        z: value(node, 0, 'pos', 'z'),
      };
    }
    this.vramRegions = Object.fromEntries(
      (xml.node('vram')?.children || []).map((node) => [
        node.name,
        Object.fromEntries(
          ['x', 'y', 'width', 'height'].map((field) => [field, value(node, 0, field)]),
        ),
      ]),
    );
    this.configuredVRAM = true;
    this.planes = {};
    for (const n of Object.keys(this.planeDefaults)) this.plane(Number(n));
  }
  plane(n) {
    return (this.planes[n] ||= {
      x: this.width / 2,
      y: this.height / 2,
      z: 0,
      baseX: this.width / 2,
      baseY: this.height / 2,
      baseZ: 0,
      scaleX: 100,
      scaleY: 100,
      scaleZ: 100,
      width: this.width,
      height: this.height,
      vramX: 0,
      vramY: 0,
      shiftX: 0,
      shiftY: 0,
      alpha: 255,
      visible: true,
      priority: 3000 + n * 100,
      pictures: [],
      tweens: {},
      ...structuredClone(this.planeDefaults[n] || {}),
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
  diagnostic(command) {
    this.unsupported.add(command);
  }
  motionTarget(object) {
    if (!this.motionLibrary) throw new Error('Stage motion requires its MOT library');
    if (!object.motionTarget)
      Object.defineProperty(object, 'motionTarget', {
        configurable: true,
        value: new MotionTarget(this.motionLibrary, {
          readState: () => objectMotionState(object, { scaleUnit: 100, visible: 'visible' }),
          writeState: (bytes) =>
            applyObjectMotionState(object, bytes, { scaleUnit: 100, visible: 'visible' }),
        }),
      });
    return object.motionTarget;
  }
  motionObjects() {
    return [
      ...Object.values(this.planes),
      ...Object.values(this.actors),
      ...Object.values(this.faces),
      ...Object.values(this.planes).flatMap((plane) => plane.pictures),
    ];
  }
  async updateMotions() {
    while (this.motionPending.size) await Promise.all([...this.motionPending]);
    for (const object of this.motionObjects()) object.motionTarget?.update(this.frame);
  }
  imageDefault(kind, slot) {
    const settings = this.imageSettings[kind] || {};
    return {
      ...(this.imageDefaults[kind]?.[slot] || {}),
      ...(settings.all || {}),
      ...(settings.slots?.[slot] || {}),
    };
  }
  image(kind, slot, create = false) {
    const found = Object.values(this.planes)
      .flatMap((p) => p.pictures)
      .find((p) => p.kind === kind && p.slot === slot);
    if (found || !create) return found;
    const defaults = this.imageDefault(kind, slot);
    const centered = !this.configuredVRAM && !['bg', 'cg'].includes(kind);
    const picture = {
      kind,
      slot,
      file: null,
      color: null,
      x: centered ? this.width / 2 : 0,
      y: centered ? this.height / 2 : 0,
      baseX: 0,
      baseY: 0,
      baseZ: 0,
      z: 0,
      shiftX: 0,
      shiftY: 0,
      scaleX: 100,
      scaleY: 100,
      scaleZ: 100,
      rotation: 0,
      alpha: 255,
      visible: true,
      width: 0,
      height: 0,
      frameID: 0,
      tweens: {},
      ...structuredClone(defaults),
    };
    picture.plane = defaults.plane ?? (this.configuredVRAM ? 0 : slot);
    this.plane(picture.plane).pictures.push(picture);
    return picture;
  }
  moveImagePlane(picture, destination) {
    if (!Number.isInteger(destination) || destination < 0)
      throw new Error(`Invalid image plane ${destination}`);
    for (const plane of Object.values(this.planes))
      plane.pictures = plane.pictures.filter((p) => p !== picture);
    picture.plane = destination;
    this.plane(destination).pictures.push(picture);
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
    let slots = planeNumbers(args[0]);
    const specified = slots.length > 0;
    if (!args.length || (specified && args.length === 1)) {
      for (const plane of Object.values(this.planes))
        plane.pictures = plane.pictures.filter(
          (p) => p.kind !== kind || (specified && !slots.includes(p.slot)),
        );
      if (!specified) delete this.imageSettings[kind];
      else
        for (const slot of slots)
          if (this.imageSettings[kind]?.slots) delete this.imageSettings[kind].slots[slot];
      return;
    }
    const sub = args[specified ? 1 : 0],
      parameters = args.slice(specified ? 2 : 1);
    if (!specified && !IMAGE_COMMANDS.has(sub)) {
      this.diagnostic(`${kind}: image loading requires an explicit bank (${sub})`);
      return;
    }
    this.imageSettings[kind] ||= { all: {}, slots: {} };
    const settings = this.imageSettings[kind];
    if (!specified)
      slots = [
        ...new Set(
          Object.values(this.planes)
            .flatMap((p) => p.pictures)
            .filter((p) => p.kind === kind)
            .map((p) => p.slot),
        ),
      ];
    const remember = (values) => {
      if (!specified) Object.assign(settings.all, structuredClone(values));
      for (const slot of slots)
        Object.assign((settings.slots[slot] ||= {}), structuredClone(values));
    };
    if (['mode', 'tone', 'blur', 'def', 'shift'].includes(sub)) {
      let properties;
      if (sub === 'def')
        properties = {
          plane: parameters.length
            ? this.number(parameters[0])
            : (this.imageDefaults[kind]?.[slots[0]]?.plane ?? 0),
        };
      else if (sub === 'shift')
        properties = {
          shiftX: this.number(parameters[0], 0),
          shiftY: this.number(parameters[1], 0),
        };
      else if (sub === 'mode') {
        if (parameters.length && !['mono', 'sepia', 'np'].includes(parameters[0])) {
          this.diagnostic(`${kind}.mode ${parameters[0]}`);
          return;
        }
        properties = { mode: parameters.length ? [parameters[0]] : [] };
      } else if (sub === 'tone') {
        properties = {
          tone:
            parameters.length === 1 && !/^[-+\d#@$(]/.test(parameters[0])
              ? parameters
              : [0, 1, 2].map((i) => this.number(parameters[i], 100)),
        };
      } else properties = { blur: [this.number(parameters[0], 0), this.number(parameters[1], 0)] };
      remember(properties);
      for (const slot of slots) {
        const picture = this.image(kind, slot, true);
        if (sub === 'def') continue; // Only subsequent loads use a changed default plane.
        if (sub === 'tone' && picture.file && picture.loadFrame !== this.frame) continue;
        Object.assign(picture, structuredClone(properties));
      }
      return;
    }
    for (const slot of slots) {
      const old = this.image(kind, slot, true);
      if (IMAGE_COMMANDS.has(sub)) {
        if (sub === 'clone') {
          const source = this.image(parameters[0], this.number(parameters[1]));
          if (!source) {
            this.diagnostic(`${kind}.${slot}.clone missing source ${parameters.join(' ')}`);
            continue;
          }
          const destination = old.plane;
          Object.assign(old, structuredClone(source), { kind, slot, plane: destination });
          this.moveImagePlane(old, destination);
        } else if (sub === 'init') {
          for (const plane of Object.values(this.planes))
            plane.pictures = plane.pictures.filter((p) => p !== old);
          delete settings.slots[slot];
        } else if (sub === 'scale' && old.file && old.loadFrame !== this.frame) {
          // Documented original behavior: static image scale is a load-time setting.
          continue;
        } else if (!this.setMotion(old, sub, parameters, kind))
          this.diagnostic(`${kind}.${slot}.${sub}`);
        continue;
      }
      const values = parameters.filter((p) => !p.startsWith('\\')),
        flags = new Set(parameters.filter((p) => p.startsWith('\\')).map((p) => p.toLowerCase())),
        color = sub.startsWith('$') || /^0x[\da-f]+$/i.test(sub),
        defaults = this.imageDefault(kind, slot);
      const picture = {
        ...old,
        ...structuredClone(defaults),
        file: color ? null : sub,
        color: color
          ? sub.startsWith('$')
            ? parseInt(sub.slice(1), 16) >>> 0
            : this.number(sub) >>> 0
          : null,
        flipX: flags.has('\\lr'),
        flipY: flags.has('\\ud'),
        loadRotation: flags.has('\\r90')
          ? 90
          : flags.has('\\r180')
            ? 180
            : flags.has('\\r270')
              ? 270
              : 0,
        mask: ['r', 'g', 'b', 'a'].find((c) => flags.has(`\\m${c}`)) || null,
        frameID: 0,
        tweens: {},
        visible: true,
        loadFrame: this.frame,
      };
      if (color) {
        picture.x = defaults.x ?? 0;
        picture.y = defaults.y ?? 0;
        picture.width = this.number(values[0], 1024);
        picture.height = this.number(values[1], 1024);
        const planeIndex = values.length === 3 ? 2 : 3;
        if (values[planeIndex] !== undefined && values[planeIndex] !== '@')
          picture.plane = this.number(values[planeIndex]);
      } else {
        const centered = !this.configuredVRAM && !['bg', 'cg'].includes(kind);
        picture.x =
          this.number(values[0], defaults.x ?? old.x) +
          (centered && values[0] && !values[0].startsWith('@') ? this.width / 2 : 0);
        picture.y =
          this.number(values[1], defaults.y ?? old.y) +
          (centered && values[1] && !values[1].startsWith('@') ? this.height / 2 : 0);
        picture.z = this.number(values[2], 0);
        if (values[3] !== undefined && values[3] !== '@') picture.plane = this.number(values[3]);
        const frame = /^(.*):(-?\d+)$/.exec(picture.file);
        if (frame) {
          picture.file = frame[1];
          picture.frameID = Number(frame[2]);
        }
      }
      Object.assign(old, picture);
      this.moveImagePlane(old, picture.plane);
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
      planeDefaults: this.planeDefaults,
      imageDefaults: this.imageDefaults,
      imageSettings: this.imageSettings,
      configuredVRAM: this.configuredVRAM,
      vramRegions: this.vramRegions,
      toneTables: this.toneTables,
    });
  }
  restore(state) {
    for (const key of [
      'frame',
      'planes',
      'actors',
      'faces',
      'emitters',
      'planeDefaults',
      'imageDefaults',
      'imageSettings',
      'configuredVRAM',
      'vramRegions',
      'toneTables',
    ])
      this[key] = structuredClone(state[key]);
  }
}
