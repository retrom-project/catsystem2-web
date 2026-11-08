// SPDX-License-Identifier: MPL-2.0
// Win32 output conversion for the mounted Japanese engine and plugin imports.
import { registryDecodeANSI, registryEncodeANSI } from '../native/registry-codepage.mjs';

const UTF8 = 65001;
const WC_ERR_INVALID_CHARS = 0x80;
const WC_COMPOSITECHECK = 0x200;
const WC_NO_BEST_FIT_CHARS = 0x400;
const CP932_FLAGS = 0x20 | 0x40 | 0x100 | WC_COMPOSITECHECK | WC_NO_BEST_FIT_CHARS;
const questionMark = Uint8Array.of(0x3f);
const utf8Encoder = new TextEncoder();

function fail(kernel, error) {
  kernel.lastError = error;
  return 0;
}

function cp932Replacement(process, pointer) {
  if (!pointer) return questionMark;
  const bytes = process.read(pointer, 2);
  if (!bytes[1]) return bytes.subarray(0, 1);
  return bytes[0] ? bytes : bytes.subarray(1);
}

function encodeCP932(kernel, source, flags, output, capacity, defaultChar, usedDefault) {
  const p = kernel.process,
    replacement = cp932Replacement(p, defaultChar),
    destination = capacity ? new Uint8Array(Math.min(source.byteLength, capacity)) : null,
    exact = Boolean(flags & WC_NO_BEST_FIT_CHARS);
  let written = 0,
    at = 0,
    used = false;
  for (; at < source.byteLength; at += 2) {
    if (destination && written === capacity) break;
    const char = String.fromCharCode(source.getUint16(at, true));
    let bytes = registryEncodeANSI(char);
    if (
      (exact || (bytes.length === 1 && bytes[0] === 0x3f)) &&
      registryDecodeANSI(bytes) !== char
    ) {
      used = true;
      bytes = replacement;
    }
    // The fallback is selected before checking space for its complete DBCS
    // character. Its used-default flag can therefore be set on this failure.
    if (destination && bytes.length > capacity - written) break;
    if (destination) destination.set(bytes, written);
    written += bytes.length;
  }
  if (usedDefault) p.store(usedDefault, Number(used));
  if (destination && written) p.write(output, destination.subarray(0, written));
  return at === source.byteLength ? written : fail(kernel, 122);
}

function encodeUTF8(kernel, source, flags, output, capacity) {
  const chunks = [];
  for (let at = 0; at < source.byteLength; ) {
    const units = [];
    for (; at < source.byteLength && units.length < 4096; at += 2)
      units.push(source.getUint16(at, true));
    chunks.push(String.fromCharCode(...units));
  }
  const text = chunks.join(''),
    bytes = utf8Encoder.encode(text);
  if (capacity && capacity < bytes.length) {
    // The output keeps complete preceding characters on buffer failure.
    let written = capacity;
    while (written && (bytes[written] & 0xc0) === 0x80) written--;
    if (written) kernel.process.write(output, bytes.subarray(0, written));
    return fail(kernel, 122);
  }
  if (capacity) kernel.process.write(output, bytes);
  if (flags & WC_ERR_INVALID_CHARS && !text.isWellFormed()) return fail(kernel, 1113);
  return bytes.length;
}

export function windowsWideCharToMultiByte(
  kernel,
  [codePage, flags, input, size, output, capacity, defaultChar, usedDefault],
) {
  size |= 0;
  capacity |= 0;
  if (!input || !size || capacity < 0 || (!output && capacity) || input === output)
    return fail(kernel, 87);
  if (![0, 1, 3, 932, UTF8].includes(codePage))
    throw new Error(`PPI unsupported byte encoder ${codePage}`);
  const utf8 = codePage === UTF8;
  if (flags & ~(utf8 ? WC_ERR_INVALID_CHARS : CP932_FLAGS)) return fail(kernel, 1004);
  if (utf8 && (defaultChar || usedDefault)) return fail(kernel, 87);
  if (flags & WC_COMPOSITECHECK)
    throw new Error('PPI CP932 composition flags require a reviewed caller contract');
  const p = kernel.process,
    bytes = size < 0 ? p.stringBytes(input, true, true) : p.read(input, size * 2),
    source = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  return utf8
    ? encodeUTF8(kernel, source, flags, output, capacity)
    : encodeCP932(kernel, source, flags, output, capacity, defaultChar, usedDefault);
}
