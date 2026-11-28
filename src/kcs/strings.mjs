// SPDX-License-Identifier: MPL-2.0
let cp932;
export function encodeCP932(text) {
  if ([...text].every((c) => c.charCodeAt(0) < 128)) return new TextEncoder().encode(text);
  if (!cp932) {
    cp932 = new Map();
    const decoder = new TextDecoder('shift_jis', { fatal: true });
    for (let a = 0; a < 256; a++) {
      try {
        cp932.set(decoder.decode(new Uint8Array([a])), [a]);
      } catch {
        /* invalid lead */
      }
    }
    for (let a = 0x81; a <= 0xfc; a++)
      if (a <= 0x9f || a >= 0xe0)
        for (let b = 0x40; b <= 0xfc; b++) {
          try {
            const char = decoder.decode(new Uint8Array([a, b]));
            if (!cp932.has(char)) cp932.set(char, [a, b]);
          } catch {
            /* invalid trail */
          }
        }
  }
  return new Uint8Array([...text].flatMap((c) => cp932.get(c) || [63]));
}
