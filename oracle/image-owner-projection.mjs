// SPDX-License-Identifier: MPL-2.0
// Independent PE owners are retained by the remaining Draw/FES consumers.
// File decoding and pixel commands use this boundary until phases 5.2/5.3.
import { NativeImageOwners as OriginalImageOwners } from './image-owner.mjs';
import { floatBits } from '../src/kcs.mjs';
import { NativeBitmap } from '../src/native/image.mjs';

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
};
const signed = new Set(['offsetX', 'offsetY', 'baseX', 'baseY']);
export class NativeImageOwnerProjection extends OriginalImageOwners {
  constructor(engine, world) {
    super(engine, world, { feature: 'image-owner-projection' });
    this.refs.models ??= new Map();
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
  async context(task) {
    const p = this.process,
      platform = await this.world.getNativeFeature('graphics-platform');
    await platform.ensureRenderer();
    let context = this.refs.contexts.get(task.id);
    if (!context) {
      const pointer = p.allocate(160, true),
        list = p.allocate(8);
      await this.call(this.listConstruct, [], list, task.id);
      p.store(pointer + 156, list);
      context = { pointer, list, owned: true };
      this.refs.contexts.set(task.id, context);
    }
    p.store(context.pointer + 4, this.world.nativeTaskID?.(task.id) ?? task.id);
    p.store(context.pointer + 116, platform.refs.view);
    return context.pointer;
  }
  pointer(handle) {
    if (!handle) return 0;
    this.world.imageOwners.get(handle);
    const record = this.refs.models.get(handle);
    if (!record || !this.process.allocations.has(record.pointer))
      throw new Error('Image owner must be projected before the EXE consumer uses it');
    return record.pointer;
  }
  capture(pointer, record) {
    const p = this.process,
      images = this.world.graphics.images,
      wrapper = p.load(pointer + 12),
      bitmap = wrapper && p.load(wrapper);
    record.info = Array.from({ length: 11 }, (_, index) => p.load(pointer + 20 + index * 4));
    if (!bitmap) return;
    const platform = this.engine.features.get('graphics-platform'),
      state = platform.logicalBitmap(bitmap).state;
    for (const [name, offset] of Object.entries(fields))
      state[name] = signed.has(name) ? p.load(bitmap + offset) | 0 : p.load(bitmap + offset);
    state.clip = Array.from({ length: 4 }, (_, index) => p.load(bitmap + 56 + index * 4) | 0);
    state.attributes = this.engine.features.get('bitmap-memory').attributes({ pointer: bitmap });
    if (record.bitmap) {
      const image = images.get(record.bitmap);
      image.state = { ...state, source: null, revision: (image.state.revision + 1) >>> 0 };
      image.cachedFrame = null;
      image.canvas = null;
    } else record.bitmap = images.add(new NativeBitmap(images, state));
  }
  importBitmap(pointer) {
    const p = this.process,
      images = this.world.graphics.images,
      state = this.engine.features.get('graphics-platform').logicalBitmap(pointer).state;
    for (const [key, offset] of Object.entries(fields))
      state[key] = signed.has(key) ? p.load(pointer + offset) | 0 : p.load(pointer + offset);
    state.clip = Array.from({ length: 4 }, (_, i) => p.load(pointer + 56 + i * 4) | 0);
    state.attributes = this.engine.features.get('bitmap-memory').attributes({ pointer });
    state.rgba = state.rgba.slice();
    state.source = null;
    return images.add(new NativeBitmap(images, state));
  }
  treeEntries(map) {
    const p = this.process,
      head = p.load(map),
      stack = [],
      entries = [];
    let node = p.load(head + 4);
    while (stack.length || !p.read(node + 13, 1)[0]) {
      while (!p.read(node + 13, 1)[0]) {
        stack.push(node);
        node = p.load(node);
      }
      node = stack.pop();
      entries.push(node);
      node = p.load(node + 8);
    }
    return entries;
  }
  captureLayers(pointer, model) {
    const p = this.process,
      vector = p.load(pointer + 16),
      primary = p.load(p.load(pointer + 12)),
      sources = new Map([[primary, model.bitmap]]);
    const importWrapper = (wrapper) => {
      if (!wrapper) return 0;
      const bitmap = p.load(wrapper);
      if (!sources.has(bitmap)) sources.set(bitmap, this.importBitmap(bitmap));
      return sources.get(bitmap);
    };
    if (!vector) {
      model.layers = null;
      return [...sources].map(([pointer, handle]) => ({ pointer, handle }));
    }
    model.layers = [];
    for (let at = p.load(vector); at !== p.load(vector + 4); at += 20) {
      const key = p.load(at),
        wrapper = p.load(at + 4),
        retained = p.load(at + 16),
        program = p.load(at + 8),
        length = p.load(at + 12);
      const layer = {
        key,
        bitmap: importWrapper(wrapper),
        program: program ? p.read(program, length).slice() : null,
      };
      if (retained) {
        const frames = this.treeEntries(p.load(retained + 60)).map((node) => {
          if (!this.sdk && p.load(node + 24))
            throw new Error('Image prefetch worker returned with an undecoded frame');
          return { key: p.load(node + 16), bitmap: importWrapper(p.load(node + 20)) };
        });
        const state = this.world.graphics.images.get(importWrapper(p.load(retained + 8))).state;
        layer.animation = {
          frames,
          selected: p.load(retained + 76),
          bounds: {
            offsetX: p.load(retained + 164) | 0,
            offsetY: p.load(retained + 168) | 0,
            width: p.load(retained + 172),
            height: p.load(retained + 176),
            canvasWidth: p.load(retained + 180),
            canvasHeight: p.load(retained + 184),
            baseX: state.baseX,
            baseY: state.baseY,
          },
        };
      }
      model.layers.push(layer);
    }
    return [...sources].map(([pointer, handle]) => ({ pointer, handle }));
  }
  async originalCreate(id, args, machine, task) {
    this.internal++;
    try {
      const reply = await super.apply(id, args, machine, task);
      if (!reply.value) return 0;
      const raw = this.world.runtime.handles.release(reply.value, 'image-owner');
      return raw.pointer;
    } finally {
      this.internal--;
    }
  }
  async load(args, machine, task) {
    const pointer = await this.originalCreate(0x2c6, args, machine, task);
    if (!pointer) return 0;
    const record = { owner: task.id, bitmap: 0, info: [] };
    try {
      this.capture(pointer, record);
      const handle = this.world.runtime.handles.add('image-owner', record);
      const sources = this.captureLayers(pointer, record);
      this.refs.models.set(handle, { pointer, owner: task.id, sources });
      return handle;
    } catch (error) {
      await this.releasePointer(pointer, task.id);
      if (record.bitmap) await this.world.graphics.images.release(record.bitmap);
      throw error;
    }
  }
  async prepare(handle) {
    if (!handle) return 0;
    const model = this.world.imageOwners.get(handle);
    if (!this.refs.models.has(handle)) {
      const machine = this.world.objects.machine(model.owner) ?? this.world.main.machine,
        pointer = await this.originalCreate(0x2dd, model.info.slice(0, 2), machine, {
          id: model.owner,
        });
      if (!pointer) throw new Error('Image owner projection allocation failed');
      this.refs.models.set(handle, { pointer, owner: model.owner });
    }
    await this.sync(handle);
    return this.pointer(handle);
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
  async close() {
    this.detachRenderer?.();
    await super.close();
  }
  async releasePointer(pointer, owner) {
    const p = this.process,
      context = this.refs.contexts.get(owner);
    if (context) {
      const head = p.load(context.list);
      for (let at = p.load(head); at !== head; at = p.load(at)) {
        if (p.load(at + 8) !== pointer) continue;
        const next = p.load(at),
          previous = p.load(at + 4);
        p.store(previous, next);
        p.store(next + 4, previous);
        p.store(context.list + 4, p.load(context.list + 4) - 1);
        p.free(at);
        break;
      }
    }
    await this.call(this.releaseAddress, [], pointer, owner);
    if (!p.allocations.has(pointer)) this.refs.pointers.delete(pointer);
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
    return super.call(address, args, pointer, task, messageContext);
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
  async releaseOwner(owner, { dispose = false } = {}) {
    const context = this.refs.contexts.get(owner);
    if (!context) return;
    const p = this.process,
      head = p.load(context.list);
    for (let at = p.load(head); at !== head; at = p.load(at))
      if (p.load(at + 8)) await this.call(this.releaseAddress, [], p.load(at + 8), owner);
    await this.call(this.listClear, [], context.list, owner);
    if (dispose) {
      p.free(head);
      p.free(context.list);
      p.free(context.pointer);
      this.refs.contexts.delete(owner);
    }
  }
}
