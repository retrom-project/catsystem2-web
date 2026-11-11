// SPDX-License-Identifier: MPL-2.0
// FILELIST has byte-defined pattern conversion and JS-owned indexed entries.
import { encodeCP932 } from '../kcs/strings.mjs';
import { nativeDataPair } from './data-text.mjs';

export function fesFileListPattern(bytes, encoding) {
  const end = bytes.indexOf(0),
    source = end < 0 ? bytes : bytes.subarray(0, end);
  if (encoding === 'cp932') return new TextDecoder('shift_jis').decode(source);
  if (encoding !== 'cp932-as-utf16le') throw new Error('Unknown FILELIST pattern encoding');
  // Preserve the reviewed narrow/wide mismatch, with a complete UTF16 NUL.
  // Bytes beyond the current token are undefined native storage, never state.
  let result = '';
  for (let at = 0; at < source.length; at += 2)
    result += String.fromCharCode(source[at] | ((source[at + 1] ?? 0) << 8));
  return result;
}
export function fesFileListKey(name, encoding) {
  if (encoding === 'cp932') {
    const bytes = encodeCP932(name);
    for (let at = 0; at < bytes.length; at++) {
      if (nativeDataPair(bytes, at)) at++;
      else if (bytes[at] >= 65 && bytes[at] <= 90) bytes[at] += 32;
    }
    return [...bytes].map((byte) => byte.toString(16).padStart(2, '0')).join('');
  }
  if (encoding !== 'utf16le') throw new Error('Unknown FILELIST key encoding');
  let result = '';
  for (let at = 0; at < name.length; at++) {
    let word = name.charCodeAt(at);
    if (word >= 65 && word <= 90) word += 32;
    result += word.toString(16).padStart(4, '0');
  }
  return result;
}
export function fesFileListEntries(state) {
  return [...state.entries].sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
}
