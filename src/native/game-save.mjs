// SPDX-License-Identifier: MPL-2.0
import { CHECKPOINT_LIMIT } from '../checkpoint.mjs';
import { nativeFileTime } from './file-time.mjs';
import { NativeGlobalFile, nativeSaveSlotName } from './persistence.mjs';

const MAX_SAVE_BYTES = 64 * 1024 * 1024;
const MAX_SAVE_FILES = 4096;
// Budget for the JS record, its byte array and an array slot, even when empty.
const MAX_SAVE_FILE_RECORDS = MAX_SAVE_BYTES / 256;

export function gameSaveFileKind(name) {
  const basename = name.slice(name.lastIndexOf('/') + 1);
  if (!basename.startsWith('save') && !basename.startsWith('tmp_save_')) return null;
  if (
    name.length > 4096 ||
    name.includes(':') ||
    Array.from(name).some(
      (character) => character.charCodeAt(0) < 32 || character.charCodeAt(0) === 127,
    )
  )
    return null;
  if (basename === 'savegen.dat') return 'index';
  if (basename === 'tmp_save_1.tmp' || basename === 'tmp_save_2.tmp') return 'scratch';
  const match = /^save(-?\d{3,10})\.dat$/.exec(basename);
  if (match && nativeSaveSlotName(Number(match[1])) === basename) return 'slot';
  return null;
}

const directory = (name) => name.slice(0, name.lastIndexOf('/') + 1);
function progressFiles(records) {
  const folders = new Set();
  for (const [name] of records) if (gameSaveFileKind(name) === 'slot') folders.add(directory(name));
  if (!folders.size) return new Map();
  // The root index can be shared by multiple slot directories.
  return new Map(
    [...records].filter(([name]) => name === 'savegen.dat' || folders.has(directory(name))),
  );
}

function sameBytes(a, b) {
  return a === b || (a.length === b.length && a.every((value, index) => value === b[index]));
}

function fileInfo({ createdMs, accessedMs, modifiedMs, attributes }) {
  if (
    [createdMs, accessedMs, modifiedMs].some((value) => nativeFileTime(value) === null) ||
    !Number.isInteger(attributes) ||
    attributes < 0 ||
    attributes > 0xffffffff
  )
    throw new Error('Invalid native game save file metadata');
  return { createdMs, accessedMs, modifiedMs, attributes };
}

function checkGameSaveBudget(records, signal) {
  if (records.size > MAX_SAVE_FILES) throw new Error('Native game save has too many files');
  let fileBytes = 0,
    expandedBytes = 0;
  for (const {
    data: { bytes },
  } of records.values()) {
    signal?.throwIfAborted();
    fileBytes += bytes.length;
    if (fileBytes > MAX_SAVE_BYTES) throw new Error('Native game save exceeds its file budget');
    // The same CSS reader checks the stream against this length during validation.
    const expanded = NativeGlobalFile.declaredFilePayloadLength(bytes);
    if (expanded > MAX_SAVE_BYTES)
      throw new Error('Native game save CSS file exceeds its expanded byte limit');
    expandedBytes += expanded;
    if (expandedBytes > CHECKPOINT_LIMIT)
      throw new Error('Native game save exceeds its combined expanded byte limit');
  }
}

async function validateCSS(name, bytes, signal) {
  const kind = gameSaveFileKind(name);
  if ((kind !== 'slot' && kind !== 'index') || !bytes.length || bytes.length > MAX_SAVE_BYTES)
    throw new Error('Invalid native game save CSS file');
  const count = await NativeGlobalFile.countFileEntries(bytes, {
    byteLimit: MAX_SAVE_BYTES,
    recordLimit: MAX_SAVE_FILE_RECORDS,
    signal,
  });
  if (kind === 'slot' && count === 0) throw new Error('Native game save slot has no CSS records');
}

async function validCSS(name, bytes, signal) {
  try {
    await validateCSS(name, bytes, signal);
    return true;
  } catch {
    signal?.throwIfAborted();
    return false;
  }
}

export async function selectedGameSave(files, normalize, signal) {
  signal?.throwIfAborted();
  if (!Array.isArray(files) || !files.length || files.length > MAX_SAVE_FILES)
    throw new Error('Invalid native game save file set');
  const records = new Map();
  let total = 0;
  for (const { path, bytes, ...info } of files) {
    if (
      typeof path !== 'string' ||
      normalize(path) !== path ||
      !['slot', 'index'].includes(gameSaveFileKind(path)) ||
      records.has(path) ||
      !(bytes instanceof Uint8Array) ||
      !bytes.length ||
      bytes.length > MAX_SAVE_BYTES - total
    )
      throw new Error('Invalid native game save file');
    total += bytes.length;
    records.set(path, { ...fileInfo(info), slot: path, data: { bytes: new Uint8Array(bytes) } });
  }
  if (progressFiles(records).size !== records.size)
    throw new Error('Native game save requires a loadable slot and its own index files');
  checkGameSaveBudget(records, signal);
  for (const [name, record] of records) {
    signal?.throwIfAborted();
    await validateCSS(name, record.data.bytes, signal);
  }
  return records;
}

// Selecting a Retrom version starts an isolated file view for this Launch.
// The account's ordinary IndexedDB files remain the base for fresh launches.
export class NativeGameSaveView {
  constructor(records) {
    this.records = new Map(records);
  }
  get(name) {
    return this.records.get(name);
  }
  put(name, data, info) {
    const record = { ...info, slot: name, data };
    this.records.set(name, record);
    return record;
  }
  delete(name) {
    this.records.delete(name);
  }
  move(from, to) {
    const record = this.get(from);
    if (!record || this.get(to)) return false;
    this.records.set(to, { ...record, slot: to });
    this.records.delete(from);
    return true;
  }
}

export class NativeGameSaveProgress {
  #valid;
  #files;
  #revision = 0;

  constructor(records) {
    this.#valid = records;
    this.#files = progressFiles(records);
  }
  static async fromLocal(records, signal) {
    const valid = new Map();
    for (const [name, record] of records) {
      if (!gameSaveFileKind(name)) continue;
      if (await validCSS(name, record.data.bytes, signal)) valid.set(name, record);
      signal?.throwIfAborted();
    }
    signal?.throwIfAborted();
    return new NativeGameSaveProgress(valid);
  }
  async accepts(name, bytes) {
    const old = this.#valid.get(name)?.data.bytes;
    return (old && sameBytes(old, bytes)) || (await validCSS(name, bytes));
  }
  committed(changes, ignoreAutomaticTime = false) {
    for (const [name, record] of changes)
      if (record) this.#valid.set(name, record);
      else this.#valid.delete(name);
    const next = progressFiles(this.#valid);
    if (
      next.size !== this.#files.size ||
      [...next].some(([name, record]) => {
        const prior = this.#files.get(name);
        return (
          record !== prior &&
          (!prior ||
            record.attributes !== prior.attributes ||
            record.createdMs !== prior.createdMs ||
            record.accessedMs !== prior.accessedMs ||
            (!ignoreAutomaticTime && record.modifiedMs !== prior.modifiedMs) ||
            !sameBytes(record.data.bytes, prior.data.bytes))
        );
      })
    )
      this.#revision++;
    this.#files = next;
  }
  status() {
    return { progress: this.#files.size > 0, revision: String(this.#revision) };
  }
  export(signal) {
    signal?.throwIfAborted();
    if (!this.#files.size) return null;
    checkGameSaveBudget(this.#files, signal);
    const files = [...this.#files]
      .sort(([left], [right]) => (left < right ? -1 : 1))
      .map(([path, record]) => ({ path, bytes: record.data.bytes.slice(), ...fileInfo(record) }));
    return { files, revision: String(this.#revision) };
  }
}
