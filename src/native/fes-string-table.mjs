// SPDX-License-Identifier: MPL-2.0
// STRTABLE owns byte cells, independent of the remaining FES common prefix.
import { nativeDataKey, nativeDataTSV } from './data-text.mjs';
import { parseNativeInteger } from './standard.mjs';

export function readFESStringTable(bytes) {
  const rows = new Map();
  for (const fields of nativeDataTSV(bytes)) {
    if (!fields.length) continue;
    const id = parseNativeInteger(nativeDataKey(fields[0])) ?? 0;
    // The original map inserts a row only once; later duplicates do not
    // replace its vector, including when the original row has no cells.
    if (!rows.has(id)) rows.set(id, fields.slice(1));
  }
  return [...rows];
}
export function fesStringTableCell(rows, row, column) {
  return rows.find(([id]) => id === (row | 0))?.[1][column >>> 0] ?? null;
}
