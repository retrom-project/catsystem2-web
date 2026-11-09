// SPDX-License-Identifier: MPL-2.0
// CST readers and history records are native resources, independent of the
// system KCS program which interprets a game's commands.
import { Binary, inflate } from '../binary.mjs';
import { readTranslation } from '../formats/scene.mjs';
import { encodeCP932 } from '../kcs/strings.mjs';
import { nativeReply } from '../kcs/vm.mjs';
import { parseNativeIntegerPrefix } from './standard.mjs';
import { encodeNativeSceneHistory, decodeNativeSceneHistory } from './scene-history.mjs';
import { NativeGlobalFile } from './persistence.mjs';

const decoder = new TextDecoder('shift_jis');
const utf8 = new TextEncoder();
const empty = () => new Uint8Array();
const word = (value) => nativeReply(1, value >>> 0);
const done = () => nativeReply(2);
const stripExtension = (name) => String(name).replace(/\.[^\\/.]*$/, '');
const lower = (name) => String(name).replace(/[A-Z]/g, (char) => char.toLowerCase());
const seenKeys = new WeakMap();
const nameBytes = (name) => {
  const bytes = name instanceof Uint8Array ? name : encodeCP932(String(name)),
    nul = bytes.indexOf(0);
  return nul < 0 ? bytes : bytes.subarray(0, nul);
};
function foldedName(name) {
  let key = '';
  for (const byte of nameBytes(name))
    key += String.fromCharCode(byte >= 65 && byte <= 90 ? byte + 32 : byte);
  return key;
}
const cbytes = (machine, address) => {
  const result = [];
  for (let at = address >>> 0; ; at++) {
    const byte = machine.load(at, 1);
    if (!byte) return Uint8Array.from(result);
    result.push(byte);
  }
};
const mapped = (machine, address) => {
  try {
    machine.region(address >>> 0, 1);
    return true;
  } catch {
    return false;
  }
};

function formatHistoryName(at, machine, services, operation) {
  if (!mapped(machine, at))
    throw new Error(`Native scene ${operation} dereferences an unmapped format string`);
  const bytes = nameBytes(
    services.formatBytes
      ? services.formatBytes(at, machine)
      : encodeCP932(services.format(at, machine)),
  );
  if (bytes.length >= 128) throw new Error(`Native scene ${operation} exceeds its format buffer`);
  return bytes;
}

function stripHistoryExtension(bytes) {
  for (let i = bytes.length - 1; i >= 0; i--) {
    if (bytes[i] === 47 || bytes[i] === 92) break;
    if (bytes[i] === 46) return bytes.subarray(0, i);
  }
  return bytes;
}

function nativeUTF8(bytes) {
  if (bytes.length > 4000) return empty();
  const text = decoder.decode(bytes);
  // 6A5300 supplies a 260-WCHAR capacity despite its larger temporary array.
  if (text.length + 1 > 260)
    throw new Error('Native CST UTF-8 conversion exceeds its initialized WCHAR buffer');
  return utf8.encode(text);
}

export class NativeSceneReader {
  constructor(languages = []) {
    this.body = null;
    this.blockCount = 0;
    this.blocksOffset = 16;
    this.offsetsOffset = 0;
    this.stringsOffset = 0;
    this.stringsSize = 0;
    this.block = 0;
    this.line = 0;
    this.filename = '';
    this.fileValue = 0;
    this.languages = [...new Set(languages)];
    this.translations = null;
  }

  async load(bytes) {
    const file = new Binary(bytes, 'Native CatScene');
    if (bytes.length < 8 || !file.magic('CatScene')) return false;
    this.body = null;
    this.offsetsOffset = this.stringsOffset = 0;
    const packed = file.u32(8),
      size = file.u32(12);
    if (bytes.length !== 16 + (packed || size)) return false;
    const body = new Binary(
      packed ? await inflate(file.range(16, packed), size) : file.range(16, size).slice(),
      'Native CatScene body',
    );
    const blockCount = body.u32(4),
      offsetsOffset = 16 + body.u32(8),
      stringsOffset = 16 + body.u32(12);
    body.range(16, blockCount * 8);
    body.range(offsetsOffset, stringsOffset - offsetsOffset);
    body.range(stringsOffset, body.u32(0) - body.u32(12));
    this.body = body;
    this.blockCount = blockCount;
    this.offsetsOffset = offsetsOffset;
    this.stringsOffset = stringsOffset;
    this.stringsSize = body.u32(0) - body.u32(12);
    this.block = this.line = 0;
    return true;
  }

  loadTranslations(bytes) {
    this.translations = null;
    if (!bytes) return false;
    const translations = readTranslation(bytes);
    if (Object.keys(translations).some((name) => !this.languages.includes(name))) return false;
    this.translations = translations;
    return true;
  }

  blockInfo(index) {
    const at = this.blocksOffset + index * 8;
    return { count: this.body.u32(at), start: this.body.u32(at + 4) };
  }

  type(block, line) {
    block |= 0;
    line |= 0;
    if (!this.body) return -1;
    if (block < 0) return this.blockCount;
    if (block >= this.blockCount) return -1;
    const info = this.blockInfo(block);
    if (line < 0) return info.count;
    if (line >= info.count) return -1;
    const offset = this.body.u32(this.offsetsOffset + 4 * (info.start + line));
    const at = this.stringsOffset + offset;
    return this.body.u8(at) === 1 ? this.body.u8(at + 1) : -1;
  }

  text(block, line, { language = '', toUTF8 = false } = {}) {
    block |= 0;
    line |= 0;
    if (!this.body) return null;
    if (block < 0) block = this.block;
    if (line < 0) line = this.line;
    if (block < 0 || block >= this.blockCount || line < 0) return null;
    const info = this.blockInfo(block);
    if (line >= info.count) return null;
    const offset = this.body.i32(this.offsetsOffset + 4 * (info.start + line));
    if (offset < 0 || offset >= this.stringsSize) return null;
    const at = this.stringsOffset + offset;
    const start = at + this.body.u8(at) + 1;
    const remaining = this.body.range(start, this.body.bytes.length - start);
    const end = remaining.indexOf(0);
    if (end < 0) throw new Error('Unterminated native CST text');
    const source = remaining.subarray(0, end);
    const locale = this.translations?.[language];
    const translation = locale?.[block] ?? { speaker: '', text: '' };
    const kind = this.type(block, line);
    if (locale && kind === 0x21) return utf8.encode(translation.speaker.split('\0')[0]);
    if (locale && kind === 0x20) {
      for (let before = 0; before < line; before++)
        if (this.type(block, before) === 0x20) return empty();
      // The native CSTL representation joins segments separated by 0x1F.
      const segments = [];
      for (const part of translation.text.split('\x1f')) {
        if (!part) break;
        segments.push(part.split('\0')[0]);
      }
      return utf8.encode(segments.join(''));
    }
    return toUTF8 ? nativeUTF8(source) : source.slice();
  }

  info(kind, block = 0) {
    if (!this.body) return -1;
    if (kind === 2) return this.block;
    if (kind === 3) return this.line;
    if (kind === 4) return this.blockCount;
    if (kind === 5) return block < 0 || block >= this.blockCount ? 0 : this.blockInfo(block).count;
    return -1;
  }

  messageCount() {
    let count = 0;
    for (let block = 0; block < this.blockCount; block++)
      for (let line = 0; line < this.blockInfo(block).count; line++)
        if (this.type(block, line) === 0x20) count++;
    return count;
  }

  snapshot() {
    return {
      ...this,
      body: this.body?.bytes.slice() ?? null,
      languages: this.languages.slice(),
      translations: structuredClone(this.translations),
    };
  }

  restore(state) {
    Object.assign(this, structuredClone(state));
    if (state.body) this.body = new Binary(state.body.slice(), 'Native CatScene body');
    return this;
  }
}

const record = (scene, value) => ({ scene, value: value >>> 0, strings: null, extra: null });
const resetName = (name) => {
  if (encodeCP932(name).length > 31)
    throw new Error('Native scene history name exceeds its 32-byte field');
  return String(name);
};
const scanReferences = (source, callback) => {
  for (let at = 0; at < source.length; at++) {
    if (
      source[at] !== 36 ||
      source[at + 1] !== 115 ||
      source[at + 2] !== 116 ||
      source[at + 3] !== 114
    )
      continue;
    let suffix = '';
    for (let i = at + 4; i < source.length && source[i] && source[i] < 128; i++)
      suffix += String.fromCharCode(source[i]);
    const parsed = parseNativeIntegerPrefix(suffix);
    if (parsed && callback(parsed.value >>> 0, at, parsed.count + 4)) at += parsed.count + 3;
  }
};
const expandHistory = (history, index, first, source, preserveMissing = false) => {
  const result = [];
  let before = 0;
  scanReferences(source, (second, at, count) => {
    if (!history) throw new Error('Native string history lookup dereferences a null scene context');
    const value = history.getString(index, first, second);
    if (preserveMissing && !value?.found) return false;
    for (const byte of source.subarray(before, at)) result.push(byte);
    if (value?.found) for (const byte of value.bytes) result.push(byte);
    before = at + count;
    return true;
  });
  for (const byte of source.subarray(before)) result.push(byte);
  return Uint8Array.from(result);
};

export class NativeSceneHistory {
  constructor() {
    this.seen = [];
    this.path = [];
  }
  findSeen(scene) {
    const key = foldedName(scene);
    return (
      this.seen.find((entry) => {
        let name = seenKeys.get(entry);
        if (name === undefined) {
          name = foldedName(entry.nameBytes ?? entry.scene);
          seenKeys.set(entry, name);
        }
        return !name || name === key;
      }) ?? null
    );
  }
  markSeen(scene, value) {
    scene = resetName(scene);
    const entry = this.findSeen(scene);
    if (entry) entry.value = Math.max(entry.value, value >>> 0);
    else this.seen.push(record(scene, value));
  }
  appendPath(scene, value) {
    scene = resetName(scene);
    const last = this.path.at(-1);
    if (last && lower(last.scene) === lower(scene)) last.value = Math.max(last.value, value >>> 0);
    else this.path.push(record(scene, value));
    return this.path.length - 1;
  }
  seenValue(scene) {
    const entry = this.findSeen(scene);
    return (entry?.nameBytes ? entry.nameBytes[0] : entry?.scene.length) ? entry.value : 0;
  }
  pathAt(index) {
    return this.path[Math.min(index >>> 0, this.path.length - 1)] ?? null;
  }
  setString(index, first, second, bytes) {
    const entry = this.pathAt(index);
    if (!entry) return false;
    entry.strings ??= [];
    const key = `${first >>> 0}:${second >>> 0}`,
      existing = entry.strings.find(([name]) => name === key);
    const old = existing?.[1] ?? new Uint8Array(64);
    const end = bytes.indexOf(0),
      source = bytes.subarray(0, Math.min(62, end < 0 ? bytes.length : end));
    old.set(source);
    old[source.length] = 0;
    if (source.length === 62) old[63] = 0;
    if (!existing) entry.strings.push([key, old]);
    return true;
  }
  getString(index, first, second) {
    const table = this.pathAt(index)?.strings;
    if (!table) return null;
    const bytes = table.find(([key]) => key === `${first >>> 0}:${second >>> 0}`)?.[1];
    return bytes
      ? { found: true, bytes: bytes.subarray(0, bytes.indexOf(0)).slice() }
      : { found: false, bytes: empty() };
  }
  aliasSeen(source, destination) {
    const entry = this.findSeen(source);
    if (entry && !this.findSeen(destination)) {
      const name = nameBytes(destination);
      if (name.length > 31) throw new Error('Native scene history name exceeds its 32-byte field');
      const field = new Uint8Array(32);
      field.set(name);
      this.seen.push({ ...record(decoder.decode(name), entry.value), nameBytes: field });
    }
  }
  encode(side, includeExtra = false) {
    if (!['seen', 'path'].includes(side)) throw new Error('Invalid native scene history list');
    return encodeNativeSceneHistory(this[side], includeExtra);
  }
  decode(side, bytes, companionPath = null) {
    if (!['seen', 'path'].includes(side)) throw new Error('Invalid native scene history list');
    this[side] = decodeNativeSceneHistory(bytes, { side, companionPath });
  }
  snapshot() {
    return structuredClone({ seen: this.seen, path: this.path });
  }
  restore(state) {
    Object.assign(this, structuredClone(state));
    return this;
  }
}

export class NativeSceneData {
  constructor({ languages = [] } = {}) {
    this.reader = new NativeSceneReader(languages);
    this.history = new NativeSceneHistory();
  }
  async load(name, read, diagnostic) {
    const bytes = await read(name, 'scene');
    if (!bytes) return false;
    let success = false;
    try {
      success = await this.reader.load(bytes);
    } catch (error) {
      diagnostic?.({ resource: name, error: error.message });
    }
    this.reader.translations = null;
    const translationName = `${stripExtension(name)}.cstl`,
      translation = await read(translationName, 'scene');
    if (translation) {
      try {
        this.reader.loadTranslations(translation);
      } catch (error) {
        diagnostic?.({ resource: translationName, error: error.message });
      }
    }
    return success;
  }
  snapshot() {
    return { reader: this.reader.snapshot(), history: this.history.snapshot() };
  }
  restore(state) {
    this.reader.restore(state.reader);
    this.history.restore(state.history);
    return this;
  }
}

const explicit = new Set([
  0x144, 0x145, 0x146, 0x147, 0x148, 0x149, 0x14a, 0x14b, 0x14c, 0x14d, 0x14e, 0x14f, 0x150, 0x151,
  0x152, 0x260, 0x3a6, 0x3d2, 0x3d3, 0x3d4, 0x3d5, 0x3d6, 0x3e1, 0x409, 0x40d, 0x40e,
]);
const implicit = new Map([
  [0xdc, 0x145],
  [0xdd, 0x146],
  [0xde, 0x147],
  [0xdf, 0x148],
  [0xe0, 0x149],
  [0xe1, 0x14a],
  [0xe2, 0x14b],
  [0xe3, 0x14c],
  [0xe4, 0x14d],
  [0xe5, 0x14e],
  [0xe6, 0x14f],
  [0xe7, 0x150],
  [0xe8, 0x151],
  [0xeb, 0x152],
  [0x40b, 0x409],
]);

export function nativeSceneData(id, args, machine, services = {}) {
  if (id === 0xdb) {
    if (!services.initializeSceneData) return undefined;
    services.initializeSceneData();
    return done();
  }
  if ([0xef, 0xf9, 0x181, 0x182].includes(id)) {
    if (!services.globalEntries) return undefined;
    if (!args[0]) return word(0);
    const direct = id === 0x181 || id === 0x182;
    if (direct && !services.handles) return undefined;
    if (!direct && !services.sceneDataForTask) return undefined;
    const source = direct
      ? args[2]
        ? services.handles.get(args[2], 'scene-data')
        : null
      : services.sceneDataForTask(args[2]);
    const execute = (data) => {
      if (!data) return word(0);
      const side = args[3] ? 'path' : 'seen';
      if (id === 0xef || id === 0x181)
        services.globalEntries.write(args[0], args[1], data.history.encode(side, !!args[4]));
      else {
        const bytes = services.globalEntries.read(args[0], args[1]);
        if (bytes === null) return word(0);
        data.history.decode(side, bytes);
      }
      return word(1);
    };
    return source && typeof source.then === 'function' ? source.then(execute) : execute(source);
  }
  if (id === 0xea) {
    if (!services.sceneDataForTask) return undefined;
    if (!services.sceneData) return word(0);
    const source = services.sceneDataForTask(args[0]);
    const execute = (data) => {
      if (!data) return word(0);
      const seen = data.history.encode('seen', true),
        path = data.history.encode('path', true);
      services.sceneData.history.decode('seen', seen, path);
      services.sceneData.history.decode('path', path);
      return word(1);
    };
    return source && typeof source.then === 'function' ? source.then(execute) : execute(source);
  }
  if (id === 0xe9) {
    if (services.sceneData === undefined) return undefined;
    if (!services.sceneData) return done();
    if (!services.sceneDataForTask) return undefined;
    const source = services.sceneDataForTask(args[0]);
    const execute = (data) => {
      const bytes = expandHistory(data?.history, args[1], args[2], cbytes(machine, args[3]), true);
      machine.bytes(args[3], bytes.length + 2).set(bytes);
      machine.store(args[3] + bytes.length, 0, 2);
      return done();
    };
    return source && typeof source.then === 'function' ? source.then(execute) : execute(source);
  }
  if (id === 0x142) {
    if (!services.read || !services.format) return undefined;
    const bytes = services.read(services.format(args[0], machine), 'scene');
    return bytes && typeof bytes.then === 'function'
      ? bytes.then((value) => word(Number(value !== null)))
      : word(Number(bytes !== null));
  }
  if (id === 0x143) {
    if (!services.handles) return undefined;
    return word(
      services.handles.add(
        'scene-data',
        new NativeSceneData({ languages: services.sceneLanguages }),
      ),
    );
  }
  if (!explicit.has(id) && !implicit.has(id)) return undefined;
  const original = id;
  const direct = explicit.has(id);
  if (!direct && services.sceneData === undefined) return undefined;
  const data = direct
    ? args[0]
      ? services.handles?.get(args[0], 'scene-data')
      : null
    : services.sceneData;
  if (!data) {
    if (!direct && [0xe1, 0xe2, 0xeb].includes(original))
      throw new Error('Native scene-data call dereferences a null task scene context');
    if (direct && args[0] && !services.handles) return undefined;
    if (
      [0x144, 0x14a, 0x14b, 0x150, 0x151, 0x3a6, 0x3d2, 0x3d5, 0x3e1].includes(
        implicit.get(id) ?? id,
      )
    )
      return done();
    return word((direct && id === 0x149) || id === 0x3d6 ? -1 : 0);
  }
  if (!direct) {
    id = implicit.get(id);
    args = [0, ...args];
  }
  const { reader, history } = data;
  if (id === 0x144) {
    services.handles.release(args[0], 'scene-data');
    return done();
  }
  if (id === 0x145) {
    if (!services.read || !services.format) return undefined;
    return data
      .load(services.format(args[1], machine), services.read, services.diagnostic)
      .then((value) => word(Number(value)));
  }
  if (id === 0x146) return word(reader.type(args[1], args[2]));
  if ([0x147, 0x409, 0x40d, 0x40e].includes(id)) {
    if (!mapped(machine, args[1])) return word(0);
    if ([0x409, 0x40e].includes(id) && !services.format) return undefined;
    const bytes = reader.text(args[2], args[3], {
      language: [0x409, 0x40e].includes(id) ? services.format(args[4], machine) : '',
      toUTF8: id === 0x40d || id === 0x40e,
    });
    if (bytes) machine.writeStringBytes(bytes, args[1]);
    return word(
      bytes
        ? bytes.length
        : original === 0xde || original === 0x40b
          ? cbytes(machine, args[1]).length
          : 0,
    );
  }
  if (id === 0x3a6 || id === 0x14c) {
    if (!services.formatBytes && !services.format) return undefined;
    if (id === 0x14c) {
      const name = formatHistoryName(args[1], machine, services, 'query');
      return word(history.seenValue(direct ? stripHistoryExtension(name) : name));
    }
    const source = formatHistoryName(args[1], machine, services, 'alias'),
      destination = formatHistoryName(args[2], machine, services, 'alias');
    history.aliasSeen(source, destination);
    return done();
  }
  if ([0x148, 0x149].includes(id)) {
    if (!services.format) return undefined;
    let name = services.format(args[1], machine);
    if (direct) name = stripExtension(name);
    let index = -1;
    if (name) {
      if (id === 0x148) history.markSeen(name, args[2]);
      else index = history.appendPath(name, args[2]);
    }
    return word(id === 0x149 && direct ? index : 1);
  }
  if (id === 0x14a) {
    history.seen = [];
    return done();
  }
  if (id === 0x14b) {
    history.path = [];
    return done();
  }
  if (id === 0x14d) {
    const index = Math.min(args[1] >>> 0, history.path.length - 1),
      entry = history.pathAt(args[1]);
    machine.writeString(entry?.scene ?? '', args[2]);
    machine.store(args[3], entry?.value ?? -1);
    return word(index);
  }
  if (id === 0x14e)
    return word(Number(history.setString(args[1], args[2], args[3], cbytes(machine, args[4]))));
  if (id === 0x14f) {
    const entry = history.getString(args[1], args[2], args[3]);
    if (entry) machine.writeStringBytes(entry.bytes, args[4]);
    return word(Number(entry?.found ?? false));
  }
  if (id === 0x150) {
    if (!services.strings) return undefined;
    scanReferences(cbytes(machine, args[3]), (index) => {
      const value = services.strings.getBytes(index);
      if (value === undefined) return false;
      history.setString(args[1], args[2], index, value);
      return true;
    });
    return done();
  }
  if (id === 0x151) {
    const result = expandHistory(history, args[1], args[2], cbytes(machine, args[3]));
    machine.bytes(args[3], result.length + 2).set(result);
    machine.store(args[3] + result.length, 0, 2);
    return done();
  }
  if (id === 0x152) {
    machine.writeString(reader.filename, args[1]);
    return word(reader.fileValue);
  }
  if (id === 0x260) return word(reader.info(4));
  if (id === 0x3d4) return word(reader.messageCount());
  if (id === 0x3d6) return word(history.path.length - 1);
  if (id === 0x3d2) {
    if (args[1] && history.path.length)
      history.path.at(-1).extra = services.handles.get(args[1], 'global-file').raw();
    return done();
  }
  if (id === 0x3d3) {
    const extra = history.path[args[1] >>> 0]?.extra;
    return word(
      extra?.length ? services.handles.add('global-file', NativeGlobalFile.fromRaw(extra)) : 0,
    );
  }
  if (id === 0x3d5 || id === 0x3e1) {
    if (!args[1]) return done();
    const source = services.handles.get(args[1], 'scene-data').history;
    if (id === 0x3e1) {
      // 72DF60 clears the destination before traversing its source list.
      // Passing the same scene therefore clears its path as well.
      history.path =
        source === history ? [] : source.path.map(({ scene, value }) => record(scene, value));
    } else
      for (const side of ['seen', 'path']) {
        for (let i = 0; i < Math.min(history[side].length, source[side].length); i++)
          history[side][i].extra = source[side][i].extra?.slice() ?? null;
      }
    return done();
  }
  throw new Error(`Missing recovered scene-data dispatch 0x${id.toString(16)}`);
}
