// SPDX-License-Identifier: MPL-2.0
// FES retains independent PE records and wrappers. JS owns image collections,
// animation and composition. This projection is removed in phase 7.
import { imageOwnerReleaseAddress } from './image-owner.mjs';
import { nativeABI } from '../src/native/abi/index.mjs';
import { floatBits } from '../src/kcs.mjs';

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
export class NativeImageOwnerProjection {
  constructor(engine, world) {
    Object.assign(this, { engine, world, process: engine.process });
    engine.refs.imageOwners ??= { pointers: new Set(), models: new Map() };
    this.releaseAddress = imageOwnerReleaseAddress(engine);
    this.internal = 0;
    engine.registerFeature('image-owner-projection', this);
  }
  get refs() {
    return this.engine.refs.imageOwners;
  }
  pointer(handle) {
    if (!handle) return 0;
    this.world.imageOwners.get(handle);
    const record = this.refs.models.get(handle);
    if (!record || !this.process.allocations.has(record.pointer))
      throw new Error('Image owner must be projected before the FES consumer uses it');
    return record.pointer;
  }
  async privateWrapper(handle, projected) {
    if (!handle) return 0;
    const memory = this.engine.features.get('bitmap-memory'),
      p = this.process;
    const previous = memory.preparingCall;
    memory.preparingCall ||= this.preparingCall;
    let pointer;
    try {
      pointer = await memory.pointer(handle);
    } finally {
      memory.preparingCall = previous;
    }
    const wrapper = p.allocate(memory.layout.wrapperBytes, true);
    await this.call(memory.layout.wrapperConstruct, [], wrapper);
    p.store(wrapper, pointer);
    p.store(pointer + 80, p.load(pointer + 80) + 1);
    projected.sources.push({ pointer, handle, wrapper });
    return wrapper;
  }
  async retainedSource(layer, projected) {
    const p = this.process;
    const pointer = p.allocate(nativeABI(this.engine.profile).graphics.retainedBytes, true);
    for (const [offset, word] of [
      [0, layer.key],
      [4, layer.key >>> 16],
      [28, 255],
      [120, floatBits(1)],
      [124, floatBits(1)],
      [188, 1],
    ])
      p.store(pointer + offset, word);
    const sdk = nativeABI(this.engine.profile).graphics.preserveRGB24,
      nodeBytes = sdk ? 24 : 28;
    const map = p.allocate(8, true),
      head = p.allocate(nodeBytes, true);
    p.store(map, head);
    p.store(map + 4, layer.animation.frames.length);
    p.write(head + 12, Uint8Array.of(1, 1));
    const frames = [];
    for (const frame of layer.animation.frames) {
      const node = p.allocate(nodeBytes, true),
        wrapper = await this.privateWrapper(frame.bitmap, projected);
      p.write(node + 12, Uint8Array.of(1, 0));
      p.store(node + 16, frame.key);
      p.store(node + 20, wrapper);
      frames.push({ node, key: frame.key, wrapper });
    }
    const tree = (start, end, parent) => {
      if (start >= end) return head;
      const mid = (start + end) >>> 1,
        n = frames[mid].node;
      p.store(n + 4, parent);
      p.store(n, tree(start, mid, n));
      p.store(n + 8, tree(mid + 1, end, n));
      return n;
    };
    p.store(head, frames[0]?.node ?? head);
    p.store(head + 4, tree(0, frames.length, head));
    p.store(head + 8, frames.at(-1)?.node ?? head);
    p.store(pointer + 60, map);
    const selected = frames.find((f) => f.key === layer.animation.selected);
    if (selected?.wrapper) {
      const memory = this.engine.features.get('bitmap-memory'),
        ref = selected.wrapper + memory.layout.wrapperBytes - 4;
      p.store(ref, p.load(ref) + 1);
      p.store(pointer + 8, selected.wrapper);
      const source = this.world.graphics.images.get(
        layer.animation.frames.find((f) => f.key === selected.key).bitmap,
      ).state;
      [source.offsetX, source.offsetY, source.width, source.height].forEach((v, i) =>
        p.store(pointer + 12 + i * 4, v),
      );
      p.store(pointer + 128, floatBits(source.baseX));
      p.store(pointer + 132, floatBits(source.baseY));
    }
    p.store(pointer + 76, layer.animation.selected);
    p.store(pointer + 136, 1);
    const b = layer.animation.bounds;
    [
      b.offsetX,
      b.offsetY,
      b.offsetX + b.width,
      b.offsetY + b.height,
      b.canvasWidth,
      b.canvasHeight,
    ].forEach((v, i) => p.store(pointer + 164 + i * 4, v));
    return pointer;
  }
  async construct(model) {
    const p = this.process,
      platform = await this.world.getNativeFeature('graphics-platform');
    const pointer = p.allocate(64, true),
      projected = { pointer, owner: model.owner, sources: [], outputBitmap: 0, outputWrapper: 0 };
    this.refs.pointers.add(pointer);
    p.store(pointer, 1);
    p.store(pointer + 4, platform.refs.view);
    if (model.layers) {
      const vector = p.allocate(12, true),
        begin = model.layers.length ? p.allocate(model.layers.length * 20, true) : 0;
      p.store(pointer + 16, vector);
      [begin, begin + model.layers.length * 20, begin + model.layers.length * 20].forEach(
        (word, i) => p.store(vector + i * 4, word),
      );
      for (let i = 0; i < model.layers.length; i++) {
        const layer = model.layers[i],
          at = begin + i * 20;
        p.store(at, layer.key);
        if (layer.bitmap) p.store(at + 4, await this.privateWrapper(layer.bitmap, projected));
        if (layer.animation) p.store(at + 16, await this.retainedSource(layer, projected));
        if (layer.program?.length) {
          const data = this.engine.features.get('data-buffers').allocateData(layer.program.length);
          p.write(data, layer.program);
          p.store(at + 8, data);
          p.store(at + 12, layer.program.length);
        }
      }
    }
    return projected;
  }
  async prepare(handle) {
    if (!handle) return 0;
    this.internal++;
    try {
      if (!this.refs.models.has(handle))
        this.refs.models.set(handle, await this.construct(this.world.imageOwners.get(handle)));
      await this.sync(handle);
      return this.pointer(handle);
    } finally {
      this.internal--;
    }
  }
  async sync(handle) {
    const model = this.world.imageOwners.get(handle),
      projected = this.refs.models.get(handle);
    if (!projected) return;
    this.internal++;
    try {
      const p = this.process;
      for (const source of projected.sources)
        if (this.world.runtime.handles.records.has(source.handle))
          await this.syncBitmap(source.handle, source.pointer, source);
      if (projected.outputBitmap !== model.bitmap) {
        const wrapper = model.bitmap ? await this.privateWrapper(model.bitmap, projected) : 0,
          previous = projected.outputWrapper;
        projected.outputWrapper = wrapper;
        projected.outputBitmap = model.bitmap;
        p.store(projected.pointer + 12, wrapper);
        if (previous)
          await this.call(
            this.engine.features.get('data-buffers').layout.imageRelease,
            [],
            previous,
          );
      }
      model.info.forEach((word, i) => p.store(projected.pointer + 20 + i * 4, word));
      // The FES copy has an independent output wrapper. Its original destructor
      // uses this ownership word, independently of the JS-visible model info.
      p.store(projected.pointer + 60, 1);
    } finally {
      this.internal--;
    }
  }
  async syncBitmap(handle, bitmap, cache) {
    const p = this.process,
      source = this.world.graphics.images.get(handle),
      memory = this.engine.features.get('bitmap-memory');
    if (!bitmap) throw new Error('Image-owner projection has no editable bitmap');
    if (
      p.load(bitmap + 4) !== source.width ||
      p.load(bitmap + 8) !== source.height ||
      p.load(bitmap + 24) !== source.state.bpp
    ) {
      const data = p.load(bitmap + 12);
      if (data) (await this.world.getNativeFeature('data-buffers')).releaseData(data);
      p.store(bitmap + 12, 0);
      p.store(bitmap + 16, 0);
      await this.call(
        memory.layout.configure,
        [source.width, source.height, source.state.bpp],
        bitmap,
      );
    }
    memory.writePixels({ pointer: bitmap }, await source.pixels());
    for (const [key, offset] of Object.entries(fields))
      if (!['width', 'height', 'bpp'].includes(key))
        p.store(bitmap + offset, source.state[key] ?? 0);
    source.state.clip.forEach((word, i) => p.store(bitmap + 56 + i * 4, word));
    const attributes = JSON.stringify(source.state.attributes ?? []);
    if (cache.outputAttributes !== attributes) {
      await this.call(memory.layout.clearAttributes, [], bitmap);
      const data = p.allocate(20);
      try {
        for (const attribute of source.state.attributes ?? []) {
          [...attribute.rect, attribute.color].forEach((v, i) => p.store(data + i * 4, v));
          await this.call(memory.layout.attribute, [attribute.id, 0, data], bitmap);
        }
      } finally {
        p.free(data);
      }
      cache.outputAttributes = attributes;
    }
  }
  snapshot() {
    return {};
  }
  restore() {
    if (!(this.refs.models instanceof Map)) throw new Error('Invalid projected owner registry');
  }
  async close() {
    for (const handle of [...this.refs.models.keys()]) await this.releaseModel(handle);
  }
  async releasePointer(pointer, owner) {
    await this.call(this.releaseAddress, [], pointer, owner);
    if (!this.process.allocations.has(pointer)) this.refs.pointers.delete(pointer);
  }
  async releaseModel(handle) {
    const record = this.refs.models.get(handle);
    if (!record) return;
    this.internal++;
    try {
      await this.releasePointer(record.pointer, record.owner);
      this.refs.models.delete(handle);
    } finally {
      this.internal--;
    }
  }
  call(address, args = [], pointer, task, messageContext) {
    if (this.preparingCall && !this.process.asyncEnabled)
      return this.process.callAsync(address, args, pointer);
    const options = { task, messageContext };
    return this.process.asyncEnabled
      ? this.engine.callFromHost(address, args, pointer, options)
      : this.engine.call(address, args, pointer, options);
  }
  async beforeCall() {
    if (this.internal) return;
    this.preparingCall = true;
    try {
      for (const handle of this.refs.models.keys()) await this.sync(handle);
    } finally {
      this.preparingCall = false;
    }
  }
  async releaseOwner(owner) {
    for (const [handle, record] of [...this.refs.models])
      if (record.owner === owner) await this.releaseModel(handle);
  }
}
