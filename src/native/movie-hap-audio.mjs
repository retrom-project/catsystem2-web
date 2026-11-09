// SPDX-License-Identifier: MPL-2.0
import { InvalidHap } from './movie-hap.mjs';

const TIME_UNITS = 10000000n;
const referenceTime = (seconds) => BigInt(Math.trunc(seconds * Number(TIME_UNITS)));
const viewOf = (bytes) => new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);

function pcmLayout({ format, packets }) {
  const view = viewOf(format),
    channels = view.getUint16(2, true),
    rate = view.getUint32(4, true),
    align = view.getUint16(12, true),
    bits = view.getUint16(14, true),
    sample = bits / 8;
  if (
    view.getUint16(0, true) !== 1 ||
    ![8, 16, 24, 32].includes(bits) ||
    channels < 1 ||
    channels > 32 ||
    rate < 3000 ||
    rate > 384000 ||
    align !== sample * channels ||
    packets.some((packet) => packet.length % align)
  )
    throw new InvalidHap('Unsupported Hap AVI PCM format');
  const frames = packets.reduce((sum, packet) => sum + packet.length / align, 0);
  return { channels, rate, align, bits, sample, frames };
}

function sampleReader(bits) {
  if (bits === 8) return (view, at) => (view.getUint8(at) - 128) / 128;
  if (bits === 16) return (view, at) => view.getInt16(at, true) / 32768;
  if (bits === 24)
    return (view, at) => (view.getUint16(at, true) | (view.getInt8(at + 2) << 16)) / 8388608;
  return (view, at) => view.getInt32(at, true) / 2147483648;
}

export class NativeHapAudio {
  static create(context, track) {
    const { channels, rate, align, bits, sample, frames } = pcmLayout(track);
    if (!frames) return null;
    if (!context || context.state === 'closed')
      throw new InvalidHap('Hap AVI PCM requires the World audio device');
    const buffer = context.createBuffer(channels, frames, rate),
      planes = Array.from({ length: channels }, (_, channel) => buffer.getChannelData(channel)),
      sampleAt = sampleReader(bits);
    let frame = 0;
    for (const packet of track.packets) {
      const view = viewOf(packet);
      for (let at = 0; at < packet.length; at += align, frame++)
        for (let channel = 0; channel < channels; channel++)
          planes[channel][frame] = sampleAt(view, at + channel * sample);
    }
    return new NativeHapAudio(context, buffer, track.startTime);
  }
  constructor(context, buffer, startTime) {
    Object.assign(this, { context, buffer, startTime });
    this.endTime = startTime + (BigInt(buffer.length) * TIME_UNITS) / BigInt(buffer.sampleRate);
    this.gain = context.createGain();
    this.gain.connect(context.destination);
    this.node = null;
  }
  clock() {
    return referenceTime(this.context.currentTime);
  }
  start(position) {
    if (position >= this.endTime) return this.clock();
    const node = this.context.createBufferSource(),
      delta = Number(position - this.startTime) / Number(TIME_UNITS);
    node.buffer = this.buffer;
    node.connect(this.gain);
    node.onended = () => {
      if (this.node === node) this.node = null;
      node.disconnect();
    };
    try {
      const now = this.context.currentTime;
      node.start(now + Math.max(0, -delta), Math.max(0, delta));
      this.node = node;
      return referenceTime(now);
    } catch (error) {
      node.onended = null;
      node.disconnect();
      throw error;
    }
  }
  stop() {
    const node = this.node;
    if (!node) return;
    this.node = null;
    node.onended = null;
    try {
      node.stop();
    } finally {
      node.disconnect();
    }
  }
  volume(decibels) {
    this.gain.gain.setValueAtTime(10 ** (decibels / 2000), this.context.currentTime);
  }
  close() {
    this.stop();
    this.gain.disconnect();
    this.buffer = null;
  }
}
