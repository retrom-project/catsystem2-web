// SPDX-License-Identifier: MPL-2.0
// Native history list layouts: current 48-byte records and original 40-byte
// records, followed by 72-byte numbered-string snapshots.
import { Binary } from '../binary.mjs';
import { encodeCP932 } from '../kcs/strings.mjs';

export function encodeNativeSceneHistory(records, includeExtra = false) {
  const size =
    4 +
    records.reduce(
      (total, entry) =>
        total +
        48 +
        72 * (entry.strings?.length ?? 0) +
        (includeExtra ? (entry.extra?.length ?? 0) : 0),
      0,
    );
  const bytes = new Uint8Array(size),
    view = new DataView(bytes.buffer);
  let at = 4;
  for (const entry of records) {
    const name = entry.nameBytes?.slice() ?? new Uint8Array(32);
    if (!entry.nameBytes) name.set(encodeCP932(entry.scene));
    bytes.set(name, at);
    view.setUint32(at + 32, entry.value >>> 0, true);
    const count = entry.strings?.length ?? 0;
    const extra = includeExtra ? entry.extra : null;
    view.setUint32(at + 36, count, true);
    view.setUint32(at + 40, extra?.length ?? 0, true);
    view.setUint32(at + 44, extra?.length ? 48 + 72 * count : 0, true);
    let pairAt = at + 48;
    for (const [key, value] of entry.strings ?? []) {
      const [first, second] = key.split(':').map(Number);
      view.setUint32(pairAt, first, true);
      view.setUint32(pairAt + 4, second, true);
      bytes.set(value, pairAt + 8);
      pairAt += 72;
    }
    if (extra) bytes.set(extra, pairAt);
    at = pairAt + (extra?.length ?? 0);
  }
  return bytes;
}

export function decodeNativeSceneHistory(bytes, { side = 'path', companionPath = null } = {}) {
  const b = new Binary(bytes, 'Native scene history'),
    modern = b.u32(0) === 0;
  const records = [];
  let at = modern ? 4 : 0;
  const recordSize = modern ? 48 : 40;
  while (at < bytes.length) {
    b.range(at, recordSize);
    const nameBytes = b.range(at, 32).slice(),
      nul = nameBytes.indexOf(0);
    if (nul < 0) throw new Error('Native scene history has an unterminated name');
    const scene = new TextDecoder('shift_jis').decode(nameBytes.subarray(0, nul));
    const count = b.u32(at + 36),
      strings = count ? [] : null;
    const pairsSize = count * 72;
    b.range(at + recordSize, pairsSize);
    for (let i = 0; i < count; i++) {
      const pairAt = at + recordSize + i * 72;
      const key = `${b.u32(pairAt)}:${b.u32(pairAt + 4)}`;
      const value = b.range(pairAt + 8, 64).slice();
      if (!value.includes(0))
        throw new Error('Native scene history has an unterminated numbered string');
      strings.push([key, value]);
    }
    const extraSize = modern ? b.u32(at + 40) : 0;
    let extra = null;
    if (extraSize) {
      const offset = b.u32(at + 44);
      // 72D680's seen-list branch adds this offset to the companion path
      // buffer, whereas its path branch adds it to the current record.
      if (side === 'seen') {
        if (!companionPath)
          throw new Error('Native seen-list extra data refers to a null companion path buffer');
        extra = new Binary(companionPath, 'Native companion path').range(offset, extraSize).slice();
      } else extra = b.range(at + offset, extraSize).slice();
    }
    b.range(at + recordSize + pairsSize, extraSize);
    records.push({ scene, nameBytes, value: b.u32(at + 32), strings, extra });
    at += recordSize + pairsSize + extraSize;
  }
  return records;
}
