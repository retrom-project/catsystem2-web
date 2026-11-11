// SPDX-License-Identifier: MPL-2.0
import { M2LipSamples } from './m2-lip-samples.mjs';
const f = Math.fround;

export class M2Lip {
  constructor() {
    this.entries = [];
    this.pending = new Map();
    this.enabled = true;
    this.previousLevel = 0;
    this.samples = null;
    this.ready = false;
  }
  select(definition, codes) {
    this.definition = definition;
    this.entries = definition.lips.flatMap((rule) => {
      if (codes[rule.digit] !== rule.code) return [];
      const first = Object.entries(
        definition.patterns[rule.digit]?.[rule.code]?.assignments ?? {},
      )[0];
      if (!first) return [];
      return [
        {
          ...structuredClone(rule),
          variable: rule.variable ?? first[0],
          base: f(first[1]),
          playing: false,
          start: 0,
          index: 0,
          from: 0,
          to: 0,
          frames: 0,
          check: false,
          next: null,
          stop: false,
          lookAheadStop: false,
        },
      ];
    });
    this.pending.clear();
  }
  install(bytes, kind) {
    const clipper = this.definition.clipper;
    this.samples = M2LipSamples.open(bytes, kind, {
      classes: clipper.slice(0, 6),
      radius: clipper[7] ?? 1,
    });
    this.sampleKind = kind;
    if (this.samples) this.samples.start = clipper[6] >>> 0;
    return Boolean(this.samples);
  }
  sample(frame) {
    return this.samples.value(frame, 0, this.sampleKind === 'lpb' ? 5 : 1);
  }
  prime() {
    this.ready = true;
    if (this.samples)
      for (const entry of this.entries) this.pending.set(entry.variable, this.sample(0));
  }
  feedLevels(levels) {
    if (levels.length <= 1 || levels[1] === this.previousLevel) return;
    this.previousLevel = levels[1];
    // The first sound tick precedes construction of the original actor's
    // lip entries. It remembers the envelope but cannot start a flow yet.
    if (!this.ready) return;
    for (const entry of this.entries) {
      if (levels[1] >= entry.low) {
        if (!entry.playing) this.begin(entry);
        entry.playing = true;
        entry.check = false;
      } else if (entry.playing && !entry.check) {
        const n = levels
          .slice(1, Math.floor(levels.length / 4))
          .filter((v) => v >= entry.low).length;
        if (n < Math.trunc(levels.length / 10)) entry.lookAheadStop = true;
      }
    }
  }
  step(entry, index) {
    const step = entry.flow[index % entry.flow.length];
    return {
      value: f(entry.levels[step.value] ?? entry.levels[0] ?? 0),
      frames: f(step.frames),
      check: step.mayStop,
    };
  }
  begin(entry) {
    entry.start = 0;
    entry.index = 0;
    entry.stop = false;
    entry.lookAheadStop = false;
    if (!entry.flow.length) {
      entry.from = 0;
      entry.to = 0;
      entry.frames = 0;
      return;
    }
    const first = this.step(entry, 0),
      second = this.step(entry, 1);
    entry.from = first.value;
    entry.to = second.value;
    entry.frames = first.frames;
    entry.check = first.check;
    entry.next = second;
  }
  stop() {
    this.previousLevel = 0;
    for (const entry of this.entries)
      if (entry.playing) {
        this.pending.set(entry.variable, entry.base);
        entry.playing = false;
      }
  }
  setEnabled(value) {
    this.enabled = Boolean(value);
    if (!this.enabled)
      for (const entry of this.entries) {
        this.pending.set(entry.variable, entry.base);
        entry.playing = false;
      }
  }
  flush(write) {
    for (const [name, value] of this.pending) write(name, value);
    this.pending.clear();
  }
  update(frame) {
    if (!this.enabled) return;
    for (const entry of this.entries) {
      if (this.samples) {
        this.pending.set(entry.variable, this.sample(frame));
        continue;
      }
      if (!entry.playing || !entry.frames) continue;
      entry.start ||= frame;
      const position = f(f((frame - entry.start) >>> 0) / entry.frames);
      let value = 0;
      if (position >= 1) {
        if (entry.stop) {
          value = entry.base;
          entry.playing = false;
          entry.start = 0;
          entry.index = 0;
          entry.frames = 0;
        } else {
          if (entry.lookAheadStop && entry.check) {
            entry.stop = true;
            entry.to = f(entry.levels[0] ?? 0);
          } else entry.to = this.step(entry, entry.index + 2).value;
          entry.from = entry.next.value;
          entry.frames = entry.next.frames;
          entry.check = entry.next.check;
          entry.next = this.step(entry, ++entry.index + 1);
          entry.start = frame;
          value = entry.from;
        }
      } else if (entry.curve === 'fix') value = entry.from;
      else if (entry.curve === 'linear')
        value = f(f(f(entry.to - entry.from) * position) + entry.from);
      else throw new Error(`Unsupported M2 lip curve ${entry.curve}`);
      this.pending.set(entry.variable, value);
    }
  }
  snapshot() {
    return structuredClone({
      entries: this.entries,
      pending: [...this.pending],
      enabled: this.enabled,
      previousLevel: this.previousLevel,
      ready: this.ready,
      samples: this.samples?.snapshot() ?? null,
      sampleKind: this.sampleKind ?? null,
    });
  }
  restore(state) {
    this.entries = structuredClone(state.entries);
    this.pending = new Map(state.pending);
    this.enabled = state.enabled;
    this.previousLevel = state.previousLevel;
    this.ready = state.ready;
    this.sampleKind = state.sampleKind;
    this.samples = state.samples ? M2LipSamples.restore(state.samples) : null;
  }
}
