// SPDX-License-Identifier: MPL-2.0
// A FES task owns encoded image bytes across interpreter replacements. Each
// decode creates an independent bitmap; retained entries own their own aliases.
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
  async data(name) {
    const key = this.key(name);
    if (this.entries.has(key)) return this.entries.get(key);
    if (!this.pending.has(key)) {
      this.pending.set(key, this.#read(name, key));
    }
    const pending = this.pending.get(key);
    try {
      return await pending;
    } finally {
      if (this.pending.get(key) === pending) this.pending.delete(key);
    }
  }
  async #read(name, key) {
    const game = this.world.game,
      bytes = game.readCategory ? await game.readCategory(name, 'image') : await game.read(name);
    // A cache insertion arriving during I/O has the same first-entry ownership.
    if (this.entries.has(key)) return this.entries.get(key);
    if (bytes === null) return 0;
    if (!(bytes instanceof Uint8Array))
      throw new TypeError('FES image resource service must return bytes or null');
    const pointer = this.buffers.createPointer(bytes);
    this.entries.set(key, pointer);
    return pointer;
  }
  async load(name, selector = 0) {
    const pointer = await this.data(name);
    if (!pointer) return 0;
    const decoded = await this.buffers.decodeImage(pointer, selector);
    if (!decoded) return 0;
    const images = this.world.graphics.images,
      handle = images.addDecoded(decoded.image, decoded.frame);
    images.get(handle).owner = this.owner;
    return handle;
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
