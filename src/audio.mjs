// SPDX-License-Identifier: MPL-2.0
import { Binary } from './binary.mjs';
import { evaluate } from './fes/expression.mjs';
import { readLoopPoints } from './native/loop-points.mjs';
import { nativeSoundGain, nativeLoopFrames } from './native/sound-math.mjs';
import { readAudioSource } from './native/audio-source.mjs';
import { nativeSoundPanGains, nativeSoundPositionPan } from './native/sound-values.mjs';
import { spatialPlaybackRate } from './native/audio-spatial.mjs';
import {
  sourcePCM,
  decodeNativeMSADPCM,
  NativePCMWindows,
  NativePCMQueue,
} from './native/audio-pcm.mjs';

const isVoice = (channel) =>
  channel.group === 'voice' || (channel.group === 'native' && channel.nativeCategory === 'voice');
const nativeCategories = new Set([null, 'bgm', 'se', 'voice', 'sysvoice']);
const validNativeCompletion = (channel) =>
  channel.nativeCompleted === undefined ||
  (channel.nativeCompleted === true &&
    channel.nativeBufferPlayback === true &&
    channel.ended === true);
const validNativeDrain = (channel) =>
  channel.nativeDraining === undefined ||
  channel.nativeDraining === false ||
  (channel.nativeDraining === true &&
    channel.nativeBufferPlayback === true &&
    channel.sourceMode === 'stream' &&
    Number.isInteger(channel.nativeStreamEnd) &&
    channel.nativeStreamEnd >= 0 &&
    Number.isInteger(channel.nativeDrainEnd) &&
    channel.nativeDrainEnd >= channel.nativeStreamEnd &&
    channel.remainingDuration === 0 &&
    channel.pcmState?.values instanceof Uint32Array &&
    channel.pcmState.values.length === 80 &&
    Number.isFinite(channel.pcmState.progress) &&
    channel.pcmState.progress >= 0);
const validNativeQueue = (channel) => {
  const queue = channel.nativeStreamQueue;
  return (
    queue === undefined ||
    queue === null ||
    (channel.nativeBufferPlayback === true &&
      channel.sourceMode === 'stream' &&
      channel.nativeDraining !== true &&
      queue.ring instanceof Uint8Array &&
      queue.ring.length >= 8 &&
      queue.ring.length % 8 === 0 &&
      [
        'decoderByte',
        'count',
        'playedBytes',
        'lastCursor',
        'restarts',
        'outputByte',
        'outputStart',
      ].every((field) => Number.isSafeInteger(queue[field]) && queue[field] >= 0) &&
      queue.count <= 0xffffffff &&
      queue.lastCursor < queue.ring.length &&
      (queue.prefixRemaining === undefined ||
        (Number.isSafeInteger(queue.prefixRemaining) && queue.prefixRemaining >= 0)) &&
      channel.pcmState?.values instanceof Uint32Array &&
      channel.pcmState.values.length === 80 &&
      Number.isFinite(channel.pcmState.progress) &&
      channel.pcmState.progress >= 0)
  );
};
const validNativeDecoderBuffer = (channel) => {
  const state = channel.nativeDecoderBuffer;
  return (
    state === undefined ||
    state === null ||
    (state.mode === channel.sourceMode &&
      ['stream', 'static'].includes(state.mode) &&
      Number.isSafeInteger(state.capacity) &&
      state.capacity > 0 &&
      state.capacity <= 0xffffffff &&
      Number.isSafeInteger(state.prefixBytes) &&
      state.prefixBytes >= 0 &&
      Number.isSafeInteger(state.remainingPrefix) &&
      state.remainingPrefix >= 0 &&
      state.activity instanceof Uint32Array &&
      state.activity.length === 80 &&
      (state.mode !== 'stream' ||
        validNativeQueue({
          ...channel,
          pcmState: { values: state.activity, progress: 0 },
          nativeStreamQueue: state.queue,
        })))
  );
};
const validTags = (tags) => {
  if (tags === null) return true;
  if (!tags || Object.getPrototypeOf(tags) !== Object.prototype) return false;
  return Reflect.ownKeys(tags).every((key) => {
    const field = Object.getOwnPropertyDescriptor(tags, key);
    return (
      typeof key === 'string' &&
      field.enumerable &&
      Object.hasOwn(field, 'value') &&
      Number.isFinite(field.value) &&
      field.value >= 0 &&
      field.value <= 0xffffffff / 1000
    );
  });
};

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
    this.nativeDecoderBuffers = new Map();
    this.nativeMSADPCM = false;
  }
  configureNativeCodecs({ msADPCM = false } = {}) {
    this.nativeMSADPCM = msADPCM;
  }
  pcmBuffer(
    pcm,
    data = pcm.pcm,
    frames = data.length / (pcm.channels * (pcm.bitsPerSample >>> 3)),
  ) {
    const buffer = this.context.createBuffer(pcm.channels, frames, pcm.sampleRate),
      view = new DataView(data.buffer, data.byteOffset, data.byteLength),
      stride = pcm.channels * (pcm.bitsPerSample >>> 3);
    for (let channel = 0; channel < pcm.channels; channel++) {
      const plane = buffer.getChannelData(channel);
      for (let frame = 0; frame < data.length / stride; frame++)
        plane[frame] =
          pcm.bitsPerSample === 8
            ? (data[frame * stride + channel] - 128) / 128
            : view.getInt16(frame * stride + channel * 2, true) / 32768;
    }
    return buffer;
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
      if (channel.playing && !channel.loading && !channel.nativeDraining) this.startSource(channel);
  }
  async decodeBuffer(bytes, maxSamples = Infinity) {
    const metadata = this.nativeMSADPCM ? readAudioSource(bytes) : null,
      native = metadata?.formatTag === 2 ? decodeNativeMSADPCM(bytes) : null;
    if (native) {
      const frames = native.advertisedBytes / (native.channels * 2);
      if (frames * native.channels > maxSamples) return null;
      const buffer = this.pcmBuffer(native, native.pcm, frames);
      this.sourceRates.set(buffer, native.sampleRate);
      this.sourceMetadata.set(buffer, {
        ...metadata,
        pcmBytes: native.advertisedBytes,
        sampleFrames: frames,
        durationSeconds: frames / native.sampleRate,
        nativeMSADPCM: true,
      });
      this.pcmSources.set(buffer, native);
      return buffer;
    }
    const rate = sourceSampleRate(bytes),
      decoder =
        rate >= 8000 && rate <= 96000 && typeof OfflineAudioContext !== 'undefined'
          ? new OfflineAudioContext(2, 1, rate)
          : this.context,
      buffer = await decoder.decodeAudioData(bytes.slice().buffer);
    if (buffer.length * buffer.numberOfChannels > maxSamples) return null;
    this.sourceRates.set(buffer, sourceSampleRate(bytes) || buffer.sampleRate);
    this.sourceMetadata.set(buffer, readAudioSource(bytes, buffer));
    const pcm = sourcePCM(bytes, this.sourceMetadata.get(buffer), buffer);
    if (Number.isFinite(maxSamples)) {
      const windows = new NativePCMWindows(pcm);
      windows.fill(0, pcm.pcm.subarray(0, windows.halfSecondBytes * 8), { initial: true });
      pcm.initialWindows = windows.snapshot();
    }
    this.pcmSources.set(buffer, pcm);
    return buffer;
  }
  rememberBuffer(name, buffer) {
    this.buffers.set(name, buffer);
    while (this.buffers.size > 8) this.buffers.delete(this.buffers.keys().next().value);
    return buffer;
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
          const buffer = await this.decodeBuffer(await this.game.require(file));
          return this.rememberBuffer(name, buffer);
        })().finally(() => this.pending.delete(name)),
      );
    return this.pending.get(name);
  }
  async preload(name) {
    const buffer = await this.buffer(name);
    return buffer ? { buffer, metadata: this.sourceMetadata.get(buffer) } : null;
  }
  createNativeDecoderBuffer(key, buffer, pcm, state, file) {
    const windows = new NativePCMWindows(pcm);
    let prepared = buffer;
    if (state.mode === 'stream') {
      if (!state.queue) {
        const queue = new NativePCMQueue(pcm, windows, {
          progress: 0,
          origin: 0,
          refills: 0,
          count: 1,
          loopStart: 0,
          prefixBytes: state.prefixBytes,
        });
        state.queue = queue.snapshot();
        state.remainingPrefix = queue.prefixRemaining ?? 0;
        state.activity = windows.snapshot();
      }
    } else {
      const stride = pcm.channels * (pcm.bitsPerSample >>> 3),
        frames = state.capacity / stride;
      prepared = this.context.createBuffer(pcm.channels, frames, pcm.sampleRate);
      const data = new Uint8Array(state.capacity),
        prefix = Math.min(data.length, state.prefixBytes);
      if (pcm.bitsPerSample === 8) data.fill(128);
      data.set(pcm.pcm.subarray(0, data.length - prefix), pcm.prefixOverwrites ? 0 : prefix);
      const view = new DataView(data.buffer);
      for (let c = 0; c < pcm.channels; c++) {
        const plane = prepared.getChannelData(c);
        for (let i = 0; i < frames; i++)
          plane[i] =
            pcm.bitsPerSample === 8
              ? (data[i * stride + c] - 128) / 128
              : view.getInt16(i * stride + c * 2, true) / 32768;
      }
      const projected = { ...pcm, pcm: data };
      this.pcmSources.set(prepared, projected);
      this.sourceRates.set(prepared, pcm.sampleRate);
      windows.fill(0, data.subarray(0, windows.halfSecondBytes * 8), { initial: true });
      state.remainingPrefix = state.prefixBytes - prefix;
      state.activity = windows.snapshot();
    }
    this.nativeDecoderBuffers.set(key, {
      sourceBuffer: buffer,
      pcm,
      buffer: prepared,
      state,
      file,
    });
    return state;
  }
  validNativeDecoderState(state, mode) {
    return validNativeDecoderBuffer({
      nativeDecoderBuffer: state,
      sourceMode: mode,
      nativeBufferPlayback: true,
    });
  }
  async prepareNativeDecoderBuffer(key, file, mode, milliseconds, saved = null) {
    if (
      saved &&
      !validNativeDecoderBuffer({
        nativeDecoderBuffer: saved,
        sourceMode: mode,
        nativeBufferPlayback: true,
      })
    )
      throw new Error('Invalid native decoder buffer checkpoint');
    const owner = this.nativeDecoderBuffers.get(key),
      buffer = owner?.file === file.toLowerCase() ? owner.sourceBuffer : await this.buffer(file);
    if (!buffer) return null;
    const metadata = this.sourceMetadata.get(buffer),
      pcm = this.pcmSources.get(buffer);
    if (
      !(
        (metadata.codec === 'wav' &&
          metadata.formatTag === 1 &&
          [8, 16].includes(metadata.bitsPerSample) &&
          pcm.precision === 'source-pcm') ||
        (this.nativeMSADPCM && metadata.nativeMSADPCM && pcm.precision === 'native-ms-adpcm')
      )
    )
      throw new Error('Native decoder option requires its owning codec implementation');
    const stride = pcm.channels * (pcm.bitsPerSample >>> 3),
      prefixBytes = Number((BigInt(milliseconds >>> 0) * BigInt(pcm.sampleRate)) / 1000n) * stride,
      state = saved ?? {
        mode,
        capacity:
          mode === 'stream'
            ? Math.floor((pcm.sampleRate * stride) / 2) * 8
            : Number((BigInt(metadata.pcmBytes) + BigInt(prefixBytes)) & 0xffffffffn),
        prefixBytes,
      },
      previous = this.nativeDecoderBuffers.get(key);
    if (
      pcm.precision === 'native-ms-adpcm' &&
      mode === 'stream' &&
      Math.floor((pcm.sampleRate * stride) / 2) % stride
    )
      throw new Error('Native MS ADPCM stream read crossing a PCM frame is unrecovered');
    if (state.capacity % stride) throw new Error('Native decoder buffer splits a PCM frame');
    if (
      previous &&
      previous.sourceBuffer === buffer &&
      previous.state.mode === state.mode &&
      previous.state.capacity === state.capacity &&
      previous.state.prefixBytes === state.prefixBytes
    ) {
      previous.state = state;
      return state;
    }
    try {
      return this.createNativeDecoderBuffer(key, buffer, pcm, state, file.toLowerCase());
    } catch (error) {
      if (error instanceof RangeError || error?.name === 'NotSupportedError') return null;
      throw error;
    }
  }
  resetNativeDecoderBuffer(key, state, channel) {
    const record = this.nativeDecoderBuffers.get(key);
    if (!record) throw new Error('Native decoder buffer has no loaded owner');
    return this.createNativeDecoderBuffer(
      key,
      record.sourceBuffer,
      record.pcm,
      {
        mode: state.mode,
        capacity: state.capacity,
        prefixBytes: channel?.nativeStreamQueue?.prefixRemaining ?? state.remainingPrefix,
      },
      record.file,
    );
  }
  releaseNativeDecoderBuffer(key) {
    this.nativeDecoderBuffers.delete(key);
  }
  async play(sound) {
    if (!validNativeCompletion(sound))
      throw new Error('Invalid native audio completion checkpoint');
    if (!validNativeDrain(sound)) throw new Error('Invalid native audio drain checkpoint');
    if (!validNativeQueue(sound)) throw new Error('Invalid native PCM queue checkpoint');
    if (!validNativeDecoderBuffer(sound))
      throw new Error('Invalid native decoder buffer checkpoint');
    const key = sound.channel,
      generation = (this.generations.get(key) || 0) + 1;
    this.generations.set(key, generation);
    this.stop(key, false);
    if (!sound.file) return;
    const channel = {
      ...sound,
      nativeCategory: sound.nativeCategory ?? null,
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
      completionCount: sound.completionCount ?? 0,
      nativeDraining: !!sound.nativeDraining,
      remainingDuration: sound.remainingDuration,
    };
    if (
      !Number.isInteger(channel.loopCount) ||
      channel.loopCount < 0 ||
      channel.loopCount > 0xffffffff
    )
      throw new Error('Invalid native audio loop count');
    if (
      !Number.isInteger(channel.completionCount) ||
      channel.completionCount < 0 ||
      channel.completionCount > 0xffffffff
    )
      throw new Error('Invalid native audio completion count');
    channel.loop = channel.sourceMode !== 'static' && channel.loopCount !== 1;
    // Reserve the bank before decoding so later guest commands can affect it
    // while browser I/O is pending inside this logical frame.
    this.channels.set(key, channel);
    const owner = sound.nativeDecoderBuffer ? this.nativeDecoderBuffers.get(key) : null;
    let buffer =
      owner?.file === sound.file.toLowerCase() ? owner.sourceBuffer : await this.buffer(sound.file);
    if (!buffer) {
      if (this.channels.get(key) === channel) this.channels.delete(key);
      return;
    }
    if (this.generations.get(key) !== generation || this.context.state === 'closed') return;
    if (sound.nativeDecoderBuffer) {
      const state = await this.prepareNativeDecoderBuffer(
        key,
        sound.file,
        sound.sourceMode,
        0,
        structuredClone(sound.nativeDecoderBuffer),
      );
      if (!state) throw new Error('Native decoder buffer allocation failed during playback');
      channel.nativeDecoderBuffer = state;
      buffer = this.nativeDecoderBuffers.get(key).buffer;
    }
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
    if (pcmFrom === 0 && pcm.initialWindows) channel.pcmWindows.restore(pcm.initialWindows);
    else
      channel.pcmWindows.fill(
        0,
        pcm.pcm.subarray(pcmFrom, pcmFrom + channel.pcmWindows.halfSecondBytes * 8),
        { initial: true },
      );
    if (channel.nativeDecoderBuffer)
      channel.pcmWindows.restore(channel.nativeDecoderBuffer.activity);
    if (sound.pcmState) channel.pcmWindows.restore(sound.pcmState.values);
    this.configureLoop(channel);
    const initialQueue = sound.nativeStreamQueue ?? channel.nativeDecoderBuffer?.queue;
    if (initialQueue || (channel.nativeDraining && channel.loopCount !== 1)) {
      const bytesPerSecond = pcm.sampleRate * pcm.channels * (pcm.bitsPerSample >>> 3);
      channel.nativeStreamQueue = new NativePCMQueue(
        pcm,
        channel.pcmWindows,
        {
          progress: channel.pcmProgress,
          origin: channel.pcmOrigin,
          refills: channel.pcmRefills,
          count: channel.loopCount,
          loopStart: Math.round(channel.loopStart * bytesPerSecond),
        },
        initialQueue,
      );
      channel.nativeDraining = false;
      channel.remainingDuration = null;
    } else channel.nativeStreamQueue = null;
    channel.offset = this.wrapPosition(channel, channel.offset);
    if (channel.nativeDraining)
      channel.playbackRate = channel.nativeSpatial?.enabled
        ? spatialPlaybackRate(channel.nativeSpatial, buffer.sampleRate)
        : 1;
    if (channel.playing && !this.deferPlayback && !channel.nativeDraining)
      this.startSource(channel);
    if (isVoice(channel)) {
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
      if (channel.group === 'native') channel.tags = structuredClone(sound.tags);
      else {
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
    const pcm = this.pcmSources.get(channel.buffer),
      rawQueue = pcm?.prefixOverwrites && channel.nativeStreamQueue;
    source.buffer = rawQueue ? this.pcmBuffer(pcm, rawQueue.ring) : channel.buffer;
    source.loop = !!channel.nativeStreamQueue || !!channel.loop;
    source.loopStart = rawQueue ? 0 : channel.loopStart;
    source.loopEnd = rawQueue ? source.buffer.duration : channel.loopEnd;
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
    const remaining = channel.nativeStreamQueue
      ? null
      : (channel.remainingDuration ??
        (!channel.loop
          ? channel.duration - channel.offset
          : channel.loopCount
            ? channel.loopEnd -
              channel.offset +
              (channel.loopCount - 1) * (channel.loopEnd - channel.loopStart)
            : null));
    channel.remainingDuration = remaining;
    this.setNativeSpatial(channel.channel, { ...channel.nativeSpatial, pan: channel.pan || 0 });
    if (rawQueue) {
      const stride = pcm.channels * (pcm.bitsPerSample >>> 3),
        position = Math.floor((channel.pcmOrigin + channel.pcmProgress) * pcm.sampleRate) * stride;
      source.start(
        channel.scheduled,
        (position % rawQueue.ring.length) / (pcm.sampleRate * stride),
      );
    } else if (channel.nativeStreamQueue) {
      const pcm = this.pcmSources.get(channel.buffer),
        bytesPerSecond = pcm.sampleRate * pcm.channels * (pcm.bitsPerSample >>> 3),
        queue = channel.nativeStreamQueue,
        elapsed = channel.pcmOrigin + channel.pcmProgress - queue.outputByte / bytesPerSecond,
        start = queue.outputStart / bytesPerSecond,
        length = channel.loopEnd - start;
      source.start(
        channel.scheduled + Math.max(0, -elapsed) / channel.playbackRate,
        start + (Math.max(0, elapsed) % length),
      );
    } else source.start(channel.scheduled, channel.offset);
    this.scheduleEnd(channel);
    source.onended = () => {
      if (channel.nativeBufferPlayback && channel.sourceMode === 'stream') {
        this.syncNativePCM(channel);
        this.detach(channel);
        return;
      }
      source.onended = null;
      source.disconnect();
      gain.disconnect();
      panner.disconnect();
      panLeft.disconnect();
      panRight.disconnect();
      merger.disconnect();
      channel.spatialNode?.disconnect();
      channel.spatialNode = null;
      if (channel.nativeBufferPlayback && channel.sourceMode === 'static') {
        channel.completionCount = (channel.completionCount + 1) >>> 0;
        if (channel.loopCount !== 1) {
          if (channel.loopCount) channel.loopCount--;
          channel.offset = 0;
          channel.remainingDelay = 0;
          channel.remainingDuration = undefined;
          this.startSource(channel);
          return;
        }
      }
      if (channel.nativeBufferPlayback) channel.nativeCompleted = true;
      channel.offset = channel.nativeBufferPlayback
        ? 0
        : channel.loop
          ? channel.loopEnd
          : channel.duration;
      channel.playing = false;
      channel.ended = true;
      this.events.push({ channel: channel.channel, reason: 'ended', frame: this.frame });
    };
  }
  volume(channel) {
    if (this.configuration?.voiceMuted?.()) return 0;
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
    if (!channel.source) {
      if (channel.nativeDraining)
        channel.playbackRate = channel.nativeSpatial.enabled
          ? spatialPlaybackRate(channel.nativeSpatial, channel.buffer.sampleRate)
          : 1;
      return;
    }
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
  remaining(channel, time = this.context.currentTime) {
    if (channel.remainingDuration === null || channel.remainingDuration === undefined)
      return channel.remainingDuration;
    if (!channel.playing || channel.loading || this.deferPlayback) return channel.remainingDuration;
    return Math.max(
      0,
      channel.remainingDuration -
        Math.max(0, time - channel.scheduled) * (channel.playbackRate ?? 1),
    );
  }
  scheduleEnd(channel) {
    const remaining = channel.remainingDuration;
    if (
      channel.nativeBufferPlayback &&
      channel.sourceMode === 'stream' &&
      !channel.nativeDraining &&
      !channel.nativeStreamQueue
    ) {
      const pcm = this.pcmSources.get(channel.buffer),
        bytesPerSecond = pcm.sampleRate * pcm.channels * (pcm.bitsPerSample >>> 3);
      channel.nativeStreamEnd =
        remaining === null || remaining === undefined
          ? null
          : Math.round((channel.pcmOrigin + channel.pcmProgress + remaining) * bytesPerSecond);
      channel.nativeDrainEnd =
        channel.nativeStreamEnd === null
          ? null
          : Math.ceil(channel.nativeStreamEnd / channel.pcmWindows.halfSecondBytes) *
            channel.pcmWindows.halfSecondBytes;
    }
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
    const firstDecoder = this.nativeDecoderBuffers.get(first),
      secondDecoder = this.nativeDecoderBuffers.get(second);
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
    this.nativeDecoderBuffers.delete(first);
    this.nativeDecoderBuffers.delete(second);
    if (firstDecoder) this.nativeDecoderBuffers.set(second, firstDecoder);
    if (secondDecoder) this.nativeDecoderBuffers.set(first, secondDecoder);
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
  position(channel, time = this.context.currentTime) {
    if (channel.nativeBufferPlayback && channel.sourceMode === 'stream')
      this.syncNativePCM(channel, time);
    if (channel.nativeDraining) return channel.duration;
    const value =
      channel.paused || channel.loading || channel.ended || this.deferPlayback
        ? channel.offset
        : channel.offset + Math.max(0, time - channel.scheduled) * (channel.playbackRate ?? 1);
    return this.wrapPosition(channel, value);
  }
  wrapPosition(channel, value) {
    if (channel.loading) return value;
    if (channel.nativeDraining) return channel.duration;
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
    if (!channel.loading) {
      channel.pcmClock = this.context.currentTime;
      if (!channel.nativeDraining) this.startSource(channel);
    }
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
    const voices = [...this.channels.values()].filter((c) => isVoice(c) && (c.playing || c.paused));
    const c =
      voices.sort((a, b) => b.sequence - a.sequence)[0] ??
      [...this.channels.values()]
        .filter(
          (channel) =>
            channel.group === 'native' &&
            channel.nativeCategory === 'voice' &&
            channel.ended &&
            !channel.loading,
        )
        .sort((a, b) => b.sequence - a.sequence)[0];
    return c
      ? {
          file: c.file,
          time: c.nativeCompleted && c.ended ? c.duration : this.position(c),
          playing: voices.some((voice) => voice.playing),
          envelope: c.envelope,
          tags: c.tags,
        }
      : {};
  }
  syncNativePCM(channel, now = this.context.currentTime) {
    if (!channel.pcmWindows || channel.loading) return;
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
    if (channel.nativeStreamQueue) {
      const queue = channel.nativeStreamQueue,
        previousRefills = channel.pcmRefills;
      while (channel.pcmRefills < consumed) {
        const next = channel.pcmRefills++,
          cursor =
            channel.pcmRefills === consumed
              ? Math.floor(channel.pcmProgress * bytesPerSecond) % queue.ring.length
              : (channel.pcmRefills * state.halfSecondBytes) % queue.ring.length,
          ended = queue.refill(next, cursor, {
            loopStart: Math.round(channel.loopStart * bytesPerSecond),
            loopEnd: Math.round(channel.loopEnd * bytesPerSecond),
            activity: channel.nativeStreamActivity,
            property: channel.nativeLevelProperty,
          });
        channel.loopCount = queue.count;
        if (ended) {
          this.detach(channel);
          this.resetNativePCM(channel.channel);
          channel.offset = 0;
          channel.playing = false;
          channel.ended = true;
          this.events.push({ channel: channel.channel, reason: 'ended', frame: this.frame });
          break;
        }
      }
      // ADPCM's partial-prefix write can leave a hole containing the previous
      // locked bytes. Present the actual four-second ring, replacing its source
      // at refill boundaries rather than mapping that output onto a file offset.
      if (pcm.prefixOverwrites && previousRefills !== channel.pcmRefills && channel.source) {
        this.detach(channel);
        this.startSource(channel);
      }
      return;
    }
    if (!channel.nativeLevelProperty) {
      channel.pcmRefills = consumed;
      this.settleNativeStream(channel);
      return;
    }
    const remaining = this.remaining(channel, now),
      endByte =
        channel.nativeStreamEnd ??
        (remaining === null || remaining === undefined
          ? Infinity
          : Math.round((channel.pcmOrigin + channel.pcmProgress + remaining) * bytesPerSecond)),
      origin = Math.floor(channel.pcmOrigin * bytesPerSecond),
      loopStart = Math.round(channel.loopStart * bytesPerSecond),
      loopEnd = Math.round(channel.loopEnd * bytesPerSecond);
    while (channel.pcmRefills < consumed) {
      const next = channel.pcmRefills++,
        data = new Uint8Array(state.halfSecondBytes);
      if (pcm.bitsPerSample === 8) data.fill(128);
      const offset = (next % 8) * state.halfSecondBytes,
        refill = (at, bytes) => {
          if (channel.nativeStreamActivity)
            state.fill(offset + at, bytes, {
              enabled: !!channel.nativeLevelProperty,
              regionBytes: data.length - at,
              nativeRefill: true,
            });
        };
      if (channel.nativeStreamActivity) state.values[next % 8] = 0;
      let written = 0;
      while (written < data.length) {
        const logical = origin + (next + 8) * state.halfSecondBytes + written;
        if (logical >= endByte || (!channel.loop && logical >= pcm.pcm.length)) {
          if (!written) refill(0, data.subarray(0, 0));
          break;
        }
        let source = logical;
        if (channel.loop && logical >= loopEnd) {
          if (!written && (logical - loopEnd) % (loopEnd - loopStart) === 0)
            refill(0, data.subarray(0, 0));
          source = loopStart + ((logical - loopEnd) % (loopEnd - loopStart));
        }
        const size = Math.min(
            data.length - written,
            endByte - logical,
            pcm.pcm.length - source,
            channel.loop ? loopEnd - source : Infinity,
          ),
          values = pcm.pcm.subarray(source, source + size);
        refill(written, values);
        data.set(values, written);
        written += values.length;
      }
      if (!channel.nativeStreamActivity)
        state.fill(offset, data.subarray(0, written), {
          enabled: !!channel.nativeLevelProperty,
          regionBytes: data.length,
        });
    }
    this.settleNativeStream(channel);
  }
  settleNativeStream(channel) {
    if (
      !channel.nativeBufferPlayback ||
      !channel.playing ||
      this.deferPlayback ||
      channel.sourceMode !== 'stream' ||
      channel.nativeStreamEnd === null ||
      channel.nativeStreamEnd === undefined
    )
      return;
    const pcm = this.pcmSources.get(channel.buffer),
      position = Math.floor(
        (channel.pcmOrigin + channel.pcmProgress) *
          pcm.sampleRate *
          pcm.channels *
          (pcm.bitsPerSample >>> 3),
      );
    if (position < channel.nativeStreamEnd) return;
    channel.nativeDraining = true;
    if (position < channel.nativeDrainEnd) return;
    this.detach(channel);
    this.resetNativePCM(channel.channel);
    channel.nativeCompleted = true;
    channel.offset = 0;
    channel.playing = false;
    channel.ended = true;
    this.events.push({ channel: channel.channel, reason: 'ended', frame: this.frame });
  }
  nativePlaying(key) {
    const channel = this.channels.get(key);
    if (!channel) return false;
    this.syncNativePCM(channel);
    return channel.playing;
  }
  resetNativePCM(key) {
    const channel = this.channels.get(key);
    if (!channel?.pcmWindows) return;
    if (channel.nativeDecoderBuffer) {
      const state = this.resetNativeDecoderBuffer(key, channel.nativeDecoderBuffer, channel);
      channel.nativeDecoderBuffer = state;
      channel.buffer = this.nativeDecoderBuffers.get(key).buffer;
      channel.pcmWindows.restore(state.activity);
      channel.nativeStreamQueue = state.queue
        ? new NativePCMQueue(
            this.pcmSources.get(channel.buffer),
            channel.pcmWindows,
            { progress: 0, origin: 0, refills: 0, count: 1, loopStart: 0 },
            state.queue,
          )
        : null;
      channel.pcmOrigin = channel.pcmProgress = channel.pcmRefills = 0;
      channel.nativeDraining = false;
      channel.nativeStreamEnd = channel.nativeDrainEnd = null;
      channel.pcmClock = this.context.currentTime;
      return;
    }
    const pcm = this.pcmSources.get(channel.buffer);
    channel.pcmOrigin = channel.pcmProgress = channel.pcmRefills = 0;
    channel.nativeDraining = false;
    channel.nativeStreamQueue = null;
    channel.nativeStreamEnd = channel.nativeDrainEnd = null;
    channel.pcmClock = this.context.currentTime;
    channel.pcmWindows.fill(0, pcm.pcm.subarray(0, channel.pcmWindows.halfSecondBytes * 8), {
      initial: true,
    });
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
  snapshot(time = this.context.currentTime) {
    return {
      frame: this.frame,
      sequence: this.sequence,
      master: this.master,
      groups: structuredClone(this.groups),
      defaults: structuredClone([...this.defaults]),
      loopPoints: structuredClone([...this.loopPoints]),
      // Bank swaps can change Map insertion order without starting playback.
      channels: [...this.channels]
        .sort(([, a], [, b]) => a.sequence - b.sequence)
        .map(([key, channel]) => this.channelState(key, channel, time)),
    };
  }
  channelState(key, c, time = this.context.currentTime) {
    this.syncNativePCM(c, time);
    return {
      channel: key,
      bank: c.bank,
      sceneGroup: c.sceneGroup,
      file: c.file,
      loop: c.loop,
      group: c.group,
      nativeCategory: c.nativeCategory,
      tags: structuredClone(c.tags ?? null),
      volumeFactor: c.volumeFactor,
      nativeSpatial: structuredClone(c.nativeSpatial),
      loopCount: c.loopCount,
      nativeBufferPlayback: c.nativeBufferPlayback,
      nativeStreamActivity: c.nativeStreamActivity,
      nativeStreamEnd: c.nativeStreamEnd,
      nativeDrainEnd: c.nativeDrainEnd,
      nativeDraining: c.nativeDraining,
      nativeStreamQueue: c.nativeStreamQueue?.snapshot() ?? null,
      ...(c.nativeDecoderBuffer
        ? { nativeDecoderBuffer: structuredClone(c.nativeDecoderBuffer) }
        : {}),
      completionCount: c.completionCount,
      ...(c.nativeCompleted ? { nativeCompleted: true } : {}),
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
      remainingDuration: this.remaining(c, time),
      volume: c.volume,
      pan: c.pan || 0,
      offset: this.position(c, time),
      delay: c.paused || c.loading ? c.remainingDelay : Math.max(0, c.scheduled - time) * this.fps,
      paused: c.paused,
      ended: !!c.ended,
      fade: structuredClone(c.fade || null),
    };
  }
  async restore(state) {
    if (state.channels.some((channel) => !validNativeCompletion(channel)))
      throw new Error('Invalid native audio completion checkpoint');
    if (state.channels.some((channel) => !validNativeDrain(channel)))
      throw new Error('Invalid native audio drain checkpoint');
    if (state.channels.some((channel) => !validNativeQueue(channel)))
      throw new Error('Invalid native PCM queue checkpoint');
    if (state.channels.some((channel) => !validNativeDecoderBuffer(channel)))
      throw new Error('Invalid native decoder buffer checkpoint');
    if (
      state.channels.some(
        (channel) =>
          !nativeCategories.has(channel.nativeCategory) ||
          !validTags(channel.tags) ||
          (isVoice(channel) && channel.tags === null),
      )
    )
      throw new Error('Invalid audio playback category in checkpoint');
    this.stopAll();
    this.frame = state.frame;
    // Rebuilding retained channels is not a new playback command. Preserve
    // their relative order below the next real play, without consuming it.
    this.sequence = state.sequence - state.channels.length;
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
    this.nativeDecoderBuffers.clear();
    await this.context.close();
  }
}
