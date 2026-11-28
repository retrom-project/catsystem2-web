// SPDX-License-Identifier: MPL-2.0
// The fixed Windows environment uses ACP/OEMCP 932. These shared mapping
// exceptions are also checked independently by the Win32 multibyte oracle.
import { REGISTRY_CP932_EXCEPTIONS } from '../native/registry-codepage-data.mjs';

const singleCharacters = new Map(REGISTRY_CP932_EXCEPTIONS.decode),
  cp932 = new TextDecoder('shift_jis', { fatal: true, ignoreBOM: true });
const lead = (byte) => (byte >= 0x81 && byte <= 0x9f) || (byte >= 0xe0 && byte <= 0xfc);

export function decodeCP932(bytes, composite) {
  const tokens = [];
  let invalid = false;
  for (let i = 0; i < bytes.length; i++) {
    const first = bytes[i],
      pair = lead(first),
      second = pair ? bytes[++i] : undefined;
    let text;
    if (pair && (second === undefined || second === 0)) {
      text = '\u30fb';
      invalid = true;
      if (second === 0) i--;
    } else if (!pair && singleCharacters.has(first)) {
      text = String.fromCharCode(singleCharacters.get(first));
      if (first === 0xa0 || first >= 0xfd) invalid = true;
    } else {
      try {
        text = cp932.decode(Uint8Array.from(pair ? [first, second] : [first]));
      } catch {
        text = '\u30fb';
        invalid = true;
      }
    }
    tokens.push(composite ? text.normalize('NFD') : text);
  }
  return { tokens, invalid };
}

// The engine's narrow-to-wide helpers use CP932 with MB_PRECOMPOSED, without
// a process allocation. Keep the same decoder as the shared Win32 import.
export function decodeWindowsCP932(bytes) {
  return decodeCP932(bytes, false).tokens.join('');
}
