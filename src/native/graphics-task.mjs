// SPDX-License-Identifier: MPL-2.0
// Canonical JS Plane message payload.
export class NativeGraphicsPacket {
  #data;
  #view;
  #unwritten = new Set();

  constructor(words = [], { unwritten = [] } = {}) {
    this.#data = new Uint8Array(Math.max(64, words.length * 4));
    this.#view = new DataView(this.#data.buffer);
    for (const index of unwritten) {
      if (!Number.isInteger(index) || index < 0 || (index + 1) * 4 > this.#data.length)
        throw new RangeError('Native graphics packet unwritten word bounds');
      this.#unwritten.add(index);
    }
    words.forEach((word, i) => {
      if (word === undefined) {
        if (!this.#unwritten.has(i))
          throw new Error('Native graphics packet initializer has an unwritten word');
      } else this.#view.setUint32(i * 4, word, true);
    });
  }
  #unknown(address, size) {
    for (const index of this.#unwritten)
      if (index * 4 < address + size && index * 4 + 4 > address) return true;
    return false;
  }
  #requireKnown() {
    if (this.#unwritten.size) throw new Error('Native graphics packet has unwritten words');
  }
  get data() {
    this.#requireKnown();
    return this.#data;
  }
  get view() {
    this.#requireKnown();
    return this.#view;
  }
  load(address) {
    const word = this.#view.getUint32(address, true),
      at = Math.trunc(Number(address)) || 0;
    return this.#unknown(at, 4) ? undefined : word;
  }
  store(address, word) {
    if (word === undefined) throw new Error('Cannot store an unwritten graphics word');
    this.#view.setUint32(address, word, true);
    const at = Math.trunc(Number(address)) || 0;
    for (const index of this.#unwritten)
      if (at <= index * 4 && index * 4 + 4 <= at + 4) this.#unwritten.delete(index);
  }
  bytes(address, size) {
    if (address < 0 || address + size > this.#data.length)
      throw new RangeError('Native graphics packet bounds');
    const bytes = this.#data.subarray(address, address + size),
      at = bytes.byteOffset - this.#data.byteOffset;
    if (this.#unknown(at, bytes.byteLength))
      throw new Error('Native graphics packet bytes include unwritten words');
    // A known slice must not expose unknown words through its backing buffer.
    return this.#unwritten.size ? bytes.slice() : bytes;
  }
}
