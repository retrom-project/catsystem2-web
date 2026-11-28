// SPDX-License-Identifier: MPL-2.0
// Raw kcBuffer ownership, distinct from a decoded bitmap and its wrapper.
import { nativeReply } from '../src/kcs/vm.mjs';
import { installNativeHG3Delta, nativeHG3DecodeContext } from './hg3-delta.mjs';

export const NATIVE_DATA_BUFFER_LAYOUTS = Object.freeze({
  'nekopara-vol3-engine-2.6.1.76': Object.freeze({
    load: 0x64b540,
    release: 0x64b8d0,
    heapAllocate: 0x6a49d0,
    heapRelease: 0x6a4b00,
    allocate: 0x628cf0,
    clear: 0x629da0,
    image: 0x675690,
    imageRelease: 0x690050,
    imageTo32: 0x68b4f0,
    frameInfo: 0x68f780,
    containerInfo: 0x68f810,
  }),
  'sdk-4.01-engine-2.6.1.74': Object.freeze({
    load: 0x518150,
    release: 0x518490,
    heapAllocate: 0x575ce0,
    heapRelease: 0x575e10,
    allocate: 0x500320,
    image: 0x54c870,
    imageRelease: 0x5668f0,
    imageTo32: 0x562050,
    frameInfo: 0x566150,
    containerInfo: 0x5661e0,
  }),
});
export const NATIVE_DATA_BUFFER_IDS = Object.freeze([0x16c, 0x16d, 0x16e, 0x170, 0x177, 0x1af]);
export const nativeDataBufferCodec = Object.freeze({
  // Guest bytes and reference counts belong to the one engine-process image.
  // The handle contains identity only; restoring it never allocates a copy.
  snapshot: (value) => ({ ...value }),
  restore: (value) => ({ ...value }),
});

function length(value) {
  if (!Number.isSafeInteger(value) || value < 0 || value > 0x7ffffffb)
    throw new RangeError('Native data-buffer length exceeds its signed allocation ABI');
  return value;
}

export class NativeDataBuffers {
  constructor(engine, { handles, read, diagnostic } = {}) {
    if (!NATIVE_DATA_BUFFER_LAYOUTS[engine.profile])
      throw new Error(`Native data buffers are unavailable in ${engine.profile}`);
    Object.assign(this, { engine, process: engine.process, handles, read, diagnostic });
    this.layout = NATIVE_DATA_BUFFER_LAYOUTS[engine.profile];
    this.pointers = new Set();
    if (engine.module) this.detachHG3Delta = installNativeHG3Delta(engine);
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
    if (handles && this.handles && handles !== this.handles)
      throw new Error('Native data buffers cannot change their owning handle space');
    if (handles) this.handles = handles;
    if (read) this.read = read;
    if (diagnostic) this.diagnostic = diagnostic;
    if (handles && !handles.codecs.has('image-data'))
      handles.registerType('image-data', nativeDataBufferCodec);
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
    if (!(bytes instanceof Uint8Array)) throw new TypeError('Native data buffer requires bytes');
    const p = this.process,
      address = this.allocateData(bytes.length);
    try {
      p.write(address, bytes);
      return this.wrapPointer(address, bytes.length, { borrowed: false });
    } catch (error) {
      this.releaseData(address);
      throw error;
    }
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
  lendPointer(pointer) {
    return this.retainPointer(pointer);
  }
  transferPointer(pointer) {
    return pointer;
  }
  retainPointer(pointer) {
    if (!pointer) return 0;
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
  handle(pointer, { owner = null, source = null } = {}) {
    if (!pointer) return 0;
    this.require(pointer);
    if (!this.handles) throw new Error('Native data-buffer handle service is unavailable');
    return this.handles.add('image-data', { pointer, owner, source });
  }
  pointer(handle) {
    if (!this.handles) throw new Error('Native data-buffer handle service is unavailable');
    return this.require(this.handles.get(handle, 'image-data').pointer);
  }
  alias(handle, { owner = null } = {}) {
    const record = this.handles.get(handle, 'image-data');
    this.retainPointer(record.pointer);
    return this.handle(record.pointer, { owner, source: record.source });
  }
  release(handle) {
    if (!handle) return;
    const pointer = this.pointer(handle);
    this.releasePointer(pointer);
    this.handles.release(handle, 'image-data');
  }
  async loadPointer(name) {
    if (typeof this.read !== 'function')
      throw new Error('Native data-buffer mounted-resource service is unavailable');
    const first = await this.read(name, 'image');
    if (!first?.length) {
      this.diagnostic?.({ native: 0x16d, resource: name, error: 'Image data was not found' });
      return 0;
    }
    const address = this.allocateData(first.length);
    try {
      const second = await this.read(name, 'image');
      if (!second || second.length !== first.length) {
        this.diagnostic?.({ native: 0x16d, resource: name, error: 'Image-data read was short' });
        this.releaseData(address);
        return 0;
      }
      this.process.write(address, second);
      return this.wrapPointer(address, second.length, { borrowed: false });
    } catch (error) {
      this.releaseData(address);
      throw error;
    }
  }
  async load(name, owner = null) {
    return this.handle(await this.loadPointer(name), { owner, source: name });
  }
  async metadataPointer(
    pointer,
    selector = 0,
    container = false,
    initial = null,
    { nullOutput = false } = {},
  ) {
    this.require(pointer);
    const p = this.process,
      output = nullOutput ? 0 : p.allocate(36, true);
    try {
      if (initial) {
        if (initial.length !== 36) throw new RangeError('Native image metadata requires 36 bytes');
        p.write(output, initial);
      }
      const success = await this.call(
        container ? this.layout.containerInfo : this.layout.frameInfo,
        container ? [pointer, output] : [pointer, output, selector >>> 0],
      );
      return { success: Boolean(success), bytes: output ? p.read(output, 36) : null };
    } finally {
      if (output) p.free(output);
    }
  }
  async decodePointer(pointer, selector = 0) {
    this.require(pointer);
    // Returns an original refcounted bitmap wrapper, not another kcBuffer.
    // Its consumer must release it through releaseBitmapPointer().
    return this.call(
      this.layout.image,
      [pointer, selector >>> 0],
      undefined,
      nativeHG3DecodeContext(),
    );
  }
  async decodeBitmapPointer(pointer, selector = 0) {
    const wrapper = await this.decodePointer(pointer, selector);
    if (!wrapper) return 0;
    try {
      const bitmap = this.process.load(wrapper);
      if (this.process.load(bitmap + 24) === 3) await this.call(this.layout.imageTo32, [], bitmap);
      return wrapper;
    } catch (error) {
      await this.releaseBitmapPointer(wrapper);
      throw error;
    }
  }
  async fileMetadata(name, initial = null, options = {}) {
    if (typeof this.read !== 'function')
      throw new Error('Native data-buffer mounted-resource service is unavailable');
    const source = await this.read(name, 'image');
    if (!source) return null;
    const pointer = this.wrapPointer(0, 0, { borrowed: false });
    try {
      const size = Math.min(source.length, 1024),
        address = this.allocatePointer(pointer, size);
      this.process.write(address, source.subarray(0, size));
      return await this.metadataPointer(pointer, 0, false, initial, options);
    } finally {
      this.releasePointer(pointer);
    }
  }
  releaseBitmapPointer(pointer) {
    if (pointer) return this.call(this.layout.imageRelease, [], pointer);
  }
  snapshot() {
    return { pointers: [...this.pointers].filter((pointer) => this.owns(pointer)) };
  }
  restore(state) {
    this.pointers = new Set(state.pointers);
    for (const pointer of this.pointers) this.require(pointer);
  }
  close() {
    this.detachHG3Delta?.();
  }
}

export async function nativeDataBuffer(id, args, machine, services = {}) {
  if (!NATIVE_DATA_BUFFER_IDS.includes(id)) return undefined;
  const count = new Map([
    [0x16c, 2],
    [0x16d, 1],
    [0x16e, 1],
    [0x170, 3],
    [0x177, 2],
    [0x1af, 2],
  ]).get(id);
  if (args.length !== count)
    throw new Error(`Native data buffer 0x${id.toString(16)} expects ${count} arguments`);
  if (!services.dataBuffers) return undefined;
  const buffers = await services.dataBuffers();
  if (id === 0x16d || id === 0x177) {
    if (typeof services.format !== 'function') return undefined;
    const name = services.format(args[0], machine);
    if (id === 0x16d) return nativeReply(1, await buffers.load(name, services.owner));
    // The file-header wrapper translates its output before opening the file.
    let output;
    try {
      output = machine.bytes(args[1], 36);
    } catch {
      output = null;
    }
    // Unlike 170/1AF, 177 does not guard a NULL translated destination. Run
    // that same helper with NULL: formats which write it fail explicitly.
    const result = await buffers.fileMetadata(name, output, { nullOutput: !output });
    if (result && output) output.set(result.bytes);
    return nativeReply(1, Number(Boolean(result?.success)));
  }
  if (id === 0x16c) {
    if (!args[0]) return nativeReply(1, 0);
    if (typeof services.importNativeBitmap !== 'function') return undefined;
    const pointer = await buffers.decodeBitmapPointer(buffers.pointer(args[0]), args[1]);
    if (!pointer) return nativeReply(1, 0);
    try {
      return nativeReply(
        1,
        await services.importNativeBitmap(pointer, services.owner, { rowOrder: 'bottom-up' }),
      );
    } catch (error) {
      await buffers.releaseBitmapPointer(pointer);
      throw error;
    }
  }
  if (id === 0x170 || id === 0x1af) {
    const address = args[id === 0x170 ? 2 : 1];
    // 8772A0 returns NULL for unmapped VM pointers, but VM address zero itself
    // is a valid mapped data address. Failed mapping leaves caller bytes alone.
    let output;
    try {
      output = machine.bytes(address, 36);
    } catch {
      return nativeReply(1, 0);
    }
    if (!args[0]) return nativeReply(1, 0);
    const result = await buffers.metadataPointer(buffers.pointer(args[0]), args[1], id === 0x1af);
    output.set(result.bytes);
    return nativeReply(1, Number(result.success));
  }
  buffers.release(args[0]);
  return nativeReply(2);
}
