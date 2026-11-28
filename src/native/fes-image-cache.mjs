// SPDX-License-Identifier: MPL-2.0
// Only explicitly resident encoded bytes belong to the FES task's map.
// Each data()/load() caller owns its temporary descriptor reference.
import { nativeCategoryFilename, readNativeResource } from './resource-file.mjs';

export class FESImageCache {
  constructor(world, owner, entries = []) {
    this.world = world;
    this.owner = owner;
    this.entries = new Map(entries);
    this.pending = new Map();
  }
  get buffers() {
    return this.world.runtime.imageDataBuffers;
  }
  key(name) {
    return this.world.game.nativeResources
      ? this.world.game.nativeResources.resolve(name, 'image')
      : name;
  }
  insert(name, pointer) {
    if (!pointer) return;
    const key = this.key(name);
    if (this.entries.has(key)) return;
    this.buffers.retainPointer(pointer);
    this.entries.set(key, pointer);
  }
  async #read(name) {
    // Install the existing unsettled-I/O marker before entering a provider.
    // Independent misses are independent reads, including reentrant requests.
    const request = {};
    this.pending.set(request, null);
    try {
      return await readNativeResource(
        this.world,
        nativeCategoryFilename(this.world.game, name, 'image'),
        3,
      );
    } finally {
      this.pending.delete(request);
    }
  }
  #buffer(bytes) {
    // Native kcBuffer size/capacity round up to eight bytes. Bytes past the
    // actual file are not native-defined; retain this JS allocator's zeros.
    const padded = new Uint8Array(Math.ceil(bytes.length / 8) * 8);
    padded.set(bytes);
    return this.buffers.createPointer(padded);
  }
  async data(name) {
    const key = this.key(name);
    if (this.entries.has(key)) return this.buffers.retainPointer(this.entries.get(key));
    const bytes = await this.#read(name);
    return bytes === null ? 0 : this.#buffer(bytes);
  }
  async preload(name) {
    // The original initializer opens/reads even an already resident key.
    const key = this.key(name),
      bytes = await this.#read(name);
    if (bytes !== null && !this.entries.has(key)) this.entries.set(key, this.#buffer(bytes));
  }
  async decode(pointer, selector = 0) {
    // Borrow a descriptor for this decode; the caller retains its own reference.
    if (!pointer) return 0;
    const decoded = await this.buffers.decodeImage(pointer, selector);
    if (!decoded) return 0;
    const images = this.world.graphics.images,
      handle = images.addDecoded(decoded.image, decoded.frame);
    images.get(handle).owner = this.owner;
    return handle;
  }
  async load(name, selector = 0) {
    const pointer = await this.data(name);
    try {
      return await this.decode(pointer, selector);
    } finally {
      this.buffers.releasePointer(pointer);
    }
  }
  snapshot() {
    if (this.pending.size)
      throw new Error('FES image cache checkpoint requires settled resource I/O');
    return [...this.entries];
  }
  close() {
    if (this.pending.size) throw new Error('FES image cache close requires settled resource I/O');
    for (const pointer of this.entries.values()) this.buffers.releasePointer(pointer);
    this.entries.clear();
  }
}
