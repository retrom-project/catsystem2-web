// SPDX-License-Identifier: MPL-2.0
// Explicit D8 foreign tasks receive independent script bitmap copies.
// Producer-owned PE images expose explicit derived views; ordinary Draw, Plane
// and texture rendering use JS bytes and never this projection (phases 7/8/9).
import { NativeBitmapMemory } from './bitmap-memory.mjs';

const fields = {
  width: 4,
  height: 8,
  bpp: 24,
  canvasWidth: 28,
  canvasHeight: 32,
  offsetX: 36,
  offsetY: 40,
  alphaHint: 44,
  baseX: 48,
  baseY: 52,
  mask: 76,
  blendType: 84,
  imageMode: 88,
};
const signed = new Set(['offsetX', 'offsetY', 'baseX', 'baseY']);

export class NativeBitmapProjection extends NativeBitmapMemory {
  isOwned(dataHandle) {
    const record = this.refs.data.get(dataHandle);
    return Boolean(record && !record.borrowed && !record.external);
  }
  bind(dataHandle) {
    if (!this.isOwned(dataHandle)) return super.bind(dataHandle);
    const record = this.refs.data.get(dataHandle),
      state = this.handles.get(dataHandle, 'bitmap-data');
    this.require(record);
    let cache = this.states.get(dataHandle);
    if (!cache || cache.state !== state) {
      cache = { state, record, pending: null };
      this.states.set(dataHandle, cache);
      this.stateBindings.set(state, dataHandle);
    }
    return cache;
  }
  replace(dataHandle, state) {
    if (!this.isOwned(dataHandle)) return super.replace(dataHandle, state);
    this.stateBindings.set(state, dataHandle);
    this.states.delete(dataHandle);
    return false;
  }
  signature(state) {
    return JSON.stringify([
      state.revision,
      ...Object.keys(fields).map((key) => state[key] ?? 0),
      state.clip,
      state.attributes,
    ]);
  }
  async flush(dataHandle) {
    if (!this.isOwned(dataHandle)) return super.flush(dataHandle);
    const cache = this.bind(dataHandle),
      state = cache.state,
      signature = this.signature(state);
    if (cache.signature === signature && cache.pixels === state.rgba) return;
    const p = this.process,
      pointer = this.require(cache.record);
    this.pending.add(dataHandle);
    this.internal++;
    try {
      if (
        p.load(pointer + 4) !== state.width ||
        p.load(pointer + 8) !== state.height ||
        p.load(pointer + 24) !== state.bpp
      ) {
        const data = p.load(pointer + 12);
        if (data) (await this.world.getNativeFeature('data-buffers')).releaseData(data);
        p.store(pointer + 12, 0);
        p.store(pointer + 16, 0);
        if (
          !(await this.call(this.layout.configure, [state.width, state.height, state.bpp], pointer))
        )
          throw new Error('Bitmap projection allocation failed');
      }
      const handle = this.aliases(dataHandle)[0];
      if (handle === undefined) throw new Error('Bitmap projection lost its JS owner');
      const rgba = await this.images.get(handle).pixels();
      this.writePixels(cache.record, rgba);
      for (const [key, offset] of Object.entries(fields))
        if (!['width', 'height', 'bpp'].includes(key)) p.store(pointer + offset, state[key] ?? 0);
      state.clip.forEach((word, index) => p.store(pointer + 56 + index * 4, word));
      const attributes = JSON.stringify(state.attributes ?? []);
      if (cache.attributes !== attributes) {
        await this.call(this.layout.clearAttributes, [], pointer);
        const data = p.allocate(20);
        try {
          for (const attribute of state.attributes ?? []) {
            [...attribute.rect, attribute.color].forEach((word, index) =>
              p.store(data + index * 4, word),
            );
            if (!(await this.call(this.layout.attribute, [attribute.id, 0, data], pointer)))
              throw new Error('Bitmap projection attribute failed');
          }
        } finally {
          p.free(data);
        }
        cache.attributes = attributes;
      }
      cache.signature = this.signature(state);
      cache.pixels = state.rgba;
      cache.pending = null;
      cache.pendingAttributes = null;
    } finally {
      this.internal--;
      this.pending.delete(dataHandle);
    }
  }
  changed(dataHandle) {
    return this.isOwned(dataHandle) ? this.flush(dataHandle) : super.changed(dataHandle);
  }
  // A decoder/capture returns a new value. Import it once at that explicit
  // operation boundary, then keep subsequent script state in JS.
  captureOperation(handle) {
    const bitmap = this.images.get(handle),
      dataHandle = bitmap.dataHandle;
    if (!this.isOwned(dataHandle)) return;
    const cache = this.bind(dataHandle),
      p = this.process,
      pointer = this.require(cache.record),
      state = cache.state;
    for (const [key, offset] of Object.entries(fields))
      state[key] = signed.has(key) ? p.load(pointer + offset) | 0 : p.load(pointer + offset);
    state.clip = Array.from({ length: 4 }, (_, index) => p.load(pointer + 56 + index * 4) | 0);
    state.rgba = super.pixels(dataHandle).slice();
    state.attributes = this.attributes(cache.record);
    state.source = null;
    state.revision = (state.revision + 1) >>> 0;
    cache.signature = this.signature(state);
    cache.pixels = state.rgba;
    cache.attributes = JSON.stringify(state.attributes);
    bitmap.cachedFrame = null;
    bitmap.canvas = null;
  }
  async adopt(handle, pointer) {
    const result = await super.adopt(handle, pointer);
    this.captureOperation(handle);
    return result;
  }
  adoptWrapper(handle, pointer, owner) {
    super.adoptWrapper(handle, pointer, owner);
    this.captureOperation(handle);
  }
  borrow(handle, pointer) {
    const result = super.borrow(handle, pointer);
    this.refs.data.get(this.images.get(handle).dataHandle).external = true;
    return result;
  }
  snapshotState(state) {
    const dataHandle = this.stateBindings.get(state);
    return this.isOwned(dataHandle) ? null : super.snapshotState(state);
  }
  call(address, args = [], pointer) {
    if (this.preparingCall && !this.process.asyncEnabled)
      return this.process.callAsync(address, args, pointer);
    return super.call(address, args, pointer);
  }
  async beforeCall() {
    if (this.internal) return;
    this.preparingCall = true;
    try {
      for (const [handle] of this.refs.wrappers) {
        const record = this.handles.records.get(handle);
        if (record?.type === 'bitmap') record.value.commitCanvas();
      }
      for (const [dataHandle] of this.refs.data)
        if (this.isOwned(dataHandle)) await this.flush(dataHandle);
      this.invalidate();
    } finally {
      this.preparingCall = false;
    }
  }
  afterCall() {
    if (!this.internal) this.invalidate();
  }
}
