// SPDX-License-Identifier: MPL-2.0
import { encodeCP932 } from '../kcs/strings.mjs';

const encoder = new TextEncoder(),
  decoder = new TextDecoder('shift_jis');

// A JavaScript-authored source string means UTF8. File bodies and already
// tokenized parameters retain their own bytes, including invalid sequences.
export function fesSourceBytes(source) {
  if (typeof source === 'string') source = encoder.encode(source);
  if (!(source instanceof Uint8Array)) throw new TypeError('FES source requires bytes or text');
  // Normalize typed-array subclasses before any owner takes a slice. Buffer's
  // slice aliases its input and its structured-clone result has another type.
  if (source.constructor !== Uint8Array)
    source = new Uint8Array(source.buffer, source.byteOffset, source.byteLength);
  const end = source.indexOf(0);
  return end < 0 ? source : source.subarray(0, end);
}
export function fesByteView(source) {
  const bytes = fesSourceBytes(source);
  let result = '';
  for (let at = 0; at < bytes.length; at += 8192)
    result += String.fromCharCode(...bytes.subarray(at, at + 8192));
  return result;
}
export function fesViewBytes(view) {
  const bytes = new Uint8Array(view.length);
  for (let at = 0; at < view.length; at++) {
    const value = view.charCodeAt(at);
    if (value > 255) throw new TypeError('FES byte view contains a Unicode character');
    bytes[at] = value;
  }
  return bytes;
}
export function fesNarrowText(token = '') {
  return token instanceof Uint8Array ? decoder.decode(fesSourceBytes(token)) : String(token);
}

// 6A5DD0/767550 preserve parenthesized expressions as a single token. The
// colon forms remove their delimiters; ordinary quotes retain two NUL bytes
// in the temporary token list, which can terminate subsequent token lookup.
export function tokenizeFESByteLine(line, { quoted = false } = {}) {
  const source = fesSourceBytes(line),
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
  const tokens = [];
  for (let start = 0; output[start]; ) {
    const end = output.indexOf(0, start);
    tokens.push(output.slice(start, end));
    start = end + 1;
  }
  return tokens;
}

// Named native consumers also use this helper with authored narrow strings.
// Their string ABI stays CP932; the source parser calls the byte helper.
export function tokenizeFESLine(line, options) {
  return tokenizeFESByteLine(line instanceof Uint8Array ? line : encodeCP932(line), options).map(
    fesNarrowText,
  );
}
