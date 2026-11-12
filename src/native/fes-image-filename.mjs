// SPDX-License-Identifier: MPL-2.0
// The Game image callback owns distinct original narrow SOURCE/CURRENT values.
// Its verified normal C-locale path compares bytes, including CP932 trail bytes.
import { nativeABI } from './abi/index.mjs';
import { encodeCP932 } from '../kcs/strings.mjs';
import { nativeDataString } from './data-text.mjs';

const types = new Set([2, 6, 11, 12, 16, 17, 18, 19, 20, 22]),
  decoder = new TextDecoder('shift_jis'),
  tokens = [new TextEncoder().encode('%LANG%'), new TextEncoder().encode('%LANG_M%')];

function filenameBytes(source) {
  if (!(source instanceof Uint8Array))
    throw new TypeError('FES image SOURCE/CURRENT requires original narrow bytes');
  const bytes = nativeDataString(source);
  if (bytes.length >= 256)
    throw new RangeError('FES image filename exceeds its defined 256-byte CString field');
  return new Uint8Array(bytes);
}
function replace(source, token, prefix) {
  const output = [];
  for (let at = 0; at < source.length; ) {
    if (token.every((byte, i) => source[at + i] === byte)) {
      output.push(...prefix);
      at += token.length;
    } else output.push(source[at++]);
  }
  return filenameBytes(new Uint8Array(output));
}
function equalASCII(left, right) {
  if (left.length !== right.length) return false;
  for (let at = 0; at < left.length; at++) {
    const a = left[at],
      b = right[at],
      x = a >= 65 && a <= 90 ? a + 32 : a,
      y = b >= 65 && b <= 90 ? b + 32 : b;
    if (x !== y) return false;
  }
  return true;
}
export function initializeFESImageFilename(object, profile) {
  if (!nativeABI(profile).fes.configurationMessage.liveObjects || !types.has(object.nativeType))
    return;
  object.fileSourceBytes = new Uint8Array();
  if (object.nativeType !== 16 && object.nativeType !== 17) object.fileBytes = new Uint8Array();
  Object.defineProperty(object, 'file', {
    configurable: true,
    enumerable: false,
    get() {
      return decoder.decode(this.fileBytes);
    },
  });
}
export function refreshFESImageFilename(world, object) {
  if (!types.has(object.nativeType) || !Object.hasOwn(object, 'fileSourceBytes'))
    throw new TypeError('FES image filename callback requires its initialized Game family');
  // No JS startup/FES API mutates a CRT locale. Non-C/unknown locale consumers
  // require a separately reviewed route; this ABI value is the verified domain,
  // never an inference from a native flag or a request to fall back to ASCII.
  if (nativeABI(world.profile).fes.configurationMessage.filenameComparison !== 'c-locale-ascii')
    throw new Error('Unrecovered FES image filename locale comparison');
  const language = world.configuration.language;
  let current = filenameBytes(object.fileSourceBytes);
  for (const [at, field] of ['ui', 'main'].entries()) {
    const entries = language.entries,
      selected = language[field] >>> 0,
      fallback = language.default >>> 0,
      row = entries[selected] ?? entries[fallback];
    if (!row) continue;
    if (typeof row.prefix !== 'string') throw new TypeError('FES language prefix requires text');
    const prefix = filenameBytes(encodeCP932(row.prefix.split('\0', 1)[0]));
    current = replace(current, tokens[at], prefix);
  }
  if (!equalASCII(current, object.fileBytes)) object.imageChanged = true;
  object.fileBytes = current;
}
export function setFESImageSourceFilename(world, object, source) {
  object.fileSourceBytes = filenameBytes(source);
  refreshFESImageFilename(world, object);
}
