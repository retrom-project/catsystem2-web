// SPDX-License-Identifier: MPL-2.0
// Shared platform font-family ordering and original name-field bytes.
import { encodeCP932 } from '../kcs/strings.mjs';

export function writeNativeFontField(bytes, at, count, value, wide) {
  const view = new DataView(bytes.buffer);
  let used = 0;
  for (const character of value) {
    if (wide) {
      if (used + character.length >= count) break;
      for (let i = 0; i < character.length; i++)
        view.setUint16(at + used++ * 2, character.charCodeAt(i), true);
    } else {
      const encoded = encodeCP932(character);
      if (used + encoded.length >= count) break;
      bytes.set(encoded, at + used);
      used += encoded.length;
    }
  }
}

// Reuse this exact platform family ordering and name-field representation.
export function nativeFontFamilyRows(rows, name = null) {
  const seen = new Set();
  return rows.filter((font) => {
    const key = font.face.toLowerCase();
    if (name !== null) return key === name;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}
export function nativeFontNameBytes(font, wide) {
  const bytes = new Uint8Array(64 * (wide ? 2 : 1));
  writeNativeFontField(bytes, 0, 64, font.fullName ?? font.face, wide);
  return bytes;
}
