// SPDX-License-Identifier: MPL-2.0
// Raw data addresses occupy a JS-owned space distinct from VM offsets/handles.
export class NativeBufferMemory {
  constructor() {
    this.next = 0x30000000;
    this.allocations = new Map();
    this.regions = new Map();
    this.freeRanges = [];
  }
  allocate(size) {
    if (!Number.isSafeInteger(size) || size < 0 || size > 0x10000000)
      throw new RangeError('Native buffer allocation exceeds its resource limit');
    const capacity = Math.ceil(Math.max(16, size) / 16) * 16,
      index = this.freeRanges.findIndex((range) => range.size >= capacity),
      range = this.freeRanges[index],
      address = range ? range.address : this.next,
      next = address + capacity;
    if (next > 0x80000000) throw new RangeError('Native buffer address space exhausted');
    const bytes = new Uint8Array(size);
    if (range) {
      range.address = next;
      range.size -= capacity;
      if (!range.size) this.freeRanges.splice(index, 1);
    } else this.next = next;
    this.allocations.set(address, size);
    this.regions.set(address, bytes);
    return address;
  }
  view(address, size) {
    for (const [start, bytes] of this.regions)
      if (address >= start && address + size <= start + bytes.length)
        return bytes.subarray(address - start, address - start + size);
    throw new RangeError('Unmapped native buffer data address');
  }
  read(address, size) {
    return this.view(address, size).slice();
  }
  write(address, bytes) {
    this.view(address, bytes.length).set(bytes);
  }
  load(address) {
    const bytes = this.view(address, 4);
    return new DataView(bytes.buffer, bytes.byteOffset, 4).getUint32(0, true);
  }
  store(address, value) {
    const bytes = this.view(address, 4);
    new DataView(bytes.buffer, bytes.byteOffset, 4).setUint32(0, value, true);
  }
  free(address) {
    const size = this.allocations.get(address);
    if (size === undefined) return false;
    this.regions.delete(address);
    this.allocations.delete(address);
    this.freeRanges.push({ address, size: Math.ceil(Math.max(16, size) / 16) * 16 });
    this.freeRanges.sort((a, b) => a.address - b.address);
    const merged = [];
    for (const range of this.freeRanges) {
      const previous = merged.at(-1);
      if (previous && previous.address + previous.size === range.address)
        previous.size += range.size;
      else merged.push({ ...range });
    }
    this.freeRanges = merged;
    return true;
  }
  snapshot() {
    return {
      next: this.next,
      freeRanges: this.freeRanges.map((range) => ({ ...range })),
      regions: [...this.regions].map(([at, bytes]) => [at, bytes.slice()]),
    };
  }
  restore(state) {
    const regions = new Map(state.regions.map(([at, bytes]) => [at, Uint8Array.from(bytes)]));
    this.next = state.next;
    this.freeRanges = state.freeRanges.map((range) => ({ ...range }));
    this.regions = regions;
    this.allocations = new Map([...regions].map(([at, bytes]) => [at, bytes.length]));
  }
}
