// SPDX-License-Identifier: MPL-2.0
// DIF automatic parameters run after the current frame's variable flush.
// Their writes are consumed by the following frame, unlike PSB eyeControl.
const f = Math.fround;

export class M2Blink {
  constructor(random) {
    if (typeof random !== 'function') throw new TypeError('M2 blink requires the engine RNG');
    this.random = random;
    this.entries = [];
    this.pending = new Map();
    this.enabled = true;
  }
  select(definition, codes) {
    this.entries = definition.blinks.flatMap((rule) => {
      if (codes[rule.digit] !== rule.code) return [];
      const assignment = Object.entries(
        definition.patterns[rule.digit]?.[rule.code]?.assignments ?? {},
      )[0];
      if (!assignment) return [];
      return [{ ...rule, variable: assignment[0], base: f(assignment[1]), start: 0, end: 0 }];
    });
    // A pose request restarts the wait timer, but does not discard the write
    // queued after the previous frame's variable flush.
  }
  flush(write) {
    for (const [name, value] of this.pending) write(name, value);
    this.pending.clear();
  }
  update(frame) {
    if (!this.enabled) return;
    frame >>>= 0;
    for (const entry of this.entries) {
      if (entry.start === entry.end) {
        // The original interval is half open; equal bounds use divisor one.
        const range = (entry.maxWait - entry.minWait) >>> 0 || 1;
        entry.start = (frame + entry.minWait + ((this.random() >>> 0) % range)) >>> 0;
        entry.end = (entry.start + entry.frames) >>> 0;
      }
      if (frame < entry.start) continue;
      if (frame >= entry.end) {
        this.pending.set(entry.variable, entry.base);
        entry.end = entry.start;
        continue;
      }
      const position = f(f(f((frame - entry.start) >>> 0) / f(entry.frames)) * 2),
        from = f(entry.from),
        to = f(entry.to),
        value =
          position <= 1
            ? f(f(f(to - from) * position) + from)
            : f(f(f(position - 1) * f(from - to)) + to);
      this.pending.set(entry.variable, value);
    }
  }
  setEnabled(value) {
    this.enabled = Boolean(value);
    if (!this.enabled)
      for (const entry of this.entries) this.pending.set(entry.variable, entry.base);
    else for (const entry of this.entries) entry.start = entry.end = 0;
  }
  snapshot() {
    return structuredClone({
      entries: this.entries,
      pending: [...this.pending],
      enabled: this.enabled,
    });
  }
  restore(state) {
    this.entries = structuredClone(state.entries);
    this.pending = new Map(state.pending);
    this.enabled = state.enabled;
  }
}
