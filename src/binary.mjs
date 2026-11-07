// SPDX-License-Identifier: MPL-2.0
// Format logic adapted from CatSystemKit (OWCramer), commit 02873f0becbdab5fd992cd9f3dcd50edd3937d78.
export class Binary {
  constructor(bytes, label = 'binary') {
    this.bytes = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
    this.view = new DataView(this.bytes.buffer, this.bytes.byteOffset, this.bytes.byteLength);
    this.label = label;
  }
  range(at, count) {
    if (
      !Number.isSafeInteger(at) ||
      !Number.isSafeInteger(count) ||
      at < 0 ||
      count < 0 ||
      at + count > this.bytes.length
    )
      throw new Error(`${this.label}: range ${at}+${count} exceeds ${this.bytes.length}`);
    return this.bytes.subarray(at, at + count);
  }
  u8(at) {
    return this.range(at, 1)[0];
  }
  u16(at) {
    this.range(at, 2);
    return this.view.getUint16(at, true);
  }
  u32(at) {
    this.range(at, 4);
    return this.view.getUint32(at, true);
  }
  i32(at) {
    return this.u32(at) | 0;
  }
  f32(at) {
    this.range(at, 4);
    return this.view.getFloat32(at, true);
  }
  f64(at) {
    this.range(at, 8);
    return this.view.getFloat64(at, true);
  }
  str(at, max = this.bytes.length - at, encoding = 'shift_jis') {
    const b = this.range(at, max),
      end = b.indexOf(0);
    return new TextDecoder(encoding).decode(end < 0 ? b : b.subarray(0, end));
  }
  magic(text, at = 0) {
    return [...text].every((c, i) => this.bytes[at + i] === c.charCodeAt(0));
  }
}

export async function inflate(bytes, expected, limit = 256 * 1024 * 1024) {
  if (
    expected !== undefined &&
    (!Number.isSafeInteger(expected) || expected < 0 || expected > limit)
  )
    throw new Error(`Invalid inflated size ${expected}`);
  const reader = new Blob([bytes])
    .stream()
    .pipeThrough(new DecompressionStream('deflate'))
    .getReader();
  let length = 0;
  const chunks = [];
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      length += value.length;
      if (length > (expected ?? limit)) throw new Error('Inflated data exceeds declared size');
      chunks.push(value);
    }
  } finally {
    await reader.cancel();
  }
  if (expected !== undefined && length !== expected)
    throw new Error(`Inflated size ${length}, expected ${expected}`);
  const result = new Uint8Array(length);
  let at = 0;
  for (const b of chunks) {
    result.set(b, at);
    at += b.length;
  }
  return result;
}

export function decodeText(bytes) {
  try {
    return new TextDecoder('utf-8', { fatal: true }).decode(bytes).replace(/^\uFEFF/, '');
  } catch {
    return new TextDecoder('shift_jis').decode(bytes);
  }
}

export function boundedCount(value, limit, label) {
  if (!Number.isSafeInteger(value) || value < 0 || value > limit)
    throw new Error(`${label}: invalid count ${value}`);
  return value;
}
