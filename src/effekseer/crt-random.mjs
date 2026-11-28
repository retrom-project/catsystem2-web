// SPDX-License-Identifier: MPL-2.0
// Logical task-thread CRT state. The 76 wrapper's random callback uses _rand,
// not the independent MT streams used by other CatSystem2 features.
const uint32 = (value, name) => {
  if (!Number.isInteger(value) || value < 0 || value > 0xffffffff)
    throw new RangeError(`Invalid CRT ${name}`);
  return value;
};
const count = (value, name) => {
  if (!Number.isSafeInteger(value) || value < 0) throw new RangeError(`Invalid CRT ${name}`);
  return value;
};

export class LogicalThreadCRT {
  constructor(seed = 1) {
    // _initptd initializes the child logical thread's rand state to one.
    this.state = uint32(seed, 'initial seed');
    this.calls = 0;
    this.seedCalls = 0;
  }
  nextInt() {
    if (this.calls === Number.MAX_SAFE_INTEGER) throw new RangeError('CRT draw counter overflow');
    this.state = (Math.imul(this.state, 214013) + 2531011) >>> 0;
    this.calls++;
    return (this.state >>> 16) & 0x7fff;
  }
  seed(seed) {
    uint32(seed, 'seed');
    if (this.seedCalls === Number.MAX_SAFE_INTEGER)
      throw new RangeError('CRT seed counter overflow');
    this.state = seed;
    this.seedCalls++;
  }
  snapshot() {
    return { state: this.state, calls: this.calls, seedCalls: this.seedCalls };
  }
  restore(saved) {
    if (!saved || typeof saved !== 'object') throw new TypeError('Invalid CRT checkpoint');
    const state = uint32(saved.state, 'state'),
      calls = count(saved.calls, 'draw count'),
      seedCalls = count(saved.seedCalls, 'seed count');
    Object.assign(this, { state, calls, seedCalls });
  }
}
