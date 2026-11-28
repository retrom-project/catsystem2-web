// SPDX-License-Identifier: MPL-2.0
// External action.def programs issue DLL variable transitions one step at a
// time. A wait step has its own engine-frame clock; it is not a transition.
export class M2Actions {
  constructor(model) {
    this.model = model;
    this.name = '';
    this.index = 0;
    this.base = new Map();
    this.until = null;
    this.current = null;
  }
  start(name) {
    this.name = name;
    this.index = 0;
    this.until = null;
    this.current = null;
    const names = new Set(
      (this.model.profiles.actions[name] ?? []).flatMap((step) => Object.keys(step.variables)),
    );
    for (const key of names) if (!this.base.has(key)) this.base.set(key, null);
    return 1;
  }
  update(frame) {
    if (!this.name || this.model.variables.busy) return;
    const animation = this.model.animation;
    for (const [name, value] of this.base)
      if (value === null) this.base.set(name, animation.variable(name));
    if (this.until !== null && frame < this.until) return;
    this.until = null;
    const step = this.model.profiles.actions[this.name]?.[this.index++];
    this.current = step ?? null;
    if (!step) {
      this.name = '';
      return;
    }
    if (step.wait) {
      this.until = (frame + step.frames) >>> 0;
      return;
    }
    const values = step.restore ? this.base : Object.entries(step.variables);
    for (const [name, value] of values)
      animation.setVariable(name, value, step.frames, step.easing);
  }
  stop() {
    this.name = '';
    this.until = null;
    this.current = null;
  }
  finish() {
    if (!this.current) return 0;
    const steps = this.model.profiles.actions[this.name] ?? [];
    while (this.current && !this.current.restore) this.current = steps[++this.index] ?? null;
    if (!this.current) this.stop();
    this.until = null;
    return Number(Boolean(this.current));
  }
  snapshot() {
    return {
      name: this.name,
      index: this.index,
      base: [...this.base],
      until: this.until,
      current: this.current,
    };
  }
  restore(state) {
    this.name = state.name;
    this.index = state.index;
    this.base = new Map(state.base);
    this.until = state.until;
    this.current = state.current;
  }
}
