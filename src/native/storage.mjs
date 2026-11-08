// SPDX-License-Identifier: MPL-2.0
import { SaveStore } from '../saves.mjs';
import { nativeReply } from '../kcs/vm.mjs';

function path(name) {
  if (typeof name !== 'string' || name.includes('\0')) throw new Error('Invalid native file name');
  const normalized = name.replaceAll('\\', '/').replace(/^c:\/catsystem2-web(?:\/|$)/i, '');
  if (normalized.startsWith('/') || /^[a-z]:/i.test(normalized))
    throw new Error('Native file path escapes the virtual game directory');
  const parts = [];
  for (const part of normalized.split('/')) {
    if (!part || part === '.') continue;
    if (part === '..') {
      if (!parts.length) throw new Error('Native file path escapes the virtual game directory');
      parts.pop();
    } else parts.push(part);
  }
  return parts.join('/').toLowerCase();
}

// Native writes have their own per-game namespace in the browser's persistent
// store. Mounted SDK/game inputs remain read-only.
export class NativeFileStorage {
  constructor(game, namespace, database) {
    this.game = game;
    this.store = new SaveStore(`${namespace}:native-files`, database);
    this.platformStore = new SaveStore(`${namespace}:native-platform`, database);
  }
  async open() {
    const results = await Promise.allSettled([this.store.open(), this.platformStore.open()]);
    const failed = results.find((result) => result.status === 'rejected');
    if (failed) {
      this.close();
      throw failed.reason;
    }
  }
  platformKey(name) {
    if (typeof name !== 'string' || !/^[a-z][a-z0-9-]*$/.test(name))
      throw new TypeError('Native platform state requires a component key');
    return name;
  }
  async readPlatform(name) {
    const record = this.platformStore.get(this.platformKey(name));
    return record ? record.data.bytes.slice() : null;
  }
  async writePlatform(name, bytes) {
    if (!(bytes instanceof Uint8Array)) throw new TypeError('Native platform state requires bytes');
    await this.platformStore.put(this.platformKey(name), { bytes: bytes.slice() }, {});
    return true;
  }
  async read(name) {
    const key = path(name),
      saved = this.store.get(key);
    return saved ? saved.data.bytes.slice() : this.game.read(key);
  }
  async readSaved(name) {
    const saved = this.store.get(path(name));
    return saved ? saved.data.bytes.slice() : null;
  }
  async write(name, bytes, { updateModified = true } = {}) {
    const key = path(name),
      previous = this.store.get(key),
      now = Date.now();
    if (previous?.attributes & 1) return false;
    await this.store.put(
      key,
      { bytes: bytes.slice() },
      {
        createdMs: previous?.createdMs ?? now,
        accessedMs: previous?.accessedMs ?? now,
        modifiedMs: updateModified || !previous ? now : previous.modifiedMs,
        attributes: previous?.attributes ?? 0x80,
      },
    );
    return true;
  }
  async remove(name) {
    const key = path(name);
    const record = this.store.get(key);
    if (!record || record.attributes & 1) return false;
    await this.store.delete(key);
    return true;
  }
  async copy(from, to, failIfExists = true) {
    const input = await this.read(from);
    if (input === null || (failIfExists && (await this.read(to)) !== null)) return false;
    if (this.store.get(path(to))?.attributes & 1) return false;
    const info = await this.stat(from),
      now = Date.now();
    await this.store.put(
      path(to),
      { bytes: input.slice() },
      {
        createdMs: now,
        accessedMs: now,
        modifiedMs: info?.modifiedMs ?? now,
        attributes: info?.attributes ?? 0x80,
      },
    );
    return true;
  }
  async move(from, to) {
    const a = path(from),
      b = path(to);
    if ((await this.read(b)) !== null) return false;
    return this.store.move(a, b);
  }
  async diskSpace() {
    if (typeof navigator === 'undefined' || !navigator.storage?.estimate) return null;
    const { quota, usage } = await navigator.storage.estimate();
    if (!Number.isFinite(quota) || !Number.isFinite(usage)) return null;
    const totalBytes = Math.floor(quota),
      freeBytes = Math.max(0, Math.floor(quota - usage));
    return { availableBytes: freeBytes, totalBytes, freeBytes };
  }
  async list() {
    const entries = new Map();
    for (const [name, record] of this.store.records)
      entries.set(name, {
        name,
        size: record.data.bytes.length,
        createdMs: record.createdMs,
        accessedMs: record.accessedMs,
        modifiedMs: record.modifiedMs,
        attributes: record.attributes,
      });
    for (const [name, file] of this.game.looseIndex ?? [])
      if (!entries.has(name))
        entries.set(name, { name, size: file.size, modifiedMs: file.modifiedMs });
    return [...entries.values()];
  }
  async stat(name) {
    const key = path(name),
      saved = this.store.get(key);
    if (saved)
      return {
        createdMs: saved.createdMs,
        accessedMs: saved.accessedMs,
        modifiedMs: saved.modifiedMs,
        attributes: saved.attributes,
      };
    const hit = this.game.lookup(key);
    return hit?.file.modifiedMs === undefined ? null : { modifiedMs: hit.file.modifiedMs };
  }
  async setTimes(name, times) {
    const saved = this.store.get(path(name));
    if (!saved) return false;
    for (const [field, value] of Object.entries(times))
      if (
        !['createdMs', 'accessedMs', 'modifiedMs'].includes(field) ||
        !Number.isSafeInteger(value)
      )
        throw new Error('Invalid native file timestamp');
    await this.store.put(saved.slot, saved.data, {
      createdMs: saved.createdMs,
      accessedMs: saved.accessedMs,
      modifiedMs: saved.modifiedMs,
      attributes: saved.attributes,
      ...times,
    });
    return true;
  }
  async setAttributes(name, attributes) {
    const saved = this.store.get(path(name));
    if (!saved) return false;
    await this.store.put(saved.slot, saved.data, {
      createdMs: saved.createdMs,
      accessedMs: saved.accessedMs,
      modifiedMs: saved.modifiedMs,
      attributes: attributes >>> 0,
    });
    return true;
  }
  close() {
    this.store.close();
    this.platformStore.close();
  }
}

export class NativeFileAccess {
  constructor(storage, handles) {
    this.storage = storage;
    this.handles = handles;
  }
  async open(name, mode) {
    // Native 0x1D scans for the first lowercase r/w; '+' and 'a' do not
    // implement CRT fopen modes. No r/w means existing read/write access.
    const first = /[rw]/.exec(mode)?.[0],
      writable = first !== 'r',
      readable = first !== 'w';
    const bytes = first === 'w' ? new Uint8Array() : await this.storage.read(name);
    if (bytes === null) return 0;
    return this.handles().add('file', {
      name,
      bytes,
      position: 0,
      readable,
      writable,
      dirty: first === 'w',
    });
  }
  read(handle, count) {
    if (!handle) return null;
    const file = this.handles().get(handle, 'file');
    if (!file.readable) return null;
    const bytes = file.bytes.slice(file.position, file.position + count);
    file.position += bytes.length;
    return bytes;
  }
  write(handle, bytes) {
    if (!handle) return -1;
    const file = this.handles().get(handle, 'file');
    if (!file.writable) return -1;
    const output = new Uint8Array(Math.max(file.bytes.length, file.position + bytes.length));
    output.set(file.bytes);
    output.set(bytes, file.position);
    file.bytes = output;
    file.position += bytes.length;
    file.dirty = true;
    return bytes.length;
  }
  async close(handle) {
    if (!handle) return;
    const file = this.handles().get(handle, 'file');
    if (file.dirty) await this.storage.write(file.name, file.bytes);
    this.handles().release(handle, 'file');
  }
  async flushAll() {
    for (const record of this.handles().records.values()) {
      if (record.type !== 'file' || !record.value.dirty) continue;
      const file = record.value;
      if (!(await this.storage.write(file.name, file.bytes)))
        throw new Error(`Native file write failed: ${file.name}`);
      file.dirty = false;
    }
  }
  async closeAll({ flush = true } = {}) {
    const errors = [];
    for (const [id, record] of [...this.handles().records])
      if (record.type === 'file') {
        try {
          if (flush) await this.close(id);
          else this.handles().release(id, 'file');
        } catch (error) {
          errors.push(error);
        }
      }
    if (errors.length) throw new AggregateError(errors, 'Native file cleanup failed');
  }
}

export function nativeFiles(id, args, machine, services = {}) {
  if (!(services.files instanceof NativeFileAccess) || ![0x1d, 0x20].includes(id)) return undefined;
  const count = id === 0x1d ? 2 : 1;
  if (args.length !== count)
    throw new Error(`KCS file native 0x${id.toString(16)} expects ${count} arguments`);
  if (id === 0x20) return services.files.close(args[0]).then(() => nativeReply(2));
  if (!services.format) return undefined;
  return services.files
    .open(services.format(args[0], machine), services.format(args[1], machine))
    .then((handle) => nativeReply(1, handle));
}
