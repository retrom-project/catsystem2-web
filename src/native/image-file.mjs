// SPDX-License-Identifier: MPL-2.0
// Immutable animation-file lookup data is shared with remaining consumers.
import { nativeCategoryFilename, readNativeResource } from './resource-file.mjs';
import { nativeReply } from '../kcs/vm.mjs';
import { nativeDataFormat, nativeDataKey, nativeDataPair, nativeDataTSV } from './data-text.mjs';
import { encodeCP932 } from '../kcs/strings.mjs';
import { captureArchiveRange, matchesArchiveRange } from '../files.mjs';
import { hasValidAnimationHeader } from './retained-animation.mjs';
const MAX_MOUNTED_ANIMATIONS = 4;
const MAX_MOUNTED_ANIMATION_BYTES = 32 * 1024;
export const NATIVE_IMAGE_FILE_CONTRACTS = Object.freeze([
  Object.freeze({ id: 0x1ae, words: 1, control: 1 }),
]);
export function nativeBmpDisposition(info, policy) {
  if (!policy || info?.format !== 'BMP') return 'unrestricted';
  if (![info.header, info.selectorBits, info.compression].every(Number.isInteger)) return 'guarded';
  if (
    !policy.selectorBits.includes(info.selectorBits) ||
    !policy.nativeHeaders.includes(info.header)
  )
    return 'rejected';
  if (
    !policy.reviewedHeaders.includes(info.header) ||
    !policy.reviewedCompressions[info.selectorBits].includes(info.compression)
  )
    return 'guarded';
  if (
    info.header === 12 &&
    (!policy.core?.pixelBits.includes(info.pixelBits) ||
      !policy.core.selectorBits.includes(info.selectorBits) ||
      !policy.core.pixelOffsets.includes(info.pixelOffset))
  )
    return 'guarded';
  if (
    info.compression === 6 &&
    (!policy.alphaBitfields?.pixelBits.includes(info.pixelBits) ||
      !policy.alphaBitfields.pixelOffsets.includes(info.pixelOffset))
  )
    return 'guarded';
  return 'reviewed';
}
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
  #mountedAnimations = new Map();

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
    return /\.anm$/i.test(name)
      ? readNativeResource(this.world, name, 3, undefined, (hit) => this.#readAnimationRange(hit))
      : readNativeResource(this.world, name);
  }
  async #readAnimationRange(hit) {
    const { game } = this.world,
      { file, offset, size } = hit,
      cached = this.#mountedAnimations.get(hit);
    // The resolver has already checked providers, named preloads and saved files.
    // Keep only small, validated programs from the read-only mounted archive.
    if (cached) {
      if (hit.archive && matchesArchiveRange(cached.range, hit, game.nativeSearch))
        return cached.bytes.slice();
      this.#mountedAnimations.delete(hit);
    }
    const range =
        hit.archive &&
        size <= MAX_MOUNTED_ANIMATION_BYTES &&
        captureArchiveRange(hit, game.nativeSearch),
      bytes = await file.read(offset, size);
    if (
      range &&
      bytes instanceof Uint8Array &&
      bytes.length === size &&
      game === this.world.game &&
      matchesArchiveRange(range, hit, game.nativeSearch) &&
      hasValidAnimationHeader(bytes)
    ) {
      this.#mountedAnimations.set(hit, { range, bytes: new Uint8Array(bytes) });
      if (this.#mountedAnimations.size > MAX_MOUNTED_ANIMATIONS)
        this.#mountedAnimations.delete(this.#mountedAnimations.keys().next().value);
    }
    return bytes;
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
    this.#mountedAnimations.clear();
    this.loaded = state.loaded;
    this.bytes = state.bytes?.slice() ?? null;
    this.entries = new Map(state.entries);
  }
  close() {
    this.#mountedAnimations.clear();
  }
}
export function installNativeImageFiles(world) {
  const files = (world.imageFiles = new NativeImageFiles(world));
  world.runtime.register('main', 0x1ae, (args, machine, task) =>
    files.apply(0x1ae, args, machine, task),
  );
}
