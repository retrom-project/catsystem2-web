// SPDX-License-Identifier: MPL-2.0
// HG delta/bit-plane coding; GARbro (MIT, see NOTICE) and the fixed image codecs.
class Bits {
  constructor(bytes) {
    this.bytes = bytes;
    this.at = 0;
  }
  bit() {
    if (this.at >= this.bytes.length * 8) throw new Error('HG control stream exhausted');
    return (this.bytes[this.at >> 3] >> (this.at++ & 7)) & 1;
  }
  gamma() {
    let count = 0;
    while (!this.bit()) if (++count > 30) throw new Error('HG gamma exceeds limit');
    let value = 1;
    while (count--) value = value * 2 + this.bit();
    return value;
  }
}
class BitWriter {
  constructor() {
    this.bytes = [];
    this.at = 0;
  }
  bit(value) {
    const index = this.at >> 3;
    this.bytes[index] = (this.bytes[index] || 0) | (Number(Boolean(value)) << (this.at++ & 7));
  }
  gamma(value) {
    const bits = value.toString(2);
    for (let i = 1; i < bits.length; i++) this.bit(0);
    this.bit(1);
    for (let i = 1; i < bits.length; i++) this.bit(bits[i] === '1');
  }
}
const spread = Array.from(
  { length: 256 },
  (_, i) => ((i & 192) << 18) | ((i & 48) << 12) | ((i & 12) << 6) | (i & 3),
);
const unfold = (value) => (value & 1 ? (value >> 1) ^ 255 : value >> 1);
const fold = (value) => (value < 128 ? value * 2 : (255 - value) * 2 + 1);

export function unpackHGPixels(data, control, width, rows, pixelSize) {
  const bits = new Bits(control),
    stride = width * pixelSize;
  let copy = Boolean(bits.bit());
  const total = bits.gamma();
  if (total < stride * rows || total % 4 || total > Math.max(stride * rows, 1024 * 1024) * 4)
    throw new Error(`HG invalid pixel run total ${total}`);
  const planar = new Uint8Array(total),
    pixels = new Uint8Array(total);
  let source = 0,
    destination = 0;
  while (destination < total) {
    const count = bits.gamma();
    if (destination + count > total || (copy && source + count > data.length))
      throw new Error('HG invalid pixel run');
    if (copy) {
      planar.set(data.subarray(source, source + count), destination);
      source += count;
    }
    destination += count;
    copy = !copy;
  }
  const plane = total / 4;
  for (let i = 0; i < plane; i++) {
    const value =
      (spread[planar[i]] << 6) |
      (spread[planar[plane + i]] << 4) |
      (spread[planar[plane * 2 + i]] << 2) |
      spread[planar[plane * 3 + i]];
    for (let channel = 0; channel < 4; channel++)
      pixels[i * 4 + channel] = unfold((value >>> (channel * 8)) & 255);
  }
  for (let x = pixelSize; x < stride; x++) pixels[x] += pixels[x - pixelSize];
  for (let y = 1; y < rows; y++)
    for (let x = 0; x < stride; x++) pixels[y * stride + x] += pixels[(y - 1) * stride + x];
  return pixels.subarray(0, stride * rows);
}

export function packHGPixels(input, width, height, pixelSize) {
  const stride = width * pixelSize,
    count = stride * height;
  if (input.length !== count || count < 1) throw new Error('HG invalid input dimensions');
  const total = (Math.max(1024, count) + 3) & ~3;
  const delta = new Uint8Array(total),
    planar = new Uint8Array(total);
  delta.set(input);
  for (let at = count - 1; at >= stride; at--) delta[at] -= delta[at - stride];
  for (let at = stride - 1; at >= pixelSize; at--) delta[at] -= delta[at - pixelSize];
  for (let at = 0; at < count; at++) delta[at] = fold(delta[at]);
  const plane = total / 4;
  for (let i = 0; i < plane; i++)
    for (let p = 0; p < 4; p++)
      for (let channel = 0; channel < 4; channel++)
        planar[p * plane + i] |= ((delta[i * 4 + channel] >>> (6 - p * 2)) & 3) << (channel * 2);
  const bits = new BitWriter(),
    data = [];
  bits.bit(planar[0] !== 0);
  bits.gamma(total);
  for (let at = 0; at < total; ) {
    const start = at,
      copying = planar[at] !== 0;
    do {
      if (copying) data.push(planar[at]);
      at++;
    } while (at < total && (planar[at] !== 0) === copying);
    bits.gamma(at - start);
  }
  return { data: Uint8Array.from(data), control: Uint8Array.from(bits.bytes) };
}
