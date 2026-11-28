// SPDX-License-Identifier: MPL-2.0
// Independent byte descriptors for explicit D8 MemoryFile/SDK consumers.
import { NativeDataBuffers as JSDataBuffers } from '../src/native/data-buffer.mjs';

export const NATIVE_DATA_BUFFER_LAYOUTS = Object.freeze({
  'nekopara-vol3-engine-2.6.1.76': Object.freeze({ imageRelease: 0x690050 }),
  'sdk-4.01-engine-2.6.1.74': Object.freeze({ imageRelease: 0x5668f0 }),
});

function length(value) {
  if (!Number.isSafeInteger(value) || value < 0 || value > 0x7ffffffb)
    throw new RangeError('Native data-buffer length exceeds its signed allocation ABI');
  return value;
}

export class NativeDataBuffers {
  constructor(engine, { handles, read, diagnostic, source = null } = {}) {
    if (!NATIVE_DATA_BUFFER_LAYOUTS[engine.profile])
      throw new Error(`Native data buffers are unavailable in ${engine.profile}`);
    Object.assign(this, { engine, process: engine.process, handles, read, diagnostic });
    this.layout = NATIVE_DATA_BUFFER_LAYOUTS[engine.profile];
    this.pointers = new Set();
    this.source = source ?? new JSDataBuffers({ handles, read, diagnostic });
    this.sourcePointers = new Map();
    this.projected = new Map();
    this.ownsSource = !source;
    this.releaseSource = (pointer) => this.releaseProjection(pointer);
    this.source.released.add(this.releaseSource);
    this.attachServices({ handles, read, diagnostic });
    const p = this.process;
    engine.registerWindows('USER32.dll', 'SetRectEmpty', {
      count: 1,
      fn: ([out]) => {
        p.zero(out, 16);
        return 1;
      },
    });
    engine.registerWindows('USER32.dll', 'IsRectEmpty', {
      count: 1,
      fn: ([at]) =>
        Number(
          (p.load(at) | 0) >= (p.load(at + 8) | 0) || (p.load(at + 4) | 0) >= (p.load(at + 12) | 0),
        ),
    });
    engine.registerFeature('data-buffers', this);
  }
  attachServices({ handles, read, diagnostic } = {}) {
    this.source.attachServices({ handles, read, diagnostic });
    if (handles && this.handles && handles !== this.handles)
      throw new Error('Native data buffers cannot change their owning handle space');
    if (handles) this.handles = handles;
    if (read) this.read = read;
    if (diagnostic) this.diagnostic = diagnostic;
    return this;
  }
  call(address, args = [], pointer, messageContext) {
    const options = { messageContext };
    return this.process.asyncEnabled
      ? this.engine.callFromHost(address, args, pointer, options)
      : this.engine.call(address, args, pointer, options);
  }
  owns(pointer) {
    return this.pointers.has(pointer) && this.process.allocations.get(pointer) === 20;
  }
  require(pointer) {
    if (!this.owns(pointer))
      throw new Error(`Invalid or released native data-buffer pointer 0x${pointer.toString(16)}`);
    return pointer;
  }
  words(pointer) {
    this.require(pointer);
    return Array.from({ length: 5 }, (_, i) => this.process.load(pointer + i * 4));
  }
  data(pointer) {
    const [address, size] = this.words(pointer);
    return size ? this.process.read(address, size) : new Uint8Array();
  }
  allocateData(size) {
    const p = this.process,
      heap = p.load(this.engine.image.heap),
      allocation = this.engine.kernel.heapAllocate(heap, 0, length(size) + 4);
    if (!allocation) throw new Error('Native data buffer heap allocation failed');
    // 6A49D0 / 575CE0 return one DWORD after their heap allocation. The
    // reference count here is independent of kcBuffer.refs at block +12.
    p.store(allocation, 1);
    return allocation + 4;
  }
  releaseData(address) {
    if (!address) return;
    const p = this.process,
      allocation = address - 4,
      references = p.load(allocation) | 0;
    if (references <= 1) {
      const heap = p.load(this.engine.image.heap);
      if (!this.engine.kernel.heapRelease(heap, allocation))
        throw new Error('Native data buffer freed unknown heap storage');
    } else p.store(allocation, references - 1);
  }
  createPointer(bytes) {
    const pointer = this.source.createPointer(bytes);
    try {
      return this.projectPointer(pointer);
    } catch (error) {
      this.source.releasePointer(pointer);
      throw error;
    }
  }
  projectPointer(source) {
    this.source.require(source);
    const previous = this.projected.get(source);
    if (previous && this.owns(previous)) return previous;
    const bytes = this.source.data(source),
      address = this.allocateData(bytes.length);
    let pointer;
    try {
      this.process.write(address, bytes);
      pointer = this.wrapPointer(address, bytes.length, { borrowed: false });
    } catch (error) {
      this.releaseData(address);
      throw error;
    }
    this.sourcePointers.set(pointer, source);
    this.projected.set(source, pointer);
    return pointer;
  }
  releaseProjection(source) {
    const pointer = this.projected.get(source);
    if (!pointer) return;
    this.projected.delete(source);
    this.sourcePointers.delete(pointer);
    if (this.owns(pointer)) this.releasePointer(pointer);
  }
  // External consumers own the lent copy's lifetime independently of JS refs.
  lendPointer(pointer) {
    if (!pointer) return 0;
    this.require(pointer);
    this.process.store(pointer + 12, this.process.load(pointer + 12) + 1);
    return pointer;
  }
  transferPointer(pointer) {
    const source = this.sourcePointers.get(pointer);
    if (!source) return pointer;
    this.lendPointer(pointer);
    this.source.releasePointer(source);
    return pointer;
  }
  wrapPointer(address, size, { capacity = size, borrowed = true } = {}) {
    length(size);
    length(capacity);
    if (capacity < size) throw new RangeError('Native data-buffer capacity is below its size');
    const p = this.process,
      pointer = p.allocate(20);
    [address, size, capacity, 1, Number(borrowed)].forEach((value, i) =>
      p.store(pointer + i * 4, value),
    );
    this.pointers.add(pointer);
    return pointer;
  }
  adoptPointer(pointer) {
    if (this.process.allocations.get(pointer) !== 20)
      throw new Error('Native data-buffer adoption requires its actual 20-byte allocation');
    this.pointers.add(pointer);
    return pointer;
  }
  retainPointer(pointer) {
    if (!pointer) return 0;
    const source = this.sourcePointers.get(pointer);
    if (source) {
      this.source.retainPointer(source);
      return pointer;
    }
    this.require(pointer);
    this.process.store(pointer + 12, this.process.load(pointer + 12) + 1);
    return pointer;
  }
  clearPointer(pointer) {
    const [address, , , , borrowed] = this.words(pointer);
    if (!borrowed && address) this.releaseData(address);
    for (const offset of [0, 4, 8, 16]) this.process.store(pointer + offset, 0);
  }
  allocatePointer(pointer, size) {
    length(size);
    this.clearPointer(pointer);
    const rounded = Math.ceil(size / 8) * 8,
      address = this.allocateData(rounded);
    this.process.store(pointer, address);
    this.process.store(pointer + 4, rounded);
    this.process.store(pointer + 8, rounded);
    return address;
  }
  releasePointer(pointer) {
    if (!pointer) return;
    const source = this.sourcePointers.get(pointer);
    if (source) {
      this.source.releasePointer(source);
      return;
    }
    this.require(pointer);
    const p = this.process,
      references = (p.load(pointer + 12) - 1) | 0;
    p.store(pointer + 12, references);
    if (references > 0) return;
    const address = p.load(pointer);
    if (!p.load(pointer + 16) && address) this.releaseData(address);
    for (const offset of [0, 4, 8]) p.store(pointer + offset, 0);
    if (!p.free(pointer)) throw new Error('Native data buffer freed an unknown descriptor');
    this.pointers.delete(pointer);
  }
  handle(pointer, options = {}) {
    if (!pointer) return 0;
    const source = this.sourcePointers.get(pointer);
    if (!source) throw new Error('Image-data handle requires its canonical JS buffer');
    return this.source.handle(source, options);
  }
  pointer(handle) {
    return this.projectPointer(this.source.pointer(handle));
  }
  alias(handle, options) {
    return this.source.alias(handle, options);
  }
  release(handle) {
    this.source.release(handle);
  }
  async loadPointer(name) {
    const pointer = await this.source.loadPointer(name);
    return pointer ? this.projectPointer(pointer) : 0;
  }
  async load(name, owner = null) {
    return this.handle(await this.loadPointer(name), { owner, source: name });
  }
  releaseBitmapPointer(pointer) {
    if (pointer) return this.call(this.layout.imageRelease, [], pointer);
  }
  snapshot() {
    return {
      pointers: [...this.pointers].filter((pointer) => this.owns(pointer)),
      sources: [...this.sourcePointers],
      source: this.ownsSource ? this.source.snapshot() : null,
    };
  }
  restore(state) {
    if (state.source) this.source.restore(state.source);
    this.sourcePointers = new Map(state.sources);
    this.projected = new Map(state.sources.map(([pointer, source]) => [source, pointer]));
    this.pointers = new Set(state.pointers);
    for (const pointer of this.pointers) this.require(pointer);
  }
  close() {
    this.source.released.delete(this.releaseSource);
    for (const source of [...this.projected.keys()]) this.releaseProjection(source);
  }
}
