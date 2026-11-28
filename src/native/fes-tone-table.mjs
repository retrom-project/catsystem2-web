// SPDX-License-Identifier: MPL-2.0
// BGTABLE/BGTABLE2 own exact byte-key tone queries, independent of image tint.
import { nativeDataString, nativeDataKey, nativeDataBytes, nativeDataPair } from './data-text.mjs';
import { parseNativeInteger } from './standard.mjs';

const byteString = (value) => {
  if (!(value instanceof Uint8Array)) throw new TypeError('FES tone data requires bytes');
  return nativeDataString(value);
};
function bounded(value, name) {
  // The original uses 512-byte C-string temporaries. Native memory corruption
  // outside this bound has no defined value for the semantic service to copy.
  if (value.length >= 512)
    throw new RangeError(`FES tone ${name} exceeds its 512-byte destination`);
  return value;
}
function lowerKey(source) {
  const bytes = new Uint8Array(byteString(source));
  bounded(bytes, 'key');
  for (let at = 0; at < bytes.length; at++) {
    if (nativeDataPair(bytes, at)) at++;
    else if (bytes[at] >= 65 && bytes[at] <= 90) bytes[at] += 32;
  }
  return nativeDataKey(bytes);
}
function lines(source) {
  const result = [];
  let block = false;
  for (const line of nativeDataKey(byteString(source)).split(/\r\n|\r|\n/)) {
    let text = '';
    for (let at = 0; at < line.length; at++) {
      if (block) {
        if (line[at] === '*' && line[at + 1] === '/') {
          block = false;
          at++;
        }
      } else if (line[at] === '/' && line[at + 1] === '/') break;
      else if (line[at] === '/' && line[at + 1] === '*') {
        block = true;
        at++;
      } else text += line[at];
    }
    text = text.replace(/[\t ]/g, '');
    if (text) result.push(text);
  }
  return result;
}
function header(line, current) {
  const hash = line.indexOf('#'),
    open = hash < 0 ? -1 : line.indexOf('(', hash);
  if (open < 0) return false;
  current.group = bounded(line.slice(hash, open), 'group');
  let at = open + 1;
  for (let component = 0; component < 3; component++) {
    const end = line.indexOf(component === 2 ? ')' : ',', at),
      field = bounded(line.slice(at, end < 0 ? line.length : end), 'numeric component');
    if (end < 0) break;
    current.rgb[component] = (parseNativeInteger(field) ?? 0) >>> 0;
    at = end + 1;
  }
  return true;
}

export function parseFESToneTable(source) {
  const table = { groups: new Map(), files: new Map() },
    current = { group: '__UNKNOWN__', rgb: [100, 100, 100] };
  for (const line of lines(source)) {
    if (header(line, current)) continue;
    const group = lowerKey(nativeDataBytes(current.group)),
      file = lowerKey(nativeDataBytes(line));
    if (!table.groups.has(group)) table.groups.set(group, current.rgb.slice());
    if (!table.files.has(file)) table.files.set(file, group);
  }
  return table;
}

export function lookupFESToneGroup(table, group) {
  const key = lowerKey(group),
    rgb = table?.groups.get(key);
  return rgb ? rgb.slice() : null;
}

export function lookupFESToneFile(table, filename) {
  const key = lowerKey(filename),
    group = table?.files.get(key),
    rgb = group === undefined ? null : table.groups.get(group);
  return rgb ? rgb.slice() : null;
}

export function readFESToneRGB(table, currentFile) {
  return lookupFESToneFile(table, currentFile) ?? [100, 100, 100];
}

function owner(object) {
  if (object?.nativeType !== 16 && object?.nativeType !== 17)
    throw new TypeError('FES tone-table owner must be BGTABLE or BGTABLE2');
}

export async function replaceFESToneTable(object, filename, read) {
  owner(object);
  const name = new Uint8Array(byteString(filename));
  if (typeof read !== 'function') throw new TypeError('FES tone-table requires a resource reader');
  object.toneTable = null;
  const bytes = await read(name, 3);
  if (bytes === null) return 0;
  object.toneTable = parseFESToneTable(bytes);
  return 1;
}

export function clearFESToneTable(object) {
  owner(object);
  object.toneTable = null;
}
