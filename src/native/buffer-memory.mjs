// SPDX-License-Identifier: MPL-2.0
// Raw data addresses occupy a JS-owned space distinct from VM offsets/handles.
const startAddress = 0x30000000;
const capacity = (size) => Math.ceil(Math.max(16, size) / 16) * 16;
const length = (size) => {
  if (!Number.isSafeInteger(size) || size < 0 || size > 0x10000000)
    throw new RangeError('Native buffer allocation exceeds its resource limit');
  return size;
};
const reference = (value) => {
  if (
    !value ||
    Object.getPrototypeOf(value) !== Object.prototype ||
    Object.keys(value).sort().join(',') !== 'kind,length,memoryID,taskID' ||
    value.kind !== 'vm' ||
    !Number.isSafeInteger(value.taskID) ||
    value.taskID < 0 ||
    !Number.isSafeInteger(value.memoryID) ||
    value.memoryID < 1
  )
    throw new Error('Invalid native VM buffer reference');
  length(value.length);
  return { ...value };
};
const sameReference = (a, b) =>
  a.taskID === b.taskID && a.memoryID === b.memoryID && a.length === b.length;
const regionLength = (value) => value.length;

export class NativeBufferMemory {
  constructor({ resolveReference } = {}) {
    this.resolveReference = resolveReference;
    this.next = startAddress;
    this.allocations = new Map();
    this.regions = new Map();
    this.freeRanges = [];
  }
  reserve(size, value) {
    length(size);
    const bytes = capacity(size),
      index = this.freeRanges.findIndex((range) => range.size >= bytes),
      range = this.freeRanges[index],
      address = range ? range.address : this.next,
      next = address + bytes;
    if (next > 0x80000000) throw new RangeError('Native buffer address space exhausted');
    if (range) {
      range.address = next;
      range.size -= bytes;
      if (!range.size) this.freeRanges.splice(index, 1);
    } else this.next = next;
    if (value instanceof Uint8Array) this.allocations.set(address, size);
    this.regions.set(address, value);
    return address;
  }
  allocate(size) {
    length(size);
    return this.reserve(size, new Uint8Array(size));
  }
  resolve(value) {
    if (value instanceof Uint8Array) return value;
    const bytes = this.resolveReference?.(value);
    if (!(bytes instanceof Uint8Array) || bytes.length !== value.length)
      throw new Error('Native VM buffer reference has no live matching region');
    return bytes;
  }
  borrow(source) {
    const value = reference(source);
    this.resolve(value);
    for (const [address, region] of this.regions) {
      if (region instanceof Uint8Array || region.taskID !== value.taskID) continue;
      if (!sameReference(region, value))
        throw new Error('Native VM buffer owner was replaced before release');
      return address;
    }
    return this.reserve(value.length, value);
  }
  releaseReferences(taskID) {
    for (const [address, value] of this.regions)
      if (!(value instanceof Uint8Array) && value.taskID === taskID) this.free(address, value);
  }
  contains(address, size = 1) {
    return [...this.regions].some(
      ([start, value]) => address >= start && address + size <= start + regionLength(value),
    );
  }
  view(address, size) {
    for (const [start, value] of this.regions)
      if (address >= start && address + size <= start + regionLength(value))
        return this.resolve(value).subarray(address - start, address - start + size);
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
  free(address, owner) {
    const value = this.regions.get(address);
    if (value === undefined) return false;
    const size = regionLength(value);
    if (!(value instanceof Uint8Array) && owner !== value)
      throw new Error('Borrowed VM buffer must be released by its interpreter owner');
    this.regions.delete(address);
    this.allocations.delete(address);
    this.freeRanges.push({ address, size: capacity(size) });
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
  validateState(state, validateReference = () => {}) {
    if (
      !state ||
      !Number.isSafeInteger(state.next) ||
      state.next < startAddress ||
      state.next > 0x80000000 ||
      state.next % 16 ||
      !Array.isArray(state.freeRanges) ||
      !Array.isArray(state.regions)
    )
      throw new Error('Invalid native buffer checkpoint');
    const ranges = [];
    for (const row of state.regions) {
      if (!Array.isArray(row) || row.length !== 2) throw new Error('Invalid native buffer region');
      const [address, value] = row;
      if (!(value instanceof Uint8Array)) validateReference(reference(value));
      const size = length(regionLength(value));
      ranges.push({ address, size: capacity(size) });
    }
    for (const range of state.freeRanges) {
      if (!range || !Number.isSafeInteger(range.size) || range.size < 16 || range.size % 16)
        throw new Error('Invalid native buffer free range');
      ranges.push(range);
    }
    ranges.sort((a, b) => a.address - b.address);
    let end = startAddress;
    for (const range of ranges) {
      if (
        !Number.isSafeInteger(range.address) ||
        range.address % 16 ||
        range.address < end ||
        range.address + range.size > state.next
      )
        throw new Error('Overlapping or invalid native buffer checkpoint range');
      end = range.address + range.size;
    }
  }
  snapshot() {
    return {
      next: this.next,
      freeRanges: this.freeRanges.map((range) => ({ ...range })),
      regions: [...this.regions].map(([at, value]) => [
        at,
        value instanceof Uint8Array ? value.slice() : { ...value },
      ]),
    };
  }
  restore(state) {
    this.validateState(state);
    const regions = new Map(
      state.regions.map(([at, value]) => [
        at,
        value instanceof Uint8Array ? value.slice() : reference(value),
      ]),
    );
    this.next = state.next;
    this.freeRanges = state.freeRanges.map((range) => ({ ...range }));
    this.regions = regions;
    this.allocations = new Map(
      [...regions]
        .filter(([, value]) => value instanceof Uint8Array)
        .map(([at, value]) => [at, value.length]),
    );
  }
}
