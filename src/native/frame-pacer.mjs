// SPDX-License-Identifier: MPL-2.0
// A host supplies actual cooperative-wait returns, never inferred wait counts.
// Ordinary game Frame, the delayed raw step and system time are independent.
const mask64 = (1n << 64n) - 1n;
const word = (value) => Number.isInteger(value) && value >= 0 && value <= 0xffffffff;

export class NativeFramePacer {
  #wait = null;
  #dispatch = null;
  #suspended = false;
  #closed = false;

  constructor({ rate, noSkip = false, tickCount }) {
    if (!word(rate) || !rate || typeof noSkip !== 'boolean' || !word(tickCount))
      throw new Error('Native pacing requires an explicit rate, mode and timer word');
    this.rate = rate;
    this.noSkip = noSkip;
    this.divisor = (1000n << 32n) / BigInt(rate);
    this.timerAnchor = tickCount;
    this.elapsedFrame = 0;
    this.frameWord = 1;
    this.waitCount = 0n;
    this.pendingStep = 0;
    this.iteration = 0;
  }
  get dispatchPending() {
    return this.#dispatch !== null;
  }
  get waiting() {
    return this.#wait !== null;
  }
  get suspended() {
    return this.#suspended;
  }
  bucket(tickCount) {
    return (BigInt(tickCount) << 32n) / this.divisor;
  }
  beginWait() {
    if (this.#wait || this.#dispatch || this.#suspended || this.#closed)
      throw new Error('Native pacing requires a single active host wait');
    return (this.#wait = Object.freeze({}));
  }
  observe(wait, tickCount, { paused = false } = {}) {
    if (!wait || wait !== this.#wait || !word(tickCount) || typeof paused !== 'boolean')
      throw new Error('Native pacing requires its actual wait return and timer sample');
    this.#wait = null;
    const before = this.bucket(this.timerAnchor),
      after = this.bucket(tickCount);
    if (before === after) {
      this.waitCount = (this.waitCount + 1n) & mask64;
      return null;
    }
    if (!paused) {
      const difference = BigInt.asUintN(64, after - before),
        scaled = Number(BigInt.asUintN(32, 60n * difference));
      this.elapsedFrame = (this.elapsedFrame + Math.floor(scaled / this.rate)) >>> 0;
    }
    this.timerAnchor = tickCount;
    if (this.noSkip) {
      if (!paused) this.frameWord = (this.frameWord + Math.floor(60 / this.rate)) >>> 0;
    } else this.frameWord = this.elapsedFrame;
    return (this.#dispatch = Object.freeze({
      frameWord: this.frameWord,
      rawStep: this.pendingStep,
      iteration: (this.iteration + 1) >>> 0,
    }));
  }
  owns(dispatch) {
    return !!dispatch && dispatch === this.#dispatch;
  }
  complete(dispatch) {
    if (!this.owns(dispatch)) throw new Error('Native pacing requires its pending dispatch');
    this.pendingStep = (Number((this.waitCount >> 2n) & 0xffffffffn) + 1) >>> 0;
    this.waitCount &= 3n;
    this.iteration = dispatch.iteration;
    this.#dispatch = null;
  }
  suspend() {
    if (this.#dispatch) throw new Error('Native pacing suspension requires a settled dispatch');
    this.#wait = null;
    this.#suspended = true;
  }
  resume(tickCount) {
    if (this.#closed) throw new Error('Native pacing owner is closed');
    if (!word(tickCount)) throw new Error('Native pacing resume requires its timer word');
    if (!this.#suspended) return;
    // Host suspension produces no hidden waits. This does not implement the
    // native pause argument, which still observes every actual wait return.
    this.timerAnchor = tickCount;
    this.#suspended = false;
  }
  snapshot() {
    if (this.#closed) throw new Error('Native pacing owner is closed');
    if (this.#dispatch) throw new Error('Native pacing checkpoint requires a settled dispatch');
    // A pending host callback is an external lease, not a completed observation.
    return {
      rate: this.rate,
      noSkip: this.noSkip,
      timerAnchor: this.timerAnchor,
      elapsedFrame: this.elapsedFrame,
      frameWord: this.frameWord,
      waitCount: this.waitCount,
      pendingStep: this.pendingStep,
      iteration: this.iteration,
    };
  }
  close() {
    this.#wait = null;
    this.#dispatch = null;
    this.#closed = true;
  }
  static restore(state) {
    if (
      !state ||
      !['timerAnchor', 'elapsedFrame', 'frameWord', 'pendingStep', 'iteration'].every((key) =>
        word(state[key]),
      ) ||
      typeof state.waitCount !== 'bigint' ||
      state.waitCount < 0n ||
      state.waitCount > mask64
    )
      throw new Error('Invalid native pacing checkpoint');
    const pacer = new NativeFramePacer({
      rate: state.rate,
      noSkip: state.noSkip,
      tickCount: state.timerAnchor,
    });
    for (const key of ['elapsedFrame', 'frameWord', 'waitCount', 'pendingStep', 'iteration'])
      pacer[key] = state[key];
    return pacer;
  }
}
