// SPDX-License-Identifier: MPL-2.0
import { Binary } from './binary.mjs';
import { evaluate } from './fes/expression.mjs';
import { readLoopPoints } from './native/loop-points.mjs';
import { nativeSoundGain, nativeLoopFrames } from './native/sound-math.mjs';
import { readAudioSource } from './native/audio-source.mjs';
import { nativeSoundPanGains, nativeSoundPositionPan } from './native/sound-values.mjs';
import { spatialPlaybackRate } from './native/audio-spatial.mjs';
import { sourcePCM, NativePCMWindows } from './native/audio-pcm.mjs';

// decodeAudioData may resample to the AudioContext rate. Loop positions refer
// to the source stream, so retain its header rate before browser decoding.
export function sourceSampleRate(bytes) {
  const b = new Binary(bytes, 'audio sample rate');
  if (bytes.length >= 12 && b.magic('RIFF') && b.str(8, 4) === 'WAVE') {
    for (let at = 12; at + 8 <= bytes.length; ) {
      const size = b.u32(at + 4);
      if (at + 8 + size > bytes.length) throw new Error('Truncated WAV chunk');
      if (b.str(at, 4) === 'fmt ') {
        if (size < 16) throw new Error('Truncated WAV format');
        return b.u32(at + 12);
      }
      at += 8 + size + (size & 1);
    }
  }
  if (bytes.length >= 58 && b.magic('OggS')) {
    for (let at = 27; at + 16 <= Math.min(bytes.length, 1024); at++)
      if (bytes[at] === 1 && b.str(at + 1, 6) === 'vorbis') return b.u32(at + 12);
  }
  return null;
}
export class AudioMixer {
  constructor(game, context = new AudioContext(), { deferPlayback = false } = {}) {
    this.game = game;
    this.context = context;
    this.deferPlayback = deferPlayback;
    this.channels = new Map();
    this.buffers = new Map();
    this.pending = new Map();
    this.generations = new Map();
    this.groups = {};
    this.master = 1;
    this.warnings = new Set();
    this.frame = 0;
    this.fps = 60;
    this.sequence = 0;
    this.defaults = new Map();
    this.events = [];
    this.loopPoints = new Map();
    this.sourceRates = new WeakMap();
    this.sourceMetadata = new WeakMap();
    this.pcmSources = new WeakMap();
  }
  loadLoopPoints(bytes) {
    for (const record of readLoopPoints(bytes)) {
      const key = record.file.toLowerCase(),
        previous = this.loopPoints.get(key);
      this.loopPoints.set(key, previous ? { ...previous, start: record.start } : record);
    }
  }
  async unlock() {
    await this.context.resume();
  }
  activate() {
    if (!this.deferPlayback) return;
    this.deferPlayback = false;
    for (const channel of this.channels.values())
      if (channel.playing && !channel.loading) this.startSource(channel);
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
          const file = this.game.resolveCategory
            ? this.game.resolveCategory(name, 'sound')
            : this.game.resolve(name, ['ogg', 'wav', 'mp3']);
          if (!file) {
            this.warnings.add(`Missing audio ${name}`);
            return null;
          }
          const bytes = await this.game.require(file),
            rate = sourceSampleRate(bytes),
            decoder =
              rate >= 8000 && rate <= 96000 && typeof OfflineAudioContext !== 'undefined'
                ? new OfflineAudioContext(2, 1, rate)
                : this.context,
            buffer = await decoder.decodeAudioData(bytes.slice().buffer);
          this.sourceRates.set(buffer, sourceSampleRate(bytes) || buffer.sampleRate);
          this.sourceMetadata.set(buffer, readAudioSource(bytes, buffer));
          this.pcmSources.set(buffer, sourcePCM(bytes, this.sourceMetadata.get(buffer), buffer));
          this.buffers.set(name, buffer);
          while (this.buffers.size > 8) this.buffers.delete(this.buffers.keys().next().value);
          return buffer;
        })().finally(() => this.pending.delete(name)),
      );
    return this.pending.get(name);
  }
  async preload(name) {
    const buffer = await this.buffer(name);
    return buffer ? { buffer, metadata: this.sourceMetadata.get(buffer) } : null;
  }
  async play(sound) {
    const key = sound.channel,
      generation = (this.generations.get(key) || 0) + 1;
    this.generations.set(key, generation);
    this.stop(key, false);
    if (!sound.file) return;
    const channel = {
      ...sound,
      source: null,
      gain: null,
      panner: null,
      buffer: null,
      offset: Math.max(0, sound.offset || 0),
      duration: 0,
      scheduled: this.context.currentTime,
      playing: !sound.paused && !sound.ended,
      paused: !!sound.paused,
      ended: !!sound.ended,
      loading: true,
      sequence: this.sequence++,
      remainingDelay: Math.max(0, sound.delay || 0),
      loopCount: sound.loopCount ?? (sound.loop ? 0 : 1),
      remainingDuration: sound.remainingDuration,
    };
    if (
      !Number.isInteger(channel.loopCount) ||
      channel.loopCount < 0 ||
      channel.loopCount > 0xffffffff
    )
      throw new Error('Invalid native audio loop count');
    channel.loop = channel.sourceMode !== 'static' && channel.loopCount !== 1;
    // Reserve the bank before decoding so later guest commands can affect it
    // while browser I/O is pending inside this logical frame.
    this.channels.set(key, channel);
    const buffer = await this.buffer(sound.file);
    if (!buffer) {
      if (this.channels.get(key) === channel) this.channels.delete(key);
      return;
    }
    if (this.generations.get(key) !== generation || this.context.state === 'closed') return;
    channel.buffer = buffer;
    channel.duration = buffer.duration;
    channel.loading = false;
    const pcm = this.pcmSources.get(buffer);
    channel.pcmWindows = new NativePCMWindows(pcm);
    channel.pcmOrigin =
      sound.pcmState?.origin ?? (channel.sourceMode === 'stream' ? channel.offset : 0);
    channel.pcmProgress =
      sound.pcmState?.progress ?? (channel.sourceMode === 'stream' ? 0 : channel.offset);
    channel.pcmRefills = sound.pcmState?.refills ?? 0;
    channel.pcmClock = this.context.currentTime;
    const pcmFrom =
      Math.floor(channel.pcmOrigin * pcm.sampleRate) * pcm.channels * (pcm.bitsPerSample >>> 3);
    channel.pcmWindows.fill(
      0,
      pcm.pcm.subarray(pcmFrom, pcmFrom + channel.pcmWindows.halfSecondBytes * 8),
      { initial: true },
    );
    if (sound.pcmState) channel.pcmWindows.restore(sound.pcmState.values);
    this.configureLoop(channel);
    channel.offset = this.wrapPosition(channel, channel.offset);
    if (channel.playing && !this.deferPlayback) this.startSource(channel);
    if (sound.group === 'voice') {
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
      const sourceName = sound.file
        .replaceAll('\\', '/')
        .split('/')
        .at(-1)
        .replace(/\.[^.]*$/, '');
      const tag = this.game.readCategory
          ? await this.game.readCategory(sourceName, 'tag')
          : await this.game.read(`${sound.file}.tag`),
        tags = {};
      if (tag) {
        const b = new Binary(tag, 'audio tags');
        if (tag.length % 24) throw new Error('Malformed audio tag records');
        for (let i = 0; i < tag.length; i += 24) tags[b.str(i, 20)] = b.u32(i + 20) / 1000;
      }
      channel.tags = tags;
    }
    return channel;
  }
  configureLoop(channel) {
    const { buffer } = channel;
    const loop =
      channel.loopStartFrame !== undefined || channel.loopEndFrame !== undefined
        ? { start: channel.loopStartFrame ?? 0n, end: channel.loopEndFrame ?? -1n }
        : this.loopPoints.get(channel.file.toLowerCase());
    if (loop) {
      const rate = this.sourceRates.get(buffer) || buffer.sampleRate;
      const frames = channel.nativeLoopDynamic
        ? { start: BigInt(loop.start), end: BigInt(loop.end) }
        : nativeLoopFrames(loop.start, loop.end, rate);
      if (
        frames.start < 0n ||
        frames.start > BigInt(Number.MAX_SAFE_INTEGER) ||
        frames.end > BigInt(Number.MAX_SAFE_INTEGER)
      )
        throw new Error(`Audio loop position is outside the playable range: ${channel.file}`);
      channel.loopStart = Number(frames.start) / rate;
      channel.loopEnd =
        frames.end < 0 ? buffer.duration : Math.min(buffer.duration, Number(frames.end) / rate);
      if (channel.loopStart >= channel.loopEnd)
        throw new Error(`Audio loop has an empty range: ${channel.file}`);
    } else {
      channel.loopStart = 0;
      channel.loopEnd = buffer.duration;
    }
  }
  startSource(channel) {
    const source = this.context.createBufferSource(),
      gain = this.context.createGain(),
      panner = this.context.createChannelSplitter(2),
      panLeft = this.context.createGain(),
      panRight = this.context.createGain(),
      merger = this.context.createChannelMerger(2);
    source.buffer = channel.buffer;
    source.loop = !!channel.loop;
    source.loopStart = channel.loopStart;
    source.loopEnd = channel.loopEnd;
    source.connect(gain);
    gain.connect(panner);
    panner.connect(panLeft, 0);
    panner.connect(panRight, channel.buffer.numberOfChannels === 1 ? 0 : 1);
    panLeft.connect(merger, 0, 0);
    panRight.connect(merger, 0, 1);
    merger.connect(this.context.destination);
    Object.assign(channel, {
      source,
      gain,
      panner,
      panLeft,
      panRight,
      merger,
      playing: true,
      paused: false,
      ended: false,
      scheduled: this.context.currentTime + (channel.remainingDelay || 0) / this.fps,
    });
    channel.playbackRate = 1;
    channel.pcmClock = channel.scheduled;
    gain.gain.value = this.volume(channel);
    const remaining =
      channel.remainingDuration ??
      (!channel.loop
        ? channel.duration - channel.offset
        : channel.loopCount
          ? channel.loopEnd -
            channel.offset +
            (channel.loopCount - 1) * (channel.loopEnd - channel.loopStart)
          : null);
    channel.remainingDuration = remaining;
    this.setNativeSpatial(channel.channel, { ...channel.nativeSpatial, pan: channel.pan || 0 });
    source.start(channel.scheduled, channel.offset);
    this.scheduleEnd(channel);
    source.onended = () => {
      channel.offset = channel.loop ? channel.loopEnd : channel.duration;
      channel.playing = false;
      channel.ended = true;
      source.disconnect();
      gain.disconnect();
      panner.disconnect();
      panLeft.disconnect();
      panRight.disconnect();
      merger.disconnect();
      channel.spatialNode?.disconnect();
      this.events.push({ channel: channel.channel, reason: 'ended', frame: this.frame });
    };
  }
  volume(channel) {
    let factor = channel.volumeFactor ?? 100;
    if (channel.volumeFactor !== undefined) {
      /* The native sound task already composed its configuration. */
    } else if (this.soundConfiguration?.master)
      factor = this.soundConfiguration.effectiveVolume(channel.file);
    else if (this.configuration) {
      const voice = this.configuration.blocks[0];
      const index = { bgm: 0, se: 1, voice: 2, play: 3 }[channel.group || 'se'];
      factor = new DataView(voice.buffer, voice.byteOffset, voice.byteLength).getUint32(
        index * 4,
        true,
      );
    }
    factor = Math.floor(factor * this.master);
    factor = Math.floor(factor * (this.groups[channel.group || 'se'] ?? 1));
    return nativeSoundGain(channel.volume ?? 100, factor);
  }
  setNativeSpatial(key, values) {
    const channel = this.channels.get(key);
    if (!channel) return;
    this.syncNativePCM(channel);
    const remaining = this.remaining(channel),
      position = this.position(channel);
    channel.nativeSpatial = { ...channel.nativeSpatial, ...structuredClone(values) };
    if (values.pan !== undefined) channel.pan = values.pan | 0;
    else if (values.position && values.enabled !== true && channel.nativeSpatial.enabled !== true)
      channel.pan = nativeSoundPositionPan(values.position[0], values.position[2]);
    const gains = nativeSoundPanGains(channel.pan || 0);
    channel.panLeft?.gain.setValueAtTime(gains[0], this.context.currentTime);
    channel.panRight?.gain.setValueAtTime(gains[1], this.context.currentTime);
    if (!channel.source) return;
    const spatial = channel.nativeSpatial;
    if (spatial.enabled && !channel.spatialNode) {
      channel.spatialNode = this.context.createPanner();
      channel.spatialNode.panningModel = 'equalpower';
      channel.spatialNode.distanceModel = 'inverse';
      channel.gain.disconnect();
      channel.merger.disconnect();
      channel.gain.connect(channel.spatialNode);
      channel.spatialNode.connect(this.context.destination);
    } else if (!spatial.enabled && channel.spatialNode) {
      channel.gain.disconnect();
      channel.spatialNode.disconnect();
      channel.spatialNode = null;
      channel.gain.connect(channel.panner);
      channel.merger.connect(this.context.destination);
    }
    if (channel.spatialNode) {
      const node = channel.spatialNode;
      node.refDistance = spatial.minimumDistance;
      node.maxDistance = spatial.maximumDistance;
      node.rolloffFactor = 1;
      const [x, y, z] = spatial.position;
      node.positionX.setValueAtTime(x, this.context.currentTime);
      node.positionY.setValueAtTime(y, this.context.currentTime);
      node.positionZ.setValueAtTime(-z, this.context.currentTime);
    }
    const rate = spatial.enabled ? spatialPlaybackRate(spatial, channel.buffer.sampleRate) : 1;
    if (rate !== channel.playbackRate) {
      channel.offset = position;
      channel.remainingDuration = remaining;
      channel.scheduled = Math.max(channel.scheduled, this.context.currentTime);
      channel.playbackRate = rate;
      channel.source.playbackRate.setValueAtTime(rate, this.context.currentTime);
      this.scheduleEnd(channel);
    }
  }
  remaining(channel) {
    if (channel.remainingDuration === null || channel.remainingDuration === undefined)
      return channel.remainingDuration;
    if (!channel.playing || channel.loading || this.deferPlayback) return channel.remainingDuration;
    return Math.max(
      0,
      channel.remainingDuration -
        Math.max(0, this.context.currentTime - channel.scheduled) * (channel.playbackRate ?? 1),
    );
  }
  scheduleEnd(channel) {
    const remaining = channel.remainingDuration;
    channel.playUntil =
      remaining === null || remaining === undefined
        ? null
        : channel.scheduled + remaining / (channel.playbackRate ?? 1);
    if (channel.loop && channel.source)
      channel.source.stop(channel.playUntil ?? Number.MAX_SAFE_INTEGER);
  }
  setNativeLoop(key, values) {
    const channel = this.channels.get(key);
    if (!channel) return;
    if (
      !Number.isInteger(values.loopCount) ||
      values.loopCount < 0 ||
      values.loopCount > 0xffffffff
    )
      throw new Error('Invalid native audio loop count');
    const position = this.position(channel),
      playing = channel.playing;
    this.detach(channel);
    Object.assign(channel, values, {
      offset: position,
      remainingDuration: undefined,
      nativeLoopDynamic: true,
    });
    channel.loop = channel.sourceMode !== 'static' && channel.loopCount !== 1;
    this.configureLoop(channel);
    if (playing) this.startSource(channel);
  }
  swapNativeBanks(first, second) {
    if (first === second) return;
    const a = this.channels.get(first),
      b = this.channels.get(second);
    if (a?.loading || b?.loading)
      throw new Error('Native bank swap requires completed sound loading');
    this.channels.delete(first);
    this.channels.delete(second);
    if (a) {
      a.channel = second;
      this.channels.set(second, a);
    }
    if (b) {
      b.channel = first;
      this.channels.set(first, b);
    }
    this.generations.set(first, (this.generations.get(first) || 0) + 1);
    this.generations.set(second, (this.generations.get(second) || 0) + 1);
  }
  async seek(key, offset) {
    const channel = this.channels.get(key);
    if (!channel || channel.loading) throw new Error(`Audio seek requires a loaded bank ${key}`);
    if (!Number.isFinite(offset) || offset < 0)
      throw new Error('Invalid native audio seek position');
    const playing = channel.playing;
    this.detach(channel);
    channel.offset = this.wrapPosition(channel, offset);
    channel.remainingDuration = undefined;
    channel.pcmOrigin = channel.sourceMode === 'stream' ? channel.offset : 0;
    channel.pcmProgress = channel.sourceMode === 'stream' ? 0 : channel.offset;
    channel.pcmRefills = 0;
    const pcm = this.pcmSources.get(channel.buffer);
    const from =
      Math.floor(channel.pcmOrigin * pcm.sampleRate) * pcm.channels * (pcm.bitsPerSample >>> 3);
    channel.pcmWindows.values.fill(0);
    channel.pcmWindows.fill(
      0,
      pcm.pcm.subarray(from, from + channel.pcmWindows.halfSecondBytes * 8),
      { initial: true },
    );
    if (playing) this.startSource(channel);
  }
  refresh() {
    for (const c of this.channels.values())
      c.gain?.gain.setValueAtTime(this.volume(c), this.context.currentTime);
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
    if (args[0] === 'pause') return this.pause(key);
    if (args[0] === 'replay') return this.replay(key);
    if (args[0] === 'end') return this.fade(c, Number(args[1] ?? 30), c.volume ?? 100, 0, true);
    if (args[0] === 'init' || args[0] === 'stop') return this.stop(key);
    if (args[0] === 'loop') {
      c.loop = Number(args[1]) !== 0;
      if (c.source) c.source.loop = c.loop;
    }
    if (args[0] === 'vol') {
      c.volume = Number(args[1]);
      this.refresh();
    }
    if (args[0] === 'fade') {
      this.fade(
        c,
        Number(args[1] ?? 30),
        args.length > 3 ? Number(args[2]) : (c.volume ?? 100),
        Number(args.at(-1) ?? 0),
      );
    }
  }
  position(channel) {
    const value =
      channel.paused || channel.loading || channel.ended || this.deferPlayback
        ? channel.offset
        : channel.offset +
          Math.max(0, this.context.currentTime - channel.scheduled) * (channel.playbackRate ?? 1);
    return this.wrapPosition(channel, value);
  }
  wrapPosition(channel, value) {
    if (channel.loading) return value;
    if (!channel.loop) return Math.min(channel.duration, value);
    const end = channel.loopEnd ?? channel.duration,
      start = channel.loopStart ?? 0;
    return value < end ? value : start + ((value - end) % (end - start));
  }
  detach(channel) {
    if (!channel.source) return;
    channel.source.onended = null;
    channel.source.stop();
    channel.source.disconnect();
    channel.gain.disconnect();
    channel.panner.disconnect();
    channel.panLeft.disconnect();
    channel.panRight.disconnect();
    channel.merger.disconnect();
    channel.spatialNode?.disconnect();
    channel.spatialNode = null;
    channel.source = channel.gain = channel.panner = null;
  }
  pause(key) {
    const channel = this.channels.get(key);
    if (!channel?.playing) return;
    this.syncNativePCM(channel);
    channel.offset = this.position(channel);
    channel.remainingDuration = this.remaining(channel);
    if (!channel.loading)
      channel.remainingDelay = Math.max(0, channel.scheduled - this.context.currentTime) * this.fps;
    this.detach(channel);
    channel.playing = false;
    channel.paused = true;
  }
  async replay(key) {
    const channel = this.channels.get(key);
    if (!channel?.paused) return;
    channel.paused = false;
    channel.playing = true;
    if (!channel.loading) this.startSource(channel);
    return channel;
  }
  fade(channel, frames, from, to, reset = false) {
    channel.volume = Math.max(0, Math.min(100, from));
    channel.fade = {
      start: this.frame,
      frames: Math.max(0, frames),
      from: channel.volume,
      to: Math.max(0, Math.min(100, to)),
      reset,
    };
    this.setFrame(this.frame);
  }
  setFrame(frame) {
    if (!Number.isSafeInteger(frame) || frame < 0) throw new Error('Invalid audio logical frame');
    this.frame = frame;
    for (const [name, value] of this.defaults)
      if (value.frame !== frame) this.defaults.delete(name);
    for (const [key, channel] of this.channels) {
      this.syncNativePCM(channel);
      if (!channel.fade) continue;
      const motion = channel.fade,
        fraction = motion.frames
          ? Math.max(0, Math.min(1, (frame - motion.start) / motion.frames))
          : 1;
      channel.volume = motion.from + (motion.to - motion.from) * fraction;
      channel.gain?.gain.setValueAtTime(this.volume(channel), this.context.currentTime);
      if (fraction === 1) {
        channel.fade = null;
        if (motion.reset) {
          this.stop(key);
          this.events.push({ channel: key, reason: 'fade-ended', frame });
        }
      }
    }
    this.refresh();
  }
  numeric(text, current = 0, fallback = 0) {
    if (text === undefined) return fallback;
    const source = String(text).replaceAll('@', `(${current})`);
    const value = /^[+-]?(?:\d+(?:\.\d*)?|\.\d+)$/.test(source)
      ? Number(source)
      : evaluate(source, {});
    if (!Number.isFinite(value)) throw new Error(`Invalid sound parameter ${text}`);
    return value;
  }
  async command({ group, banks, verb, args = [] }) {
    if (!['bgm', 'se', 'pcm'].includes(group)) throw new Error(`Unknown sound group ${group}`);
    if (
      banks !== null &&
      (!Array.isArray(banks) || banks.some((bank) => !Number.isSafeInteger(bank) || bank < 0))
    )
      throw new Error('Invalid sound bank selection');
    const prefix = `${group}:`,
      selected =
        banks === null
          ? [...this.channels.keys()]
              .filter((key) => key.startsWith(prefix))
              .map((key) => Number(key.slice(prefix.length)))
          : banks;
    if (verb === 'play' || verb === 'loop') {
      if (!args[0]) throw new Error('Sound playback requires a file');
      const allocated =
        banks === null
          ? [
              (() => {
                let n = 0;
                while (
                  this.channels.get(prefix + n)?.playing ||
                  this.channels.get(prefix + n)?.paused
                )
                  n++;
                return n;
              })(),
            ]
          : banks;
      const output = [];
      for (const bank of allocated) {
        const defaults = this.defaults.get(`${prefix}${bank}`) || this.defaults.get(group);
        const channel = await this.play({
          channel: prefix + bank,
          bank,
          sceneGroup: group,
          group: group === 'pcm' ? 'voice' : group,
          file: args[0],
          loop: verb === 'loop' || group === 'bgm',
          pan: this.numeric(args[1]),
          delay: this.numeric(args[2]),
          volume: defaults?.volume ?? 100,
        });
        if (channel) output.push(this.channelState(prefix + bank, channel));
      }
      return { handled: true, banks: output };
    }
    if (!['init', 'pause', 'replay', 'end', 'vol', 'fade'].includes(verb))
      return { handled: false, reason: `Sound motion ${verb} requires the MOT service` };
    if (verb === 'vol') {
      const volume = Math.max(0, Math.min(100, this.numeric(args[0], 100, 100)));
      if (banks === null) this.defaults.set(group, { volume, frame: this.frame });
      else
        for (const bank of banks) this.defaults.set(prefix + bank, { volume, frame: this.frame });
    }
    for (const bank of selected) {
      const key = prefix + bank,
        channel = this.channels.get(key);
      if (!channel) continue;
      if (verb === 'init') this.stop(key);
      else if (verb === 'pause') this.pause(key);
      else if (verb === 'replay') await this.replay(key);
      else if (verb === 'end')
        this.fade(channel, this.numeric(args[0], 0, 30), channel.volume ?? 100, 0, true);
      else if (verb === 'vol') {
        channel.volume = Math.max(
          0,
          Math.min(100, this.numeric(args[0], channel.volume ?? 100, 100)),
        );
        this.refresh();
      } else if (verb === 'fade') {
        const [frames, from, to] = args.length === 2 ? [30, ...args] : args;
        if (from === undefined || to === undefined)
          throw new Error('Sound fade requires start and end volumes');
        this.fade(
          channel,
          this.numeric(frames, 0, 30),
          this.numeric(from, channel.volume ?? 100),
          this.numeric(to, channel.volume ?? 100),
        );
      }
    }
    return {
      handled: true,
      banks: selected.flatMap((bank) => {
        const key = prefix + bank,
          channel = this.channels.get(key);
        return channel ? [this.channelState(key, channel)] : [];
      }),
    };
  }
  stop(key, invalidate = true) {
    if (invalidate) this.generations.set(key, (this.generations.get(key) || 0) + 1);
    const c = this.channels.get(key);
    this.channels.delete(key);
    if (c) {
      c.playing = false;
      this.detach(c);
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
    const voices = [...this.channels.values()].filter(
      (c) => c.group === 'voice' && (c.playing || c.paused),
    );
    const c = voices.sort((a, b) => b.sequence - a.sequence)[0];
    return c
      ? {
          file: c.file,
          time: this.position(c),
          playing: voices.some((voice) => voice.playing),
          envelope: c.envelope,
          tags: c.tags,
        }
      : {};
  }
  syncNativePCM(channel) {
    if (!channel.pcmWindows || channel.loading) return;
    const now = this.context.currentTime;
    if (channel.playing && !this.deferPlayback)
      channel.pcmProgress +=
        Math.max(0, now - Math.max(channel.pcmClock, channel.scheduled)) *
        (channel.playbackRate ?? 1);
    channel.pcmClock = now;
    if (channel.sourceMode !== 'stream') return;
    const pcm = this.pcmSources.get(channel.buffer),
      state = channel.pcmWindows,
      stride = pcm.channels * (pcm.bitsPerSample >>> 3),
      bytesPerSecond = pcm.sampleRate * stride,
      consumed = Math.floor((channel.pcmProgress * bytesPerSecond) / state.halfSecondBytes);
    if (!channel.nativeLevelProperty) {
      channel.pcmRefills = consumed;
      return;
    }
    while (channel.pcmRefills < consumed) {
      const next = channel.pcmRefills++,
        data = new Uint8Array(state.halfSecondBytes);
      if (pcm.bitsPerSample === 8) data.fill(128);
      for (let at = 0; at < data.length; at += stride) {
        const time =
          channel.pcmOrigin +
          ((next + 8) * state.halfSecondBytes) / bytesPerSecond +
          at / bytesPerSecond;
        if (!channel.loop && time >= channel.duration) break;
        const source = Math.floor(this.wrapPosition(channel, time) * pcm.sampleRate) * stride;
        data.set(
          pcm.pcm.subarray(
            source,
            Math.min(pcm.pcm.length, source + Math.min(stride, data.length - at)),
          ),
          at,
        );
      }
      state.fill((next % 8) * state.halfSecondBytes, data, {
        enabled: !!channel.nativeLevelProperty,
      });
    }
  }
  pcmCursors(channel) {
    const pcm = this.pcmSources.get(channel.buffer),
      state = channel.pcmWindows,
      bytesPerSecond = pcm.sampleRate * pcm.channels * (pcm.bitsPerSample >>> 3),
      capacity = channel.sourceMode === 'stream' ? state.halfSecondBytes * 8 : pcm.pcm.length,
      play = Math.floor(channel.pcmProgress * bytesPerSecond) % capacity,
      latency = this.context.baseLatency || 0;
    return [play, (play + Math.floor(latency * bytesPerSecond)) % capacity];
  }
  nativeLevel(key) {
    const channel = this.channels.get(key);
    if (!channel || channel.loading) return 0;
    this.syncNativePCM(channel);
    return channel.pcmWindows.level(this.pcmCursors(channel)[0], channel.playing);
  }
  setNativeLevelProperty(key, value) {
    const channel = this.channels.get(key);
    if (!channel) return;
    this.syncNativePCM(channel);
    channel.nativeLevelProperty = value >>> 0;
  }
  nativeLevels(key, count) {
    const channel = this.channels.get(key);
    if (!channel || channel.loading) return [];
    this.syncNativePCM(channel);
    return channel.pcmWindows.levels(count, ...this.pcmCursors(channel));
  }
  snapshot() {
    return {
      frame: this.frame,
      sequence: this.sequence,
      master: this.master,
      groups: structuredClone(this.groups),
      defaults: structuredClone([...this.defaults]),
      loopPoints: structuredClone([...this.loopPoints]),
      channels: [...this.channels].map(([key, channel]) => this.channelState(key, channel)),
    };
  }
  channelState(key, c) {
    this.syncNativePCM(c);
    return {
      channel: key,
      bank: c.bank,
      sceneGroup: c.sceneGroup,
      file: c.file,
      loop: c.loop,
      group: c.group,
      volumeFactor: c.volumeFactor,
      nativeSpatial: structuredClone(c.nativeSpatial),
      loopCount: c.loopCount,
      loopStartFrame: c.loopStartFrame,
      loopEndFrame: c.loopEndFrame,
      sourceMode: c.sourceMode,
      nativeLoopDynamic: c.nativeLoopDynamic,
      nativeLevelProperty: c.nativeLevelProperty,
      pcmState: c.pcmWindows
        ? {
            values: c.pcmWindows.snapshot(),
            progress: c.pcmProgress,
            refills: c.pcmRefills,
            origin: c.pcmOrigin,
          }
        : null,
      remainingDuration: this.remaining(c),
      volume: c.volume,
      pan: c.pan || 0,
      offset: this.position(c),
      delay:
        c.paused || c.loading
          ? c.remainingDelay
          : Math.max(0, c.scheduled - this.context.currentTime) * this.fps,
      paused: c.paused,
      ended: !!c.ended,
      fade: structuredClone(c.fade || null),
    };
  }
  async restore(state) {
    this.stopAll();
    this.frame = state.frame;
    this.sequence = state.sequence;
    this.master = state.master;
    this.groups = structuredClone(state.groups);
    this.defaults = new Map(structuredClone(state.defaults));
    this.loopPoints = new Map(structuredClone(state.loopPoints));
    for (const saved of state.channels) {
      const channel = await this.play(saved);
      if (!channel) continue;
      if (saved.paused) this.pause(saved.channel);
      channel.fade = structuredClone(saved.fade);
    }
    this.setFrame(this.frame);
  }
  async dispose() {
    this.stopAll();
    this.buffers.clear();
    await this.context.close();
  }
}
