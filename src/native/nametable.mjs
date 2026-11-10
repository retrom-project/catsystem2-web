// SPDX-License-Identifier: MPL-2.0
import { nativeABI } from './abi/index.mjs';
import { nativeReply } from '../kcs/vm.mjs';
import { parseNativeInteger } from './standard.mjs';
import {
  nativeDataArgument,
  nativeDataCString,
  nativeDataFormat,
  nativeDataKey,
  nativeDataMapped,
  nativeDataTSV,
} from './data-text.mjs';

export const NATIVE_NAME_TABLE_IDS = Object.freeze(Array.from({ length: 8 }, (_, i) => 0x279 + i));
function wildcard(source, pattern) {
  if (pattern.length === 1 && pattern[0] === 42) return true;
  let at = 0;
  while (at < source.length && at < pattern.length) {
    if (pattern[at] === 42) return true;
    if (pattern[at] !== 63 && pattern[at] !== source[at]) return false;
    at++;
  }
  return at === source.length && at === pattern.length;
}
function extension(bytes) {
  for (let i = bytes.length - 1; i >= 0; i--) {
    if (bytes[i] === 92 || bytes[i] === 47) break;
    if (bytes[i] === 46) return i + 1;
  }
  return bytes.length;
}
function matches(source, pattern) {
  const prefix = source.subarray(0, pattern.length),
    first = extension(prefix),
    second = extension(pattern);
  return (
    wildcard(prefix.subarray(0, first), pattern.subarray(0, second)) &&
    wildcard(prefix.subarray(first), pattern.subarray(second))
  );
}
function replaceFilename(machine, source, destination, pattern, template) {
  const input = (index) => machine.load((source + index) >>> 0, 1),
    write = (index, value) => machine.store((destination + index) >>> 0, value, 1),
    signed = (byte) => (byte << 24) >> 24;
  let output = 0;
  for (let at = 0; at < template.length; at++) {
    if (template[at] !== 37) {
      write(output++, template[at]);
      continue;
    }
    const code = template[at + 1];
    if (code === 99) {
      write(output, input(output));
      output++;
      at++;
    } else if (code === 102) {
      for (const byte of pattern) write(output++, byte);
      at++;
    } else if (code === 110) {
      let from = 0;
      while (input(from) && input(from) !== 44 && (input(from) < 48 || input(from) > 57)) from++;
      while (input(from) >= 48 && input(from) <= 57) write(output++, input(from++));
      at++;
    } else if (code === 114 || code === 115) {
      let from = code === 114 ? output : 0;
      while (input(from)) write(output++, input(from++));
      at++;
    } else write(output++, 37);
  }
  write(output, 0);
  // The comma scan compares its position with the next signed source byte.
  let comma = 0;
  if (signed(input(0)) <= 0) return;
  while (input(comma) !== 44) {
    comma++;
    if (comma >= signed(input(comma))) return;
  }
  let append = 0;
  while (machine.load((destination + append) >>> 0, 1)) append++;
  while (input(comma)) write(append++, input(comma++));
  write(append, 0);
}
export class NativeNameTable {
  constructor(bytes = null, aliases = false) {
    this.rows = [];
    for (const fields of bytes ? nativeDataTSV(bytes) : []) {
      const id = fields[0],
        name = fields[1];
      if (!id?.length || id[0] < 48 || id[0] > 57 || !name) continue;
      if (fields.slice(1, 4).some((field) => field.length > 255))
        throw new RangeError('Native name-table field exceeds its 256-byte buffer');
      this.rows.push({
        id: parseNativeInteger(nativeDataKey(id)) ?? 0,
        name: name.slice(),
        names: [name, ...(aliases ? fields.slice(4) : [])].map(nativeDataKey),
        fields: [fields[2]?.slice() ?? new Uint8Array(), fields[3]?.slice() ?? new Uint8Array()],
      });
    }
  }
}
export const nativeNameTableCodec = Object.freeze({
  snapshot: (table) => structuredClone(table.rows),
  restore: (state) => {
    const table = new NativeNameTable();
    table.rows = structuredClone(state);
    return table;
  },
});
export async function nativeNameTable(id, args, machine, services) {
  const handle = nativeDataArgument(args, machine, 0),
    { handles } = services;
  if (id === 0x279) {
    const name = nativeDataFormat(args, machine, services, 0);
    if (name === null) return nativeReply(1, 0);
    const filename = new TextDecoder('shift_jis').decode(name),
      first = await services.read(filename, 'fes');
    if (!first?.length) return nativeReply(1, 0);
    const bytes = await services.read(filename, 'fes');
    return nativeReply(
      1,
      handles.add('nametable', new NativeNameTable(bytes, services.nameTableAliases)),
    );
  }
  if (id === 0x27a) {
    if (handle) handles.release(handle, 'nametable');
    return nativeReply(2);
  }
  if (!handle) return nativeReply(1, id === 0x27b || id === 0x27c ? -1 : 0);
  const table = handles.get(handle, 'nametable');
  if (id === 0x27b) {
    const name = nativeDataFormat(args, machine, services, 1);
    return nativeReply(
      1,
      name === null ? -1 : table.rows.findIndex((row) => row.names.includes(nativeDataKey(name))),
    );
  }
  const index = nativeDataArgument(args, machine, 1) | 0,
    row = table.rows[index];
  if (id === 0x27c) return nativeReply(1, row?.id ?? -1);
  if (id === 0x27d) {
    if (!row) return nativeReply(1, 0);
    machine.writeStringBytes(row.name, nativeDataArgument(args, machine, 2));
    return nativeReply(1, 1);
  }
  if (id === 0x27e) {
    const field = row?.fields[nativeDataArgument(args, machine, 2) | 0],
      destination = nativeDataArgument(args, machine, 3);
    if (!field) return nativeReply(1, 0);
    if (nativeDataMapped(machine, destination)) machine.writeStringBytes(field, destination);
    return nativeReply(1, 1);
  }
  if (!row) throw new Error('Native filename rules dereference an invalid name-table row');
  const source = nativeDataArgument(args, machine, 2);
  if (id === 0x27f)
    return nativeReply(1, Number(matches(nativeDataCString(machine, source, 256), row.fields[0])));
  replaceFilename(
    machine,
    source,
    nativeDataArgument(args, machine, 3),
    row.fields[0],
    row.fields[1],
  );
  return nativeReply(1, 1);
}
export function installNativeNameTables(world) {
  world.runtime.services.nameTableAliases = nativeABI(world.profile).capabilities.nameTableAliases;
  for (const id of NATIVE_NAME_TABLE_IDS)
    world.runtime.register('main', id, (args, machine) =>
      nativeNameTable(id, args, machine, world.runtime.services),
    );
}
