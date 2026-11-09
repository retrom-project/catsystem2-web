// SPDX-License-Identifier: MPL-2.0
import { CP932_PAIRS } from './cp932-data.mjs';
import { REGISTRY_CP932_EXCEPTIONS } from './registry-codepage-data.mjs';
const decode = new Map(),
  encode = new Map();
function add(code, point) {
  decode.set(code, point);
  if (!encode.has(point)) encode.set(point, code);
}
for (let i = 0; i < CP932_PAIRS.length; i += 8)
  add(
    Number.parseInt(CP932_PAIRS.slice(i, i + 4), 16),
    Number.parseInt(CP932_PAIRS.slice(i + 4, i + 8), 16),
  );
// Windows/WHATWG user-defined rows, absent from the 1998 assigned-character table.
for (let row = 0; row < 10; row++)
  for (let cell = 0; cell < 188; cell++)
    add(((0xf0 + row) << 8) + (cell < 63 ? 0x40 + cell : 0x41 + cell), 0xe000 + row * 188 + cell);
for (const [code, point] of REGISTRY_CP932_EXCEPTIONS.decode) add(code, point);
const bestFit = new Map(
  REGISTRY_CP932_EXCEPTIONS.encode.map(([unit, count, word]) => [
    unit,
    Uint8Array.of(word & 255, ...(count === 2 ? [word >>> 8] : [])),
  ]),
);
export function decodeNativeCP932(bytes) {
  let text = '';
  for (let i = 0; i < bytes.length; i++) {
    const first = bytes[i],
      pair = (first >= 0x81 && first <= 0x9f) || (first >= 0xe0 && first <= 0xfc);
    const code = pair ? (first << 8) | (bytes[++i] ?? 0) : first;
    text += String.fromCharCode(decode.get(code) ?? 0x30fb);
  }
  return text;
}
export function encodeNativeCP932(text) {
  const out = [];
  // The original Windows ACP encoder maps each UTF-16 unit independently.
  for (let i = 0; i < text.length; i++) {
    const unit = text.charCodeAt(i),
      special = bestFit.get(unit);
    if (special) {
      out.push(...special);
      continue;
    }
    const code = encode.get(unit) ?? 63;
    if (code > 255) out.push(code >>> 8);
    out.push(code & 255);
  }
  return Uint8Array.from(out);
}
