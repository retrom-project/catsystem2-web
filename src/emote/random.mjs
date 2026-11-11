// SPDX-License-Identifier: MPL-2.0
// Reviewed DLL xorshift128: low 23 bits form a canonical float mantissa.
export class EmoteRandom {
  constructor(seed = 0) {
    this.words = Uint32Array.of(123456789, 362436069, 521288629, seed >>> 0);
  }
  next() {
    const words = this.words,
      t = (words[0] ^ (words[0] << 11)) >>> 0,
      w = words[3];
    words[0] = words[1];
    words[1] = words[2];
    words[2] = w;
    words[3] = (w ^ (w >>> 19) ^ t ^ (t >>> 8)) >>> 0;
    return (
      (words[3] & 0x7fffff) /* exe-address-check: non-address - IEEE754 fraction mask */ /
      8388608 /* exe-address-check: non-address - canonical fraction denominator 2^23 */
    );
  }
  snapshot() {
    return { words: [...this.words] };
  }
  restore(state) {
    if (
      state?.words?.length !== 4 ||
      state.words.some((word) => !Number.isInteger(word) || word < 0 || word > 0xffffffff)
    )
      throw new Error('Invalid E-mote random state');
    this.words.set(state.words);
  }
}
