// SPDX-License-Identifier: MPL-2.0
// Immutable animation-file lookup data is shared with remaining consumers.
import { nativeCategoryFilename, readNativeResource } from './resource-file.mjs';
import { nativeReply } from '../kcs/vm.mjs';
import { nativeDataFormat, nativeDataKey, nativeDataPair, nativeDataTSV } from './data-text.mjs';
import { encodeCP932 } from '../kcs/strings.mjs';
export const NATIVE_IMAGE_FILE_CONTRACTS = Object.freeze([
  Object.freeze({ id: 0x1ae, words: 1, control: 1 }),
]);
export function nativeImagePathParts(name) {
  const slash = Math.max(name.lastIndexOf('/'), name.lastIndexOf('\\')),
    dot = name.lastIndexOf('.');
  return dot > slash
    ? { stem: name.slice(0, dot), extension: name.slice(dot) }
    : { stem: name, extension: '' };
}
function lowerKey(value) {
  const bytes = encodeCP932(value);
  for (let i = 0; i < bytes.length; i++)
    if (nativeDataPair(bytes, i)) i++;
    else if (bytes[i] >= 65 && bytes[i] <= 90) bytes[i] += 32;
  return nativeDataKey(bytes);
}
export class NativeImageFiles {
  constructor(world) {
    this.world = world;
    this.loaded = false;
    this.entries = new Map();
    this.bytes = null;
  }
  resolve(name) {
    return nativeCategoryFilename(this.world.game, name, 'image');
  }
  readResolved(name) {
    return readNativeResource(this.world, name);
  }
  async read(name) {
    const file = this.resolve(name);
    return file === null ? null : this.readResolved(file);
  }
  async initialize() {
    if (this.loaded) return;
    this.loaded = true;
    this.bytes = await this.read('anmtable.csv');
    this.entries = new Map();
    if (this.bytes?.length) this.loadTable(this.bytes);
  }
  loadTable(bytes) {
    const entries = new Map();
    for (const fields of nativeDataTSV(bytes)) {
      if (fields.length < 2 || !fields[0].length) continue;
      const key = nativeDataKey(fields[0].subarray(0, 255)),
        value = new TextDecoder('shift_jis').decode(fields[1].subarray(0, 255));
      if (!entries.has(key)) entries.set(key, value);
    }
    this.entries = entries;
    this.bytes = bytes.slice();
    this.loaded = true;
  }
  async locate(name) {
    const resolved = this.resolve(name) ?? '',
      direct = nativeImagePathParts(resolved).stem + '.anm';
    if ((await this.readResolved(direct)) !== null) return direct;
    await this.initialize();
    const base = nativeImagePathParts(resolved.replaceAll('\\', '/').split('/').pop()).stem,
      key = lowerKey(base);
    if (!this.entries.has(key)) return null;
    const mapped = nativeImagePathParts(this.resolve(this.entries.get(key)) ?? '').stem + '.anm';
    return (await this.readResolved(mapped)) !== null ? mapped : null;
  }
  async apply(id, args, machine) {
    if (id !== 0x1ae) return undefined;
    const bytes = nativeDataFormat(args, machine, this.world.runtime.services, 0),
      name = bytes ? new TextDecoder('shift_jis').decode(bytes) : '';
    return nativeReply(1, Number(Boolean(name && (await this.locate(name)))));
  }
  snapshot() {
    return { loaded: this.loaded, bytes: this.bytes?.slice() ?? null, entries: [...this.entries] };
  }
  restore(state) {
    this.loaded = state.loaded;
    this.bytes = state.bytes?.slice() ?? null;
    this.entries = new Map(state.entries);
  }
}
export function installNativeImageFiles(world) {
  const files = (world.imageFiles = new NativeImageFiles(world));
  world.registerNativeFeature('image-files', (engine) => {
    engine.registerFeature('image-files', files);
    return files;
  });
  world.runtime.register('main', 0x1ae, (args, machine, task) =>
    files.apply(0x1ae, args, machine, task),
  );
}
