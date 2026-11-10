// SPDX-License-Identifier: MPL-2.0
import { encodeCP932 } from '../../src/kcs/strings.mjs';

export function galleryVariantFile(mode) {
  const bytes = new Uint8Array(86400),
    view = new DataView(bytes.buffer),
    groups = mode === 0 ? [] : mode === 1 ? [0, 1] : [0, 4, 19];
  for (const group of groups)
    for (let slot = 0; slot < (group === 0 ? 3 : 1); slot++) {
      const at = 540 * (group * 8 + slot);
      view.setUint32(at, slot === 1 ? 0x80000000 : 1, true);
      bytes.set(
        encodeCP932(slot === 2 ? '' : group === 19 ? '日本' : `img${group}_${slot}`),
        at + 4,
      );
      view.setUint32(at + 20, 3, true);
      view.setUint32(at + 280, 2, true);
      bytes.set([0, 65, 48, 0, 0], at + 24);
      bytes.set([66, 0, 0, 68], at + 40);
      bytes.set([0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 90], at + 56);
      bytes.set([48, 0, 67], at + 284);
      bytes.set([0, 0xff, 0, 0x81, 0x5c], at + 300);
    }
  return bytes;
}
export function galleryNameFile(mode) {
  const bytes = new Uint8Array(4 + 3 * 128),
    view = new DataView(bytes.buffer);
  view.setUint32(0, mode === 2 ? 0x80000000 : mode === 3 ? 0 : 3, true);
  for (let row = 0; row < 3; row++)
    for (let column = 0; column < 4; column++) {
      const at = 4 + row * 128 + column * 32;
      bytes.set(encodeCP932(`r${row}c${column}日本`), at);
    }
  if (mode === 1) {
    bytes[4] = 0;
    bytes[4 + 32] = 0;
    bytes[4 + 33] = 0;
    bytes[4 + 34] = 0;
    bytes[4 + 35] = 0;
    bytes.fill(65, 4 + 128, 4 + 128 + 32);
    bytes.set([0x81, 0x5c, 0xff, 0x80, 0], 4 + 256);
  }
  return bytes;
}
export function galleryTableFiles() {
  return new Map([
    ['variants0', galleryVariantFile(0)],
    ['variants1', galleryVariantFile(1)],
    ['variants2', galleryVariantFile(2)],
    ['wrong-size', new Uint8Array(16)],
    ['empty', new Uint8Array()],
    ...[0, 1, 2, 3].map((i) => [`names${i}`, galleryNameFile(i)]),
  ]);
}

export function galleryTableOperations(name, variants) {
  const operations = [[variants ? 0x195 : 0x19c, name]],
    count = variants ? 0x197 : 0x19e;
  operations.push([count]);
  if (variants) {
    for (const group of [0, 1, 2, 4, 19, 20, 0xffffffff]) {
      operations.push([0x198, group]);
      for (const file of [0, 1, 2, 7, 8, 0xffffffff]) {
        operations.push([0x199, group, file], [0x19a, group, file]);
        for (const [first, second, dest] of [
          [0, 0, 256],
          [1, 1, 256],
          [2, 0, 0],
          [3, 0, 256],
          [0, 2, 256],
          [0, 0, 0xffffffff],
          [16, 16, 256],
        ])
          operations.push([0x19b, group, file, first, second, dest]);
      }
    }
    operations.push([0x196]);
  } else {
    for (const row of [0, 1, 2, 3, 0x7fffffff, 0x80000000, 0xffffffff])
      for (const column of [0, 1, 2, 3, 4, 0xffffffff])
        operations.push([0x19f, row, column], [0x1a0, row, column, 256]);
    operations.push([0x19d]);
  }
  return operations;
}
