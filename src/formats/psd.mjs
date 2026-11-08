// SPDX-License-Identifier: MPL-2.0
// CatSystem's ordinary PSD bitmap reader selects the merged composite. It
// consumes three byte planes and discards the merged alpha plane. This is the
// original reader's contract, including its PackBits 0x80 repeat behavior.
import { Binary } from '../binary.mjs';

export class PSD {
  constructor(bytes) {
    this.binary = new Binary(bytes, 'PSD');
    const b = this.binary,
      be16 = (at) => {
        b.range(at, 2);
        return b.view.getUint16(at);
      },
      be32 = (at) => {
        b.range(at, 4);
        return b.view.getUint32(at);
      };
    b.range(0, 30);
    if (!b.magic('8BPS')) throw new Error('Invalid PSD signature');
    // The original aligned header reads only the low 16 bits of both 32-bit
    // dimensions. Its acceptance test reads color mode and the high word of
    // the color-data length; the declared sample depth is not consulted.
    this.width = be16(20);
    this.height = be16(16);
    if (![3, 8].includes(be16(24)) || ![0, 3].includes(be16(26)))
      throw new Error('Unsupported native PSD color header');
    if (!this.width || !this.height || this.width * this.height > 64 * 1024 * 1024)
      throw new Error('PSD unreasonable dimensions');
    this.channels = be16(12);
    let at = 30 + be32(26);
    at += 4 + be32(at);
    at += 4 + be32(at);
    this.compression = be16(at);
    at += 2;
    if (this.compression === 1) at += this.height * this.channels * 2;
    b.range(at, 0);
    this.dataOffset = at;
  }
  decode() {
    if (this.rgba) return this.rgba;
    const b = this.binary,
      length = this.width * this.height,
      rgba = new Uint8ClampedArray(length * 4);
    let at = this.dataOffset;
    for (let channel = 0; channel < 3; channel++) {
      if (this.compression !== 1) {
        const plane = b.range(at, length);
        for (let i = 0; i < length; i++) rgba[i * 4 + channel] = plane[i];
        at += length;
      } else {
        for (let y = 0; y < this.height; y++) {
          let x = 0;
          while (x < this.width) {
            const control = b.u8(at++),
              count = control < 128 ? control + 1 : 257 - control;
            if (control < 128) {
              const run = b.range(at, count);
              for (let i = 0; i < count; i++, x++)
                if (x < this.width) rgba[(y * this.width + x) * 4 + channel] = run[i];
              at += count;
            } else {
              const value = b.u8(at++);
              for (let i = 0; i < count; i++, x++)
                if (x < this.width) rgba[(y * this.width + x) * 4 + channel] = value;
            }
          }
        }
      }
    }
    for (let i = 0; i < length; i++) rgba[i * 4 + 3] = 255;
    this.rgba = rgba;
    return rgba;
  }
}
