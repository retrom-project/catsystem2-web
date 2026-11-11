// SPDX-License-Identifier: BSD-3-Clause
// Based on motionplayer EmoteWindEmitter; target DLL uses the shared xorshift RNG.
// Original notices: licenses/motionplayer.txt.
const f = Math.fround;
export class EmoteWind {
  constructor(random) {
    this.random = random;
    this.active = new Uint8Array(128);
    this.position = new Float32Array(128);
    this.strength = new Float32Array(128);
    this.start = 0;
    this.end = 0;
    this.velocity = 0;
    this.low = 0;
    this.high = 1;
    this.accumulator = 0;
  }
  configure(start, end, speed, high, low, scale) {
    if (speed < 0) {
      speed = -speed;
      [start, end] = [end, start];
    }
    if (start === end || speed === 0 || (low === 0 && high === 0)) return false;
    if (![start, end, speed, low, high, scale].every(Number.isFinite) || scale === 0)
      throw new Error('Invalid E-mote wind configuration');
    if (start !== this.start || end !== this.end) this.active.fill(0);
    this.start = f(start);
    this.end = f(end);
    this.low = f(low);
    this.high = f(high);
    this.velocity = f((end < start ? -1 : 1) * f(speed / scale));
    this.accumulator = 0;
    return true;
  }
  step(dt) {
    this.accumulator = f(dt + this.accumulator);
    let budget = 100000;
    while (this.accumulator >= 0) {
      if (!--budget) throw new Error('E-mote wind emission budget exceeded');
      if (f(this.random()) < 0.0625) {
        const slot = this.active.indexOf(0);
        if (slot >= 0) {
          this.active[slot] = 1;
          this.position[slot] = this.start;
          this.strength[slot] = f(this.low + f(f(this.high - this.low) * f(this.random())));
        }
      }
      this.accumulator = f(this.accumulator - 1);
    }
    for (let i = 0; i < 128; i++)
      if (this.active[i]) {
        this.position[i] = f(this.position[i] + f(this.velocity * dt));
        if (
          (this.velocity > 0 && this.position[i] > this.end) ||
          (this.velocity < 0 && this.position[i] < this.end)
        )
          this.active[i] = 0;
      }
  }
  force(x) {
    for (let i = 0; i < 128; i++)
      if (this.active[i]) {
        const half = f(f(this.strength[i] * 0.5) * 4);
        if (f(this.position[i] - half) < x && f(this.position[i] + half) > x)
          return f(this.strength[i] * (this.velocity >= 0 ? 1 : -1));
      }
    return 0;
  }
}
