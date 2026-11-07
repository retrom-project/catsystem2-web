// SPDX-License-Identifier: MPL-2.0
import { Binary } from './binary.mjs';
export class AudioMixer {
  constructor(game, context = new AudioContext()) {
    this.game = game;
    this.context = context;
    this.channels = new Map();
    this.buffers = new Map();
    this.pending = new Map();
    this.generations = new Map();
    this.groups = {};
    this.master = 1;
    this.warnings = new Set();
  }
  async unlock() {
    await this.context.resume();
  }
  async buffer(name) {
    name = name.toLowerCase();
    if (this.buffers.has(name)) {
      const b = this.buffers.get(name);
      this.buffers.delete(name);
      this.buffers.set(name, b);
      return b;
    }
    if (!this.pending.has(name))
      this.pending.set(
        name,
        (async () => {
          const file = this.game.resolve(name, ['ogg', 'wav', 'mp3']);
          if (!file) {
            this.warnings.add(`Missing audio ${name}`);
            return null;
          }
          const bytes = await this.game.require(file),
            buffer = await this.context.decodeAudioData(bytes.slice().buffer);
          this.buffers.set(name, buffer);
          while (this.buffers.size > 8) this.buffers.delete(this.buffers.keys().next().value);
          return buffer;
        })().finally(() => this.pending.delete(name)),
      );
    return this.pending.get(name);
  }
  async play(sound) {
    const key = sound.channel,
      generation = (this.generations.get(key) || 0) + 1;
    this.generations.set(key, generation);
    this.stop(key, false);
    if (!sound.file) return;
    const buffer = await this.buffer(sound.file);
    if (!buffer) return;
    if (this.generations.get(key) !== generation || this.context.state === 'closed') return;
    const source = this.context.createBufferSource(),
      gain = this.context.createGain();
    source.buffer = buffer;
    source.loop = !!sound.loop;
    source.connect(gain);
    gain.connect(this.context.destination);
    const offset = Math.max(0, sound.offset || 0) % buffer.duration,
      channel = {
        ...sound,
        source,
        gain,
        duration: buffer.duration,
        started: this.context.currentTime - offset,
        offset,
        playing: true,
      };
    gain.gain.value = this.volume(channel);
    source.start(0, offset);
    this.channels.set(key, channel);
    source.onended = () => {
      channel.playing = false;
      source.disconnect();
      gain.disconnect();
      if (this.channels.get(key) === channel) this.channels.delete(key);
    };
    if (key === 'voice') {
      const samples = buffer.getChannelData(0),
        step = Math.max(1, Math.floor(buffer.sampleRate / 60)),
        envelope = [];
      for (let i = 0; i < samples.length; i += step) {
        let sum = 0,
          end = Math.min(samples.length, i + step);
        for (let j = i; j < end; j++) sum += samples[j] ** 2;
        envelope.push(Math.sqrt(sum / (end - i)));
      }
      channel.envelope = envelope;
      const tag = await this.game.read(`${sound.file}.tag`),
        tags = {};
      if (tag) {
        const b = new Binary(tag, 'audio tags');
        if (tag.length % 24) throw new Error('Malformed audio tag records');
        for (let i = 0; i < tag.length; i += 24) tags[b.str(i, 20)] = b.u32(i + 20) / 1000;
      }
      channel.tags = tags;
    }
  }
  volume(channel) {
    return (
      this.master *
      Math.max(0, Math.min(1, (channel.volume ?? 100) / 100)) *
      (this.groups[channel.group || 'se'] ?? 1)
    );
  }
  refresh() {
    for (const c of this.channels.values())
      c.gain.gain.setTargetAtTime(this.volume(c), this.context.currentTime, 0.015);
  }
  setGroup(name, volume) {
    this.groups[name] = Math.max(0, Math.min(1, volume / 100));
    this.refresh();
  }
  setMaster(volume) {
    this.master = Math.max(0, Math.min(1, volume / 100));
    this.refresh();
  }
  control(key, args) {
    const c = this.channels.get(key);
    if (!c) return;
    if (args[0] === 'loop') c.source.loop = c.loop = Number(args[1]) !== 0;
    if (args[0] === 'vol') {
      c.volume = Number(args[1]);
      this.refresh();
    }
    if (args[0] === 'fade') {
      const duration = Math.max(0, Number(args[1]) || 0) / 60,
        target = Number(args.at(-1) || 0) / 100;
      c.gain.gain.cancelScheduledValues(this.context.currentTime);
      c.gain.gain.setValueAtTime(c.gain.gain.value, this.context.currentTime);
      c.gain.gain.linearRampToValueAtTime(
        target * this.master * (this.groups[c.group] ?? 1),
        this.context.currentTime + duration,
      );
      c.volume = target * 100;
    }
  }
  stop(key, invalidate = true) {
    if (invalidate) this.generations.set(key, (this.generations.get(key) || 0) + 1);
    const c = this.channels.get(key);
    this.channels.delete(key);
    if (c) {
      c.playing = false;
      c.source.onended = null;
      c.source.stop();
      c.source.disconnect();
      c.gain.disconnect();
    }
  }
  stopAll() {
    for (const key of new Set([
      ...this.channels.keys(),
      ...this.pending.keys(),
      ...this.generations.keys(),
    ]))
      this.stop(key);
  }
  voiceInfo() {
    const c = this.channels.get('voice');
    return c
      ? {
          file: c.file,
          time: this.context.currentTime - c.started,
          playing: c.playing,
          envelope: c.envelope,
          tags: c.tags,
        }
      : {};
  }
  snapshot() {
    return [...this.channels].map(([key, c]) => ({
      channel: key,
      file: c.file,
      loop: c.loop,
      group: c.group,
      volume: c.volume,
      offset: this.context.currentTime - c.started,
    }));
  }
  async restore(state) {
    this.stopAll();
    await Promise.all(state.map((c) => this.play(c)));
  }
  async dispose() {
    this.stopAll();
    this.buffers.clear();
    await this.context.close();
  }
}
