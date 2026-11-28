// SPDX-License-Identifier: MPL-2.0
import { nativeReply } from '../kcs/vm.mjs';
import {
  nativeDataArgument,
  nativeDataFormat,
  nativeDataKey,
  nativeDataLines,
  nativeDataMapped,
} from './data-text.mjs';

export const NATIVE_SECTION_TABLE_IDS = Object.freeze([0x2ab, 0x2ac, 0x2ad]);
export class NativeSectionTable {
  constructor(bytes = null) {
    this.sections = new Map();
    let rows = null;
    for (const line of bytes ? nativeDataLines(bytes) : []) {
      if (line[0] === 35) {
        const section = nativeDataKey(line);
        if (!this.sections.has(section)) this.sections.set(section, []);
        rows = this.sections.get(section);
      } else if (rows) {
        const delimiter = line.indexOf(32),
          key = delimiter < 0 ? line : line.subarray(0, delimiter),
          value = delimiter < 0 ? new Uint8Array() : line.slice(delimiter + 1);
        rows.push({ key: nativeDataKey(key), value });
      }
    }
  }
  snapshot() {
    return structuredClone([...this.sections]);
  }
}
export const nativeSectionTableCodec = Object.freeze({
  snapshot: (table) => table.snapshot(),
  restore: (state) => {
    const table = new NativeSectionTable();
    table.sections = new Map(structuredClone(state));
    return table;
  },
});
export async function nativeSectionTable(id, args, machine, services) {
  const handle = nativeDataArgument(args, machine, 0),
    { handles } = services;
  if (id === 0x2ab) {
    const name = nativeDataFormat(args, machine, services, 0);
    if (name === null) return nativeReply(1, 0);
    const bytes = await services.read(new TextDecoder('shift_jis').decode(name));
    return nativeReply(
      1,
      bytes === null ? 0 : handles.add('section-table', new NativeSectionTable(bytes)),
    );
  }
  if (id === 0x2ac) {
    if (handle) handles.release(handle, 'section-table');
    return nativeReply(2);
  }
  if (!handle) return nativeReply(1, 0);
  const table = handles.get(handle, 'section-table'),
    section = nativeDataFormat(args, machine, services, 1);
  if (section === null) return nativeReply(1, 0);
  const key = nativeDataFormat(args, machine, services, 2);
  if (key === null) return nativeReply(1, 0);
  const ordinal = nativeDataArgument(args, machine, 3) | 0,
    destination = nativeDataArgument(args, machine, 4);
  if (!nativeDataMapped(machine, destination)) return nativeReply(1, 0);
  const rows = table.sections.get(nativeDataKey(section)),
    row = rows?.filter((row) => row.key === nativeDataKey(key))[ordinal];
  if (!row) return nativeReply(1, 0);
  machine.bytes(destination, row.value.length + 1).set([...row.value, 0]);
  return nativeReply(1, 1);
}
export function installNativeSectionTables(world) {
  for (const id of NATIVE_SECTION_TABLE_IDS)
    world.runtime.register('main', id, (args, machine) =>
      nativeSectionTable(id, args, machine, world.runtime.services),
    );
}
