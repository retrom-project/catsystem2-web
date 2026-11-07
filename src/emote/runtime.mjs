// SPDX-License-Identifier: MPL-2.0
// Adapted from CatSystemKit EmoteCast / EmoteStage (OWCramer).
import { readPSB } from '../formats/psb.mjs';
import { EmoteModel } from './model.mjs';
import { drawList, pointToRoot } from './draw-list.mjs';
import { tweenValue } from '../stage.mjs';

export class EmoteRuntime {
  constructor(game, profiles, gpu) {
    this.game = game;
    this.profiles = profiles;
    this.gpu = gpu;
    this.models = new Map();
    this.pending = new Map();
    this.states = {};
    this.poseCache = new Map();
    this.levelsCache = new Map();
    this.randomState = 0x12345678;
    this.physics = true;
  }
  random() {
    let s = this.randomState;
    s ^= s << 13;
    s ^= s >>> 17;
    s ^= s << 5;
    this.randomState = s >>> 0;
    return this.randomState / 4294967296;
  }
  async model(name) {
    if (this.models.has(name)) {
      const model = this.models.get(name);
      this.models.delete(name);
      this.models.set(name, model);
      return model;
    }
    if (!this.pending.has(name))
      this.pending.set(
        name,
        (async () => {
          const psb = await readPSB(
            await this.game.require(this.game.resolve(name, ['psz', 'psb']) || name),
          );
          const model = new EmoteModel(psb);
          this.models.set(name, model);
          return model;
        })().finally(() => this.pending.delete(name)),
      );
    return this.pending.get(name);
  }
  pose(c) {
    const key = `${c.model}|${c.body.join(',')}`;
    if (!this.poseCache.has(key)) {
      if (this.poseCache.size > 256) this.poseCache.clear();
      this.poseCache.set(key, this.profiles.pose(c.model, c.body));
    }
    return this.poseCache.get(key);
  }
  async prepare(stage) {
    const active = new Set();
    for (const [prefix, cast] of [
      ['', stage.actors],
      ['face:', stage.faces],
    ])
      for (const [bank, c] of Object.entries(cast)) {
        if (!c.model) continue;
        const key = prefix + bank,
          pose = this.pose(c),
          frame = stage.frame;
        await this.model(pose.model);
        active.add(pose.model);
        const signature = `${c.model}|${c.body.join(',')}|${JSON.stringify(c.parameterScales)}`;
        let s = this.states[key];
        if (s?.signature === signature) continue;
        const same = s?.modelName === pose.model,
          oldPose = s ? this.profiles.pose(s.spec, s.body) : null;
        if (!same)
          s = this.states[key] = {
            modelName: pose.model,
            variables: {},
            idleStart: frame - this.random() * 90,
            nextBlink: frame + 30 + this.random() * 90,
            blinkStart: null,
            springs: {},
            lastSources: {},
            lastFrame: frame,
            flow: null,
          };
        const rules = {};
        if (same && oldPose)
          for (const [profile, oldCodes, codes] of [
            [pose.face, oldPose.codes, pose.codes],
            [pose.body, oldPose.bodyCodes, pose.bodyCodes],
          ]) {
            for (const [digit, code] of Object.entries(codes))
              if (oldCodes[digit] !== code) {
                const chain = profile.chains[digit] || { curve: 'fix', frames: 1, pairs: {} },
                  rule = chain.pairs[`${oldCodes[digit]}>${code}`] || chain;
                const names = new Set([
                  ...Object.keys(profile.patterns[digit]?.[code]?.assignments || {}),
                  ...Object.keys(profile.patterns[digit]?.[oldCodes[digit]]?.assignments || {}),
                ]);
                for (const name of names) rules[name] = rule;
              }
          }
        for (const [name, value] of Object.entries(pose.variables)) {
          const target = (value * (c.parameterScales[name] ?? 100)) / 100,
            old = s.variables[name],
            rule = rules[name] || { curve: 'fix', frames: 1 };
          if (old?.to === target) continue;
          const frames =
            same && old && rule.curve !== 'fix'
              ? (rule.frames * 100) / Math.max(1, c.speeds[name] ?? 100)
              : 0;
          s.variables[name] = {
            from: old ? tweenValue(old, frame) : target,
            to: target,
            start: frame,
            frames,
            curve: rule.curve,
          };
        }
        if (!stage.busy('mpl')) c.pausedSprings = [];
        Object.assign(s, {
          signature,
          spec: c.model,
          body: [...c.body],
          poseGeneration: c.generation,
        });
      }
    for (const key of Object.keys(this.states))
      if (!(key.startsWith('face:') ? stage.faces[key.slice(5)] : stage.actors[key]))
        delete this.states[key];
    while (this.models.size > Math.max(5, active.size)) {
      const key = [...this.models.keys()].find((n) => !active.has(n));
      if (!key) break;
      this.gpu?.release(this.models.get(key));
      this.models.delete(key);
    }
  }
  async levels(name) {
    if (!name) return [];
    name = name.toLowerCase();
    if (!this.levelsCache.has(name)) {
      const bytes = await this.game.read(`${name}.lv`),
        values = [];
      if (bytes) {
        const b = new DataView(bytes.buffer, bytes.byteOffset, bytes.length);
        for (let i = 0; i + 4 <= bytes.length; i += 4) values.push(b.getFloat32(i, true));
      }
      if (this.levelsCache.size > 20) this.levelsCache.clear();
      this.levelsCache.set(name, values);
    }
    return this.levelsCache.get(name);
  }
  busy(frame) {
    return Object.values(this.states).some((s) =>
      Object.values(s.variables).some((t) => frame < t.start + t.frames),
    );
  }
  finish(frame) {
    for (const s of Object.values(this.states))
      for (const t of Object.values(s.variables)) {
        t.from = t.to;
        t.start = frame;
        t.frames = 0;
      }
  }
  inertia(s, pose, variables, c, frame, bustScale = 1) {
    const p = pose.face,
      frames = Math.min(4, Math.max(0, frame - s.lastFrame));
    s.lastFrame = frame;
    const sources = { '@x': c.x, '@y': c.y };
    for (const r of p.inertiaFromChange) sources[r.source] = variables[r.source] || 0;
    const kicks = {};
    if (Object.keys(s.lastSources).length) {
      const dx = c.x - s.lastSources['@x'],
        dy = c.y - s.lastSources['@y'];
      for (const name of p.inertiaLR)
        kicks[name] = (kicks[name] || 0) - dx / (p.materials[name]?.scale || 30);
      for (const name of p.inertiaUD)
        kicks[name] = (kicks[name] || 0) - dy / (p.materials[name]?.scale || 30);
      for (const r of p.inertiaFromChange)
        kicks[r.target] =
          (kicks[r.target] || 0) - (sources[r.source] - (s.lastSources[r.source] || 0)) * r.power;
    }
    s.lastSources = sources;
    for (const [name, m] of Object.entries(p.materials)) {
      const spring = (s.springs[name] ||= { x: 0, v: 0 }),
        held = c.pausedSprings.includes('*') || c.pausedSprings.includes(name);
      if (!held)
        spring.x +=
          (kicks[name] || 0) * (m.inverted ? -1 : 1) * (/bust/i.test(name) ? bustScale : 1);
      const steps = Math.max(1, Math.ceil(frames * 4)),
        h = (frames * m.step) / steps;
      for (let i = 0; i < steps; i++) {
        spring.v += ((-m.spring * spring.x - m.resistance * spring.v) / m.mass) * h;
        spring.x += spring.v * h;
      }
      spring.x = Math.max(-m.limit, Math.min(m.limit, spring.x));
      const limit = Math.max(
        30,
        ...p.inertiaFromChange.filter((r) => r.target === name).map((r) => r.limit),
      );
      variables[name] = (variables[name] || 0) + Math.max(-limit, Math.min(limit, spring.x));
    }
  }
  drawing(stage, bank, voice = {}, faces = false) {
    const actor = (faces ? stage.faces : stage.actors)[bank],
      key = `${faces ? 'face:' : ''}${bank}`,
      s = this.states[key];
    if (!actor?.model || !actor.visible || !s) return null;
    const c = stage.place(actor),
      pose = this.pose(actor),
      model = this.models.get(pose.model),
      frame = stage.frame;
    if (!model || c.alpha < 0.5) return null;
    const v = model.resting();
    for (const [name, tween] of Object.entries(s.variables)) v[name] = tweenValue(tween, frame);
    if (pose.idle)
      for (const [name, value] of Object.entries(model.timeline(pose.idle, frame - s.idleStart)))
        v[name] = model.timelines[pose.idle]?.diff ? (v[name] || 0) + value : value;
    const blink = pose.face.blinks.find((b) => pose.codes[b.digit] === b.code);
    if (blink && actor.blinkEnabled !== false) {
      if (s.blinkStart === null && frame >= s.nextBlink) s.blinkStart = frame;
      if (s.blinkStart !== null) {
        const t = (frame - s.blinkStart) / Math.max(1, blink.frames);
        if (t >= 1) {
          s.blinkStart = null;
          s.nextBlink =
            frame + blink.minWait + this.random() * Math.max(0, blink.maxWait - blink.minWait);
        } else
          v.face_eye_open =
            t < 0.5
              ? blink.from + (blink.to - blink.from) * t * 2
              : blink.to + ((v.face_eye_open ?? blink.from) - blink.to) * (t - 0.5) * 2;
      }
    } else s.blinkStart = null;
    const lip = pose.face.lips.find((l) => pose.codes[l.digit] === l.code),
      speaker = voice.file?.[0]?.toLowerCase();
    if (
      lip &&
      actor.lipEnabled !== false &&
      voice.playing &&
      pose.model.toLowerCase().startsWith(`c${speaker}`)
    ) {
      const levels = this.levelsCache.get(voice.file.toLowerCase()) || [],
        voiceFrame = Math.floor(voice.time * 60);
      if (voiceFrame >= 0 && voiceFrame < levels.length) {
        const values = lip.levels.length > 1 ? lip.levels.slice(1) : lip.levels,
          level = levels[voiceFrame] * 100;
        const pos =
            Math.max(0, Math.min(1, (level - lip.low) / Math.max(1, lip.high - lip.low))) *
            (values.length - 1),
          i = Math.floor(pos);
        v[lip.variable] = values[i] + ((values[i + 1] ?? values[i]) - values[i]) * (pos - i);
      } else if (lip.flow.length) {
        const sounding = (voice.envelope?.[voiceFrame] ?? 1) >= 0.02;
        if (!s.flow && sounding) s.flow = { step: 0, start: frame };
        if (s.flow) {
          let budget = 64;
          while (budget-- > 0 && frame >= s.flow.start + lip.flow[s.flow.step].frames) {
            if (lip.flow[s.flow.step].mayStop && !sounding) {
              s.flow = null;
              break;
            }
            s.flow.start += lip.flow[s.flow.step].frames;
            s.flow.step = (s.flow.step + 1) % lip.flow.length;
          }
          if (s.flow) v[lip.variable] = lip.flow[s.flow.step].value;
        }
      }
    } else s.flow = null;
    if (this.physics) this.inertia(s, pose, v, c, frame, this.bustScale ?? 1);
    if (s.action) {
      const steps = this.profiles.actions[s.action.name] || [];
      let elapsed = frame - s.action.start,
        values = { ...s.action.base };
      for (const step of steps) {
        const target = step.restore ? s.action.base : { ...values, ...step.variables };
        if (elapsed < step.frames) {
          const weight =
              step.easing > 0 ? step.easing + 1 : step.easing < 0 ? 1 / (1 - step.easing) : 1,
            t = Math.max(0, Math.min(1, elapsed / Math.max(1, step.frames))) ** weight;
          for (const name of Object.keys(target))
            values[name] = (values[name] || 0) + (target[name] - (values[name] || 0)) * t;
          Object.assign(v, values);
          break;
        }
        values = { ...target };
        elapsed -= step.frames;
      }
      if (elapsed >= 0 && frame >= s.action.start + steps.reduce((n, step) => n + step.frames, 0))
        delete s.action;
    }
    model.selectorsFor(v);
    const sx = (pose.scaleX * c.scaleX) / 100,
      sy = (pose.scaleY * c.scaleY) / 100,
      angle = ((c.rotation || 0) * Math.PI) / 180,
      cs = Math.cos(angle),
      sn = Math.sin(angle);
    const transform = [
      cs * sx,
      sn * sx,
      -sn * sy,
      cs * sy,
      c.x + pose.positionX + stage.width / 2 + pose.scaleOffsetX * (1 - c.scaleX / 100),
      c.y + pose.positionY + stage.height / 2 + pose.scaleOffsetY * (1 - c.scaleY / 100),
    ];
    // Character poses advance through metadata timelines; their parameterized root stays at frame zero.
    return {
      model,
      variables: v,
      list: drawList(model, v, 0, transform),
      alpha: c.alpha / 255,
      pose,
    };
  }
  async attribute(stage, bank, number) {
    await this.prepare(stage);
    const drawing = this.drawing(stage, bank);
    if (!drawing) return null;
    const { list, pose } = drawing,
      item = list.items.find((i) => i.label.includes('輪郭'));
    const offset = pose.face.attributes[number] || { x: 0, y: -50, extra: 3 };
    const point = item
      ? pointToRoot(list.nodes, item.node, offset.x, offset.y)
      : pointToRoot(list.nodes, 0, offset.x, -445 + offset.y);
    return { x: point[0], y: point[1], extra: offset.extra };
  }
  hit(stage, x, y) {
    if (!this.gpu || x < 0 || y < 0 || x >= stage.width || y >= stage.height) return null;
    for (const [bank, actor] of Object.entries(stage.actors).sort(
      ([, a], [, b]) => b.priority - a.priority,
    )) {
      if (!actor.touch) continue;
      const d = this.drawing(stage, bank);
      if (!d || !d.pose.face.hitVariables.length) continue;
      const variables = { ...d.variables };
      for (const name of d.pose.face.hitVariables) variables[name] = 0;
      const list = drawList(d.model, variables, 0, d.list.nodes[0].transform);
      this.gpu.render(d.model, list, 1);
      const gl = this.gpu.gl,
        pixel = new Uint8Array(4);
      gl.readPixels(
        Math.floor(x),
        stage.height - 1 - Math.floor(y),
        1,
        1,
        gl.RGBA,
        gl.UNSIGNED_BYTE,
        pixel,
      );
      const color = ((pixel[3] << 24) | (pixel[0] << 16) | (pixel[1] << 8) | pixel[2]) >>> 0;
      const tables = d.pose.face.touchMappings[color];
      if (tables) return { bank, color, choices: d.pose.face.touchTables[tables[0]] || [] };
    }
    return null;
  }
  touch(stage, x, y) {
    const hit = this.hit(stage, x, y);
    if (!hit || !hit.choices.length) return null;
    const selected = hit.choices[Math.floor(this.random() * hit.choices.length)],
      state = this.states[hit.bank],
      drawing = this.drawing(stage, hit.bank);
    state.action = { name: selected.action, start: stage.frame, base: { ...drawing.variables } };
    return selected;
  }
  snapshot() {
    return structuredClone({ states: this.states, randomState: this.randomState });
  }
  restore(state) {
    this.states = structuredClone(state.states);
    this.randomState = state.randomState;
  }
  dispose() {
    this.gpu?.dispose();
    this.models.clear();
    this.states = {};
  }
}
