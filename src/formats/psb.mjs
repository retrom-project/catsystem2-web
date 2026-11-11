// SPDX-License-Identifier: MPL-2.0
// Adapted from CatSystemKit PSB (OWCramer).
import { Binary, inflate, boundedCount } from '../binary.mjs';
export async function readPSB(bytes, options) {
  const b = new Binary(bytes, 'PSZ');
  if (b.magic('PSZ\0')) bytes = await inflate(b.range(16, b.u32(4)), b.u32(8));
  return new PSB(bytes, options);
}
export class PSB {
  constructor(bytes, { allowUnverifiedVersion = false } = {}) {
    this.b = new Binary(bytes, 'PSB');
    if (!this.b.magic('PSB\0')) throw new Error('Expected PSB');
    this.version = this.b.u16(4);
    if (![2, 3, 4].includes(this.version) && !allowUnverifiedVersion)
      throw new Error(`Unsupported PSB ${this.version}`);
    if (this.b.u16(6)) throw new Error('Encrypted PSB: use a prepared/decrypted game directory');
    const b = this.b;
    this.names = [];
    const pointer = { at: b.u32(12) },
      charset = this.integers(pointer),
      data = this.integers(pointer),
      tree = this.integers(pointer);
    for (const index of tree) {
      if (index >= data.length) throw new Error('Invalid PSB name index');
      const out = [];
      let chr = data[index];
      while (chr) {
        if (chr >= data.length || data[chr] >= charset.length || out.length > 1024)
          throw new Error('Invalid PSB name trie');
        const code = data[chr];
        out.push((chr - charset[code]) & 255);
        chr = code;
      }
      this.names.push(new TextDecoder().decode(new Uint8Array(out.reverse())));
    }
    this.strings = this.integers({ at: b.u32(16) });
    this.stringData = b.u32(20);
    this.chunkOffsets = this.integers({ at: b.u32(24) });
    this.chunkLengths = this.integers({ at: b.u32(28) });
    this.chunkData = b.u32(32);
    if (this.chunkOffsets.length !== this.chunkLengths.length)
      throw new Error('PSB chunk table mismatch');
    for (let i = 0; i < this.chunkOffsets.length; i++)
      b.range(this.chunkData + this.chunkOffsets[i], this.chunkLengths[i]);
    this.nodes = 0;
    this.root = this.value(b.u32(36));
  }
  uint(at, count) {
    if (count < 1 || count > 8) throw new Error('PSB invalid integer width');
    this.b.range(at, count);
    let value = 0;
    for (let i = count - 1; i >= 0; i--) value = value * 256 + this.b.u8(at + i);
    if (!Number.isSafeInteger(value)) throw new Error('PSB integer exceeds JavaScript exact range');
    return value;
  }
  integers(pointer) {
    const countWidth = this.b.u8(pointer.at++) - 12,
      count = boundedCount(this.uint(pointer.at, countWidth), 16000000, 'PSB array');
    pointer.at += countWidth;
    const width = this.b.u8(pointer.at++) - 12;
    this.b.range(pointer.at, count * width);
    const values = new Array(count);
    for (let i = 0; i < count; i++) values[i] = this.uint(pointer.at + i * width, width);
    pointer.at += count * width;
    return values;
  }
  value(at, depth = 0) {
    if (depth > 128 || ++this.nodes > 4000000) throw new Error('PSB tree limit exceeded');
    const b = this.b,
      type = b.u8(at);
    if (type === 1) return null;
    if (type === 2 || type === 3) return type === 3;
    if (type === 4 || type === 29) return 0;
    if (type >= 5 && type <= 12) {
      const width = type - 4;
      if (width === 8) {
        b.range(at + 1, 8);
        const v = b.view.getBigInt64(at + 1, true);
        if (v > BigInt(Number.MAX_SAFE_INTEGER) || v < BigInt(Number.MIN_SAFE_INTEGER))
          throw new Error('PSB int64 exceeds exact range');
        return Number(v);
      }
      const v = this.uint(at + 1, width);
      return v >= 2 ** (width * 8 - 1) ? v - 2 ** (width * 8) : v;
    }
    if (type >= 13 && type <= 20) return this.integers({ at });
    if (type >= 21 && type <= 24) {
      const index = this.uint(at + 1, type - 20);
      if (index >= this.strings.length) throw new Error('PSB invalid string reference');
      return b.str(this.stringData + this.strings[index], undefined, 'utf-8');
    }
    if (type >= 25 && type <= 28) return { resource: this.uint(at + 1, type - 24) };
    if (type === 30) return b.f32(at + 1);
    if (type === 31) return b.f64(at + 1);
    if (type === 32 || type === 33) {
      const pointer = { at: at + 1 },
        keys = type === 33 ? this.integers(pointer) : null,
        offsets = this.integers(pointer);
      if (!keys) return offsets.map((o) => this.value(pointer.at + o, depth + 1));
      if (keys.length !== offsets.length) throw new Error('PSB dictionary table mismatch');
      const dict = Object.create(null);
      for (let i = 0; i < keys.length; i++) {
        if (keys[i] >= this.names.length) throw new Error('PSB invalid key');
        dict[this.names[keys[i]]] = this.value(pointer.at + offsets[i], depth + 1);
      }
      return dict;
    }
    if (type >= 34 && type <= 37) return { extraResource: this.uint(at + 1, type - 33) };
    throw new Error(`PSB value type ${type} at ${at}`);
  }
  resource(index) {
    if (!Number.isInteger(index) || index < 0 || index >= this.chunkOffsets.length)
      throw new Error('Invalid PSB resource');
    return this.b.range(this.chunkData + this.chunkOffsets[index], this.chunkLengths[index]);
  }
}
