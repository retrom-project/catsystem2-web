// SPDX-License-Identifier: MPL-2.0
import { Binary, inflate } from '../binary.mjs';
import { nativeReply } from '../kcs/vm.mjs';
import { nativeDeflate } from './zlib.mjs';
import { nativeFileTime, nativeSystemTime } from './file-time.mjs';

export function nativeSavePath(directory, filename) {
  const name = filename.replaceAll('\\', '/'),
    root = directory.replaceAll('\\', '/').replace(/\/+$/, '');
  return root ? `${root}/${name}` : name;
}

const word = (bytes, offset, value) =>
  new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength).setUint32(
    offset,
    value >>> 0,
    true,
  );
const mapped = (machine, address) => {
  try {
    machine.region(address >>> 0, 1);
    return true;
  } catch {
    return false;
  }
};

export class NativeGlobalFile {
  constructor(tag = 0) {
    this.tag = tag >>> 0;
    this.capacity = 0x80000;
    this.records = [];
  }
  get used() {
    return this.records.reduce((size, record) => size + record.bytes.length + 8, 0);
  }
  read(id) {
    return this.records.find((record) => record.id === id >>> 0)?.bytes ?? null;
  }
  clear() {
    this.capacity = 0x80000;
    this.records = [];
  }
  clone() {
    const copy = new NativeGlobalFile();
    copy.restore(this.snapshot());
    return copy;
  }
  write(id, bytes) {
    let used = this.used,
      capacity = this.capacity;
    for (const size of [8, bytes.length]) {
      const previousBucket = used >>> 19,
        nextBucket = (used + size) >>> 19;
      capacity += (nextBucket - previousBucket) * 0x10000;
      used += size;
      if (used > capacity)
        throw new Error('Native global-file capacity growth would overflow its buffer');
    }
    this.capacity = capacity;
    this.records.push({ id: id >>> 0, bytes: bytes.slice() });
  }
  remove(id) {
    let at = 0;
    for (let i = 0; i < this.records.length; i++) {
      const record = this.records[i],
        size = record.bytes.length + 8;
      if (record.id === id >>> 0) {
        // The native only removes a record when bytes remain in allocated capacity.
        if (at + size >= this.capacity) return;
        this.capacity -= size;
        this.records.splice(i, 1);
        return;
      }
      at += size;
    }
  }
  payload() {
    const out = new Uint8Array(this.used);
    let at = 0;
    for (const { id, bytes } of this.records) {
      word(out, at, id);
      word(out, at + 4, bytes.length);
      out.set(bytes, at + 8);
      at += 8 + bytes.length;
    }
    return out;
  }
  raw() {
    const out = new Uint8Array(this.used + 16);
    // Word zero is an ignored process pointer in native memory snapshots.
    word(out, 4, this.capacity);
    word(out, 8, this.used);
    word(out, 12, this.tag);
    out.set(this.payload(), 16);
    return out;
  }
  static fromPayload(bytes, tag = 0, capacity = ((bytes.length >>> 19) + 1) * 0x80000) {
    if (!Number.isInteger(capacity) || capacity < bytes.length || capacity > 256 * 1024 * 1024)
      throw new Error('Invalid native global-file capacity');
    const file = new NativeGlobalFile(tag),
      b = new Binary(bytes, 'global-file records');
    file.capacity = capacity;
    for (let at = 0; at < bytes.length; ) {
      const id = b.u32(at),
        size = b.u32(at + 4);
      file.records.push({ id, bytes: b.range(at + 8, size).slice() });
      at += size + 8;
    }
    return file;
  }
  static fromRaw(bytes) {
    const b = new Binary(bytes, 'global-file memory record');
    return NativeGlobalFile.fromPayload(b.range(16, b.u32(8)), b.u32(12), b.u32(4));
  }
  async file() {
    const payload = this.payload();
    const encoded = await nativeDeflate(payload, new Uint8Array(Math.max(64, payload.length * 2)));
    if (encoded.result < 0 || encoded.result > encoded.bytes.length)
      throw new Error('Native CSS compression failed');
    const compressed = encoded.bytes.subarray(0, encoded.result);
    const out = new Uint8Array(compressed.length + 16);
    word(out, 0, 0x00535343 /* exe-address-check: non-address - CSS file signature */);
    word(out, 4, compressed.length);
    word(out, 8, payload.length);
    word(out, 12, this.tag);
    out.set(compressed, 16);
    return out;
  }
  static async fromFile(bytes) {
    const b = new Binary(bytes, 'CSS saved file');
    if (b.u32(0) !== 0x00535343 /* exe-address-check: non-address - CSS file signature */)
      throw new Error('Invalid CSS saved-file signature');
    const compressed = b.range(16, b.u32(4));
    if (!b.u32(8)) return NativeGlobalFile.fromPayload(new Uint8Array(), b.u32(12));
    const payload = await inflate(compressed, b.u32(8));
    return NativeGlobalFile.fromPayload(payload, b.u32(12));
  }
  snapshot() {
    return { tag: this.tag, capacity: this.capacity, records: structuredClone(this.records) };
  }
  restore(state) {
    if (!Array.isArray(state.records)) throw new Error('Invalid global-file checkpoint records');
    let used = 0;
    for (const record of state.records) {
      if (
        !Number.isInteger(record.id) ||
        record.id < 0 ||
        record.id > 0xffffffff ||
        !(record.bytes instanceof Uint8Array)
      )
        throw new Error('Invalid global-file checkpoint record');
      used += record.bytes.length + 8;
    }
    if (
      !Number.isInteger(state.capacity) ||
      state.capacity < used ||
      state.capacity > 256 * 1024 * 1024
    )
      throw new Error('Invalid global-file checkpoint capacity');
    this.tag = state.tag >>> 0;
    this.capacity = state.capacity;
    this.records = structuredClone(state.records);
  }
}

export function createGlobalEntries(handles) {
  return {
    read: (handle, id) => (handle ? handles.get(handle, 'global-file').read(id) : null),
    write: (handle, id, bytes) => handles.get(handle, 'global-file').write(id, bytes),
  };
}

export function serializeStringBank(bank) {
  const entries = [...bank.entries].sort(([a], [b]) => a - b);
  // Native reports eight unused trailing bytes; readers ignore this padding.
  const out = new Uint8Array(12 + entries.reduce((size, [, bytes]) => size + 5 + bytes.length, 0));
  word(out, 0, entries.length);
  let at = 4;
  for (const [id, bytes] of entries) {
    word(out, at, id);
    out.set(bytes, at + 4);
    at += 5 + bytes.length;
  }
  return out;
}
export function importStringBank(bank, bytes) {
  const b = new Binary(bytes, 'string variable bank'),
    count = b.u32(0),
    entries = new Map();
  if (count > bytes.length / 5) throw new Error('String bank count exceeds its buffer');
  let at = 4;
  for (let i = 0; i < count; i++) {
    const id = b.u32(at),
      end = bytes.indexOf(0, at + 4);
    if (end < 0) throw new Error('Unterminated string bank entry');
    if (!entries.has(id)) entries.set(id, b.range(at + 4, end - at - 4).slice());
    at = end + 1;
  }
  bank.entries = entries;
  bank.dirty = true;
}

const counts = new Map([
  [0xee, 1],
  [0xf0, 5],
  [0xf2, 3],
  [0xf3, 2],
  [0xf4, 4],
  [0xf5, 2],
  [0xf6, 1],
  [0xf7, 1],
  [0xf8, 1],
  [0xfa, 4],
  [0xfc, 2],
  [0xfd, 2],
  [0xfe, 4],
  [0xff, 6],
  [0x1d5, 2],
  [0x185, 1],
  [0x186, 1],
  [0x3de, 1],
  [0x407, 2],
]);
export function nativePersistence(id, args, machine, services = {}) {
  if (!counts.has(id)) return undefined;
  if (args.length !== counts.get(id))
    throw new Error(
      `KCS persistence native 0x${id.toString(16)} expects ${counts.get(id)} arguments`,
    );
  const handles = services.handles;
  if (!handles) return undefined;
  const result = (value) => nativeReply(1, value >>> 0);
  const file = (handle) => handles.get(handle, 'global-file');
  if (id === 0xee) return result(handles.add('global-file', new NativeGlobalFile(args[0])));
  if (id === 0x185) {
    if (args[0]) file(args[0]).clear();
    return result(Number(Boolean(args[0])));
  }
  if (id === 0x186) return result(args[0] ? handles.add('global-file', file(args[0]).clone()) : 0);
  if (id === 0xf6) {
    if (args[0]) handles.release(args[0], 'global-file');
    return nativeReply(2);
  }
  if (id === 0xf8) return result(args[0] ? file(args[0]).tag : 0);
  if (id === 0x1d5) {
    if (args[0]) file(args[0]).remove(args[1]);
    return nativeReply(2);
  }
  if ([0xf5, 0xf7, 0xff, 0x3de, 0x407].includes(id)) {
    if (!services.format || !services.persistence) return undefined;
    if ([0xf5, 0x407].includes(id) && !args[0]) return result(0);
    const name = nativeSavePath(
        services.contextName ?? '',
        services.format(args[id === 0xf5 || id === 0x407 ? 1 : 0], machine),
      ),
      storage = services.persistence;
    if (id === 0x3de) {
      if (!storage.remove) return undefined;
      return Promise.resolve(storage.setAttributes?.(name, 0x80))
        .then(() => storage.remove(name))
        .then(() => nativeReply(2));
    }
    if (id === 0xf5 || id === 0x407) {
      if (!storage.write) return undefined;
      return file(args[0])
        .file()
        .then((bytes) => storage.write(name, bytes, { updateModified: id === 0xf5 }))
        .then((ok) => result(Number(Boolean(ok))));
    }
    if (!storage.read || (id === 0xff && !storage.stat)) return undefined;
    return Promise.resolve(storage.read(name)).then(async (bytes) => {
      if (bytes === null) return result(0);
      if (id === 0xff) {
        if (
          bytes.length < 16 ||
          new Binary(bytes).u32(0) !==
            0x00535343 /* exe-address-check: non-address - CSS file signature */
        )
          return result(0);
        const info = await storage.stat(name);
        if (!info) return result(0);
        const value = nativeFileTime(info.modifiedMs),
          offset = services.localOffsetMinutes?.() ?? -new Date().getTimezoneOffset(),
          date = value === null ? null : nativeSystemTime(value + BigInt(offset) * 600000000n);
        if (!date) return result(0);
        [date[0], date[1], date[3], date[4], date[5]].forEach((n, i) =>
          machine.store(args[i + 1], n),
        );
        return result(1);
      }
      try {
        return result(handles.add('global-file', await NativeGlobalFile.fromFile(bytes)));
      } catch (error) {
        services.diagnostic?.({ resource: name, native: id, error: error.message });
        return result(0);
      }
    });
  }
  if (!args[0]) return result(0);
  const container = file(args[0]);
  if (id === 0xf4) {
    if (!mapped(machine, args[3])) return result(0);
    container.write(args[1], machine.bytes(args[3], args[2]));
    return result(1);
  }
  if (id === 0xfe) {
    const bytes = container.read(args[1]);
    if (bytes === null || !mapped(machine, args[2])) return result(0);
    const size = Math.min(args[3] >>> 0, bytes.length);
    machine.bytes(args[2], size).set(bytes.subarray(0, size));
    return result(size);
  }
  if (id === 0xf2) {
    if (!args[2]) return result(0);
    container.write(args[1], file(args[2]).raw());
    return result(1);
  }
  if (id === 0xfc) {
    const bytes = container.read(args[1]);
    return result(bytes === null ? 0 : handles.add('global-file', NativeGlobalFile.fromRaw(bytes)));
  }
  if (id === 0xf3 || id === 0xfd) {
    if (!services.strings) return undefined;
    if (id === 0xf3) container.write(args[1], serializeStringBank(services.strings));
    else {
      const bytes = container.read(args[1]);
      if (bytes === null) return result(0);
      importStringBank(services.strings, bytes);
      services.markStringsDirty?.();
    }
    return result(1);
  }
  if (id === 0xf0 || id === 0xfa) {
    if (!services.variableBankForTask) return undefined;
    const bank = services.variableBankForTask(args[2]);
    if (!bank?.words) return result(0);
    const first = args[3] >>> 0;
    if (id === 0xf0) {
      const count = first < bank.capacity ? Math.min(args[4] >>> 0, bank.capacity - first) : 0;
      const bytes = new Uint8Array(count * 4);
      for (let i = 0; i < count; i++) word(bytes, i * 4, bank.get(first + i));
      container.write(args[1], bytes);
    } else {
      const bytes = container.read(args[1]);
      if (bytes === null) return result(0);
      const count = first < bank.capacity ? Math.min(bytes.length >>> 2, bank.capacity - first) : 0,
        b = new Binary(bytes);
      for (let i = 0; i < count; i++) bank.set(first + i, b.u32(i * 4));
      bank.dirty = true;
    }
    return result(1);
  }
  return undefined;
}
