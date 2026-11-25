// SPDX-License-Identifier: MPL-2.0
// Raw data addresses occupy a JS-owned space distinct from VM offsets/handles.
const taskStartAddress = 0x20000000;
const startAddress = 0x30000000;
const endAddress = 0x80000000;
const capacity = (size) => Math.ceil(Math.max(16, size) / 16) * 16;
const length = (size) => {
  if (!Number.isSafeInteger(size) || size < 0 || size > 0xffffffff)
    throw new RangeError('Native buffer length is outside its DWORD ABI');
  return size;
};
const isTaskReference = (value) => value.kind === 'task';
const reference = (value) => {
  if (
    !value ||
    Object.getPrototypeOf(value) !== Object.prototype ||
    !Number.isSafeInteger(value.taskID) ||
    value.taskID < 0
  )
    throw new Error('Invalid native buffer reference');
  const keys = Object.keys(value).sort().join(',');
  if (isTaskReference(value)) {
    if (keys !== 'kind,length,taskID' || value.length === 0)
      throw new Error('Invalid native task buffer reference');
  } else if (
    keys !== 'kind,length,memoryID,taskID' ||
    value.kind !== 'vm' ||
    !Number.isSafeInteger(value.memoryID) ||
    value.memoryID < 1
  )
    throw new Error('Invalid native VM buffer reference');
  length(value.length);
  return { ...value };
};
const sameReference = (a, b) =>
  a.kind === b.kind && a.taskID === b.taskID && a.memoryID === b.memoryID && a.length === b.length;
const regionLength = (value) => value.length;

export class NativeBufferAllocationError extends Error {
  constructor(message, options) {
    super(message, options);
    this.name = 'NativeBufferAllocationError';
  }
}

export class NativeBufferMemory {
  constructor({ resolveReference } = {}) {
    this.resolveReference = resolveReference;
    this.next = startAddress;
    this.nextTaskAddress = taskStartAddress;
    this.allocations = new Map();
    this.regions = new Map();
    this.freeRanges = [];
  }
  #plan(size) {
    length(size);
    const bytes = capacity(size),
      index = this.freeRanges.findIndex((range) => range.size >= bytes),
      range = this.freeRanges[index],
      address = range ? range.address : this.next,
      next = address + bytes;
    if (next > endAddress)
      throw new NativeBufferAllocationError('Native buffer address space exhausted');
    return { size, bytes, index, range, address, next };
  }
  #publish({ size, bytes, index, range, address, next }, value) {
    if (range) {
      range.address = next;
      range.size -= bytes;
      if (!range.size) this.freeRanges.splice(index, 1);
    } else this.next = next;
    if (value instanceof Uint8Array) this.allocations.set(address, size);
    this.regions.set(address, value);
    return address;
  }
  reserve(size, value) {
    return this.#publish(this.#plan(size), value);
  }
  allocate(size) {
    const plan = this.#plan(size);
    let value;
    try {
      value = new Uint8Array(size);
    } catch (error) {
      if (!(error instanceof RangeError)) throw error;
      throw new NativeBufferAllocationError('Native buffer storage allocation failed', {
        cause: error,
      });
    }
    return this.#publish(plan, value);
  }
  #resolve(value, taskReader) {
    if (value instanceof Uint8Array) return value;
    const bytes = this.resolveReference?.(value, taskReader);
    if (!(bytes instanceof Uint8Array) || bytes.length !== value.length)
      throw new Error('Native buffer reference has no live matching region');
    return bytes;
  }
  borrow(source) {
    const value = reference(source);
    this.#resolve(value);
    for (const [address, region] of this.regions) {
      if (region.kind !== value.kind || region.taskID !== value.taskID) continue;
      if (!sameReference(region, value))
        throw new Error('Native buffer owner was replaced before release');
      return address;
    }
    if (!isTaskReference(value)) return this.reserve(value.length, value);
    // Object IDs can be reused after deletion. Task addresses have their
    // own monotonically allocated range, so an old pointer cannot name
    // the replacement task or an ordinary owned buffer.
    const address = this.nextTaskAddress,
      next = address + capacity(value.length);
    if (next > startAddress)
      throw new NativeBufferAllocationError('Native task address space exhausted');
    this.nextTaskAddress = next;
    this.regions.set(address, value);
    return address;
  }
  releaseReferences(taskID, kind = 'vm') {
    if (kind === 'task' && this.nextTaskAddress === taskStartAddress) return;
    for (const [address, value] of this.regions)
      if (value.kind === kind && value.taskID === taskID) this.free(address, value);
  }
  contains(address, size = 1) {
    return [...this.regions].some(
      ([start, value]) =>
        !isTaskReference(value) &&
        address >= start &&
        address + size <= start + regionLength(value),
    );
  }
  #view(address, size, taskReader) {
    for (const [start, value] of this.regions) {
      if (!(address >= start && address + size <= start + regionLength(value))) continue;
      if (isTaskReference(value) && taskReader === undefined)
        throw new RangeError('Native task address requires a reviewed read-only consumer');
      return this.#resolve(value, taskReader).subarray(address - start, address - start + size);
    }
    throw new RangeError('Unmapped native buffer data address');
  }
  view(address, size) {
    return this.#view(address, size);
  }
  read(address, size) {
    return this.view(address, size).slice();
  }
  readHostData(address, size, nativeID) {
    return this.#view(address, size, nativeID).slice();
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
      throw new Error(
        isTaskReference(value)
          ? 'Borrowed native task buffer must be released by its task owner'
          : 'Borrowed VM buffer must be released by its interpreter owner',
      );
    this.regions.delete(address);
    if (isTaskReference(value)) return true;
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
    const nextTaskAddress = state?.nextTaskAddress ?? taskStartAddress;
    if (
      !state ||
      !Number.isSafeInteger(state.next) ||
      state.next < startAddress ||
      state.next > endAddress ||
      state.next % 16 ||
      !Number.isSafeInteger(nextTaskAddress) ||
      nextTaskAddress < taskStartAddress ||
      nextTaskAddress > startAddress ||
      nextTaskAddress % 16 ||
      !Array.isArray(state.freeRanges) ||
      !Array.isArray(state.regions)
    )
      throw new Error('Invalid native buffer checkpoint');
    const ranges = [],
      taskRanges = [];
    for (const row of state.regions) {
      if (!Array.isArray(row) || row.length !== 2) throw new Error('Invalid native buffer region');
      const [address, value] = row;
      if (!(value instanceof Uint8Array)) validateReference(reference(value));
      const size = length(regionLength(value));
      (isTaskReference(value) ? taskRanges : ranges).push({ address, size: capacity(size) });
    }
    for (const range of state.freeRanges) {
      if (!range || !Number.isSafeInteger(range.size) || range.size < 16 || range.size % 16)
        throw new Error('Invalid native buffer free range');
      ranges.push(range);
    }
    const validateRanges = (entries, minimum, maximum) => {
      entries.sort((a, b) => a.address - b.address);
      let end = minimum;
      for (const range of entries) {
        if (
          !Number.isSafeInteger(range.address) ||
          range.address % 16 ||
          range.address < end ||
          range.address + range.size > maximum
        )
          throw new Error('Overlapping or invalid native buffer checkpoint range');
        end = range.address + range.size;
      }
    };
    validateRanges(ranges, startAddress, state.next);
    validateRanges(taskRanges, taskStartAddress, nextTaskAddress);
  }
  snapshot() {
    return {
      next: this.next,
      ...(this.nextTaskAddress === taskStartAddress
        ? {}
        : { nextTaskAddress: this.nextTaskAddress }),
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
    this.nextTaskAddress = state.nextTaskAddress ?? taskStartAddress;
    this.freeRanges = state.freeRanges.map((range) => ({ ...range }));
    this.regions = regions;
    this.allocations = new Map(
      [...regions]
        .filter(([, value]) => value instanceof Uint8Array)
        .map(([at, value]) => [at, value.length]),
    );
  }
}
