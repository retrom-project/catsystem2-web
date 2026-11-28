// SPDX-License-Identifier: MPL-2.0
import { deflateSync } from 'node:zlib';
import { encodeCP932 } from '../../src/kcs/strings.mjs';
export const DATABASE_COLUMNS = Object.freeze([
  ['ID', 4],
  ['TITLE_S', 64],
  ['TITLE', 256],
  ['IND1', 128],
  ['IND24', 128],
  ['INDEX', 256],
]);
export function compiledDatabase(rows, columns = DATABASE_COLUMNS) {
  const stride = columns.reduce((sum, [, size]) => sum + size, 0),
    body = new Uint8Array(4 + columns.length * 24 + 8 + stride * rows.length),
    view = new DataView(body.buffer);
  view.setUint32(0, columns.length, true);
  columns.forEach(([name, size], i) => {
    body.set(encodeCP932(name), 4 + i * 24);
    view.setUint32(4 + i * 24 + 16, name === 'ID' ? 1 : 0, true);
    view.setUint32(4 + i * 24 + 20, size, true);
  });
  const data = 4 + columns.length * 24;
  view.setUint32(data, rows.length, true);
  view.setUint32(data + 4, stride, true);
  rows.forEach((row, index) => {
    let at = data + 8 + index * stride;
    for (const [name, size] of columns) {
      if (name === 'ID') view.setUint32(at, row[name] >>> 0, true);
      else {
        const bytes = row[name] instanceof Uint8Array ? row[name] : encodeCP932(row[name] ?? '');
        if (bytes.length > size || (!(row[name] instanceof Uint8Array) && bytes.length === size))
          throw new Error(`Authored database ${name} exceeds its field`);
        body.set(bytes, at);
      }
      at += size;
    }
  });
  const compressed = deflateSync(body),
    file = new Uint8Array(12 + compressed.length),
    header = new DataView(file.buffer);
  header.setUint32(0, 0x4244434b, true);
  header.setUint32(4, compressed.length, true);
  header.setUint32(8, body.length, true);
  file.set(compressed, 12);
  return file;
}
export const DATABASE_ROWS = Object.freeze([
  {
    ID: 1,
    TITLE_S: 'First',
    TITLE: 'First authored entry',
    IND1: 'text\\nline',
    IND24: 'last',
    INDEX: 'zeta',
  },
  { ID: 2, TITLE_S: '日本語', TITLE: '日本語の項目', IND1: 'あいうえお', INDEX: '猫' },
  { ID: 3, TITLE_S: 'Long title', TITLE: 'another entry', INDEX: 'alpha' },
]);
