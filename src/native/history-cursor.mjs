// SPDX-License-Identifier: MPL-2.0
// Main 17B..180 browse the live scene-history path with rotating reader slots.
import { NativeSceneData, NativeSceneReader } from './scene-data.mjs';
import { nativeReply } from '../kcs/vm.mjs';

export const NATIVE_HISTORY_CURSOR_IDS = Object.freeze([0x17b, 0x17c, 0x17d, 0x17e, 0x17f, 0x180]);
export const NATIVE_HISTORY_CURSOR_HANDLERS = Object.freeze({
  'nekopara-vol3-engine-2.6.1.76': Object.freeze([
    0x64f390, 0x64f100, 0x64f590, 0x64f250, 0x64f160, 0x64f1d0,
  ]),
  'sdk-4.01-engine-2.6.1.74': Object.freeze([
    0x51aa30, 0x51a860, 0x51abf0, 0x51a9b0, 0x51a8c0, 0x51a930,
  ]),
});
const word = (value) => nativeReply(1, value >>> 0);
const done = () => nativeReply(2);
const mapped = (machine, address) => {
  try {
    machine.region(address >>> 0, 1);
    return true;
  } catch {
    return false;
  }
};
const basename = (name) => {
  let last = 0;
  for (let i = 0; i < name.length; i++) if (name[i] === '/' || name[i] === '\\') last = i;
  return name.slice(last ? last + 1 : 0);
};
const fold = (name) => name.replace(/[A-Z]/g, (char) => char.toLowerCase());

export class NativeHistoryCursor {
  constructor(sceneHandle, capacity) {
    this.sceneHandle = sceneHandle >>> 0;
    this.capacity = capacity >>> 0;
    if ((this.capacity | 0) < 0 || this.capacity > 0x100000)
      throw new RangeError('Native history cursor has no mapped reader slots');
    this.lastPath = -1;
    this.rows = Array.from({ length: this.capacity }, () => ({
      path: -1,
      block: -1,
      lastBlock: -1,
      reader: new NativeSceneReader(),
      valid: 0,
    }));
  }
  history(services) {
    if (!this.sceneHandle)
      throw new Error('Native history cursor dereferences a null scene-data resource');
    return services.handles.get(this.sceneHandle, 'scene-data').history;
  }
  path(index, services) {
    const history = this.history(services),
      at = Math.min(index >>> 0, history.path.length - 1);
    return { at, entry: history.path[at] ?? null };
  }
  row(index) {
    if ((index | 0) < 0)
      throw new RangeError('Native history cursor reads before its reader slots');
    return this.rows[index | 0];
  }
  async refresh(row, services) {
    const { at, entry } = this.path(row.path, services);
    row.path = at;
    if (!entry) return false;
    row.lastBlock = entry.value | 0;
    if (fold(basename(row.reader.filename)) === fold(entry.scene)) return true;
    const data = new NativeSceneData();
    data.reader = row.reader;
    return data.load(entry.scene, services.read, services.diagnostic);
  }
  async text(row, services, message, speaker) {
    if (!(await this.refresh(row, services))) return 0;
    message?.clear();
    speaker?.clear();
    let found = 0;
    for (let line = 0; ; line++) {
      const type = row.reader.type(row.block, line);
      if (type === -1) return found;
      if (type !== 0x20 && type !== 0x21) continue;
      const target = type === 0x20 ? message : speaker,
        bytes = target ? row.reader.text(row.block, line) : null;
      if (bytes) target.append(bytes);
      found = 1;
    }
  }
  async voice(row, ordinal, services, target) {
    if (!(await this.refresh(row, services))) return 0;
    target?.clear();
    let found = 0;
    for (let line = 0; ; line++) {
      const type = row.reader.type(row.block, line);
      if (type === -1) return 0;
      if (type !== 0x30) continue;
      if (found !== (ordinal | 0)) {
        found++;
        continue;
      }
      const bytes = target ? row.reader.text(row.block, line) : null;
      if (bytes) target.append(bytes);
      return 1;
    }
  }
  rotate(forward) {
    if (!this.rows.length) throw new RangeError('Native history cursor has no mapped reader slots');
    if (forward) this.rows.push(this.rows.shift());
    else this.rows.unshift(this.rows.pop());
  }
  async initialize(services) {
    const { at, entry } = this.path(-1, services);
    if (!entry) return;
    this.lastPath = at;
    const row = this.rows[0];
    if (!row) throw new RangeError('Native history cursor has no mapped reader slots');
    row.path = at;
    row.block = row.lastBlock = entry.value | 0;
    row.valid = await this.text(row, services);
    while (!row.valid) {
      row.block = (row.block - 1) | 0;
      if (row.block < 0) {
        row.path = (row.path - 1) | 0;
        if (row.path < 0) break;
        const previous = this.path(row.path, services);
        row.path = previous.at;
        if (!previous.entry) break;
        row.block = row.lastBlock = previous.entry.value | 0;
      }
      row.valid = await this.text(row, services);
    }
    if (this.capacity > 1) {
      for (let i = 0; i < this.capacity - 1; i++) await this.move(0, services);
    } else if (row.block === row.lastBlock) await this.move(0, services);
  }
  async move(direction, services) {
    const forward = !!direction;
    this.rotate(forward);
    if (!forward) {
      const row = this.rows[0],
        backup = { ...row };
      if (this.capacity >= 2) {
        const next = this.rows[1];
        [row.path, row.block, row.lastBlock] = [next.path, next.block, next.lastBlock];
      }
      row.valid = 0;
      for (;;) {
        row.block = (row.block - 1) | 0;
        if (row.block < 0) {
          row.path = (row.path - 1) | 0;
          if (row.path < 0) break;
          const previous = this.path(row.path, services);
          row.path = previous.at;
          if (!previous.entry) break;
          row.lastBlock = previous.entry.value | 0;
          row.block = row.lastBlock;
        }
        row.valid = await this.text(row, services);
        if (row.valid) break;
      }
      if (!row.valid) {
        Object.assign(row, backup);
        this.rotate(true);
        return 0;
      }
      return row.valid;
    }
    let index = 0;
    if (this.capacity >= 2) {
      index = this.capacity - 2;
      while (index >= 0 && !this.rows[index].valid) index--;
      if (index < 0) {
        this.rotate(false);
        return 0;
      }
      index++;
    }
    const row = this.rows[index],
      backup = { ...row };
    if (index) {
      const previous = this.rows[index - 1];
      [row.path, row.block, row.lastBlock] = [previous.path, previous.block, previous.lastBlock];
    }
    row.valid = 0;
    for (;;) {
      row.block = (row.block + 1) | 0;
      const beyond =
        row.path === this.lastPath ? row.block > row.lastBlock : row.block >= row.lastBlock;
      if (beyond) {
        row.path = (row.path + 1) | 0;
        if (row.path > this.lastPath) break;
        const next = this.path(row.path, services);
        row.path = next.at;
        if (!next.entry) break;
        row.lastBlock = next.entry.value | 0;
        row.block = 0;
      }
      row.valid = await this.text(row, services);
      if (row.valid) break;
    }
    if (
      !row.valid ||
      (this.capacity === 1 && row.block >= row.lastBlock && row.path === this.lastPath)
    ) {
      Object.assign(row, backup);
      this.rotate(false);
      return 0;
    }
    return row.valid;
  }
  snapshot() {
    return {
      sceneHandle: this.sceneHandle,
      capacity: this.capacity,
      lastPath: this.lastPath,
      rows: this.rows.map((row) => ({ ...row, reader: row.reader.snapshot() })),
    };
  }
  restore(state) {
    this.sceneHandle = state.sceneHandle >>> 0;
    this.capacity = state.capacity >>> 0;
    this.lastPath = state.lastPath | 0;
    if ((this.capacity | 0) < 0 || this.capacity !== state.rows.length)
      throw new Error('Native history cursor checkpoint slot count differs');
    this.rows = state.rows.map((row) => ({
      ...row,
      reader: new NativeSceneReader().restore(row.reader),
    }));
    return this;
  }
}
export const nativeHistoryCursorCodec = Object.freeze({
  snapshot: (cursor) => cursor.snapshot(),
  restore: (state) => Object.create(NativeHistoryCursor.prototype).restore(state),
});
const output = (machine, address) => {
  if (!mapped(machine, address)) return null;
  let length = 0;
  return {
    clear() {
      length = 0;
      machine.store(address, 0, 1);
    },
    append(bytes) {
      machine.bytes(address + length, bytes.length).set(bytes);
      length += bytes.length;
      machine.store(address + length, 0, 1);
    },
  };
};
export function nativeHistoryCursor(id, args, machine, services = {}) {
  if (!NATIVE_HISTORY_CURSOR_IDS.includes(id) || !services.handles) return undefined;
  if (id === 0x17b) {
    if (!services.read) return undefined;
    const cursor = new NativeHistoryCursor(args[0], args[1]);
    return cursor
      .initialize(services)
      .then(() => word(services.handles.add('history-cursor', cursor)));
  }
  if (!args[0]) return id === 0x17c ? done() : word(0);
  const cursor = services.handles.get(args[0], 'history-cursor');
  if (id === 0x17c) {
    services.handles.release(args[0], 'history-cursor');
    return done();
  }
  if (id === 0x17d) {
    if (!services.read) return undefined;
    return cursor.move(args[1], services).then(word);
  }
  const row = cursor.row(args[1]);
  if (!row?.valid) return word(0);
  if (id === 0x180) {
    // Unlike string destinations, these translated pointers are mandatory.
    machine.store(args[2], row.path);
    machine.store(args[3], row.block);
    return word(1);
  }
  if (!services.read) return undefined;
  if (id === 0x17e)
    return cursor
      .text(row, services, output(machine, args[2]), output(machine, args[3]))
      .then(word);
  return cursor.voice(row, args[3], services, output(machine, args[2])).then(word);
}
