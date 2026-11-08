// SPDX-License-Identifier: MPL-2.0
// One system clock is shared by the VM, the original engine and its DLLs.
const fileTimeEpoch = 11644473600000n;
const gcd = (a, b) => {
  a = a < 0n ? -a : a;
  while (b) [a, b] = [b, a % b];
  return a;
};
function fraction(numerator, denominator = 1n) {
  const divisor = gcd(numerator, denominator);
  return { numerator: numerator / divisor, denominator: denominator / divisor };
}
function fromNumber(value) {
  if (typeof value !== 'number' || !Number.isFinite(value))
    throw new TypeError('Native clock requires a finite millisecond value');
  if (Number.isSafeInteger(value)) return fraction(BigInt(value));
  const bits = new DataView(new ArrayBuffer(8));
  bits.setFloat64(0, value, false);
  const raw = bits.getBigUint64(0, false),
    exponent = Number((raw >> 52n) & 0x7ffn),
    mantissa = (raw & 0xfffffffffffffn) | (exponent ? 0x10000000000000n : 0n),
    shift = (exponent || 1) - 1075,
    signed = raw >> 63n ? -mantissa : mantissa;
  return shift >= 0 ? fraction(signed << BigInt(shift)) : fraction(signed, 1n << BigInt(-shift));
}
const add = (a, b) =>
  fraction(
    a.numerator * b.denominator + b.numerator * a.denominator,
    a.denominator * b.denominator,
  );
const subtract = (a, b) => add(a, { ...b, numerator: -b.numerator });
const number = ({ numerator, denominator }) =>
  Number(numerator / denominator) +
  Number((numerator % denominator << 53n) / denominator) / 2 ** 53;
function savedFraction(value) {
  if (
    typeof value?.numerator !== 'bigint' ||
    typeof value?.denominator !== 'bigint' ||
    value.denominator <= 0n
  )
    throw new Error('Invalid native clock checkpoint');
  return fraction(value.numerator, value.denominator);
}

export class NativeSystemClock {
  constructor({ now = null, utcNow = Date.now } = {}) {
    if (now !== null && typeof now !== 'function')
      throw new TypeError('Native external clock requires a millisecond provider');
    if (typeof utcNow !== 'function') throw new TypeError('Native UTC clock requires a provider');
    this.external = now;
    this.lastExternal = now ? fromNumber(now()) : null;
    this.elapsed = this.lastExternal ?? fraction(0n);
    if (this.elapsed.numerator < 0n)
      throw new Error('Native monotonic clock cannot start negative');
    this.utcOrigin = subtract(fromNumber(utcNow()), this.elapsed);
  }
  sample() {
    if (this.external) {
      const current = fromNumber(this.external());
      let delta = subtract(current, this.lastExternal);
      if (delta.numerator < 0n) {
        // A host may expose the original DWORD timer. Unwrap its rollover for
        // QPC/UTC while keeping timeGetTime/GetTickCount modulo 2^32.
        const old = number(this.lastExternal),
          next = number(current);
        if (old >= 0 && old < 2 ** 32 && next >= 0 && next < 2 ** 32 && old - next > 2 ** 31)
          delta = add(delta, fraction(1n << 32n));
        else throw new Error('Native external millisecond clock moved backwards');
      }
      this.elapsed = add(this.elapsed, delta);
      this.lastExternal = current;
    }
    return this.elapsed;
  }
  advance(fps) {
    if (this.external) return this.now();
    if (!Number.isInteger(fps) || fps <= 0 || fps > 0xffffffff)
      throw new Error('Native virtual clock requires a positive FPS or an external clock');
    this.elapsed = add(this.elapsed, fraction(1000n, BigInt(fps)));
    return this.now();
  }
  now() {
    return number(this.sample());
  }
  get epoch() {
    return number(this.utcOrigin);
  }
  utcNow() {
    return number(add(this.utcOrigin, this.sample()));
  }
  tickCount() {
    const { numerator, denominator } = this.sample();
    return Number(BigInt.asUintN(32, numerator / denominator));
  }
  performanceCounter() {
    const { numerator, denominator } = this.sample();
    return (numerator * 1000n) / denominator;
  }
  fileTime() {
    const { numerator, denominator } = add(this.utcOrigin, this.sample());
    return fileTimeEpoch * 10000n + (numerator * 10000n) / denominator;
  }
  snapshot() {
    return { elapsed: { ...this.sample() }, utcOrigin: { ...this.utcOrigin } };
  }
  restore(state) {
    const elapsed = savedFraction(state?.elapsed),
      utcOrigin = savedFraction(state?.utcOrigin);
    if (elapsed.numerator < 0n) throw new Error('Invalid native monotonic clock checkpoint');
    const external = this.external ? fromNumber(this.external()) : null;
    this.elapsed = elapsed;
    this.utcOrigin = utcOrigin;
    this.lastExternal = external;
  }
}
