// SPDX-License-Identifier: MPL-2.0
import { Binary } from '../binary.mjs';
import { nativePCMLevel } from './sound-values.mjs';

const pcm16 = (sample) => Math.min(32767, Math.max(-32768, Math.round(sample * 32768)));

export function sourcePCM(bytes, metadata, buffer) {
  if (
    metadata.codec === 'wav' &&
    metadata.formatTag === 1 &&
    [8, 16].includes(metadata.bitsPerSample)
  ) {
    const b = new Binary(bytes),
      chunks = [];
    let length = 0;
    for (let at = 12; at + 8 <= bytes.length; ) {
      const size = b.u32(at + 4);
      if (b.str(at, 4) === 'data') {
        chunks.push(b.range(at + 8, size));
        length += size;
      }
      at += 8 + size + (size & 1);
    }
    const pcm = new Uint8Array(length);
    let at = 0;
    for (const chunk of chunks) {
      pcm.set(chunk, at);
      at += chunk.length;
    }
    return {
      pcm,
      channels: metadata.channels,
      bitsPerSample: metadata.bitsPerSample,
      sampleRate: metadata.sampleRate,
      precision: 'source-pcm',
    };
  }
  // Ogg and compressed WAVE are decoded at their source rate. Retain signed
  // interleaved PCM for the native activity query instead of an RMS envelope.
  const channels = buffer.numberOfChannels,
    frames = buffer.length,
    pcm = new Uint8Array(frames * channels * 2),
    view = new DataView(pcm.buffer);
  if (channels === 1) {
    const plane = buffer.getChannelData(0);
    for (let i = 0; i < frames; i++) view.setInt16(i * 2, pcm16(plane[i]), true);
  } else if (channels === 2) {
    const left = buffer.getChannelData(0),
      right = buffer.getChannelData(1);
    for (let i = 0; i < frames; i++) {
      view.setInt16(i * 4, pcm16(left[i]), true);
      view.setInt16(i * 4 + 2, pcm16(right[i]), true);
    }
  } else {
    const planes = Array.from({ length: channels }, (_, channel) => buffer.getChannelData(channel));
    for (let i = 0; i < frames; i++)
      for (let channel = 0; channel < channels; channel++)
        view.setInt16((i * channels + channel) * 2, pcm16(planes[channel][i]), true);
  }
  return {
    pcm,
    channels,
    bitsPerSample: 16,
    sampleRate: buffer.sampleRate,
    precision: 'browser-decoder',
  };
}

// The native device owns an 80-word activity ring. Initial filling always
// populates it; subsequent stream writes change it only when property 96 is set.
// Play and write cursors are supplied by the output backend, as DirectSound's
// GetCurrentPosition does. Keep its forward-copy/early-break behavior intact.
export class NativePCMWindows {
  constructor({ channels, bitsPerSample, sampleRate }) {
    Object.assign(this, { channels, bitsPerSample, sampleRate });
    this.halfSecondBytes = Math.floor((sampleRate * channels * (bitsPerSample >>> 3)) / 2);
    this.windowBytes = Math.floor(this.halfSecondBytes / 10);
    if (!this.windowBytes) throw new Error('Native PCM activity window has zero size');
    this.values = new Uint32Array(80);
  }
  fill(
    offset,
    pcm,
    { initial = false, enabled = false, regionBytes = pcm.length, nativeRefill = false } = {},
  ) {
    if (!initial && !enabled) return;
    const frameBytes = this.channels * (this.bitsPerSample >>> 3);
    let index = initial ? 0 : Math.floor(offset / this.windowBytes);
    if (!initial && nativeRefill) {
      // The owning refill clears the rest of a short locked region after its
      // first window. A zero-byte decode starts clearing with zero consumed,
      // so it also clears the next ring slot after a complete empty region.
      let consumed = 0;
      for (; index < 80; index++) {
        if (pcm.length) {
          const size = Math.min(this.windowBytes, pcm.length - consumed);
          this.values[index] = nativePCMLevel(
            pcm.subarray(consumed, consumed + size),
            this.channels,
            this.bitsPerSample,
          );
          consumed += size;
        } else this.values[index] = 0;
        if (pcm.length < regionBytes) {
          consumed = pcm.length ? this.windowBytes : 0;
          for (let next = index + 1; next < 80 && consumed < regionBytes; next++) {
            consumed += this.windowBytes;
            this.values[next] = 0;
          }
        }
        if (pcm.length <= consumed) break;
      }
      return;
    }
    for (let at = 0; index < 80 && at < regionBytes; at += this.windowBytes, index++) {
      const end = Math.min(pcm.length, at + this.windowBytes);
      // The device's byte-sized windows can split a frame at the end of a clip.
      this.values[index] =
        end - at < frameBytes
          ? 0
          : nativePCMLevel(pcm.subarray(at, end), this.channels, this.bitsPerSample);
    }
  }
  level(playCursor, playing) {
    const index = Math.floor(playCursor / this.windowBytes);
    return playing && index < 80 ? this.values[index] : 0;
  }
  levels(count, playCursor, writeCursor) {
    const result = new Uint32Array(Math.min(count >>> 0, 80));
    let index = Math.floor(playCursor / this.windowBytes);
    const end = Math.floor(writeCursor / this.windowBytes);
    if (index >= 80) return [...result];
    for (let i = 0; i < result.length; i++, index++) {
      if (index >= 80) index = 0;
      result[i] = this.values[index];
      if (index >= end) break;
    }
    return [...result];
  }
  snapshot() {
    return this.values.slice();
  }
  restore(state) {
    if (!(state instanceof Uint32Array) || state.length !== 80)
      throw new Error('Invalid native PCM activity ring');
    this.values.set(state);
  }
}

// A paused stream keeps its decoder and output ring. In particular, changing
// its repeat count after EOF starts decoding into the next reusable region;
// those bytes become audible only when the play cursor reaches that region.
export class NativePCMQueue {
  constructor(source, windows, { progress, origin, refills, count, loopStart }, saved) {
    this.source = source;
    this.windows = windows;
    const half = windows.halfSecondBytes,
      capacity = half * 8,
      bytesPerSecond = source.sampleRate * source.channels * (source.bitsPerSample >>> 3);
    if (saved)
      for (const field of [
        'ring',
        'decoderByte',
        'count',
        'playedBytes',
        'lastCursor',
        'restarts',
        'outputByte',
        'outputStart',
      ])
        this[field] = structuredClone(saved[field]);
    else {
      this.ring = new Uint8Array(capacity);
      if (source.bitsPerSample === 8) this.ring.fill(128);
      const first = Math.max(0, refills - 8);
      for (let slot = 0; slot < 8; slot++) {
        const latest = first + ((slot - (first % 8) + 8) % 8),
          from =
            Math.round(origin * bytesPerSecond) + (latest < refills ? latest + 8 : slot) * half,
          bytes = source.pcm.subarray(from, from + half);
        this.ring.set(bytes, slot * half);
      }
      this.decoderByte = source.pcm.length;
      this.playedBytes = (refills * half) >>> 0;
      this.lastCursor = (refills % 8) * half;
      this.restarts = 0;
      this.outputByte = Math.round(origin * bytesPerSecond) + (refills + 8) * half;
      this.outputStart = loopStart;
    }
    if (
      !(this.ring instanceof Uint8Array) ||
      this.ring.length !== capacity ||
      this.lastCursor >= capacity ||
      this.decoderByte > source.pcm.length ||
      !Number.isFinite(progress)
    )
      throw new Error('Invalid native PCM queue checkpoint');
    this.count = count;
  }
  refill(index, cursor, { loopStart, loopEnd, activity, property }) {
    const half = this.windows.halfSecondBytes,
      offset = (index % 8) * half,
      silence = this.source.bitsPerSample === 8 ? 128 : 0;
    if (activity) this.windows.values[index % 8] = 0;
    let written = 0;
    while (written < half) {
      const length = Math.min(half - written, Math.max(0, loopEnd - this.decoderByte)),
        bytes = this.source.pcm.subarray(this.decoderByte, this.decoderByte + length);
      this.ring.fill(silence, offset + written, offset + half);
      this.ring.set(bytes, offset + written);
      if (activity)
        this.windows.fill(offset + written, bytes, {
          enabled: !!property,
          regionBytes: half - written,
          nativeRefill: true,
        });
      written += bytes.length;
      this.decoderByte += bytes.length;
      if (written === half || this.count === 1) break;
      if (loopStart >= loopEnd) throw new Error('Native PCM queue has an empty loop');
      if (this.count) this.count--;
      this.decoderByte = loopStart;
      this.restarts = (this.restarts + 1) >>> 0;
    }
    this.playedBytes =
      (this.playedBytes + ((cursor - this.lastCursor + this.ring.length) % this.ring.length)) >>> 0;
    this.lastCursor = cursor;
    if (this.restarts && this.playedBytes >= this.source.pcm.length) {
      this.playedBytes -= this.source.pcm.length;
      this.restarts--;
    }
    return written === 0 && this.playedBytes >= this.source.pcm.length;
  }
  snapshot() {
    return structuredClone({
      ring: this.ring,
      decoderByte: this.decoderByte,
      count: this.count,
      playedBytes: this.playedBytes,
      lastCursor: this.lastCursor,
      restarts: this.restarts,
      outputByte: this.outputByte,
      outputStart: this.outputStart,
    });
  }
}
