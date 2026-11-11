// SPDX-License-Identifier: BSD-3-Clause
// Translated from motionplayer EmoteEngine timeline operations.
// Source and original notices: NOTICE.md, licenses/motionplayer.txt.
import { ValueController, emoteTransitionPower } from './controllers.mjs';
const f = Math.fround;

export class EmoteTimelines {
  constructor(metadata, owner) {
    this.owner = owner;
    this.definitions = new Map((metadata.timelineControl ?? []).map((data) => [data.label, data]));
    this.instant = new Set(metadata.instantVariableList ?? []);
    this.states = new Map();
    this.active = [];
  }
  state(label) {
    if (this.states.has(label)) return this.states.get(label);
    const data = this.definitions.get(label);
    if (!data) throw new Error(`Unknown E-mote timeline ${label}`);
    const tracks = (data.variableList ?? []).map((track) => ({
        label: track.label,
        instant: this.instant.has(track.label),
        cursor: 0,
        output: 0,
        controller: new ValueController(),
        frames: (track.frameList ?? []).map((frame) => ({
          time: frame.time,
          zero: frame.type === 0,
          value: f(frame.content?.value ?? 0),
          easing: frame.content?.easing ?? 0,
          power: emoteTransitionPower(frame.content?.easing ?? 0),
        })),
      })),
      blend = new ValueController();
    blend.set([1]);
    const state = {
      label,
      flags: 0,
      loopBegin: data.loopBegin ?? -1,
      loopEnd: data.loopEnd ?? -1,
      lastTime:
        data.lastTime < 0
          ? Math.max(0, ...tracks.flatMap((track) => track.frames.map((frame) => frame.time)))
          : (data.lastTime ?? 0),
      time: 0,
      blendWeight: 1,
      autoStop: false,
      blend,
      tracks,
    };
    this.states.set(label, state);
    return state;
  }
  action(state, track, index, time) {
    const frame = track.frames[index],
      duration = Math.max(track.frames[index + 1].time - time - 1, 0);
    if (state.flags & 2 && !track.instant)
      track.controller.set([frame.value], f(duration), frame.power, this.owner.queuing);
    else this.owner.setVariable(track.label, frame.value, duration, frame.easing);
  }
  seek(state, time) {
    for (const track of state.tracks) {
      if (state.flags & 4 && track.instant) continue;
      let cursor = 0,
        last = -1;
      if (track.frames.length >= 2) {
        for (; cursor < track.frames.length - 1; cursor++) {
          if (!track.frames[cursor].zero) last = cursor;
          if (track.frames[cursor].time <= time && track.frames[cursor + 1].time > time) break;
        }
      }
      track.cursor = cursor;
      if (last >= 0) this.action(state, track, last, time);
    }
    state.time = time;
  }
  window(state, inclusive, target) {
    for (const track of state.tracks) {
      if (state.flags & 4 && track.instant) continue;
      while (track.cursor < track.frames.length - 1) {
        const next = track.frames[track.cursor + 1];
        if (!(inclusive ? next.time <= target : next.time < target)) break;
        track.cursor++;
        if (!next.zero && track.cursor + 1 < track.frames.length)
          this.action(state, track, track.cursor, target);
      }
    }
    state.time = target;
  }
  play(label, flags = 0) {
    if (flags & 1) this.active.length = 0;
    const state = this.state(label);
    state.flags = flags;
    if (flags & 2) for (const track of state.tracks) track.controller.set([0]);
    if (!this.active.includes(label)) this.active.push(label);
    this.seek(state, 0);
  }
  stop(label = '') {
    if (!label) this.active.length = 0;
    else {
      const at = this.active.indexOf(label);
      if (at >= 0) this.active.splice(at, 1);
    }
  }
  playing(label = '') {
    return label ? this.active.includes(label) : this.active.length > 0;
  }
  setBlend(label, value, duration = 0, easing = 0, autoStop = false) {
    const state = this.state(label);
    state.blend.set([f(value)], f(duration), emoteTransitionPower(easing), this.owner.queuing);
    state.autoStop = autoStop;
  }
  fadeIn(label, duration = 0, easing = 0) {
    if (!this.playing(label)) {
      this.play(label, 3);
      this.setBlend(label, 0);
    }
    this.setBlend(label, 1, duration, easing);
  }
  update(dt) {
    if (dt === 0) return;
    let remaining = dt;
    for (let i = 0; i < this.active.length; ) {
      const state = this.states.get(this.active[i]),
        nonLoop = !(state.loopBegin >= 0);
      if (nonLoop) this.window(state, true, state.time + remaining);
      else {
        if (!(state.loopEnd > state.loopBegin))
          throw new Error('E-mote timeline has non-positive loop span');
        while (state.time + remaining >= state.loopEnd) {
          remaining -= state.loopEnd - state.time;
          this.window(state, false, state.loopEnd);
          this.seek(state, state.loopBegin);
        }
        this.window(state, true, state.time + Math.max(remaining, 0));
      }
      if (state.flags & 2) {
        state.blendWeight = state.blend.step(f(remaining))[0];
        for (const track of state.tracks)
          if (track.frames.length && !track.instant)
            track.output = track.controller.step(f(remaining))[0];
      }
      if (
        (nonLoop && state.lastTime <= state.time) ||
        (state.autoStop && !state.blend.state && !state.blend.queue.length)
      )
        this.active.splice(i, 1);
      else i++;
    }
  }
  contribution(label, value = 0) {
    let result = value;
    for (const name of this.active) {
      const state = this.states.get(name);
      if (!(state.flags & 2)) continue;
      for (const track of state.tracks)
        if (!track.instant && track.frames.length && track.label === label)
          result += f(track.output * state.blendWeight);
    }
    return result;
  }
}
