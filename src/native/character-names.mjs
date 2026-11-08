// SPDX-License-Identifier: MPL-2.0
// Main 252..255: group RGB values and character-name aliases, 78D820..78E305.
import { encodeCP932 } from '../kcs/strings.mjs';
import { nativeReply } from '../kcs/vm.mjs';
import { parseNativeInteger } from './standard.mjs';

function key(bytes) {
  const folded = bytes.slice();
  for (let i = 0; i < folded.length; i++) {
    const lead = folded[i],
      trail = folded[i + 1];
    if (
      ((lead >= 0x81 && lead <= 0x9f) || (lead >= 0xe0 && lead <= 0xef)) &&
      ((trail >= 0x40 && trail <= 0x7e) || (trail >= 0x80 && trail <= 0xfc))
    )
      i++;
    else if (lead >= 65 && lead <= 90) folded[i] += 32;
  }
  return Array.from(folded, (byte) => byte.toString(16).padStart(2, '0')).join('');
}
function lines(source) {
  let end = source.indexOf(0);
  if (end === -1) end = source.length;
  const rows = [];
  let start = 0;
  for (let at = 0; at < end; at++)
    if (source[at] === 13 || source[at] === 10) {
      rows.push(source.subarray(start, at));
      if (source[at] === 13 && source[at + 1] === 10) at++;
      start = at + 1;
    }
  if (start < end) rows.push(source.subarray(start, end));
  let comment = false;
  return rows
    .map((row) => {
      const output = [];
      for (let i = 0; i < row.length; i++) {
        if (comment) {
          if (row[i] === 42 && row[i + 1] === 47) {
            comment = false;
            i++;
          }
        } else if (row[i] === 47 && row[i + 1] === 47) break;
        else if (row[i] === 47 && row[i + 1] === 42) {
          comment = true;
          i++;
        } else output.push(row[i]);
      }
      return Uint8Array.from(output.filter((byte) => byte !== 9 && byte !== 32));
    })
    .filter((row) => row.length);
}
function header(row, current) {
  const hash = row.indexOf(35);
  if (hash < 0) return false;
  const open = row.indexOf(40, hash);
  if (open < 0) return false;
  if (open - hash >= 512) throw new RangeError('Native character-color header exceeds 512 bytes');
  current.group = key(row.subarray(hash, open));
  let at = open + 1;
  for (let i = 0; i < 3; i++) {
    const end = row.indexOf(i === 2 ? 41 : 44, at);
    if (end < 0) break;
    if (end - at >= 512) throw new RangeError('Native character-color number exceeds 512 bytes');
    current.color[i] =
      (parseNativeInteger(new TextDecoder('windows-1252').decode(row.subarray(at, end))) ?? 0) >>>
      0;
    at = end + 1;
  }
  return true;
}

export class NativeCharacterNames {
  constructor(source) {
    this.groups = new Map();
    this.names = new Map();
    if (source !== undefined) this.parse(source);
  }
  parse(source) {
    if (!(source instanceof Uint8Array))
      throw new TypeError('Native character names require bytes');
    const current = { group: key(encodeCP932('__UNKNOWN__')), color: [100, 100, 100] };
    for (const row of lines(source)) {
      if (header(row, current)) continue;
      const name = key(row);
      if (!this.groups.has(current.group)) this.groups.set(current.group, [...current.color]);
      if (!this.names.has(name)) this.names.set(name, current.group);
    }
    return this;
  }
  byGroup(bytes) {
    return this.groups.get(key(bytes)) ?? null;
  }
  byName(bytes) {
    const group = this.names.get(key(bytes));
    return group === undefined ? null : (this.groups.get(group) ?? null);
  }
  snapshot() {
    return { groups: [...this.groups], names: [...this.names] };
  }
  restore(state) {
    this.groups = new Map(state.groups);
    this.names = new Map(state.names);
  }
}
export const nativeCharacterNamesCodec = {
  snapshot: (value) => value.snapshot(),
  restore: (state) => {
    const value = new NativeCharacterNames();
    value.restore(state);
    return value;
  },
};

export function nativeCharacterNames(id, args, machine, services = {}) {
  if (id < 0x252 || id > 0x255) return undefined;
  const count = id <= 0x253 ? 1 : 5;
  if (args.length !== count)
    throw new Error(`KCS character names native 0x${id.toString(16)} expects ${count} arguments`);
  if (!services.handles) return undefined;
  if (id === 0x253) {
    if (args[0]) services.handles.release(args[0], 'character-names');
    return nativeReply(2);
  }
  if (id === 0x252) {
    if (!services.read || !services.format) return undefined;
    const file = services.format(args[0], machine),
      finish = (bytes) =>
        nativeReply(
          1,
          bytes === null
            ? 0
            : services.handles.add('character-names', new NativeCharacterNames(bytes)),
        ),
      bytes = services.read(file);
    return bytes && typeof bytes.then === 'function' ? bytes.then(finish) : finish(bytes);
  }
  if (!args[0]) return nativeReply(1, 0);
  if (!services.format) return undefined;
  const names = services.handles.get(args[0], 'character-names'),
    query = encodeCP932(services.format(args[1], machine)),
    color = id === 0x254 ? names.byGroup(query) : names.byName(query);
  if (color) for (let i = 0; i < 3; i++) machine.store(args[i + 2], color[i]);
  return nativeReply(1, Number(Boolean(color)));
}
