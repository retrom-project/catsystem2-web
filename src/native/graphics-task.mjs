// SPDX-License-Identifier: MPL-2.0
// Canonical JS Plane message payload.
export class NativeGraphicsPacket {
  constructor(words = []) {
    this.data = new Uint8Array(Math.max(64, words.length * 4));
    this.view = new DataView(this.data.buffer);
    words.forEach((word, i) => this.store(i * 4, word));
  }
  load(address) {
    return this.view.getUint32(address, true);
  }
  store(address, word) {
    this.view.setUint32(address, word, true);
  }
  bytes(address, size) {
    if (address < 0 || address + size > this.data.length)
      throw new RangeError('Native graphics packet bounds');
    return this.data.subarray(address, address + size);
  }
}
