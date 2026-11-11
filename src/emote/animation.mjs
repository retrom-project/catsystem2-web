// SPDX-License-Identifier: BSD-3-Clause
// JS controller host, based on motionplayer's EmoteEngine controller ordering.
// Source and original notices: NOTICE.md, licenses/motionplayer.txt.
import {
  ValueController,
  AngleController,
  MouthController,
  SelectorController,
  LoopController,
  emoteTransitionPower,
} from './controllers.mjs';
import { GraphController } from './controller-graph.mjs';
import { EmoteTimelines } from './timelines.mjs';
import { EmoteRandom } from './random.mjs';
import { EmoteSpring, EmoteChainSpring } from './springs.mjs';
import { EmoteWind } from './wind.mjs';
const f = Math.fround;
const enabled = (rows) => (rows ?? []).filter((row) => row.enabled);

function saveController(controller) {
  return Object.fromEntries(
    Object.entries(controller)
      .filter(
        ([key, value]) =>
          !['options', 'edges', 'nodes', 'keys'].includes(key) && typeof value !== 'function',
      )
      .map(([key, value]) => [key, structuredClone(value)]),
  );
}
function restoreController(controller, state) {
  for (const [key, value] of Object.entries(state)) {
    if (ArrayBuffer.isView(controller[key])) controller[key].set(value);
    else controller[key] = structuredClone(value);
  }
}

export class EmoteAnimation {
  constructor(
    document,
    { seed = 0, random = new EmoteRandom(seed), resolveAnchor = () => null } = {},
  ) {
    this.document = document;
    this.resolveAnchor = resolveAnchor;
    this.random = random;
    const metadata = document.metadata;
    this.values = new Map([...document.variables.keys()].map((name) => [name, 0]));
    this.bound = new Map(this.values);
    this.references = new Map();
    this.queuing = false;
    this.dirty = true;
    this.directEdit = false;
    this.mirror = Boolean(metadata.mirror);
    this.mirrorChanged = false;
    this.root = {
      position: new ValueController(2),
      color: new ValueController(4),
      scale: new ValueController(),
      angle: new AngleController(),
      bustForce: new ValueController(2),
      hairForce: new ValueController(2),
      partsForce: new ValueController(2),
    };
    this.root.scale.set([1]);
    this.root.color.set([128, 128, 128, 255]);
    this.controls = { eye: [], eyebrow: [], mouth: [], selector: [], transition: [], loop: [] };
    const add = (category, row, controller, label = row.label, direct = true) => {
      const entry = { data: row, label, controller, direct };
      this.controls[category].push(entry);
      this.references.set(label, entry);
      return entry;
    };
    for (const row of enabled(metadata.eyeControl))
      add('eye', row, new GraphController(row, { blink: true, random: () => this.random.next() }));
    for (const row of enabled(metadata.eyebrowControl))
      add('eyebrow', row, new GraphController(row));
    for (const row of enabled(metadata.mouthControl)) {
      const entry = add('mouth', row, new MouthController(row));
      this.references.set(row.talkLabel, entry);
    }
    for (const row of enabled(metadata.transitionControl))
      add('transition', row, new ValueController());
    for (const row of enabled(metadata.selectorControl)) {
      const options = (row.optionList ?? []).map((option) => {
        let entry = this.controls.transition.find((entry) => entry.label === option.label);
        if (!entry)
          entry = add(
            'transition',
            { label: option.label },
            new ValueController(),
            option.label,
            false,
          );
        entry.direct = false;
        return {
          controller: entry.controller,
          onValue: f(option.onValue ?? 0),
          offValue: f(option.offValue ?? 0),
        };
      });
      add('selector', row, new SelectorController(options));
    }
    for (const row of enabled(metadata.loopControl))
      add('loop', row, new LoopController(row), row.var_loop);
    this.physics = [];
    for (const category of ['bust', 'hair', 'parts'])
      for (const row of enabled(metadata[`${category}Control`])) {
        const entry = {
          category,
          data: row,
          spring: category === 'bust' ? new EmoteSpring(row) : new EmoteChainSpring(row),
          anchor: new Float32Array(2),
          first: true,
        };
        this.physics.push(entry);
        for (const label of [row.var_lr, row.var_lrm, row.var_ud])
          if (label) this.references.set(label, { physics: true });
      }
    this.timelines = new EmoteTimelines(metadata, this);
    this.wind = null;
    this.bustScale = 1;
    this.hairScale = 1;
    this.partsScale = 1;
    this.time = 0;
  }
  setVariable(name, value, frames = 0, easing = 0) {
    const entry = this.references.get(name),
      exponent = emoteTransitionPower(easing);
    this.dirty = true;
    if (!entry || (entry.physics && this.directEdit)) {
      this.values.set(name, f(value));
      return;
    }
    if (entry.physics || !entry.direct || entry.controller instanceof LoopController) return;
    const controller = entry.controller;
    if (controller instanceof MouthController && name === entry.label)
      controller.beginFrame = Math.trunc(value) | 0;
    else if (controller instanceof ValueController)
      controller.set([f(value)], f(frames), exponent, this.queuing);
    else controller.set(f(value), f(frames), exponent, this.queuing);
  }
  variable(name) {
    return f(this.values.get(name) ?? 0);
  }
  variables() {
    return [...this.document.variables.keys()].filter(
      (name) => !this.controls.transition.some((entry) => entry.label === name && !entry.direct),
    );
  }
  setMirror(value) {
    this.mirrorChanged = Boolean(value) !== this.mirror;
    this.dirty = true;
  }
  setRoot(name, values, frames = 0, easing = 0) {
    const controller = this.root[name];
    if (!controller) throw new Error(`Unknown E-mote root controller ${name}`);
    controller.set(values, f(frames), emoteTransitionPower(easing), this.queuing);
    this.dirty = true;
  }
  setColor(color, frames = 0, easing = 0) {
    this.setRoot(
      'color',
      [24, 16, 8, 0].map((shift) => (color >>> shift) & 255),
      frames,
      easing,
    );
  }
  color() {
    let result = 0;
    for (let i = 0; i < 4; i++)
      result |= (Math.trunc(this.root.color.value[i]) & 255) << ((3 - i) * 8);
    return result >>> 0;
  }
  angleDegrees() {
    return f(f(this.root.angle.value * 360) / f(2 * Math.PI));
  }
  angle() {
    return f((this.angleDegrees() * f(2 * Math.PI)) / 360);
  }
  setWind(values) {
    const wind = this.wind ?? new EmoteWind(() => this.random.next());
    this.wind = wind.configure(...values.map(f), f(this.document.metadata.scale ?? 1))
      ? wind
      : null;
  }
  update(dt) {
    if (!Number.isFinite(dt)) throw new Error('E-mote frame delta must be finite');
    dt = f(dt);
    if (!Number.isFinite(dt)) throw new Error('E-mote frame delta exceeds float32');
    this.timelines.update(dt);
    let remaining = dt;
    while (remaining > 0 || this.dirty) {
      const slice = Math.min(remaining, f(1.1)),
        step = f(slice);
      this.dirty = false;
      for (const category of ['eye', 'eyebrow', 'mouth', 'selector', 'transition', 'loop'])
        for (const { label, data, controller } of this.controls[category]) {
          const result = controller.step(step);
          if (category === 'mouth') {
            this.values.set(label, f(controller.beginFrame));
            this.values.set(data.talkLabel, result);
          } else this.values.set(label, result instanceof Float32Array ? result[0] : result);
        }
      for (const name of ['position', 'color', 'scale', 'angle']) this.root[name].step(step);
      this.wind?.step(step);
      remaining = f(remaining - slice);
    }
    const metadata = this.document.metadata;
    for (const [label, value] of this.values) {
      const negate =
        this.mirrorChanged &&
        (metadata.mirrorControl?.variableMatchList ?? []).some(
          (pattern) => label.indexOf(pattern) >= 1,
        );
      this.bound.set(label, this.timelines.contribution(label, value) * (negate ? -1 : 1));
    }
    this.applyClamps();
    this.time += dt;
    if (dt !== 0 && !this.directEdit) {
      for (const name of ['bustForce', 'hairForce', 'partsForce']) this.root[name].step(f(dt));
      for (const entry of this.physics) this.stepPhysics(entry, f(dt));
    }
  }
  stepPhysics(entry, dt) {
    const point = this.resolveAnchor(entry.data.baseLayer),
      x = f(point?.[0] ?? entry.anchor[0]),
      y = f(point?.[1] ?? entry.anchor[1]),
      force = this.root[`${entry.category}Force`].value,
      scale = f(this[`${entry.category}Scale`] ?? 1),
      angle = this.angle();
    let elapsed = 0;
    const step = (delta, ax, ay) =>
      entry.spring.step(ax, ay, force[0], force[1], delta, scale, angle, this.wind);
    if (entry.first) {
      entry.first = false;
      step(0, x, y);
    } else
      while (elapsed < f(dt - f(0.0001))) {
        const delta = f(Math.min(f(dt - elapsed), f(1.1)));
        elapsed = f(elapsed + delta);
        const weight = f(elapsed / dt),
          previous = f(1 - weight);
        step(
          delta,
          f(f(previous * entry.anchor[0]) + f(weight * x)),
          f(f(previous * entry.anchor[1]) + f(weight * y)),
        );
      }
    entry.anchor[0] = x;
    entry.anchor[1] = y;
    const out = entry.spring.output,
      data = entry.data,
      settled = out.every((value) => Math.abs(value) <= f(0.01));
    this.values.set(data.var_lr, settled ? 0 : entry.category === 'bust' ? out[0] : out[1]);
    this.values.set(data.var_ud, settled ? 0 : entry.category === 'bust' ? out[1] : out[2]);
    if (entry.category !== 'bust') this.values.set(data.var_lrm, settled ? 0 : out[0]);
  }
  applyClamps() {
    for (const data of enabled(this.document.metadata.clampControl)) {
      const range = data.max - data.min;
      let x =
          (((this.values.get(data.var_lr) ?? 0) +
            this.timelines.contribution(data.var_lr) -
            data.min) /
            range) *
            2 -
          1,
        y =
          (((this.values.get(data.var_ud) ?? 0) +
            this.timelines.contribution(data.var_ud) -
            data.min) /
            range) *
            2 -
          1;
      if (x !== 0 && y !== 0) {
        if (data.type === 1 && Math.hypot(x, y) > 1) {
          const angle = Math.atan2(y, x);
          x = Math.cos(angle);
          y = Math.sin(angle);
        } else if (data.type === 0) {
          const ratio = Math.abs(x / y),
            v = ratio <= 1 ? ratio : 1 / ratio,
            inverse = 1 / Math.sqrt(v * v + 1),
            px = x * inverse,
            py = y * inverse,
            length = Math.sqrt(px * px + py * py),
            scale =
              (1 - Math.cos(v * 1.57079633)) * (Math.sin(length * 1.57079633) / length - 1) + 1;
          x = px * scale;
          y = py * scale;
        }
      }
      const mirror =
        this.mirrorChanged &&
        (this.document.metadata.mirrorControl?.variableMatchList ?? []).some(
          (pattern) => data.var_lr.indexOf(pattern) >= 1,
        );
      this.bound.set(data.var_lr, (data.min + range * (x + 1) * 0.5) * (mirror ? -1 : 1));
      this.bound.set(data.var_ud, data.min + range * (y + 1) * 0.5);
    }
  }
  snapshot() {
    return {
      time: this.time,
      queuing: this.queuing,
      dirty: this.dirty,
      directEdit: this.directEdit,
      mirrorChanged: this.mirrorChanged,
      values: [...this.values],
      bound: [...this.bound],
      random: this.random.snapshot(),
      wind: this.wind ? saveController(this.wind) : null,
      physicsScales: [this.bustScale, this.hairScale, this.partsScale],
      root: Object.fromEntries(
        Object.entries(this.root).map(([name, controller]) => [name, saveController(controller)]),
      ),
      controls: Object.fromEntries(
        Object.entries(this.controls).map(([name, rows]) => [
          name,
          rows.map((row) => saveController(row.controller)),
        ]),
      ),
      physics: this.physics.map((entry) => ({
        first: entry.first,
        anchor: entry.anchor.slice(),
        spring: saveController(entry.spring),
      })),
      timelines: {
        active: [...this.timelines.active],
        states: [...this.timelines.states].map(([name, state]) => [
          name,
          {
            ...state,
            blend: saveController(state.blend),
            tracks: state.tracks.map((track) => ({
              ...track,
              controller: saveController(track.controller),
            })),
          },
        ]),
      },
    };
  }
  restore(state) {
    for (const name of ['time', 'queuing', 'dirty', 'directEdit', 'mirrorChanged'])
      this[name] = state[name];
    this.values = new Map(state.values);
    this.bound = new Map(state.bound);
    this.random.restore(state.random);
    this.wind = state.wind ? new EmoteWind(() => this.random.next()) : null;
    if (this.wind) restoreController(this.wind, state.wind);
    [this.bustScale, this.hairScale, this.partsScale] = state.physicsScales;
    for (const [name, saved] of Object.entries(state.root))
      restoreController(this.root[name], saved);
    for (const [name, rows] of Object.entries(state.controls))
      rows.forEach((saved, i) => restoreController(this.controls[name][i].controller, saved));
    state.physics.forEach((saved, i) => {
      this.physics[i].first = saved.first;
      this.physics[i].anchor.set(saved.anchor);
      restoreController(this.physics[i].spring, saved.spring);
    });
    this.timelines.active = [...state.timelines.active];
    for (const [name, saved] of state.timelines.states) {
      const timeline = this.timelines.state(name);
      for (const key of [
        'flags',
        'loopBegin',
        'loopEnd',
        'lastTime',
        'time',
        'blendWeight',
        'autoStop',
      ])
        timeline[key] = saved[key];
      restoreController(timeline.blend, saved.blend);
      saved.tracks.forEach((track, i) => {
        Object.assign(timeline.tracks[i], { cursor: track.cursor, output: track.output });
        restoreController(timeline.tracks[i].controller, track.controller);
      });
    }
  }
}
