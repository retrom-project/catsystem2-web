// SPDX-License-Identifier: MPL-2.0
import { NativeDataBuffers } from '../../oracle/data-buffer.mjs';
import { NativeHandles } from '../../src/native/handles.mjs';
import { NATIVE_ENGINE_IMAGES } from '../../src/native/engine-process.mjs';

export class DataBufferMemory {
  constructor() {
    this.start = 0x31000000;
    this.next = this.start;
    this.bytes = new Uint8Array(65536);
    this.allocations = new Map();
    this.frees = [];
    this.heapBlocks = new Set();
  }
  allocate(size, zero = false) {
    const at = this.next;
    this.next += Math.ceil(Math.max(16, size) / 16) * 16;
    if (this.next - this.start > this.bytes.length) throw new Error('Fixture memory exhausted');
    this.allocations.set(at, size);
    if (zero) this.zero(at, size);
    return at;
  }
  view(at, size) {
    const offset = at - this.start;
    if (offset < 0 || offset + size > this.bytes.length)
      throw new RangeError('Unmapped authored data-buffer memory');
    return this.bytes.subarray(offset, offset + size);
  }
  load(at) {
    if (Object.values(NATIVE_ENGINE_IMAGES).some((image) => image.heap === at)) return 1;
    const bytes = this.view(at, 4);
    return new DataView(bytes.buffer, bytes.byteOffset, 4).getUint32(0, true);
  }
  store(at, value) {
    const bytes = this.view(at, 4);
    new DataView(bytes.buffer, bytes.byteOffset, 4).setUint32(0, value, true);
  }
  zero(at, size) {
    this.view(at, size).fill(0);
  }
  read(at, size) {
    return this.view(at, size).slice();
  }
  write(at, bytes) {
    this.view(at, bytes.length).set(bytes);
  }
  free(at) {
    this.frees.push(at);
    return this.allocations.delete(at);
  }
  snapshot() {
    return {
      bytes: this.bytes.slice(),
      next: this.next,
      allocations: [...this.allocations],
      heapBlocks: [...this.heapBlocks],
    };
  }
  restore(state) {
    this.bytes.set(state.bytes);
    this.next = state.next;
    this.allocations = new Map(state.allocations);
    this.heapBlocks.clear();
    for (const pointer of state.heapBlocks) this.heapBlocks.add(pointer);
  }
}

export function dataBufferFixture(profile, options = {}) {
  const process = new DataBufferMemory(),
    handles = new NativeHandles(),
    engine = {
      profile,
      image: NATIVE_ENGINE_IMAGES[profile],
      process,
      kernel: {
        heapAllocate(handle, flags, size) {
          if (handle !== 1 || flags !== 0) throw new Error('Unexpected authored heap allocation');
          const pointer = process.allocate(size);
          process.heapBlocks.add(pointer);
          return pointer;
        },
        heapRelease(handle, pointer) {
          if (handle !== 1 || !process.heapBlocks.delete(pointer)) return 0;
          return Number(process.free(pointer));
        },
      },
      features: new Map(),
      registerWindows() {},
      registerFeature(name, feature) {
        this.features.set(name, feature);
      },
    },
    buffers = new NativeDataBuffers(engine, { handles, ...options });
  return { process, engine, handles, buffers };
}
export const dataBufferPayload = (size) =>
  Uint8Array.from({ length: size }, (_, i) => (i * 97 + size * 13) & 255);

export function dataBufferCases() {
  const cases = [];
  for (const size of [1, 2, 3, 4, 7, 8, 9, 15, 16, 17, 31, 32, 33, 63, 255, 256, 260, 1024])
    for (const name of ['authored', '日本語', 'path\\image.hg3'])
      cases.push({ operation: 'load', name, size });
  for (const size of [0, -1, 1, 17, 1024])
    cases.push({ operation: 'load', name: 'empty-or-short', size, short: true });
  for (const references of [-2147483648, -1, 0, 1, 2, 3, 2147483647])
    for (const borrowed of [0, 1, 0xffffffff])
      for (const innerReferences of [-2, 0, 1, 2, 3])
        for (const nullData of [false, true])
          cases.push({ operation: 'release', references, borrowed, innerReferences, nullData });
  for (const size of [0, 1, 2, 3, 4, 7, 8, 9, 15, 16, 17, 33, 255, 256, 260, 1023, 1024])
    for (const borrowed of [0, 1]) cases.push({ operation: 'allocate', size, borrowed });
  return cases;
}

export function dataBufferState(p, pointer, originalData) {
  const words = Array.from({ length: 5 }, (_, i) => p.load(pointer + i * 4)),
    data = words[0],
    allocated = p.allocations.has(pointer),
    oldReleased = p.frees.includes(originalData - 4),
    newAllocated = Boolean(data && p.allocations.has(data - 4));
  return {
    words: [Number(Boolean(data)), ...words.slice(1)],
    allocated,
    oldReleased,
    newAllocated,
    oldReferences: originalData ? p.load(originalData - 4) : null,
    bytes: allocated && data ? [...p.read(data, words[1])] : [],
  };
}

export async function runDataBufferCase(profile, testCase) {
  let reads = 0;
  const { process: p, buffers } = dataBufferFixture(profile, {
    read: async () => {
      reads++;
      return testCase.size < 0
        ? null
        : dataBufferPayload(
            Math.max(0, testCase.size - Number(Boolean(testCase.short && reads > 1))),
          );
    },
  });
  if (testCase.operation === 'load') {
    const pointer = await buffers.loadPointer(testCase.name);
    if (!pointer) return { reads, result: 0 };
    const data = p.load(pointer);
    return { reads, result: 1, state: dataBufferState(p, pointer, data) };
  }
  const pointer = buffers.createPointer(dataBufferPayload(17)),
    data = p.load(pointer);
  p.store(pointer + 16, testCase.borrowed);
  if (testCase.operation === 'release') {
    p.store(pointer + 12, testCase.references);
    p.store(data - 4, testCase.innerReferences);
    if (testCase.nullData) p.store(pointer, 0);
    buffers.releasePointer(pointer);
  } else buffers.allocatePointer(pointer, testCase.size);
  const state = dataBufferState(p, pointer, data);
  if (testCase.operation === 'allocate') delete state.bytes;
  return state;
}
