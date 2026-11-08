// SPDX-License-Identifier: MPL-2.0
// Native MT19937 uses the pre-2002 69069 initializer, not init_genrand(1812433253).
export class NativeMT19937 {
  constructor(seed = 4357) {
    this.localWords = new Uint32Array(624);
    this.seed(seed);
  }
  get words() {
    return this.stateBinding ? this.stateBinding.words() : this.localWords;
  }
  get index() {
    return this.stateBinding ? this.stateBinding.getIndex() : this.localIndex;
  }
  set index(value) {
    if (this.stateBinding) this.stateBinding.setIndex(value);
    else this.localIndex = value;
  }
  bindState(provider) {
    if (
      !provider ||
      typeof provider.words !== 'function' ||
      typeof provider.getIndex !== 'function' ||
      typeof provider.setIndex !== 'function' ||
      !(provider.words() instanceof Uint32Array) ||
      provider.words().length !== 624
    )
      throw new TypeError('Native MT19937 requires a complete state provider');
    if (this.stateBinding && this.stateBinding !== provider)
      throw new Error('Native MT19937 already has a state owner');
    this.stateBinding = provider;
  }
  unbindState(provider) {
    if (!this.stateBinding || (provider && this.stateBinding !== provider)) return;
    const state = this.snapshot();
    this.stateBinding = null;
    this.localWords.set(state.words);
    this.localIndex = state.index;
  }
  seed(seed) {
    const words = this.words;
    let n = seed >>> 0;
    for (let i = 0; i < 624; i++) {
      const high = n & 0xffff0000;
      n = (Math.imul(69069, n) + 1) >>> 0;
      words[i] = high | (n >>> 16);
      n = (Math.imul(69069, n) + 1) >>> 0;
    }
    this.index = 624;
  }
  nextUint32() {
    let index = this.index;
    if (index === 625) {
      this.seed(4357);
      index = 624;
    }
    const mt = this.words;
    if (index >= 624) {
      for (let i = 0; i < 624; i++) {
        const y = ((mt[i] & 0x80000000) | (mt[(i + 1) % 624] & 0x7fffffff)) >>> 0;
        mt[i] = mt[(i + 397) % 624] ^ (y >>> 1) ^ (y & 1 ? 0x9908b0df : 0);
      }
      index = 0;
    }
    let y = mt[index];
    this.index = index + 1;
    y ^= y >>> 11;
    y ^= (y << 7) & 0x9d2c5680;
    y ^= (y << 15) & 0xefc60000;
    return (y ^ (y >>> 18)) >>> 0;
  }
  snapshot() {
    const index = this.index;
    return { index, words: Array.from(this.words) };
  }
  restore(snapshot) {
    if (
      !Number.isInteger(snapshot?.index) ||
      snapshot.index < 0 ||
      snapshot.index > 625 ||
      snapshot.words?.length !== 624 ||
      snapshot.words.some((n) => !Number.isInteger(n) || n < 0 || n > 0xffffffff)
    )
      throw new TypeError('Invalid native MT19937 snapshot');
    this.words.set(snapshot.words);
    this.index = snapshot.index;
  }
}

// The engine shares each stream across emitters; integer and float calls do not
// consume each other's stream. The runtime supplies the game's startup seeds.
export class ParticleRandom {
  constructor(integerSeed = 4357, floatSeed = integerSeed) {
    this.integer = new NativeMT19937(integerSeed);
    this.real = new NativeMT19937(floatSeed);
  }
  rand() {
    return this.integer.nextUint32();
  }
  frand() {
    return Math.fround(this.real.nextUint32() / 4294967295);
  }
  snapshot() {
    return { integer: this.integer.snapshot(), real: this.real.snapshot() };
  }
  restore(snapshot) {
    this.integer.restore(snapshot.integer);
    this.real.restore(snapshot.real);
  }
}
