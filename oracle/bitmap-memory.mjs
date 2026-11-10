// SPDX-License-Identifier: MPL-2.0
import { nativeABI } from '../src/native/abi/index.mjs';
// Persistent bitmap wrappers. Guest kcBitmap storage is authoritative after
// materialization; host RGBA and Canvas objects are derived presentation views.

export function sameNativeBitmap(process, first, second) {
  const data = first && process.load(first);
  return Boolean(data && second && process.load(second) === data);
}

const layouts = {
  'nekopara-vol3-engine-2.6.1.76': {
    construct: 0x68b3e0,
    configure: 0x68be00,
    release: 0x68cf20,
    attribute: 0x68b5c0,
    clearAttributes: 0x68b870,
    resize: 0x68d450,
    wrapperBytes: nativeABI('nekopara-vol3-engine-2.6.1.76').layouts.bitmapMemory.wrapperBytes,
    wrapperConstruct: 0x68e9f0,
    wrapperRelease: 0x690050,
  },
  'sdk-4.01-engine-2.6.1.74': {
    construct: 0x561f40,
    configure: 0x562970,
    release: 0x563a90,
    attribute: 0x562120,
    clearAttributes: 0x5623d0,
    resize: 0x563fc0,
    wrapperBytes: nativeABI('sdk-4.01-engine-2.6.1.74').layouts.bitmapMemory.wrapperBytes,
    wrapperConstruct: 0x565560,
    wrapperRelease: 0x5668f0,
  },
};
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
export class NativeBitmapMemory {
  constructor(engine, world) {
    Object.assign(this, { engine, world, process: engine.process });
    this.layout = layouts[engine.profile];
    if (!this.layout) throw new Error('Bitmap memory requires a reviewed engine profile');
    engine.refs.bitmapMemory ??= { data: new Map(), wrappers: new Map() };
    this.states = new Map();
    this.pixelStates = new Map();
    this.stateBindings = new WeakMap();
    this.pending = new Set();
    this.internal = 0;
    engine.registerFeature('bitmap-memory', this);
  }
  get refs() {
    return this.engine.refs.bitmapMemory;
  }
  get images() {
    return this.world.graphics.images;
  }
  get handles() {
    return this.world.runtime.handles;
  }
  call(address, args = [], pointer) {
    return this.process.asyncEnabled
      ? this.engine.callFromHost(address, args, pointer)
      : this.engine.call(address, args, pointer);
  }
  require(record) {
    if (!(this.process.allocations.get(record.pointer) >= 92))
      throw new Error('Native bitmap backing is released');
    return record.pointer;
  }
  bind(dataHandle) {
    const record = this.refs.data.get(dataHandle);
    if (!record) return null;
    this.require(record);
    const state = this.handles.get(dataHandle, 'bitmap-data');
    if (this.states.get(dataHandle)?.state === state) return this.states.get(dataHandle);
    const p = this.process,
      cache = { state, record, pending: null },
      pixels = this.pixelStates.get(record.pointer) ?? { rgba: null, metadata: null, dirty: true };
    this.pixelStates.set(record.pointer, pixels);
    for (const name of ['rgba', 'metadata', 'dirty'])
      Object.defineProperty(cache, name, {
        get: () => pixels[name],
        set: (value) => {
          pixels[name] = value;
        },
      });
    this.states.set(dataHandle, cache);
    this.stateBindings.set(state, dataHandle);
    for (const [key, offset] of Object.entries(fields))
      Object.defineProperty(state, key, {
        configurable: true,
        enumerable: true,
        get: () =>
          signed.has(key)
            ? p.load(this.require(record) + offset) | 0
            : p.load(this.require(record) + offset),
        set: (value) => {
          p.store(this.require(record) + offset, value);
        },
      });
    const clip = Array(4).fill(0);
    for (let i = 0; i < 4; i++)
      Object.defineProperty(clip, i, {
        enumerable: true,
        configurable: true,
        get: () => p.load(this.require(record) + 56 + i * 4) | 0,
        set: (value) => {
          p.store(this.require(record) + 56 + i * 4, value);
        },
      });
    Object.defineProperty(state, 'clip', {
      configurable: true,
      enumerable: true,
      get: () => clip,
      set: (values) => {
        if (values.length !== 4) throw new Error('Native bitmap clip needs four words');
        values.forEach((v, i) => {
          clip[i] = v;
        });
      },
    });
    Object.defineProperty(state, 'rgba', {
      configurable: true,
      enumerable: true,
      get: () => (cache.dirty || !cache.rgba ? this.pixels(dataHandle) : cache.rgba),
      set: (rgba) => {
        if (rgba == null) {
          cache.rgba = null;
          return;
        }
        cache.rgba = rgba;
        this.writePixels(record, rgba);
        this.touch(record, dataHandle);
        cache.dirty = false;
      },
    });
    Object.defineProperty(state, 'attributes', {
      configurable: true,
      enumerable: true,
      get: () => this.attributes(record),
      set: (attributes) => {
        cache.pendingAttributes = attributes;
      },
    });
    state.source = null;
    delete state.nativeBitmapPointer;
    return cache;
  }
  pixels(dataHandle) {
    const cache = this.bind(dataHandle);
    if (!cache) return null;
    if (cache.pending) return cache.pending.rgba;
    const p = this.process,
      record = cache.record,
      pointer = this.require(record),
      width = p.load(pointer + 4),
      height = p.load(pointer + 8),
      bpp = p.load(pointer + 24),
      stride = p.load(pointer + 20),
      data = p.load(pointer + 12);
    if (width && height && (![2, 3, 4].includes(bpp) || stride < width * bpp))
      throw new Error(
        `Native bitmap RGBA projection does not support ${width}x${height}/${bpp}/${stride}`,
      );
    const rgba = new Uint8ClampedArray(width * height * 4);
    for (let y = 0; width && y < height; y++) {
      const row = p.read(data + (height - y - 1) * stride, width * bpp);
      for (let x = 0; x < width; x++) {
        const at = (y * width + x) * 4,
          src = x * bpp;
        if (bpp === 2) {
          const value = row[src] | (row[src + 1] << 8);
          rgba[at] = ((value >>> 8) & 15) * 17;
          rgba[at + 1] = ((value >>> 4) & 15) * 17;
          rgba[at + 2] = (value & 15) * 17;
          rgba[at + 3] = (value >>> 12) * 17;
        } else {
          rgba[at] = row[src + 2];
          rgba[at + 1] = row[src + 1];
          rgba[at + 2] = row[src];
          rgba[at + 3] = bpp === 4 ? row[src + 3] : 255;
        }
      }
    }
    const old = cache.rgba,
      metadata = [...Object.values(fields), 56, 60, 64, 68].map((offset) =>
        p.load(pointer + offset),
      );
    if (
      !old ||
      old.length !== rgba.length ||
      rgba.some((v, i) => v !== old[i]) ||
      !cache.metadata ||
      metadata.some((v, i) => v !== cache.metadata[i])
    ) {
      cache.rgba = rgba;
      this.touch(record);
    }
    cache.metadata = metadata;
    cache.dirty = false;
    return cache.rgba;
  }
  writePixels(record, rgba) {
    const p = this.process,
      pointer = this.require(record),
      width = p.load(pointer + 4),
      height = p.load(pointer + 8),
      stride = p.load(pointer + 20),
      data = p.load(pointer + 12),
      bpp = p.load(pointer + 24);
    if (
      rgba.length !== width * height * 4 ||
      (width && height && (![2, 3, 4].includes(bpp) || stride < width * bpp))
    )
      throw new Error('Native bitmap pixel transfer requires matching RGBA32 dimensions');
    for (let y = 0; width && y < height; y++) {
      const row = p.read(data + (height - y - 1) * stride, width * bpp);
      for (let x = 0; x < width; x++) {
        const src = (y * width + x) * 4,
          at = x * bpp;
        if (bpp === 2) {
          const value =
            ((rgba[src + 3] & 240) << 8) |
            ((rgba[src] & 240) << 4) |
            (rgba[src + 1] & 240) |
            (rgba[src + 2] >>> 4);
          row[at] = value;
          row[at + 1] = value >>> 8;
        } else {
          row[at] = rgba[src + 2];
          row[at + 1] = rgba[src + 1];
          row[at + 2] = rgba[src];
          if (bpp === 4) row[at + 3] = rgba[src + 3];
        }
      }
      p.write(data + (height - y - 1) * stride, row);
    }
  }
  attributes(record) {
    const p = this.process,
      map = p.load(this.require(record) + 72);
    if (!map) return [];
    const head = p.load(map),
      stack = [],
      output = [],
      seen = new Set();
    let node = p.load(head + 4);
    while (stack.length || !p.read(node + 13, 1)[0]) {
      while (!p.read(node + 13, 1)[0]) {
        if (seen.has(node)) throw new Error('Native bitmap attributes contain a tree cycle');
        seen.add(node);
        stack.push(node);
        node = p.load(node);
      }
      node = stack.pop();
      const key = p.load(node + 16),
        type = key >>> 16,
        data = p.load(node + 20);
      if (type === 0) {
        const words = Array.from({ length: 5 }, (_, i) => p.load(data + i * 4));
        output.push({
          id: key & 65535,
          rect: words.slice(0, 4).map((v) => v | 0),
          color: words[4],
        });
      } else throw new Error('Native bitmap attribute type has no reviewed projection');
      node = p.load(node + 8);
    }
    return output;
  }
  replace(dataHandle, state) {
    const cache = this.bind(dataHandle);
    if (!cache) return false;
    cache.pending = state;
    this.handles.records.get(dataHandle).value = state;
    this.stateBindings.set(state, dataHandle);
    return true;
  }
  changed(dataHandle) {
    const cache = this.states.get(dataHandle);
    if (!cache) return undefined;
    if (cache.pending || cache.pendingAttributes) return this.flush(dataHandle);
    if (cache.rgba) this.writePixels(cache.record, cache.rgba);
    this.touch(cache.record, dataHandle);
    return undefined;
  }
  async resize(dataHandle, width, height) {
    const record = this.refs.data.get(dataHandle);
    if (!record) throw new Error('Native bitmap resize requires materialized storage');
    this.pending.add(dataHandle);
    this.internal++;
    try {
      await this.call(this.layout.resize, [width, height], this.require(record));
      this.states.get(dataHandle).dirty = true;
    } finally {
      this.internal--;
      this.pending.delete(dataHandle);
    }
  }
  async flush(dataHandle) {
    const cache = this.states.get(dataHandle);
    if (!cache) return;
    const state = cache.pending,
      p = this.process,
      record = cache.record,
      pointer = this.require(record);
    this.pending.add(dataHandle);
    this.internal++;
    try {
      if (state) {
        if (state.bpp !== 4) throw new Error('Native bitmap host replacement requires RGBA32');
        const data = p.load(pointer + 12),
          same = p.load(pointer + 4) === state.width && p.load(pointer + 8) === state.height;
        if (!same) {
          const buffers = await this.world.getNativeFeature('data-buffers');
          if (data) buffers.releaseData(data);
          p.store(pointer + 12, 0);
          p.store(pointer + 16, 0);
          if (!(await this.call(this.layout.configure, [state.width, state.height, 4], pointer)))
            throw new Error('Original bitmap reconfiguration failed');
        }
        this.writePixels(record, state.rgba);
        for (const [key, offset] of Object.entries(fields))
          if (!['width', 'height', 'bpp'].includes(key) && state[key] !== undefined)
            p.store(pointer + offset, state[key]);
        state.clip.forEach((v, i) => p.store(pointer + 56 + i * 4, v));
        cache.pendingAttributes = state.attributes;
        cache.pending = null;
        this.states.delete(dataHandle);
        this.bind(dataHandle);
      }
      const attributes = cache.pendingAttributes;
      if (attributes) {
        await this.call(this.layout.clearAttributes, [], pointer);
        const source = p.allocate(20);
        try {
          for (const attribute of attributes) {
            if (!attribute.rect || attribute.rect.length !== 4)
              throw new Error('Native bitmap attribute needs four coordinates');
            [...attribute.rect, attribute.color].forEach((v, i) => p.store(source + i * 4, v));
            if (!(await this.call(this.layout.attribute, [attribute.id, 0, source], pointer)))
              throw new Error('Original bitmap attribute update failed');
          }
        } finally {
          p.free(source);
        }
        cache.pendingAttributes = null;
      }
      this.states.get(dataHandle).rgba = null;
    } finally {
      this.internal--;
      this.pending.delete(dataHandle);
    }
  }
  aliases(dataHandle) {
    return [...this.handles.records]
      .filter(([, r]) => r.type === 'bitmap' && r.value.dataHandle === dataHandle)
      .map(([handle]) => handle);
  }
  addAlias(handle, dataHandle) {
    const record = this.refs.data.get(dataHandle);
    if (!record) return;
    if (this.refs.wrappers.has(handle)) throw new Error('Native bitmap wrapper already exists');
    if (!record.borrowed)
      this.process.store(record.pointer + 80, this.process.load(record.pointer + 80) + 1);
    this.refs.wrappers.set(handle, { pointer: 0, dataHandle });
  }
  async adopt(handle, pointer) {
    const bitmap = this.images.get(handle),
      dataHandle = bitmap.dataHandle;
    if (this.refs.data.has(dataHandle))
      throw new Error('Native bitmap backing is already materialized');
    if (!(this.process.allocations.get(pointer) >= 92))
      throw new Error('Native bitmap adoption requires its original bitmap base object');
    const aliases = this.aliases(dataHandle);
    this.process.store(pointer + 80, this.process.load(pointer + 80) + aliases.length);
    this.refs.data.set(dataHandle, { pointer });
    for (const alias of aliases) this.refs.wrappers.set(alias, { pointer: 0, dataHandle });
    this.bind(dataHandle);
    return pointer;
  }
  adoptWrapper(handle, pointer, owner) {
    const p = this.process,
      bitmap = this.images.get(handle),
      dataHandle = bitmap.dataHandle;
    if (this.refs.data.has(dataHandle) || p.allocations.get(pointer) !== this.layout.wrapperBytes)
      throw new Error('Native bitmap wrapper adoption requires a new original owner');
    const backing = p.load(pointer);
    this.require({ pointer: backing });
    const aliases = this.aliases(dataHandle);
    p.store(backing + 80, p.load(backing + 80) + aliases.length - 1);
    this.refs.data.set(dataHandle, { pointer: backing });
    for (const alias of aliases)
      this.refs.wrappers.set(alias, {
        pointer: alias === handle ? pointer : 0,
        dataHandle,
        ...(alias === handle ? { registration: owner } : {}),
      });
    this.bind(dataHandle);
  }
  borrow(handle, pointer) {
    const bitmap = this.images.get(handle),
      dataHandle = bitmap.dataHandle,
      existing = this.refs.data.get(dataHandle);
    if (existing) {
      if (existing.pointer !== pointer) throw new Error('Borrowed bitmap changed backing identity');
    } else {
      const record = { pointer, borrowed: true };
      this.require(record);
      this.refs.data.set(dataHandle, record);
      for (const alias of this.aliases(dataHandle))
        this.refs.wrappers.set(alias, { pointer: 0, dataHandle });
    }
    this.bind(dataHandle);
    this.states.get(dataHandle).dirty = true;
    return pointer;
  }
  async pointer(handle) {
    if (!handle) return 0;
    const bitmap = this.images.get(handle),
      dataHandle = bitmap.dataHandle;
    if (!this.refs.data.has(dataHandle)) {
      bitmap.commitCanvas();
      const frame = await bitmap.frame(),
        state = bitmap.state,
        initialState = structuredClone(state),
        p = this.process,
        pointer = p.allocate(92, true);
      let constructed = false;
      this.internal++;
      this.pending.add(dataHandle);
      try {
        await this.call(this.layout.construct, [], pointer);
        constructed = true;
        if (!(await this.call(this.layout.configure, [frame.width, frame.height, 4], pointer)))
          throw new Error('Original bitmap allocation failed');
        const record = { pointer };
        this.writePixels(record, frame.rgba);
        for (const [key, offset] of Object.entries(fields))
          if (!['width', 'height', 'bpp'].includes(key) && state[key] !== undefined)
            p.store(pointer + offset, state[key]);
        state.clip.forEach((v, i) => p.store(pointer + 56 + i * 4, v));
        const aliases = this.aliases(dataHandle);
        p.store(pointer + 80, aliases.length);
        this.refs.data.set(dataHandle, record);
        for (const alias of aliases) this.refs.wrappers.set(alias, { pointer: 0, dataHandle });
        const attributes = state.attributes;
        this.bind(dataHandle);
        this.states.get(dataHandle).pendingAttributes = attributes;
        await this.flush(dataHandle);
      } catch (error) {
        if (constructed) {
          p.store(pointer + 80, 1);
          await this.call(this.layout.release, [], pointer);
        } else p.free(pointer);
        this.refs.data.delete(dataHandle);
        this.states.delete(dataHandle);
        this.handles.records.get(dataHandle).value = initialState;
        for (const [alias, r] of this.refs.wrappers)
          if (r.dataHandle === dataHandle) this.refs.wrappers.delete(alias);
        throw error;
      } finally {
        this.pending.delete(dataHandle);
        this.internal--;
      }
    }
    const cache = this.states.get(dataHandle);
    if (cache?.pending || cache?.pendingAttributes) await this.flush(dataHandle);
    const record = this.refs.data.get(dataHandle);
    if (record.borrowed) {
      const aliases = this.aliases(dataHandle);
      this.process.store(
        record.pointer + 80,
        this.process.load(record.pointer + 80) + aliases.length,
      );
      delete record.borrowed;
    }
    return this.require(record);
  }
  async wrapper(handle) {
    if (!handle) return 0;
    const pointer = await this.pointer(handle),
      record = this.refs.wrappers.get(handle);
    if (!record) throw new Error('Native bitmap wrapper has no logical owner');
    if (!record.pointer) {
      const wrapper = this.process.allocate(this.layout.wrapperBytes);
      try {
        await this.call(this.layout.wrapperConstruct, [], wrapper);
        this.process.store(wrapper, pointer);
        record.pointer = wrapper;
      } catch (error) {
        this.process.free(wrapper);
        throw error;
      }
    }
    return record.pointer;
  }
  async release(handle, { task } = {}) {
    const wrapper = this.refs.wrappers.get(handle);
    if (!wrapper) return;
    const record = this.refs.data.get(wrapper.dataHandle);
    if (!record) throw new Error('Native bitmap wrapper lost its backing identity');
    this.pending.add(wrapper.dataHandle);
    this.internal++;
    try {
      if (wrapper.pointer) {
        if (wrapper.registration !== undefined || task !== undefined)
          await this.engine.features
            .get('bitmap-factories')
            .releaseWrapper(wrapper, task ?? wrapper.registration);
        else await this.call(this.layout.wrapperRelease, [], wrapper.pointer);
      } else if (!record.borrowed) await this.call(this.layout.release, [], this.require(record));
      this.refs.wrappers.delete(handle);
      if (
        ![...this.refs.wrappers.values()].some((value) => value.dataHandle === wrapper.dataHandle)
      ) {
        this.refs.data.delete(wrapper.dataHandle);
        this.states.delete(wrapper.dataHandle);
        if (![...this.refs.data.values()].some((value) => value.pointer === record.pointer))
          this.pixelStates.delete(record.pointer);
      }
    } finally {
      this.internal--;
      this.pending.delete(wrapper.dataHandle);
    }
  }
  snapshotState(state) {
    const dataHandle = this.stateBindings.get(state);
    if (dataHandle === undefined) return null;
    const cache = this.states.get(dataHandle);
    if (cache?.pending || cache?.pendingAttributes)
      throw new Error('Cannot checkpoint an uncommitted native bitmap replacement');
    const pointer = this.require(this.refs.data.get(dataHandle));
    const output = {};
    for (const key of Object.keys(state)) if (key !== 'rgba') output[key] = state[key];
    Object.assign(output, { rgba: null, nativeBitmapPointer: pointer, source: null });
    return output;
  }
  beforeCall() {
    if (this.internal) return;
    for (const [handle] of this.refs.wrappers) {
      const record = this.handles.records.get(handle);
      if (record?.type === 'bitmap') record.value.commitCanvas();
    }
    this.invalidate();
  }
  afterCall() {
    if (!this.internal) this.invalidate();
  }
  invalidate() {
    for (const cache of this.states.values()) {
      cache.dirty = true;
    }
  }
  touch(record, except) {
    for (const [dataHandle, cache] of this.states)
      if (cache.record.pointer === record.pointer && dataHandle !== except)
        cache.state.revision = (cache.state.revision + 1) >>> 0;
  }
  snapshot() {
    if (this.pending.size || this.internal)
      throw new Error('Cannot checkpoint unsettled native bitmap transfers');
    return {};
  }
  restore() {
    this.states.clear();
    this.pixelStates.clear();
    this.stateBindings = new WeakMap();
    for (const [dataHandle, record] of this.refs.data) {
      this.require(record);
      if (this.handles.records.has(dataHandle)) this.bind(dataHandle);
    }
    for (const [handle, wrapper] of this.refs.wrappers) {
      this.images.get(handle);
      if (
        wrapper.pointer &&
        this.process.load(wrapper.pointer) !== this.refs.data.get(wrapper.dataHandle).pointer
      )
        throw new Error('Restored bitmap wrapper has a different backing');
    }
  }
  async close() {
    if (this.closed) return;
    for (const [handle] of this.refs.wrappers)
      if (this.handles.records.has(handle)) await this.images.release(handle);
      else await this.release(handle);
    this.closed = true;
  }
}
