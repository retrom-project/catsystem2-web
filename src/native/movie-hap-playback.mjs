// SPDX-License-Identifier: MPL-2.0
import { InvalidHap, decodeHap5, nativeHapMovie } from './movie-hap.mjs';
import { NativeHapAudio } from './movie-hap-audio.mjs';

export class NativeHapPlayback {
  constructor({ clock, diagnostic, audioContext }) {
    this.clock = clock;
    this.diagnostic = diagnostic;
    this.audioContext = audioContext;
    this.time = 0n;
    this.anchor = null;
  }
  open(filename, { bytes }) {
    try {
      const clip = nativeHapMovie(bytes);
      decodeHap5(
        clip.packets.find((packet) => packet.length),
        clip.width,
        clip.height,
      );
      this.audio = clip.audio && NativeHapAudio.create(this.audioContext, clip.audio);
      this.clip = clip;
      this.duration =
        this.audio && this.audio.endTime > clip.duration ? this.audio.endTime : clip.duration;
      return true;
    } catch (error) {
      if (!(error instanceof InvalidHap)) throw error;
      this.diagnostic?.({ type: 'movie-codec-unavailable', filename, message: error.message });
      return false;
    }
  }
  metadata() {
    const { width, height } = this.clip;
    return { width, height, duration: this.duration, alpha: true };
  }
  now() {
    return this.audio ? this.audio.clock() : this.clock();
  }
  position() {
    const time = this.anchor === null ? this.time : this.time + this.now() - this.anchor;
    return time >= this.duration ? this.duration : time;
  }
  frameStamp() {
    const { startTime, scale, rate, packets } = this.clip,
      position = this.position(),
      time = position > startTime ? position - startTime : 0n,
      frame = Number((time * BigInt(rate)) / (BigInt(scale) * 10000000n));
    return Math.min(frame, packets.length - 1);
  }
  decodedFrame() {
    const { width, height, packets } = this.clip;
    let index = this.frameStamp();
    while (index >= 0 && packets[index].length === 0) index--;
    const frame =
      index >= 0
        ? decodeHap5(packets[index], width, height)
        : { width, height, rgba: new Uint8Array(width * height * 4) };
    return { ...frame, alpha: true };
  }
  play() {
    if (this.anchor !== null) return true;
    if (this.audio?.context.state === 'closed') return false;
    this.anchor = this.audio?.start(this.time) ?? this.clock();
    return true;
  }
  stop() {
    this.time = this.position();
    this.anchor = null;
    this.audio?.stop();
    return true;
  }
  seek(time) {
    if (this.anchor !== null) {
      this.audio?.stop();
      this.anchor = this.audio?.start(time) ?? this.clock();
    }
    this.time = time;
  }
  advance() {
    if (this.anchor === null || this.position() < this.duration) return;
    this.stop();
    this.ended?.();
  }
  volume(decibels) {
    this.audio?.volume(decibels);
  }
  close() {
    this.anchor = null;
    this.clip = null;
    this.audio?.close();
    this.audio = null;
  }
}
