// SPDX-License-Identifier: MPL-2.0
import { nativeReply } from '../kcs/vm.mjs';
import { encodeCP932 } from '../kcs/strings.mjs';
import { NativeCompiledTable } from './compiled-table.mjs';
import { compareNativeBytes } from './dictionary.mjs';
import {
  nativeDataArgument,
  nativeDataFormat,
  nativeDataKey,
  nativeDataPair,
  nativeDataString,
} from './data-text.mjs';

export const NATIVE_DATABASE_IDS = Object.freeze([0x365, 0x366, 0x367, 0x368, 0x369, 0x36d, 0x36e]);
const kana = 'がぎぐげござじずぜぞだぢづでどばびぶべぼぱぴぷぺぽぁぃぅぇぉゃゅょっ',
  plain = 'かきくけこさしすせそたちつてとはひふへほはひふへほあいうえおやゆよつ',
  replacements = new Map(
    Array.from(kana, (character, i) => {
      const from = encodeCP932(character),
        to = encodeCP932(plain[i]);
      return [(from[0] << 8) | from[1], to];
    }),
  );
export function normalizeDatabaseIndex(value) {
  const bytes = nativeDataString(value).slice();
  for (let at = 0; at < bytes.length; at++)
    if (nativeDataPair(bytes, at)) {
      const replacement = replacements.get((bytes[at] << 8) | bytes[at + 1]);
      if (replacement) bytes.set(replacement, at);
      at++;
    }
  // The original long-vowel branch has an impossible signed-byte comparison.
  return bytes;
}
export class NativeDatabase {
  constructor() {
    this.records = new Map();
    this.modified = 0;
  }
  async load(bytes) {
    const table = new NativeCompiledTable();
    if (!(await table.load(bytes))) return;
    if (!table.columns.some((column) => column.name === 'ID')) return;
    let scratch = null;
    for (let index = 0; index < table.rows.length; index++) {
      for (const name of [
        'TITLE_S',
        'TITLE',
        ...Array.from({ length: 24 }, (_, i) => `IND${i + 1}`),
        'INDEX',
      ]) {
        const field = table.field(index, name);
        if (field) scratch = field;
      }
      if (!scratch) throw new Error('Native database index reads an uninitialized field buffer');
      const name = normalizeDatabaseIndex(scratch),
        key = nativeDataKey(name);
      if (name.length > 255) throw new RangeError('Native database index exceeds its export field');
      if (!this.records.has(key)) this.records.set(key, { name, flags: new Uint32Array(3) });
    }
  }
  set(name, bit) {
    const row = this.records.get(nativeDataKey(normalizeDatabaseIndex(name)));
    if (!row) return;
    const mask = 1 << (bit & 31);
    if (!row.flags[0]) {
      row.flags[2] = 1;
      this.modified = 1;
    }
    if (!(row.flags[0] & mask)) {
      row.flags[0] |= mask;
      row.flags[1] |= mask;
      this.modified = 1;
    }
  }
  export() {
    const rows = [...this.records.values()].sort((a, b) => compareNativeBytes(a.name, b.name)),
      bytes = new Uint8Array(4 + rows.length * 268),
      view = new DataView(bytes.buffer);
    view.setUint32(0, rows.length, true);
    rows.forEach((row, i) => {
      const at = 4 + i * 268;
      bytes.set(row.name, at);
      row.flags.forEach((word, j) => view.setUint32(at + 256 + j * 4, word, true));
    });
    return bytes;
  }
  import(memory, pointer) {
    const count = memory.load(pointer);
    for (let i = 0; i < count; i++) {
      const at = pointer + 4 + i * 268,
        raw = memory.read(at, 256),
        name = normalizeDatabaseIndex(raw),
        row = this.records.get(nativeDataKey(name));
      memory.write(at, Uint8Array.from([...name, 0]));
      if (row)
        for (let word = 0; word < 3; word++) row.flags[word] = memory.load(at + 256 + word * 4);
    }
  }
  snapshot() {
    return { records: structuredClone([...this.records]), modified: this.modified };
  }
}
export const nativeDatabaseCodec = Object.freeze({
  snapshot: (database) => database.snapshot(),
  restore: (state) => {
    const database = new NativeDatabase();
    database.records = new Map(structuredClone(state.records));
    database.modified = state.modified;
    return database;
  },
});
export async function nativeDatabase(id, args, machine, services) {
  const handle = nativeDataArgument(args, machine, 0),
    { handles } = services;
  if (id === 0x365) {
    const filename = nativeDataFormat(args, machine, services, 0);
    if (filename === null) return nativeReply(1, 0);
    for (const index of [1, 2, 3])
      if (nativeDataFormat(args, machine, services, index) === null) return nativeReply(1, 0);
    const database = new NativeDatabase(),
      name = new TextDecoder('shift_jis').decode(filename),
      first = await services.read(name, 'database');
    if (first?.length) {
      const bytes = await services.read(name, 'database');
      try {
        await database.load(bytes);
      } catch (error) {
        services.diagnostic?.({ native: id, resource: name, error: error.message });
      }
    }
    return nativeReply(1, handles.add('database', database));
  }
  if (id === 0x366) {
    if (handle) handles.release(handle, 'database');
    return nativeReply(2);
  }
  if (!handle)
    return nativeReply(
      id === 0x367 || id === 0x36e ? 2 : 1,
      id === 0x368 || id === 0x369 ? 0xcccccccc : id === 0x36d ? 0 : undefined,
    );
  const database = handles.get(handle, 'database');
  if (id === 0x367) {
    const name = nativeDataFormat(args, machine, services, 2);
    if (name !== null) database.set(name, nativeDataArgument(args, machine, 1));
    return nativeReply(2);
  }
  if (id === 0x36d) return nativeReply(1, database.modified);
  if (id === 0x36e) {
    database.modified = 0;
    return nativeReply(2);
  }
  const pointer = nativeDataArgument(args, machine, 1);
  if (id === 0x368) {
    const bytes = database.export();
    if (pointer) (await services.dataBuffers()).process.write(pointer, bytes);
    return nativeReply(1, bytes.length);
  }
  if (!pointer) return nativeReply(1, 0);
  database.import((await services.dataBuffers()).process, pointer);
  return nativeReply(1, 1);
}
export function installNativeDatabases(world) {
  for (const id of NATIVE_DATABASE_IDS)
    world.runtime.register('main', id, (args, machine) =>
      nativeDatabase(id, args, machine, world.runtime.services),
    );
}
