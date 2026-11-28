// SPDX-License-Identifier: MPL-2.0
import { encodeCP932 } from '../kcs/strings.mjs';
import { REGISTRY_CP932_EXCEPTIONS } from './registry-codepage-data.mjs';
const exceptions = new Map(REGISTRY_CP932_EXCEPTIONS.decode),
  encoded = new Map(
    REGISTRY_CP932_EXCEPTIONS.encode.map(([unit, count, word]) => [unit, { count, word }]),
  ),
  decoder = new TextDecoder('shift_jis', { fatal: true, ignoreBOM: true });
const lead = (byte) => (byte >= 0x81 && byte <= 0x9f) || (byte >= 0xe0 && byte <= 0xfc);

export function registryDecodeANSI(bytes) {
  let text = '';
  for (let i = 0; i < bytes.length; i++) {
    const first = bytes[i],
      pair = lead(first) && i + 1 < bytes.length,
      next = pair ? bytes[++i] : undefined,
      key = pair ? 0x10000 + first * 256 + next : first;
    let unit = exceptions.get(key);
    if (unit === undefined) {
      if (lead(first) && !pair) unit = 0;
      else {
        try {
          unit = decoder.decode(Uint8Array.from(pair ? [first, next] : [first])).charCodeAt(0);
        } catch {
          unit = 0x30fb;
        }
      }
    }
    text += String.fromCharCode(unit);
  }
  return text;
}
export function registryEncodeANSI(text) {
  const result = [];
  // The NT ACP routine maps UTF16 units independently, including surrogates.
  for (let i = 0; i < text.length; i++) {
    const unit = text.charCodeAt(i),
      special = encoded.get(unit);
    if (special) {
      result.push(special.word & 255);
      if (special.count === 2) result.push(special.word >>> 8);
    } else result.push(...encodeCP932(text[i]));
  }
  return Uint8Array.from(result);
}
