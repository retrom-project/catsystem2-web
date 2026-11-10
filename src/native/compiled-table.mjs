// SPDX-License-Identifier: MPL-2.0
import { Binary, inflate } from '../binary.mjs';
import { nativeReply } from '../kcs/vm.mjs';
import {
  nativeDataKey,
  nativeDataFormat,
  nativeDataArgument,
  nativeDataMapped,
} from './data-text.mjs';

export class NativeCompiledTable {
  constructor() {
    this.columns = [];
    this.rows = [];
    this.stride = 0;
  }
  async load(bytes) {
    this.columns = [];
    this.rows = [];
    this.stride = 0;
    if (!bytes?.length) return false;
    const file = new Binary(bytes, 'Native KCDB');
    if (!file.magic('KCDB')) return false;
    const size = file.u32(8);
    if (size > 0x10000000) throw new RangeError('Native KCDB exceeds its resource limit');
    const compressed = file.range(12, file.u32(4));
    let unpacked;
    try {
      unpacked = await inflate(compressed, size);
    } catch {
      return false;
    }
    const body = new Binary(unpacked, 'Native KCDB body'),
      count = body.u32(0),
      columns = [];
    let offset = 0;
    body.range(4, count * 24);
    for (let i = 0; i < count; i++) {
      const at = 4 + i * 24,
        width = body.u32(at + 20);
      columns.push({
        name: nativeDataKey(body.range(at, 16)),
        type: body.u32(at + 16),
        size: width,
        offset,
      });
      offset += width;
    }
    const at = 4 + count * 24,
      records = body.u32(at),
      stride = body.u32(at + 4);
    if (offset > stride) throw new Error('Native KCDB columns exceed its record width');
    body.range(at + 8, records * stride);
    const rows = Array.from({ length: records }, (_, i) =>
      body.range(at + 8 + i * stride, stride).slice(),
    );
    Object.assign(this, { columns, rows, stride });
    return true;
  }
  field(index, name) {
    const row = this.rows[index >>> 0],
      column = this.columns.find((column) => column.name === name);
    return row && column ? row.subarray(column.offset, column.offset + column.size) : null;
  }
  number(index, name) {
    const field = this.field(index, name);
    if (!field || field.length > 4) return 0;
    const bytes = new Uint8Array(4);
    bytes.set(field);
    return new DataView(bytes.buffer).getUint32(0, true);
  }
  snapshot() {
    return {
      columns: structuredClone(this.columns),
      rows: this.rows.map((row) => row.slice()),
      stride: this.stride,
    };
  }
  restore(state) {
    this.columns = structuredClone(state.columns);
    this.rows = state.rows.map((row) => Uint8Array.from(row));
    this.stride = state.stride;
    return this;
  }
}

export const NATIVE_COMPILED_TABLE_IDS = Object.freeze([0x317, 0x318, 0x319, 0x31a]);
export async function nativeCompiledTable(id, args, machine, services) {
  const argument = (index) => nativeDataArgument(args, machine, index),
    { handles } = services;
  if (id === 0x317) {
    const name = nativeDataFormat(args, machine, services, 0);
    if (name === null) return nativeReply(1, 0);
    const table = new NativeCompiledTable(),
      bytes = await services.read(new TextDecoder('shift_jis').decode(name), 'database');
    if (!(await table.load(bytes))) return nativeReply(1, 0);
    return nativeReply(
      1,
      handles.add('content-database', { family: 'compiledTable', data: table }),
    );
  }
  const handle = argument(0);
  if (!handle) return nativeReply(id === 0x318 ? 2 : 1, id === 0x318 ? undefined : 0);
  const owner = handles.get(handle, 'content-database');
  if (owner.family !== 'compiledTable')
    throw new Error('Native content database has a different object family');
  if (id === 0x318) {
    handles.release(handle, 'content-database');
    return nativeReply(2);
  }
  const destination = id === 0x31a ? argument(3) : null;
  if (destination !== null && !nativeDataMapped(machine, destination)) return nativeReply(1, 0);
  const name = nativeDataFormat(args, machine, services, 1);
  if (name === null) return nativeReply(1, 0);
  const field = owner.data.field(argument(2), nativeDataKey(name));
  if (id === 0x319) return nativeReply(1, owner.data.number(argument(2), nativeDataKey(name)));
  if (!field) return nativeReply(1, 0);
  machine.bytes(destination, field.length).set(field);
  return nativeReply(1, field.length);
}
export function installNativeCompiledTables(world) {
  for (const id of NATIVE_COMPILED_TABLE_IDS)
    world.runtime.register('main', id, (args, machine) =>
      nativeCompiledTable(id, args, machine, world.runtime.services),
    );
}
