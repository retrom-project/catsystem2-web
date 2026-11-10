// SPDX-License-Identifier: MPL-2.0
import { nativeReply } from '../kcs/vm.mjs';
import { NativeCompiledTable } from './compiled-table.mjs';
import { nativeDataArgument, nativeDataFormat, nativeDataKey } from './data-text.mjs';

export const NATIVE_SELECTION_TABLE_IDS = Object.freeze([
  0x30b, 0x30c, 0x30d, 0x30e, 0x30f, 0x310, 0x33d, 0x33e, 0x33f, 0x340,
]);
export class NativeSelectionTable {
  constructor() {
    this.names = new Map();
    this.tables = new Map();
    this.work = [];
  }
  async load(bytes) {
    const table = new NativeCompiledTable();
    if (!(await table.load(bytes))) return false;
    this.tables.clear();
    for (let row = 0; row < table.rows.length; row++) {
      if (!table.field(row, 'TBL')) break;
      const id = table.number(row, 'TBL') | 0;
      if (this.tables.has(id)) continue;
      const values = Array.from({ length: 19 }, (_, index) => {
        const field = table.field(row, `P${String(index).padStart(2, '0')}`);
        return field ? (this.names.get(nativeDataKey(field)) ?? -1) : -1;
      });
      this.tables.set(id, values);
    }
    return true;
  }
  select(id) {
    this.work = (this.tables.get(id | 0) ?? []).slice();
  }
  fillMissing() {
    // The original helper appends each missing slot's index to this vector.
    for (let index = 2; index < this.work.length; index++)
      if (this.work[index] === -1) this.work.push(index);
  }
  consume(index, mark) {
    if (index >>> 0 >= this.work.length)
      throw new RangeError('Native selection operation dereferences an invalid work index');
    if (this.work[index] >= 0) this.fillMissing();
    if (mark) this.work[index] = -10;
  }
  move(value, index) {
    const from = this.work.findIndex((word) => (word & 0x7fffffff) === value);
    if (from < 0 || this.work[from] < 0) return;
    if (index >>> 0 >= this.work.length)
      throw new RangeError('Native selection operation dereferences an invalid work index');
    this.work[from] = this.work[index];
    this.work[index] = value | 0x80000000;
  }
  snapshot() {
    return structuredClone({ names: this.names, tables: this.tables, work: this.work });
  }
  restore(state) {
    Object.assign(this, structuredClone(state));
    return this;
  }
}
export async function nativeSelectionTable(id, args, machine, services) {
  const argument = (index) => nativeDataArgument(args, machine, index),
    { handles } = services;
  if (id === 0x30b)
    return nativeReply(
      1,
      handles.add('content-database', { family: 'selection', data: new NativeSelectionTable() }),
    );
  const handle = argument(0);
  if (!handle)
    return nativeReply(
      [0x30e, 0x30f, 0x310].includes(id) ? 1 : 2,
      id === 0x310 ? -1 : id === 0x30e || id === 0x30f ? 0 : undefined,
    );
  const owner = handles.get(handle, 'content-database');
  if (owner.family !== 'selection')
    throw new Error('Native content database has a different object family');
  const table = owner.data;
  if (id === 0x30c) {
    handles.release(handle, 'content-database');
    return nativeReply(2);
  }
  if (id === 0x30d) {
    const name = nativeDataFormat(args, machine, services, 2);
    if (name !== null && !table.names.has(nativeDataKey(name)))
      table.names.set(nativeDataKey(name), argument(1) | 0);
  } else if (id === 0x30e) {
    const name = nativeDataFormat(args, machine, services, 1);
    if (name === null) return nativeReply(1, 0);
    const bytes = await services.read(new TextDecoder('shift_jis').decode(name), 'database');
    return nativeReply(1, Number(await table.load(bytes)));
  } else if (id === 0x30f) return nativeReply(1, table.tables.size);
  else if (id === 0x310) {
    const word = table.work[argument(1) >>> 0];
    return nativeReply(
      1,
      word === undefined || word === -1 ? -1 : word === -10 ? -10 : word & 0x7fffffff,
    );
  } else if (id === 0x33d) table.select(argument(1));
  else if (id === 0x33e) table.move(argument(1), argument(2));
  else table.consume(argument(1), id === 0x33f);
  return nativeReply(2);
}
export function installNativeSelectionTables(world) {
  for (const id of NATIVE_SELECTION_TABLE_IDS)
    world.runtime.register('main', id, (args, machine) =>
      nativeSelectionTable(id, args, machine, world.runtime.services),
    );
}
