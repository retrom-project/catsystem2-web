// SPDX-License-Identifier: MPL-2.0
import { SaveStore } from '../saves.mjs';
import { nativeReply } from '../kcs/vm.mjs';
import { nativeABI } from './abi/index.mjs';
import {
  nativeDataArgument,
  nativeDataCString,
  nativeDataFormat,
  nativeDataMapped,
} from './data-text.mjs';
import {
  gameSaveFileKind,
  NativeGameSaveProgress,
  NativeGameSaveView,
  selectedGameSave,
} from './game-save.mjs';

const toolbarQuickSaveSlot = 'toolbar-quick-save';

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
  #quickSave = null;
  #gameSave = null;
  #selectedSave = null;
  #preparingGameSave = false;
  #gameSaveWrites = 0;

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
  async prepareGameSave(files, { signal } = {}) {
    signal?.throwIfAborted();
    if (this.#preparingGameSave || this.#gameSave)
      throw new Error('Native game save files are already configured');
    this.#preparingGameSave = true;
    try {
      if (files === null)
        this.#gameSave = await NativeGameSaveProgress.fromLocal(this.store.records, signal);
      else {
        const selected = await selectedGameSave(files, path, signal);
        signal?.throwIfAborted();
        this.#selectedSave = new NativeGameSaveView(selected);
        this.#gameSave = new NativeGameSaveProgress(selected);
      }
    } finally {
      this.#preparingGameSave = false;
    }
  }
  get gameSaveEnabled() {
    return this.#gameSave !== null;
  }
  gameSaveStatus() {
    const status = this.#gameSave?.status() ?? { progress: false, revision: '0' };
    if (this.#gameSaveWrites || this.#preparingGameSave) status.busy = true;
    return status;
  }
  withGameSaveWrite(names, write) {
    if (!this.#gameSave || !names.some((name) => this.#tracks(path(name)))) return write();
    return this.#pendingGameSaveWrite(write);
  }
  async #pendingGameSaveWrite(write) {
    this.#gameSaveWrites++;
    try {
      return await write();
    } finally {
      this.#gameSaveWrites--;
    }
  }
  exportGameSave({ signal } = {}) {
    signal?.throwIfAborted();
    if (this.#gameSaveWrites || this.#preparingGameSave)
      throw new Error('Native game save files are still being committed');
    return this.#gameSave?.export(signal) ?? null;
  }
  #files(name) {
    return this.#selectedSave && gameSaveFileKind(name) ? this.#selectedSave : this.store;
  }
  #tracks(name) {
    if (!this.#gameSave) return false;
    const kind = gameSaveFileKind(name);
    return kind === 'slot' || kind === 'index';
  }
  async #put(name, data, info, companion, ignoreAutomaticTime = false) {
    const files = this.#files(name);
    if (!this.#tracks(name)) return files.put(name, data, info, companion);
    this.#gameSaveWrites++;
    try {
      const record = await files.put(name, data, info, companion);
      const valid = await this.#gameSave.accepts(name, data.bytes);
      if (files.get(name) === record)
        this.#gameSave.committed([[name, valid ? record : null]], ignoreAutomaticTime);
      return record;
    } finally {
      this.#gameSaveWrites--;
    }
  }
  *savedEntries() {
    for (const [name, record] of this.store.records)
      if (this.#files(name) === this.store) yield [name, record];
    if (this.#selectedSave) yield* this.#selectedSave.records;
  }
  hasSaved(name) {
    const key = path(name);
    return !!this.#files(key).get(key);
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
  has(name) {
    // Same saved-file / mounted-input namespace as read(), without reading
    // file contents or mistaking a missing timestamp for file absence.
    const key = path(name);
    return !!this.#files(key).get(key) || !!this.game.lookup(key);
  }
  size(name) {
    // Same saved-first lookup as read/has. A missing timestamp says nothing
    // about existence; null alone represents an absent file.
    const key = path(name),
      saved = this.#files(key).get(key),
      hit = saved ? null : this.game.lookup(key);
    if (!saved && !hit) return null;
    const size = saved ? saved.data.bytes.length : hit.size;
    if (!Number.isSafeInteger(size) || size < 0)
      throw new Error('Native file metadata has an invalid length');
    return size;
  }
  async read(name, readHit) {
    const key = path(name),
      saved = this.#files(key).get(key);
    if (saved) return saved.data.bytes.slice();
    return readHit ? this.game.read(key, readHit) : this.game.read(key);
  }
  mountedHit(name) {
    const key = path(name);
    // A saved file wins the same path and is never a preparation source.
    return this.#files(key).get(key) ? undefined : (this.game.lookup(key) ?? null);
  }
  async readSaved(name) {
    const key = path(name),
      saved = this.#files(key).get(key);
    return saved ? saved.data.bytes.slice() : null;
  }
  get toolbarQuickSavePending() {
    return !!this.#quickSave?.stillAtStoryPoint();
  }
  pruneToolbarQuickSave() {
    if (this.#quickSave && !this.#quickSave.stillAtStoryPoint()) this.#quickSave = null;
  }
  armToolbarQuickSave(request) {
    this.#quickSave = request;
    return () => {
      if (this.#quickSave === request) this.#quickSave = null;
    };
  }
  async readToolbarQuickSave(saves) {
    let checkpoint = null;
    await saves.request('readonly', (store) => {
      const owner = store.get(`${saves.namespace}:${toolbarQuickSaveSlot}`);
      owner.onsuccess = () => {
        const saved = owner.result,
          reference = saved?.nativeSave;
        if (
          saved?.namespace !== saves.namespace ||
          typeof reference?.slot !== 'string' ||
          typeof reference.revision !== 'string'
        )
          return;
        const file = store.get(`${this.store.namespace}:${reference.slot}`);
        file.onsuccess = () => {
          if (
            file.result?.namespace === this.store.namespace &&
            file.result.data?.quickSaveRevision === reference.revision
          )
            checkpoint = saved.data;
        };
      };
      return owner;
    });
    return checkpoint;
  }
  async write(name, bytes, { updateModified = true } = {}, nativeSaveWriter = null) {
    const key = path(name),
      files = this.#files(key),
      previous = files.get(key),
      now = Date.now();
    const pending = this.#quickSave;
    let companion, revision;
    if (pending && files === this.store && nativeSaveWriter === pending.writer && updateModified) {
      const match = /(?:^|\/)save(\d+)\.dat$/.exec(key),
        slot = match && Number(match[1]);
      if (!pending.stillAtStoryPoint()) this.#quickSave = null;
      else if (slot !== null && slot >= pending.firstSlot && slot < pending.endSlot) {
        this.#quickSave = null;
        revision = crypto.randomUUID();
        companion = {
          store: pending.saves,
          slot: toolbarQuickSaveSlot,
          data: pending.checkpoint,
          info: { nativeSave: { slot: key, revision } },
        };
      }
    }
    if (previous?.attributes & 1) return false;
    const data = { bytes: bytes.slice() },
      info = {
        createdMs: previous?.createdMs ?? now,
        accessedMs: previous?.accessedMs ?? now,
        modifiedMs: updateModified || !previous ? now : previous.modifiedMs,
        attributes: previous?.attributes ?? 0x80,
      };
    if (companion) data.quickSaveRevision = revision;
    try {
      await this.#put(key, data, info, companion, true);
    } catch (error) {
      if (!companion) throw error;
      pending.failed(error);
      return false;
    }
    return true;
  }
  async remove(name) {
    const key = path(name);
    const files = this.#files(key),
      record = files.get(key);
    if (!record || record.attributes & 1) return false;
    const tracked = this.#tracks(key);
    if (tracked) this.#gameSaveWrites++;
    try {
      await files.delete(key);
      if (tracked && !files.get(key)) this.#gameSave.committed([[key, null]]);
      return true;
    } finally {
      if (tracked) this.#gameSaveWrites--;
    }
  }
  async copy(from, to, failIfExists = true) {
    return this.withGameSaveWrite([to], async () => {
      const input = await this.read(from);
      if (input === null || (failIfExists && (await this.read(to)) !== null)) return false;
      const key = path(to);
      if (this.#files(key).get(key)?.attributes & 1) return false;
      const info = await this.stat(from),
        now = Date.now();
      await this.#put(
        key,
        { bytes: input.slice() },
        {
          createdMs: now,
          accessedMs: now,
          modifiedMs: info?.modifiedMs ?? now,
          attributes: info?.attributes ?? 0x80,
        },
      );
      return true;
    });
  }
  async move(from, to) {
    const a = path(from),
      b = path(to),
      files = this.#files(a);
    if (files !== this.#files(b)) return false;
    return this.withGameSaveWrite([a, b], async () => {
      if ((await this.read(b)) !== null) return false;
      const trackFrom = this.#tracks(a),
        trackTo = this.#tracks(b);
      if (!trackFrom && !trackTo) return files.move(a, b);
      if (!(await files.move(a, b))) return false;
      const record = files.get(b),
        valid = trackTo && record && (await this.#gameSave.accepts(b, record.data.bytes));
      const changes = [];
      if (trackFrom && !files.get(a)) changes.push([a, null]);
      if (trackTo && files.get(b) === record) changes.push([b, valid ? record : null]);
      if (changes.length) this.#gameSave.committed(changes);
      return true;
    });
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
    for (const [name, record] of this.savedEntries())
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
      saved = this.#files(key).get(key);
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
    const key = path(name),
      saved = this.#files(key).get(key);
    if (!saved) return false;
    for (const [field, value] of Object.entries(times))
      if (
        !['createdMs', 'accessedMs', 'modifiedMs'].includes(field) ||
        !Number.isSafeInteger(value)
      )
        throw new Error('Invalid native file timestamp');
    await this.#put(key, saved.data, {
      createdMs: saved.createdMs,
      accessedMs: saved.accessedMs,
      modifiedMs: saved.modifiedMs,
      attributes: saved.attributes,
      ...times,
    });
    return true;
  }
  async setAttributes(name, attributes) {
    const key = path(name),
      saved = this.#files(key).get(key);
    if (!saved) return false;
    await this.#put(key, saved.data, {
      createdMs: saved.createdMs,
      accessedMs: saved.accessedMs,
      modifiedMs: saved.modifiedMs,
      attributes: attributes >>> 0,
    });
    return true;
  }
  close() {
    this.#quickSave = null;
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
    const first =
        mode instanceof Uint8Array
          ? String.fromCharCode(mode.find((byte) => byte === 114 || byte === 119) ?? 0)
          : /[rw]/.exec(mode)?.[0],
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
  read(handle, count, consume) {
    if (!handle) return null;
    const file = this.handles().get(handle, 'file');
    if (!file.readable) return null;
    const bytes = file.bytes.slice(file.position, file.position + count);
    consume?.(bytes);
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
  const { files, profile } = services;
  if (!(files instanceof NativeFileAccess) || id < 0x1d || id > 0x20) return undefined;
  const oldFileIO = profile && nativeABI(profile).fileIO?.rawModeAndBoundedBuffer;
  if (!oldFileIO && id !== 0x1d && id !== 0x20) return undefined;
  const count = [2, 4, 4, 1][id - 0x1d];
  if (args.length !== count)
    throw new Error(`KCS file native 0x${id.toString(16)} expects ${count} arguments`);
  if (id === 0x20) return files.close(args[0]).then(() => nativeReply(2));
  if (id === 0x1e || id === 0x1f) {
    const [address, elementBytes, elements, handle] = args,
      size = Math.imul(elementBytes, elements) >>> 0;
    if (!handle || !nativeDataMapped(machine, address)) return nativeReply(1, 0);
    if (id === 0x1e) {
      const bytes = files.read(handle, size, (data) =>
        machine.bytes(address, data.length).set(data),
      );
      return nativeReply(1, bytes?.length ?? 0);
    }
    return nativeReply(1, Math.max(0, files.write(handle, machine.bytes(address, size))));
  }
  if (!services.format) return undefined;
  const name = services.format(args[0], machine),
    mode = oldFileIO
      ? nativeDataFormat(args, machine, services, 1)
      : services.format(args[1], machine);
  if (mode === null) return nativeReply(1, 0);
  return files.open(name, mode).then((handle) => nativeReply(1, handle));
}

export function installNativeFormattedFileOutput(world) {
  world.runtime.register('main', 0x237, async (args, machine) => {
    const bytes = nativeDataCString(machine, nativeDataArgument(args, machine, 0)),
      formatted = nativeDataFormat(args, machine, world.runtime.services, 1);
    if (formatted === null) throw new Error('Native file output reads an unmapped format');
    const filename = new TextDecoder('shift_jis').decode(bytes);
    if (!filename || (await world.storage.stat?.(filename))?.attributes & 1) return nativeReply(2);
    const previous = (await world.storage.read(filename)) ?? new Uint8Array(),
      offset = Math.max(0, previous.length - 1),
      output = new Uint8Array(offset + formatted.length + 2);
    output.set(previous.subarray(0, offset));
    output.set(formatted, offset);
    output.set([13, 10], offset + formatted.length);
    await world.storage.write(filename, output);
    return nativeReply(2);
  });
}
