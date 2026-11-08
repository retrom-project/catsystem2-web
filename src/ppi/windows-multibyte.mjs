// SPDX-License-Identifier: MPL-2.0
// The fixed Windows environment uses ACP/OEMCP 932. These shared mapping
// exceptions are also checked independently by the Win32 multibyte oracle.
import { REGISTRY_CP932_EXCEPTIONS } from '../native/registry-codepage-data.mjs';

const singleCharacters = new Map(REGISTRY_CP932_EXCEPTIONS.decode),
  cp932 = new TextDecoder('shift_jis', { fatal: true, ignoreBOM: true });
const lead = (byte) => (byte >= 0x81 && byte <= 0x9f) || (byte >= 0xe0 && byte <= 0xfc);

function decodeCP932(bytes, composite) {
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

function decodeUTF8(bytes) {
  const tokens = [];
  let invalid = false;
  for (let i = 0; i < bytes.length; ) {
    const first = bytes[i++];
    if (first < 0x80) {
      tokens.push(String.fromCharCode(first));
      continue;
    }
    const count =
      first >= 0xc2 && first <= 0xdf
        ? 2
        : first >= 0xe0 && first <= 0xef
          ? 3
          : first >= 0xf0 && first <= 0xf4
            ? 4
            : 0;
    if (count && bytes.length - i < count - 1) {
      tokens.push('\ufffd');
      invalid = true;
      break;
    }
    let value = first & (count === 2 ? 31 : count === 3 ? 15 : 7),
      bad = !count;
    for (let next = 1; next < count; next++) {
      const byte = bytes[i];
      if (byte === undefined || byte < 0x80 || byte > 0xbf) {
        bad = true;
        break;
      }
      i++;
      value = (value << 6) | (byte & 63);
      // Win32 consumes the invalid two-byte prefix before replacing it.
      // Remaining continuation bytes are processed independently.
      if (
        next === 1 &&
        ((first === 0xe0 && byte < 0xa0) ||
          (first === 0xed && byte >= 0xa0) ||
          (first === 0xf0 && byte < 0x90) ||
          (first === 0xf4 && byte >= 0x90))
      ) {
        bad = true;
        break;
      }
    }
    if (bad) {
      tokens.push('\ufffd');
      invalid = true;
    } else tokens.push(String.fromCodePoint(value));
  }
  return { tokens, invalid };
}

export function windowsMultiByteToWideChar(
  kernel,
  [codePage, flags, input, size, output, capacity],
) {
  const fail = (error) => {
    kernel.lastError = error;
    return 0;
  };
  size |= 0;
  capacity |= 0;
  if (!input || !size || capacity < 0 || (!output && capacity) || input === output) return fail(87);
  if (![0, 1, 3, 932, 65001].includes(codePage))
    throw new Error(`PPI unsupported byte decoder ${codePage}`);
  if (codePage === 65001 ? Boolean(flags & ~8) : Boolean(flags & ~15) || (flags & 3) === 3)
    return fail(1004);
  const p = kernel.process,
    bytes = size < 0 ? p.stringBytes(input, false, true) : p.read(input, size);
  let tokens, invalid;
  if (codePage === 65001) {
    ({ tokens, invalid } = decodeUTF8(bytes));
  } else {
    ({ tokens, invalid } = decodeCP932(bytes, Boolean(flags & 2)));
    // The CP932 strict path validates before touching the destination.
    if (invalid && flags & 8) return fail(1113);
  }
  const converted = [];
  let used = 0,
    overflow = false;
  for (const token of tokens) {
    const remaining = capacity ? capacity - used : token.length;
    if (!remaining || (codePage !== 65001 && token.length > remaining)) {
      overflow = true;
      break;
    }
    const count = Math.min(remaining, token.length);
    // The observed UTF8 writer can fill its final unit with the high
    // surrogate. A subsequent token then reports an insufficient buffer.
    if (capacity) converted.push(count === token.length ? token : token.slice(0, count));
    used += count;
  }
  if (capacity && used) {
    const text = converted.join(''),
      encoded = new Uint8Array(used * 2),
      view = new DataView(encoded.buffer);
    for (let i = 0; i < used; i++) view.setUint16(i * 2, text.charCodeAt(i), true);
    p.write(output, encoded);
  }
  if (overflow) return fail(122);
  // The UTF8 platform path retains converted prefix bytes on failure. A full
  // destination is checked before its invalid-sequence status is returned.
  if (invalid && flags & 8) return fail(1113);
  return used;
}
