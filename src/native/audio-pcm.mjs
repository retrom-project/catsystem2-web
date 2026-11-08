// SPDX-License-Identifier: MPL-2.0
import { Binary } from '../binary.mjs';
import { nativePCMLevel } from './sound-values.mjs';

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
    view = new DataView(pcm.buffer),
    planes = Array.from({ length: channels }, (_, channel) => buffer.getChannelData(channel));
  for (let i = 0; i < frames; i++)
    for (let channel = 0; channel < channels; channel++)
      view.setInt16(
        (i * channels + channel) * 2,
        Math.min(32767, Math.max(-32768, Math.round(planes[channel][i] * 32768))),
        true,
      );
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
  fill(offset, pcm, { initial = false, enabled = false, regionBytes = pcm.length } = {}) {
    if (!initial && !enabled) return;
    let index = initial ? 0 : Math.floor(offset / this.windowBytes);
    for (let at = 0; index < 80 && at < regionBytes; at += this.windowBytes, index++)
      this.values[index] =
        at >= pcm.length
          ? 0
          : nativePCMLevel(
              pcm.subarray(at, Math.min(pcm.length, at + this.windowBytes)),
              this.channels,
              this.bitsPerSample,
            );
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
