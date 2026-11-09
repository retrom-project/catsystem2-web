// SPDX-License-Identifier: MPL-2.0
import { InvalidHap, decodeHap5, nativeHapMovie } from './movie-hap.mjs';

const VID = 0x63646976;
const HAP5 = 0x35706148;
const DRIVERS = {
  'nekopara-vol3-engine-2.6.1.76': 0x8ef07c,
  'sdk-4.01-engine-2.6.1.74': 0x9b135c,
};

export class NativeHapDriver {
  constructor(engine) {
    this.process = engine.process;
    this.vtable = DRIVERS[engine.profile];
    this.path = null;
    engine.registerWindows('MSVFW32.dll', 'ICInstall', {
      count: 5,
      fn: (args) => this.install(...args),
    });
    engine.registerWindows('MSVFW32.dll', 'ICRemove', {
      count: 3,
      fn: (args) => this.remove(...args),
    });
  }
  install(type, handler, path, _description, flags) {
    if (type !== VID || handler !== HAP5 || flags !== 2 || !path) return 0;
    // ICInstall is an ANSI API. The game's UTF-16 pointer supplies only the
    // first character of its path, while the SDK converts the whole string.
    this.path = this.process.string(path);
    return 1;
  }
  remove(type, handler, flags) {
    if (type !== VID || handler !== HAP5 || flags || this.path === null) return 0;
    this.path = null;
    return 1;
  }
  matches(movie) {
    const p = this.process,
      loader = p.load(movie + 424);
    return Boolean(
      this.vtable && p.allocations.get(loader) === 12 && p.load(loader) === this.vtable,
    );
  }
  available() {
    return /(?:^|\/)dsfilter\/hapcodec\.dll$/i.test(this.path?.replaceAll('\\', '/') ?? '');
  }
}

export class NativeHapPlayback {
  constructor({ clock, diagnostic }) {
    this.clock = clock;
    this.diagnostic = diagnostic;
    this.time = 0n;
    this.anchor = null;
  }
  open(filename, { bytes }) {
    try {
      const clip = nativeHapMovie(bytes);
      if (clip.audio) throw new InvalidHap('Hap5 AVI audio delivery is unavailable');
      decodeHap5(
        clip.packets.find((packet) => packet.length),
        clip.width,
        clip.height,
      );
      this.clip = clip;
      return true;
    } catch (error) {
      if (!(error instanceof InvalidHap)) throw error;
      this.diagnostic?.({ type: 'movie-codec-unavailable', filename, message: error.message });
      return false;
    }
  }
  metadata() {
    const { width, height, duration } = this.clip;
    return { width, height, duration, alpha: true };
  }
  position() {
    const time = this.anchor === null ? this.time : this.time + this.clock() - this.anchor;
    return time >= this.clip.duration ? this.clip.duration : time;
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
    this.anchor ??= this.clock();
    return true;
  }
  stop() {
    this.time = this.position();
    this.anchor = null;
    return true;
  }
  seek(time) {
    this.time = time;
    if (this.anchor !== null) this.anchor = this.clock();
  }
  advance() {
    if (this.anchor === null || this.position() < this.clip.duration) return;
    this.stop();
    this.ended?.();
  }
  volume() {
    // This adapter accepts video-only AVI streams.
  }
  close() {
    this.anchor = null;
    this.clip = null;
  }
}
