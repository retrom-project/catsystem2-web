// SPDX-License-Identifier: MPL-2.0
import { encodeCP932 } from '../../src/kcs/strings.mjs';
import { narrowKIF } from './history-cursor63-inputs.mjs';
import { kcsProgram } from '../helpers.mjs';
export function gallery63Tables() {
  const variants = new Uint8Array(86400),
    view = new DataView(variants.buffer);
  for (const [group, file, base] of [
    [0, 0, 'img0'],
    [0, 1, 'second'],
    [0, 2, ''],
    [1, 0, '日本'],
  ]) {
    const at = 540 * (group * 8 + file);
    view.setUint32(at, 1, true);
    variants.set(encodeCP932(base), at + 4);
    view.setUint32(at + 20, 3, true);
    view.setUint32(at + 280, 2, true);
    variants.set([0, 65, 48, 0, 0], at + 24);
    variants.set([66, 0, 0, 68], at + 40);
    variants.set([0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 90], at + 56);
    variants.set([48, 0, 67], at + 284);
    variants.set([0, 0, 69, 0, 70], at + 300);
  }
  const names = new Uint8Array(4 + 128 * 3);
  new DataView(names.buffer).setUint32(0, 3, true);
  const fields = [
    ['重複', '零一', '零二', '零三'],
    ['重複', '', '一二', '一三'],
    ['最後', '二一', '二二', '日本名'],
  ];
  fields.forEach((row, r) =>
    row.forEach((text, c) => names.set(encodeCP932(text), 4 + r * 128 + c * 32)),
  );
  return new Map([
    ['台%帳.tbl', variants],
    ['names.tbl', names],
    ['emptyvariants.tbl', new Uint8Array(86400)],
    ['zeronames.tbl', new Uint8Array(4)],
  ]);
}
export function gallery63Resources() {
  return new Map([
    ['scripts.int', narrowKIF([['resource63.kcs', kcsProgram([[37, 256], [43, 71, 4], [59]])]])],
    ['scene.int', narrowKIF([['unused.dat', new Uint8Array(16)]])],
    ['tables.int', narrowKIF([...gallery63Tables()])],
  ]);
}
