// SPDX-License-Identifier: MPL-2.0
// Independent PE owners are retained by the remaining Draw/FES consumers.
// JS owns all encoded inputs, layer pixels and metadata. Only consumers execute here.
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
    engine.registerFeature('image-owner-projection', this);
    this.internal = 0;
    this.consumed = new Set();
    const retained = engine.features.get('retained-draw'),
      p = this.process;
    this.detachRenderer = p.beforeInstruction(
      retained.abi.rendererDraw,
      'observe projected owner rendering',
      () => {
        if (this.internal) return;
        const pointer = p.cpu.reg_read_i32(p.uc.X86_REG_ECX) >>> 0;
        for (const [handle, record] of this.refs.models)
          if (p.load(record.pointer + 8) === pointer) this.consumed.add(handle);
      },
    );
  }
  get refs() {
    return this.engine.refs.imageOwners;
  }
  pointer(handle) {
    if (!handle) return 0;
    this.world.imageOwners.get(handle);
    const record = this.refs.models.get(handle);
    if (!record || !this.process.allocations.has(record.pointer))
      throw new Error('Image owner must be projected before the EXE consumer uses it');
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
    projected.sources.push({ pointer, handle });
    return wrapper;
  }
  async retainedSource(layer, projected) {
    const p = this.process,
      retained = this.engine.features.get('retained-draw');
    const pointer = p.allocate(nativeABI(this.engine.profile).graphics.retainedBytes, true);
    await this.call(retained.abi.construct, [layer.key, 0, 0], pointer);
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
      platform = this.engine.features.get('graphics-platform');
    await platform.ensureRenderer();
    const pointer = p.allocate(64, true),
      projected = { pointer, owner: model.owner, sources: [] };
    this.refs.pointers.add(pointer);
    p.store(pointer, 1);
    p.store(pointer + 4, platform.refs.view);
    if (model.layers) {
      const vector = p.allocate(12, true),
        begin = model.layers.length ? p.allocate(model.layers.length * 20, true) : 0;
      p.store(pointer + 16, vector);
      [begin, begin + model.layers.length * 20, begin + model.layers.length * 20].forEach((v, i) =>
        p.store(vector + i * 4, v),
      );
      for (let i = 0; i < model.layers.length; i++) {
        const l = model.layers[i],
          at = begin + i * 20;
        p.store(at, l.key);
        if (l.bitmap) p.store(at + 4, await this.privateWrapper(l.bitmap, projected));
        if (l.animation) p.store(at + 16, await this.retainedSource(l, projected));
        if (l.program?.length) {
          const data = this.engine.features.get('data-buffers').allocateData(l.program.length);
          p.write(data, l.program);
          p.store(at + 8, data);
          p.store(at + 12, l.program.length);
        }
      }
      await this.rebuildRenderer(projected, model);
    } else p.store(pointer + 12, await this.privateWrapper(model.bitmap, projected));
    projected.rebuild = model.rebuild ?? 0;
    return projected;
  }
  async prepare(handle) {
    if (!handle) return 0;
    const model = this.world.imageOwners.get(handle);
    this.internal++;
    try {
      if (!this.refs.models.has(handle)) this.refs.models.set(handle, await this.construct(model));
      await this.sync(handle);
      return this.pointer(handle);
    } finally {
      this.internal--;
    }
  }
  signature(model) {
    const state = model.bitmap && this.world.graphics.images.get(model.bitmap).state;
    return JSON.stringify([
      model.info,
      model.revision,
      model.rebuild,
      (model.layers ?? []).flatMap((l) => [
        l.bitmap && this.world.graphics.images.get(l.bitmap).state.revision,
        ...(l.animation?.frames ?? []).map(
          (f) => f.bitmap && this.world.graphics.images.get(f.bitmap).state.revision,
        ),
      ]),
      state && Object.keys(fields).map((key) => state[key] ?? 0),
      state?.revision,
      state?.clip,
      state?.attributes,
    ]);
  }
  async sync(handle) {
    const projected = this.refs.models.get(handle),
      model = this.world.imageOwners.get(handle),
      signature = this.signature(model);
    if (projected.signature === signature) return;
    const p = this.process,
      pointer = projected.pointer;
    this.internal++;
    try {
      for (const entry of projected.sources ?? []) {
        if (entry.handle === model.bitmap || !this.world.runtime.handles.records.has(entry.handle))
          continue;
        await this.syncBitmap(entry.handle, entry.pointer, entry);
      }
      const vector = p.load(pointer + 16);
      if (vector)
        for (let i = 0; i < (model.layers ?? []).length; i++) {
          const layer = model.layers[i];
          if (!layer.animation) continue;
          const current = layer.animation.frames.find(
              (f) => f.key === layer.animation.selected && f.bitmap,
            ),
            raw = p.load(p.load(vector) + i * 20 + 16);
          if (!current || !raw) continue;
          const state = this.world.graphics.images.get(current.bitmap).state;
          [state.offsetX, state.offsetY, state.width, state.height].forEach((v, j) =>
            p.store(raw + 12 + j * 4, v),
          );
          p.store(raw + 128, floatBits(state.baseX));
          p.store(raw + 132, floatBits(state.baseY));
          p.store(raw + 136, 1);
        }
      if ((model.rebuild ?? 0) !== (projected.rebuild ?? 0)) {
        await this.rebuildRenderer(projected, model);
        projected.rebuild = model.rebuild ?? 0;
        projected.outputAttributes = null;
      }
      if (model.bitmap)
        await this.syncBitmap(model.bitmap, p.load(p.load(pointer + 12)), projected);
      model.info.forEach((word, index) => p.store(pointer + 20 + index * 4, word));
      if ((model.revision ?? 0) !== (projected.revision ?? 0)) {
        const manager = p.load(pointer + 8),
          retained = this.engine.features.get('retained-draw');
        if (manager)
          for (const layer of model.layers ?? []) {
            const entry = await this.call(retained.abi.rendererFind, [layer.key], manager);
            if (entry)
              await this.call(retained.abi.rendererLayer, [layer.key, p.load(entry + 4)], manager);
          }
        projected.revision = model.revision ?? 0;
      }
      projected.signature = this.signature(model);
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
  async rebuildRenderer(projected, model) {
    const p = this.process,
      owner = projected.pointer,
      vector = p.load(owner + 16),
      retained = this.engine.features.get('retained-draw'),
      abi = retained.abi;
    const old = p.load(owner + 8);
    if (old) {
      await this.call(abi.rendererDestroy, [], old);
      p.free(old);
      p.store(owner + 8, 0);
    }
    if (!vector) return;
    const begin = p.load(vector);
    if (model.layers.length === 1 && model.layers[0].bitmap) {
      p.store(owner + 12, p.load(begin + 4));
      return;
    }
    const manager = p.allocate(60, true),
      scratch = p.allocate(24, true);
    try {
      await this.call(abi.rendererConstruct, [model.info[0], model.info[1], 4, 1], manager);
      p.store(owner + 8, manager);
      p.store(owner + 12, p.load(manager + 8));
      for (let i = 0; i < model.layers.length; i++) {
        const layer = model.layers[i],
          raw = begin + i * 20;
        const source = layer.bitmap
          ? this.world.graphics.images.get(layer.bitmap).state
          : layer.animation.bounds;
        const base = [source.baseX, source.baseY],
          position = [(base[0] - model.info[4]) >>> 0, (base[1] - model.info[5]) >>> 0];
        [...position, ...base, 1, 1].forEach((v, j) => p.store(scratch + j * 4, floatBits(v)));
        const input = layer.bitmap ? p.load(p.load(raw + 4)) : p.load(raw + 16);
        await this.call(
          layer.bitmap ? abi.rendererBitmap : abi.rendererRetained,
          [layer.key, input, scratch, scratch + 8, 0, scratch + 16, 255, 1, 0],
          manager,
        );
        if (!layer.bitmap && p.load(raw + 8)) {
          const entry = await this.call(abi.rendererFind, [layer.key], manager);
          if (entry) await this.call(abi.load, [p.load(raw + 8), p.load(raw + 12)], entry);
        }
      }
      await this.call(abi.rendererDraw, [0, 0, 0], manager);
    } finally {
      p.free(scratch);
    }
  }
  afterCall() {
    this.captureRendered();
  }
  captureRendered() {
    if (this.internal) return;
    const p = this.process,
      images = this.world.graphics.images;
    for (const handle of this.consumed) {
      const projection = this.refs.models.get(handle);
      if (!projection || !this.world.runtime.handles.records.has(handle)) continue;
      const model = this.world.imageOwners.get(handle);
      if (!model.bitmap || !model.layers || (model.layers.length === 1 && model.layers[0].bitmap))
        continue;
      const pointer = p.load(p.load(projection.pointer + 12)),
        source = this.engine.features.get('graphics-platform').logicalBitmap(pointer).state;
      const output = images.get(model.bitmap);
      output.state.rgba = source.rgba.slice();
      output.state.revision = (output.state.revision ?? 0) + 1;
      output.cachedFrame = null;
      output.canvas = null;
      model.info[9] = p.load(projection.pointer + 56);
      projection.signature = this.signature(model);
    }
    this.consumed.clear();
  }
  snapshot() {
    return {};
  }
  restore() {
    if (!(this.refs.models instanceof Map)) throw new Error('Invalid projected owner registry');
  }
  async close() {
    this.detachRenderer?.();
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
    for (const [h, r] of [...this.refs.models]) if (r.owner === owner) await this.releaseModel(h);
  }
}
