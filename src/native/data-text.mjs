// SPDX-License-Identifier: MPL-2.0
import { encodeCP932 } from '../kcs/strings.mjs';

export function nativeDataArgument(args, machine, index) {
  return index < args.length ? args[index] : machine.nativeArgument(index);
}
export function nativeDataMapped(machine, address) {
  try {
    machine.region(address >>> 0, 1);
    return true;
  } catch {
    return false;
  }
}
export function nativeDataString(bytes) {
  const end = bytes.indexOf(0);
  return end < 0 ? bytes : bytes.subarray(0, end);
}
export function nativeDataKey(bytes) {
  return Array.from(nativeDataString(bytes), (byte) => String.fromCharCode(byte)).join('');
}
export function nativeDataFormat(args, machine, services, index) {
  const address = nativeDataArgument(args, machine, index);
  if (!nativeDataMapped(machine, address)) return null;
  return nativeDataString(
    services.formatBytes
      ? services.formatBytes(address, machine)
      : encodeCP932(services.format(address, machine)),
  );
}

export function nativeDataBytes(text) {
  return Uint8Array.from(text, (character) => character.charCodeAt(0));
}
export function nativeDataLines(bytes) {
  const lines = nativeDataKey(bytes).split(/\r\n|\r|\n/),
    result = [];
  let comment = false;
  for (const line of lines) {
    let text = '';
    for (let i = 0; i < line.length; i++) {
      if (comment) {
        if (line[i] === '*' && line[i + 1] === '/') {
          comment = false;
          i++;
        }
      } else if (line[i] === '/' && line[i + 1] === '/') break;
      else if (line[i] === '/' && line[i + 1] === '*') {
        comment = true;
        i++;
      } else text += line[i];
    }
    text = text.replaceAll('\t', ' ').replace(/ +/g, ' ').replace(/^ | $/g, '');
    if (text) result.push(nativeDataBytes(text));
  }
  return result;
}

export function nativeDataPair(bytes, at) {
  const first = bytes[at],
    second = bytes[at + 1];
  return (
    ((first >= 0x81 && first <= 0x9f) || (first >= 0xe0 && first <= 0xef)) &&
    ((second >= 0x40 && second <= 0x7e) || (second >= 0x80 && second <= 0xfc))
  );
}
export function nativeDataCString(machine, address, capacity = 0x10000000) {
  const bytes = [];
  for (let at = 0; at < capacity; at++) {
    const byte = machine.load((address + at) >>> 0, 1);
    if (!byte) return Uint8Array.from(bytes);
    bytes.push(byte);
  }
  throw new RangeError('Native data string exceeds its destination capacity');
}
export function nativeDataTSV(bytes) {
  const rows = [];
  let at = 0;
  while (at < bytes.length) {
    const fields = [];
    while (at < bytes.length && bytes[at] !== 13 && bytes[at] !== 10) {
      const field = [],
        quoted = bytes[at] === 34;
      if (quoted) at++;
      let end = false;
      while (at < bytes.length && !end) {
        const byte = bytes[at];
        if (!byte) throw new Error('Native TSV stops advancing at an embedded NUL');
        if ((byte === 9 && !quoted) || ((byte === 13 || byte === 10) && !quoted)) break;
        if (byte === 34) {
          if (bytes[at + 1] === 34) {
            field.push(34);
            at += 2;
          } else {
            at++;
            end = true;
          }
        } else if (byte === 13 || byte === 10) {
          at++;
          if (bytes[at] === (byte === 13 ? 10 : 13)) at++;
        } else if (nativeDataPair(bytes, at)) {
          field.push(byte, bytes[at + 1]);
          at += 2;
        } else {
          field.push(byte);
          at++;
        }
      }
      while (at < bytes.length && ![9, 10, 13].includes(bytes[at])) {
        if (!bytes[at]) throw new Error('Native TSV stops advancing at an embedded NUL');
        at += nativeDataPair(bytes, at) ? 2 : 1;
      }
      if (bytes[at] === 9) at++;
      fields.push(Uint8Array.from(field));
    }
    rows.push(fields);
    const newline = bytes[at++];
    if (newline === 13 && bytes[at] === 10) at++;
  }
  return rows;
}
