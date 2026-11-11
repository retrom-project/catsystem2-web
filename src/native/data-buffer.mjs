// SPDX-License-Identifier: MPL-2.0
// Raw kcBuffer ownership, distinct from a decoded bitmap and its wrapper.
import { Binary } from '../binary.mjs';
import { nativeReply } from '../kcs/vm.mjs';
import { NativeBufferMemory } from './buffer-memory.mjs';
import { nativeImageMetadata } from './image-buffer-info.mjs';
import { openImage } from '../formats/hg3.mjs';

export const NATIVE_DATA_BUFFER_IDS = Object.freeze([0x16c, 0x16d, 0x16e, 0x170, 0x177, 0x1af]);
export const nativeDataBufferCodec = Object.freeze({
  // Canonical bytes and sharing are owned once by the runtime buffer store.
  snapshot: (value) => ({ ...value }),
  restore: (value) => ({ ...value }),
});

function length(value) {
  if (!Number.isSafeInteger(value) || value < 0 || value > 0x7ffffffb)
    throw new RangeError('Native data-buffer length exceeds its signed allocation ABI');
  return value;
}

export class NativeDataBuffers {
  constructor({ handles, read, diagnostic, memory = new NativeBufferMemory() } = {}) {
    this.process = memory;
    this.pointers = new Set();
    this.released = new Set();
    this.attachServices({ handles, read, diagnostic });
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
    const allocation = this.process.allocate(length(size) + 4);
    this.process.store(allocation, 1);
    return allocation + 4;
  }
  releaseData(address) {
    if (!address) return;
    const p = this.process,
      allocation = address - 4,
      references = p.load(allocation) | 0;
    if (references <= 1) {
      if (!p.free(allocation)) throw new Error('Native data buffer freed unknown storage');
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
    for (const record of this.handles?.records.values() ?? [])
      if (record.type === 'image-data' && record.value.pointer === pointer)
        record.value.released = true;
    for (const listener of this.released) listener(pointer);
  }
  handle(pointer, { owner = null, source = null } = {}) {
    if (!pointer) return 0;
    this.require(pointer);
    if (!this.handles) throw new Error('Native data-buffer handle service is unavailable');
    return this.handles.add('image-data', { pointer, owner, source, released: false });
  }
  pointer(handle) {
    if (!this.handles) throw new Error('Native data-buffer handle service is unavailable');
    const record = this.handles.get(handle, 'image-data');
    if (record.released) throw new Error('Invalid or released native data-buffer handle');
    return this.require(record.pointer);
  }
  alias(handle, { owner = null } = {}) {
    const record = this.handles.get(handle, 'image-data');
    const pointer = this.pointer(handle);
    this.retainPointer(pointer);
    return this.handle(pointer, { owner, source: record.source });
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
    const bytes = initial ? Uint8Array.from(initial) : new Uint8Array(36),
      result = nativeImageMetadata(this.data(pointer), selector, container, bytes);
    if (nullOutput && result.written)
      throw new Error('Native image metadata dereferences a NULL destination');
    return { success: result.success, bytes: nullOutput ? null : bytes };
  }
  async decode(pointer, selector = 0) {
    return (await this.decodeImage(pointer, selector))?.frame ?? null;
  }
  async decodeImage(pointer, selector = 0) {
    this.require(pointer);
    const bytes = this.data(pointer);
    if (!bytes.length) return null;
    const format = new Binary(bytes, 'Native image data'),
      jpeg = bytes[0] === 255 && bytes[1] === 216;
    if (!format.magic('HG-2') && !format.magic('HG-3') && !jpeg) return null;
    const image = await openImage(bytes),
      frame = image.frame(jpeg ? 0 : selector >>> 0);
    if (!frame) return null;
    return { image, frame: await image.decode(frame) };
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
  snapshot() {
    return { pointers: [...this.pointers], memory: this.process.snapshot() };
  }
  restore(state) {
    this.process.restore(state.memory);
    this.pointers = new Set(state.pointers);
    for (const pointer of this.pointers) this.require(pointer);
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
  if (!services.imageDataBuffers) return undefined;
  const buffers = await services.imageDataBuffers();
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
    if (typeof services.importImageFrame !== 'function') return undefined;
    const frame = await buffers.decode(buffers.pointer(args[0]), args[1]);
    return nativeReply(1, frame ? await services.importImageFrame(frame, services.owner) : 0);
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
