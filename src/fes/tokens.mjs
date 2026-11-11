// SPDX-License-Identifier: MPL-2.0
import { encodeCP932 } from '../kcs/strings.mjs';

// 6A5DD0/767550 preserve parenthesized expressions as a single token. The
// colon forms remove their delimiters; ordinary quotes retain two NUL bytes
// in the temporary token list, which can terminate subsequent token lookup.
export function tokenizeFESLine(line, { quoted = false } = {}) {
  const source = encodeCP932(line),
    output = new Uint8Array(source.length * 2 + 8);
  let input = 0,
    at = 0,
    boundary = true,
    previous = 0;
  while (input < source.length && source[input]) {
    const byte = source[input];
    if (byte === 40 || (byte === 34 && quoted)) {
      if (((previous >= 65 && previous <= 90) || (previous >= 97 && previous <= 122)) && !boundary)
        output[at++] = 0;
      const start = input,
        stripped = source[input + 1] === 58;
      if (byte === 34) {
        input++;
        let written = at;
        while (input < source.length && source[input] && source[input] !== 34)
          output[written++] = source[input++];
        output[written] = output[written + 1] = 0;
        if (source[input] === 34) input++;
      } else {
        let depth = 0;
        do {
          const value = source[input++];
          output[at + input - start - 1] = value;
          if (value === 40) depth++;
          else if (value === 41) depth--;
        } while (input < source.length && source[input] && depth);
        output[at + input - start] = output[at + input - start + 1] = 0;
      }
      const count = input - start;
      if (stripped) {
        if (count > 3) output.copyWithin(at, at + 2, at + count - 1);
        if (count >= 2) output[at + count - 3] = 0;
        at -= 3;
      }
      at += count;
      boundary = false;
    } else {
      if (byte !== 32) {
        output[at++] = byte;
        boundary = false;
        previous = byte;
      } else if (!boundary) {
        output[at++] = 0;
        boundary = true;
        previous = 0;
      }
      input++;
    }
  }
  output[at] = output[at + 1] = 0;
  const tokens = [],
    decoder = new TextDecoder('shift_jis');
  for (let start = 0; output[start]; ) {
    const end = output.indexOf(0, start);
    tokens.push(decoder.decode(output.subarray(start, end)));
    start = end + 1;
  }
  return tokens;
}
