// SPDX-License-Identifier: MPL-2.0
// Main 375..37D and 37E..386 are bytewise ordered string-to-word maps. Their packed form
// stores a count, NUL-terminated keys padded to DWORD alignment, then values.
import { nativeReply } from '../kcs/vm.mjs';
import { encodeCP932 } from '../kcs/strings.mjs';

const identity = (bytes) => Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('');
const terminated = (bytes) => {
  const at = bytes.indexOf(0);
  return at < 0 ? bytes : bytes.subarray(0, at);
};
const padded = (length) => (length + 4) & ~3;
const compare = (a, b) => {
  for (let i = 0; i < Math.min(a.length, b.length); i++) if (a[i] !== b[i]) return a[i] - b[i];
  return a.length - b.length;
};
const foldAscii = (byte) => (byte >= 0x41 && byte <= 0x5a ? byte + 0x20 : byte);
export class NativeDictionary {
  constructor() {
    this.entries = new Map();
  }
  set(bytes, value, { replace = true } = {}) {
    const nul = bytes.indexOf(0),
      key = bytes.slice(0, nul < 0 ? bytes.length : nul),
      id = identity(key);
    if (replace || !this.entries.has(id)) this.entries.set(id, { key, value: value >>> 0 });
  }
  get(bytes, fallback = 0) {
    return this.entries.get(identity(terminated(bytes)))?.value ?? fallback;
  }
  delete(bytes) {
    return this.entries.delete(identity(terminated(bytes)));
  }
  firstKeyFor(value) {
    return this.ordered().find((entry) => entry.value === value >>> 0)?.key;
  }
  firstValueForKeyPrefix(bytes) {
    const query = terminated(bytes);
    for (const { key, value } of this.ordered()) {
      if (
        key.length <= query.length &&
        key.every((byte, i) => foldAscii(byte) === foldAscii(query[i]))
      )
        return value;
    }
    return 0;
  }
  ordered() {
    return [...this.entries.values()].sort((a, b) => compare(a.key, b.key));
  }
  get size() {
    return 4 + this.ordered().reduce((n, { key }) => n + padded(key.length) + 4, 0);
  }
  write(bytes) {
    if (bytes.length < this.size) throw new Error('Native dictionary output buffer is too short');
    const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
    view.setUint32(0, this.entries.size, true);
    let at = 4;
    for (const { key, value } of this.ordered()) {
      bytes.set(key, at);
      bytes[at + key.length] = 0;
      at += padded(key.length);
      view.setUint32(at, value, true);
      at += 4;
    }
    return at;
  }
  importFrom(machine, address) {
    const count = machine.load(address),
      source = [];
    let at = address + 4;
    for (let i = 0; i < count; i++) {
      const key = [];
      for (let value; (value = machine.load(at + key.length, 1)); ) key.push(value);
      at += padded(key.length);
      source.push([Uint8Array.from(key), machine.load(at)]);
      at += 4;
    }
    for (const [key, value] of source) this.set(key, value, { replace: false });
  }
  snapshot() {
    return [...this.entries.values()].map(({ key, value }) => ({ key: key.slice(), value }));
  }
  restore(state) {
    this.entries.clear();
    for (const { key, value } of state) {
      if (!(key instanceof Uint8Array) || key.includes(0) || !Number.isInteger(value))
        throw new Error('Invalid native dictionary checkpoint');
      this.set(key, value);
    }
    return this;
  }
}
export const nativeDictionaryCodec = {
  snapshot: (dictionary) => dictionary.snapshot(),
  restore: (state) => new NativeDictionary().restore(state),
};
function nativeLegacyDictionary(id, args, machine, services) {
  const count = [0, 1, 3, 2][id - 0x203];
  if (args.length !== count)
    throw new Error(`Legacy KCS dictionary 0x${id.toString(16)} expects ${count} arguments`);
  if (!services.handles) return undefined;
  if (id === 0x203)
    return nativeReply(1, services.handles.add('dictionary', new NativeDictionary()));
  if (id === 0x204) {
    if (args[0]) services.handles.release(args[0], 'dictionary');
    return nativeReply(2);
  }
  const dictionary = args[0] ? services.handles.get(args[0], 'dictionary') : null;
  if (!dictionary) return id === 0x206 ? nativeReply(1, 0xffffffff) : nativeReply(2);
  const key = [];
  for (let at = args[1]; ; at++) {
    const byte = machine.load(at, 1);
    if (!byte) break;
    key.push(byte);
  }
  const bytes = Uint8Array.from(key);
  if (id === 0x206)
    return nativeReply(1, dictionary.entries.get(identity(bytes))?.value ?? 0xffffffff);
  dictionary.set(bytes, args[2], { replace: false });
  return nativeReply(2);
}
export function nativeDictionary(id, args, machine, services = {}) {
  if (id >= 0x203 && id <= 0x206) return nativeLegacyDictionary(id, args, machine, services);
  if (id >= 0x375 && id <= 0x37d) id += 9;
  if (id < 0x37e || id > 0x386) return undefined;
  const count = [0, 1, 3, 2, 1, 1, 2, 2, 3][id - 0x37e];
  if (args.length !== count)
    throw new Error(`KCS dictionary native 0x${id.toString(16)} expects ${count} arguments`);
  if (!services.handles) return undefined;
  if (id === 0x37e)
    return nativeReply(1, services.handles.add('dictionary', new NativeDictionary()));
  if (id === 0x37f) {
    if (args[0]) services.handles.release(args[0], 'dictionary');
    return nativeReply(2);
  }
  const dictionary = args[0] ? services.handles.get(args[0], 'dictionary') : null;
  if (id === 0x380 || id === 0x381) {
    if (!dictionary) return id === 0x381 ? nativeReply(1, 0) : nativeReply(2);
    if (!services.formatBytes && !services.format) return undefined;
    const key = services.formatBytes
      ? services.formatBytes(args[1], machine)
      : encodeCP932(services.format(args[1], machine));
    if (id === 0x381) return nativeReply(1, dictionary.get(key));
    dictionary.set(key, args[2]);
  } else if (id === 0x382) dictionary?.entries.clear();
  else if (id === 0x383) return nativeReply(1, dictionary?.size ?? 0);
  else if (id === 0x384) {
    if (dictionary && args[1]) {
      if (!services.imageDataBuffers) return undefined;
      return Promise.resolve(services.imageDataBuffers()).then(({ process }) => {
        const bytes = process.read(args[1], dictionary.size);
        dictionary.write(bytes);
        process.write(args[1], bytes);
        return nativeReply(2);
      });
    }
  } else if (id === 0x385) {
    if (dictionary && args[1]) {
      if (!services.imageDataBuffers) return undefined;
      return Promise.resolve(services.imageDataBuffers()).then(({ process }) => {
        dictionary.importFrom(
          { load: (at, size = 4) => (size === 1 ? process.read(at, 1)[0] : process.load(at)) },
          args[1],
        );
        return nativeReply(2);
      });
    }
  } else {
    let mapped = false;
    try {
      machine.region(args[2] >>> 0, 1);
      mapped = true;
    } catch {
      /* Native VM pointer translation failed. */
    }
    const entry = mapped && dictionary?.ordered()[args[1] >>> 0];
    if (entry) machine.writeStringBytes(entry.key, args[2]);
    return nativeReply(1, Number(!!entry));
  }
  return nativeReply(2);
}

export { compare as compareNativeBytes };
