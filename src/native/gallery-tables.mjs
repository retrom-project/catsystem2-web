// SPDX-License-Identifier: MPL-2.0
import { nativeReply } from '../kcs/vm.mjs';
import { nativeDataArgument, nativeDataFormat, nativeDataMapped } from './data-text.mjs';

export const NATIVE_GALLERY_TABLE_IDS = Object.freeze(
  Array.from({ length: 12 }, (_, index) => 0x195 + index),
);
const word = (value) => nativeReply(1, value),
  done = () => nativeReply(2);
export class NativeGalleryTable {
  constructor(kind, bytes = new Uint8Array()) {
    this.kind = kind;
    this.bytes = kind === 'variants' && bytes.length !== 86400 ? new Uint8Array() : bytes.slice();
  }
  word(offset) {
    return new DataView(this.bytes.buffer, this.bytes.byteOffset, this.bytes.length).getUint32(
      offset,
      true,
    );
  }
  get count() {
    if (this.kind === 'names') return this.word(0);
    let count = 0;
    for (let group = 0; group < 20; group++) if (this.fileCount(group)) count++;
    return count;
  }
  fileCount(group) {
    if (!this.bytes.length || group >>> 0 >= 20) return 0;
    let count = 0;
    for (let slot = 0; slot < 8; slot++) if (this.word((group * 8 + slot) * 540)) count++;
    return count;
  }
  choices(group, file, second = false) {
    return this.bytes.length && group >>> 0 < 20 && file >>> 0 < 8
      ? this.word((group * 8 + file) * 540 + (second ? 280 : 20))
      : 0;
  }
  string(offset) {
    const end = this.bytes.indexOf(0, offset);
    if (end < 0) throw new RangeError('Native gallery string crosses its source allocation');
    return this.bytes.subarray(offset, end);
  }
  reference(group, file, first, second) {
    if (
      !this.bytes.length ||
      group >>> 0 >= 20 ||
      file >>> 0 >= 8 ||
      first >>> 0 >= 16 ||
      second >>> 0 >= 16 ||
      group >= this.count ||
      file >= this.fileCount(group) ||
      first >= (this.choices(group, file) | 0) ||
      second >= (this.choices(group, file, true) | 0)
    )
      return null;
    const at = (group * 8 + file) * 540,
      mask = new Uint8Array(16);
    for (const offset of [at + 24 + 16 * first, at + 284 + 16 * second])
      for (let index = 0; index < 16; index++) {
        const byte = this.bytes[offset + index];
        if (byte && byte !== 48) mask[index] = byte;
      }
    let length = 16;
    while (length && !mask[length - 1]) length--;
    const base = this.string(at + 4),
      out = [...base];
    for (let index = 0; index < length; index++) out.push(44, mask[index] || 48);
    return Uint8Array.from(out);
  }
  field(row, column) {
    if ((row | 0) < 0 || (row | 0) >= (this.count | 0) || column >>> 0 > 3) return null;
    const offset = 4 + 128 * (row | 0) + 32 * column;
    if (offset >= this.bytes.length)
      throw new RangeError('Native gallery row crosses its source allocation');
    return this.bytes[offset] ? this.string(offset) : null;
  }
  snapshot() {
    return { kind: this.kind, bytes: this.bytes.slice() };
  }
}
export const nativeGalleryTableCodec = Object.freeze({
  snapshot: (table) => table.snapshot(),
  restore: (state) => new NativeGalleryTable(state.kind, state.bytes),
});
export function nativeGalleryTable(id, args, machine, services = {}) {
  if (!NATIVE_GALLERY_TABLE_IDS.includes(id)) return undefined;
  const argument = (index) => nativeDataArgument(args, machine, index),
    load = id === 0x195 || id === 0x19c;
  if (!load && !argument(0)) return id === 0x196 || id === 0x19d ? done() : word(0);
  if (!services.handles) return undefined;
  if (load) {
    if (!services.read || !services.formatBytes) return undefined;
    const name = nativeDataFormat(args, machine, services, 0);
    if (name === null) throw new Error('Native gallery-table formatting reads an unmapped source');
    return (async () => {
      const filename = new TextDecoder('shift_jis').decode(name),
        first = await services.read(filename, 'fes');
      if (!first?.length && id === 0x19c) return word(0);
      const bytes = (await services.read(filename, 'fes')) ?? new Uint8Array();
      return word(
        services.handles.add(
          'gallery-table',
          new NativeGalleryTable(id === 0x195 ? 'variants' : 'names', bytes),
        ),
      );
    })();
  }
  const handle = argument(0),
    table = services.handles.get(handle, 'gallery-table'),
    variants = id <= 0x19b;
  if (table.kind !== (variants ? 'variants' : 'names'))
    throw new Error('Native gallery table has a different binary layout');
  if (id === 0x196 || id === 0x19d) {
    services.handles.release(handle, 'gallery-table');
    return done();
  }
  if (id === 0x197 || id === 0x19e) return word(table.count);
  if (id === 0x198) return word(table.fileCount(argument(1)));
  if (id === 0x199 || id === 0x19a)
    return word(table.choices(argument(1), argument(2), id === 0x19a));
  if (id === 0x19b) {
    const destination = argument(5),
      bytes = table.reference(argument(1), argument(2), argument(3), argument(4));
    if (!bytes || !nativeDataMapped(machine, destination)) return word(0);
    machine.writeStringBytes(Uint8Array.from([...bytes, 0]), destination);
    return word(1);
  }
  const bytes = table.field(argument(1), argument(2));
  if (!bytes) return word(0);
  if (id === 0x1a0 && nativeDataMapped(machine, argument(3)))
    machine.writeStringBytes(bytes, argument(3));
  return word(1);
}
