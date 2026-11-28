// SPDX-License-Identifier: MPL-2.0
// The native comma splitter drops empty fields; it has no CSV quote grammar.
// A comma cannot be a CP932 trail byte, so these operations preserve raw bytes.
export function nativeCommaFields(source, { capacity = 2048 } = {}) {
  if (!(source instanceof Uint8Array) || !Number.isSafeInteger(capacity) || capacity < 2)
    throw new TypeError('Native comma fields require bytes and scratch capacity');
  const fields = [];
  let start = 0,
    used = 0,
    separated = true,
    at = 0;
  for (; at < source.length && source[at]; at++) {
    if (source[at] === 44) {
      if (!separated) {
        fields.push(source.slice(start, at));
        used++;
        separated = true;
      }
    } else {
      if (separated) start = at;
      used++;
      separated = false;
    }
  }
  if (used + 2 > capacity)
    throw new RangeError('Native comma fields exceed their original scratch buffer');
  if (!separated) fields.push(source.slice(start, at));
  return fields;
}
export function parseNativeResourceSelection(source) {
  const fields = nativeCommaFields(source, { capacity: 256 });
  return fields.length
    ? {
        base: fields[0],
        selectors: Int32Array.from(fields.slice(1), (field) => (field[0] << 24) >> 24),
      }
    : null;
}
