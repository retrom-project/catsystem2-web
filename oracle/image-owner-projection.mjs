// SPDX-License-Identifier: MPL-2.0
// Independent PE owners are retained by the remaining Draw/FES consumers.
// File decoding and pixel commands use this boundary until phases 5.2/5.3.
import { NativeImageOwners as OriginalImageOwners } from './image-owner.mjs';
import { NativeBitmap } from '../src/native/image.mjs';
import { nativeDataArgument } from '../src/native/data-text.mjs';

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
      this.refs.models.set(handle, { pointer, owner: task.id });
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
      if (model.bitmap) {
        const source = this.world.graphics.images.get(model.bitmap),
          wrapper = p.load(pointer + 12),
          bitmap = wrapper && p.load(wrapper),
          memory = this.engine.features.get('bitmap-memory');
        if (!bitmap) throw new Error('Image-owner projection has no editable bitmap');
        if (
          p.load(bitmap + 4) !== source.width ||
          p.load(bitmap + 8) !== source.height ||
          p.load(bitmap + 24) !== source.state.bpp
        )
          throw new Error('Image-owner dimensions require an explicit projection replacement');
        memory.writePixels({ pointer: bitmap }, await source.pixels());
        for (const [key, offset] of Object.entries(fields))
          if (!['width', 'height', 'bpp'].includes(key))
            p.store(bitmap + offset, source.state[key] ?? 0);
        source.state.clip.forEach((word, index) => p.store(bitmap + 56 + index * 4, word));
        const attrs = JSON.stringify(source.state.attributes ?? []);
        if (projected.attributes !== attrs) {
          await this.call(memory.layout.clearAttributes, [], bitmap);
          const data = p.allocate(20);
          try {
            for (const attribute of source.state.attributes ?? []) {
              [...attribute.rect, attribute.color].forEach((word, index) =>
                p.store(data + index * 4, word),
              );
              await this.call(memory.layout.attribute, [attribute.id, 0, data], bitmap);
            }
          } finally {
            p.free(data);
          }
          projected.attributes = attrs;
        }
      }
      model.info.forEach((word, index) => p.store(pointer + 20 + index * 4, word));
      projected.signature = this.signature(model);
    } finally {
      this.internal--;
    }
  }
  async applyModel(id, args, machine, task) {
    const argument = (index) => nativeDataArgument(args, machine, index),
      draw = id === 0x2db || id === 0x2dc,
      primary = argument(draw ? 2 : 0);
    if (primary) await this.prepare(primary);
    if (id === 0x2d5 && argument(1)) await this.prepare(argument(1));
    if ((id === 0x2de || id === 0x2df) && argument(5)) await this.prepare(argument(5));
    this.internal++;
    try {
      const reply = await super.apply(id, args, machine, task);
      if (primary && !draw) {
        const model = this.world.imageOwners.get(primary),
          projected = this.refs.models.get(primary);
        this.capture(projected.pointer, model);
        projected.signature = this.signature(model);
      }
      return reply;
    } finally {
      this.internal--;
    }
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
