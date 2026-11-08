// SPDX-License-Identifier: MPL-2.0
// PNG scanlines, filters and Adam7: https://www.w3.org/TR/png/
// Decode samples directly: a Canvas round-trip loses RGB beneath alpha zero
// and quantizes partially transparent channels before native bitmap copies.
import { Binary, inflate } from '../binary.mjs';
const channels = { 0: 1, 2: 3, 3: 1, 4: 2, 6: 4 },
  depths = { 0: [1, 2, 4, 8, 16], 2: [8, 16], 3: [1, 2, 4, 8], 4: [8, 16], 6: [8, 16] },
  crcTable = Uint32Array.from({ length: 256 }, (_, i) => {
    for (let bit = 0; bit < 8; bit++) i = i & 1 ? 0xedb88320 ^ (i >>> 1) : i >>> 1;
    return i >>> 0;
  });
function crc32(bytes) {
  let value = 0xffffffff;
  for (const byte of bytes) value = crcTable[(value ^ byte) & 255] ^ (value >>> 8);
  return (value ^ 0xffffffff) >>> 0;
}
const paeth = (a, b, c) => {
  const p = a + b - c,
    da = Math.abs(p - a),
    db = Math.abs(p - b),
    dc = Math.abs(p - c);
  return da <= db && da <= dc ? a : db <= dc ? b : c;
};
export class PNG {
  constructor(bytes) {
    const b = (this.binary = new Binary(bytes, 'PNG')),
      be = (at) => {
        b.range(at, 4);
        return b.view.getUint32(at);
      };
    if (!b.magic('\x89PNG\r\n\x1a\n')) throw new Error('Invalid PNG signature');
    this.data = [];
    let ended = false,
      hasHeader = false;
    for (let at = 8; at < bytes.length; ) {
      const size = be(at),
        type = b.str(at + 4, 4, 'utf-8'),
        data = b.range(at + 8, size),
        validCRC = crc32(b.range(at + 4, size + 4)) === be(at + 8 + size);
      if (!/^[A-Za-z]{4}$/.test(type)) throw new Error('PNG invalid chunk type');
      if (!hasHeader && type !== 'IHDR') throw new Error('PNG header must be first');
      if (!validCRC) {
        if (type[0] === type[0].toUpperCase()) throw new Error(`PNG invalid ${type} checksum`);
        at += size + 12;
        continue;
      }
      if (type === 'IHDR') {
        if (hasHeader || size !== 13) throw new Error('PNG invalid header');
        this.width = be(at + 8);
        this.height = be(at + 12);
        this.depth = data[8];
        this.colorType = data[9];
        this.interlace = data[12];
        if (
          !depths[this.colorType]?.includes(this.depth) ||
          data[10] ||
          data[11] ||
          this.interlace > 1
        )
          throw new Error('PNG unsupported header fields');
        if (!this.width || !this.height || this.width * this.height > 64 * 1024 * 1024)
          throw new Error('PNG unreasonable dimensions');
        hasHeader = true;
      } else if (type === 'PLTE') {
        if (!size || size % 3 || size > 768) throw new Error('PNG invalid palette');
        this.palette = data;
      } else if (type === 'tRNS') this.transparency = data;
      else if (type === 'IDAT') this.data.push(data);
      else if (type === 'IEND') {
        if (size) throw new Error('PNG invalid end chunk');
        ended = true;
        break;
      } else if (type[0] === type[0].toUpperCase())
        throw new Error(`PNG unsupported critical chunk ${type}`);
      at += size + 12;
    }
    if (!ended || !this.data.length || (this.colorType === 3 && !this.palette))
      throw new Error('PNG incomplete image');
  }
  async decode() {
    const { width, height, depth, colorType } = this,
      count = channels[colorType],
      bits = count * depth,
      passes = this.interlace
        ? [
            [0, 0, 8, 8],
            [4, 0, 8, 8],
            [0, 4, 4, 8],
            [2, 0, 4, 4],
            [0, 2, 2, 4],
            [1, 0, 2, 2],
            [0, 1, 1, 2],
          ]
        : [[0, 0, 1, 1]],
      layouts = passes.map(([x, y, dx, dy]) => ({
        x,
        y,
        dx,
        dy,
        width: Math.max(0, Math.ceil((width - x) / dx)),
        height: Math.max(0, Math.ceil((height - y) / dy)),
      })),
      expected = layouts.reduce(
        (sum, pass) =>
          sum +
          (pass.width && pass.height ? (Math.ceil((pass.width * bits) / 8) + 1) * pass.height : 0),
        0,
      ),
      compressed = new Uint8Array(this.data.reduce((sum, data) => sum + data.length, 0));
    let compressedAt = 0;
    for (const data of this.data) {
      compressed.set(data, compressedAt);
      compressedAt += data.length;
    }
    const input = await inflate(compressed, expected),
      rgba = new Uint8ClampedArray(width * height * 4),
      sampleMax = (1 << depth) - 1,
      filterSize = Math.max(1, Math.ceil(bits / 8)),
      transparent =
        this.transparency &&
        new DataView(
          this.transparency.buffer,
          this.transparency.byteOffset,
          this.transparency.byteLength,
        ),
      sample8 = (value) =>
        depth === 16 ? value >>> 8 : depth < 8 ? Math.floor((value * 255) / sampleMax) : value;
    let at = 0;
    for (const pass of layouts) {
      if (!pass.width || !pass.height) continue;
      const stride = Math.ceil((pass.width * bits) / 8);
      let previous = new Uint8Array(stride);
      for (let y = 0; y < pass.height; y++) {
        const filter = input[at++],
          row = input.slice(at, at + stride);
        if (filter > 4) throw new Error('PNG invalid scanline filter');
        at += stride;
        for (let i = 0; i < stride; i++) {
          const left = i >= filterSize ? row[i - filterSize] : 0,
            up = previous[i],
            upperLeft = i >= filterSize ? previous[i - filterSize] : 0;
          row[i] +=
            filter === 1
              ? left
              : filter === 2
                ? up
                : filter === 3
                  ? (left + up) >>> 1
                  : filter === 4
                    ? paeth(left, up, upperLeft)
                    : 0;
        }
        const sample = (index) =>
          depth === 16
            ? (row[index * 2] << 8) | row[index * 2 + 1]
            : depth === 8
              ? row[index]
              : (row[(index * depth) >> 3] >>> (8 - depth - ((index * depth) & 7))) & sampleMax;
        for (let x = 0; x < pass.width; x++) {
          const destination = ((pass.y + y * pass.dy) * width + pass.x + x * pass.dx) * 4,
            source = x * count,
            first = sample(source);
          let r,
            g,
            b,
            a = 255;
          if (colorType === 3) {
            if (first * 3 + 2 >= this.palette.length)
              throw new Error('PNG palette index exceeds palette');
            [r, g, b] = this.palette.subarray(first * 3, first * 3 + 3);
            a = this.transparency?.[first] ?? 255;
          } else if (colorType === 0 || colorType === 4) {
            r = g = b = sample8(first);
            if (colorType === 4) a = sample8(sample(source + 1));
            else if (transparent && transparent.getUint16(0) === first) a = 0;
          } else {
            const green = sample(source + 1),
              blue = sample(source + 2);
            r = sample8(first);
            g = sample8(green);
            b = sample8(blue);
            if (colorType === 6) a = sample8(sample(source + 3));
            else if (
              transparent &&
              transparent.getUint16(0) === first &&
              transparent.getUint16(2) === green &&
              transparent.getUint16(4) === blue
            )
              a = 0;
          }
          rgba.set([r, g, b, a], destination);
        }
        previous = row;
      }
    }
    return rgba;
  }
}
