// SPDX-License-Identifier: MPL-2.0
// M2's external DIF controller feeds the E-mote player; its curve names do
// not describe the DLL's easing parameter. See the authored wrapper oracle.
const f = Math.fround;
const easing = new Map([
  ['fix', 0],
  ['linear', 1],
  ['sin_fs', -f(1.2)],
  ['sin_sf', f(1.2)],
  ['sin_ss', 1],
]);

export class M2Variables {
  constructor(animation) {
    this.animation = animation;
    this.codes = {};
    this.targets = new Map();
    this.activeTransitions = new Set();
    this.pins = new Map();
    this.speeds = new Map();
    this.scales = new Map();
    this.speed = 1;
    this.scale = 1;
    this.playing = true;
    this.enabled = true;
  }
  apply(definition, requested, { animate = true } = {}) {
    const names = new Set(),
      changes = new Map(),
      codes = { ...this.codes },
      targets = new Map(this.targets),
      pins = new Map(Object.entries(definition.defaults).map(([name, value]) => [name, f(value)]));
    for (const [index, options] of Object.entries(definition.patterns)) {
      const old = this.codes[index],
        supplied = requested[index],
        fallback = Object.entries(options).find(([, pattern]) => pattern.isDefault)?.[0],
        code =
          supplied == null || supplied === '' || supplied === '$'
            ? (old ?? fallback)
            : String(supplied).toLowerCase();
      if (code === undefined) continue;
      codes[index] = code;
      if (code === old) continue;
      const rule = definition.chains[index] ?? { curve: 'fix', frames: 1, pairs: {} },
        transition = rule.pairs?.[`${old}>${code}`] ?? rule;
      for (const name of new Set([
        ...Object.keys(options[old]?.assignments ?? {}),
        ...Object.keys(options[code]?.assignments ?? {}),
      ]))
        changes.set(name, transition);
    }
    for (const [index, code] of Object.entries(codes))
      for (const [name, value] of Object.entries(
        definition.patterns[index]?.[code]?.assignments ?? {},
      )) {
        if (names.has(name)) throw new Error(`Unverified M2 DIF composition for variable ${name}`);
        names.add(name);
        if (!this.targets.has(name))
          changes.set(name, definition.chains[index] ?? { curve: 'fix', frames: 1 });
        targets.set(name, f(value));
      }
    for (const name of changes.keys()) if (!names.has(name)) targets.set(name, 0);
    this.definition = definition;
    this.codes = codes;
    this.targets = targets;
    this.pins = pins;
    this.pending = changes.size !== 0;
    for (const [name, rule] of changes) {
      if (this.pins.has(name)) continue;
      this.drive(name, this.targets.get(name), rule, animate);
    }
    // DEFVAL is a persistent override, not a fallback for a missing pattern.
    for (const [name, value] of this.pins)
      this.animation.setVariable(name, f(value * (this.scales.get(name) ?? this.scale)));
  }
  drive(name, value, rule, animate) {
    if (rule.curve === 'nomove') return;
    const mode = easing.get(rule.curve);
    if (mode === undefined) throw new Error(`Unsupported M2 DIF curve ${rule.curve}`);
    const speed = this.speeds.get(name) ?? this.speed,
      duration =
        animate && this.playing && this.enabled && rule.curve !== 'fix'
          ? f(f(rule.frames) / speed)
          : 0;
    if (!Number.isFinite(duration) || duration < 0)
      throw new Error(`Unverified M2 transition duration ${duration} (${name})`);
    if (duration > 0) this.activeTransitions.add(name);
    else this.activeTransitions.delete(name);
    this.animation.setVariable(
      name,
      f(value * (this.scales.get(name) ?? this.scale)),
      duration,
      mode,
    );
  }
  beforeUpdate() {
    for (const name of this.activeTransitions) {
      const c = this.animation.controls.transition.find(
        (entry) => entry.label === name,
      )?.controller;
      if (!c || (c.state === 0 && !c.queue.length)) this.activeTransitions.delete(name);
    }
  }
  setPlaying(value) {
    this.playing = Boolean(value);
    if (!this.playing) this.activeTransitions.clear();
  }
  setSpeed(name, value) {
    value = f(value);
    if (!Number.isFinite(value) || value <= 0)
      throw new Error(`Unverified M2 frame speed ${value}`);
    if (name == null) this.speed = value;
    else this.speeds.set(name, value);
  }
  resetSpeed(name) {
    if (name == null) {
      this.speeds.clear();
      this.speed = 1;
    } else this.speeds.delete(name);
  }
  setScale(name, value) {
    value = f(value);
    if (!Number.isFinite(value)) throw new Error(`Non-finite M2 parameter scale ${value}`);
    if (name == null) this.scale = value;
    else this.scales.set(name, value);
    for (const [key, target] of [...this.targets, ...this.pins])
      if (name == null || key === name)
        this.animation.setVariable(key, f(target * (this.scales.get(key) ?? this.scale)));
  }
  finish() {
    const names = this.pending
      ? new Set([...this.targets.keys(), ...this.pins.keys()])
      : this.activeTransitions;
    for (const name of names) {
      const value = this.pins.get(name) ?? this.targets.get(name);
      this.animation.setVariable(name, f(value * (this.scales.get(name) ?? this.scale)));
    }
    this.activeTransitions.clear();
    this.pending = false;
  }
  get busy() {
    return (
      Boolean(this.pending) ||
      this.activeTransitions.size > 0 ||
      this.animation.controls.transition.some(
        ({ controller }) => controller.state !== 0 || controller.queue.length !== 0,
      )
    );
  }
  snapshot() {
    return structuredClone({
      codes: this.codes,
      pending: this.pending ?? false,
      activeTransitions: [...this.activeTransitions],
      targets: [...this.targets],
      pins: [...this.pins],
      speeds: [...this.speeds],
      scales: [...this.scales],
      speed: this.speed,
      scale: this.scale,
      playing: this.playing,
      enabled: this.enabled,
    });
  }
  restore(state) {
    this.codes = structuredClone(state.codes);
    this.pending = state.pending;
    this.activeTransitions = new Set(state.activeTransitions);
    for (const key of ['targets', 'pins', 'speeds', 'scales']) this[key] = new Map(state[key]);
    for (const key of ['speed', 'scale', 'playing', 'enabled']) this[key] = state[key];
  }
}
