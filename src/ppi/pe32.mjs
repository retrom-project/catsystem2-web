// SPDX-License-Identifier: MPL-2.0
import { Binary } from '../binary.mjs';
import { FLOATING_POINT_REGISTERS } from './floating-point.mjs';

export function parsePE32(bytes, { allowExecutable = false } = {}) {
  const b = new Binary(bytes, 'PPI PE32');
  if (b.u16(0) !== 0x5a4d) throw new Error('PPI is not an MZ executable');
  const pe = b.u32(60),
    optional = pe + 24;
  if (b.u32(pe) !== 0x4550 || b.u16(pe + 4) !== 0x14c || b.u16(optional) !== 0x10b)
    throw new Error('PPI requires an i386 PE32 DLL');
  if (!allowExecutable && !(b.u16(pe + 22) & 0x2000)) throw new Error('PPI PE image is not a DLL');
  const size = b.u32(optional + 56),
    headers = b.u32(optional + 60);
  if (size < headers || size > 256 * 1024 * 1024) throw new Error('PPI invalid image size');
  const image = new Uint8Array(size);
  image.set(b.range(0, headers));
  const sections = [];
  for (let i = 0; i < b.u16(pe + 6); i++) {
    const at = optional + b.u16(pe + 20) + i * 40;
    const address = b.u32(at + 12),
      rawSize = b.u32(at + 16),
      rawOffset = b.u32(at + 20);
    if (address + Math.max(rawSize, b.u32(at + 8)) > size)
      throw new Error('PPI section exceeds image');
    image.set(b.range(rawOffset, rawSize), address);
    sections.push({
      name: b.str(at, 8),
      address,
      size: Math.max(rawSize, b.u32(at + 8)),
      flags: b.u32(at + 36),
    });
  }
  const v = new Binary(image, 'PPI mapped image');
  const directory = (index) => ({
    address: b.u32(optional + 96 + index * 8),
    size: b.u32(optional + 100 + index * 8),
  });
  const exports = new Map(),
    names = new Map(),
    imports = [],
    relocations = [];
  const exp = directory(0);
  if (exp.address) {
    const at = exp.address,
      ordinal = v.u32(at + 16),
      count = v.u32(at + 20);
    if (count > 65536) throw new Error('PPI export table exceeds limit');
    for (let i = 0; i < count; i++) {
      const target = v.u32(v.u32(at + 28) + i * 4);
      if (target >= at && target < at + exp.size)
        exports.set(ordinal + i, { forward: v.str(target) });
      else if (target) exports.set(ordinal + i, { address: target });
    }
    for (let i = 0; i < v.u32(at + 24); i++)
      names.set(v.str(v.u32(v.u32(at + 32) + i * 4)), ordinal + v.u16(v.u32(at + 36) + i * 2));
  }
  const imp = directory(1);
  if (imp.address)
    for (let at = imp.address; v.u32(at) || v.u32(at + 12) || v.u32(at + 16); at += 20) {
      const dll = v.str(v.u32(at + 12)),
        lookup = v.u32(at) || v.u32(at + 16),
        iat = v.u32(at + 16);
      for (let i = 0; ; i++) {
        const entry = v.u32(lookup + i * 4);
        if (!entry) break;
        imports.push({
          dll,
          ...(entry & 0x80000000 ? { ordinal: entry & 0xffff } : { name: v.str(entry + 2) }),
          address: iat + i * 4,
        });
      }
    }
  const rel = directory(5);
  for (let at = rel.address; rel.address && at < rel.address + rel.size; ) {
    const page = v.u32(at),
      blockSize = v.u32(at + 4);
    if (blockSize < 8 || blockSize % 2 || at + blockSize > rel.address + rel.size)
      throw new Error('PPI invalid relocation block');
    for (let off = 8; off < blockSize; off += 2) {
      const word = v.u16(at + off),
        type = word >>> 12;
      if (type && type !== 3) throw new Error(`Unsupported PPI PE32 relocation ${type}`);
      if (type) relocations.push(page + (word & 0xfff));
    }
    at += blockSize;
  }
  return {
    image,
    base: b.u32(optional + 28),
    entry: b.u32(optional + 16),
    sections,
    exports,
    names,
    imports,
    relocations,
    tls: directory(9),
  };
}

export class PE32Process {
  constructor(
    unicorn,
    {
      budget = 10000000,
      singleStep = false,
      trace = false,
      heapSize = 0x4000000,
      executableHeap = true,
    } = {},
  ) {
    this.uc = unicorn;
    this.cpu = new unicorn.Unicorn(unicorn.ARCH_X86, unicorn.MODE_32);
    this.ramViews = new Map();
    // Protection changes can split RAM and change its host address. Cached
    // guest spans are valid only until one of these mapping APIs succeeds.
    for (const name of ['mem_map', 'mem_unmap', 'mem_protect']) {
      const operation = this.cpu[name];
      this.cpu[name] = (...args) => {
        const result = operation.apply(this.cpu, args);
        this.ramViews.clear();
        this.executableRanges = null;
        return result;
      };
    }
    this.budget = budget;
    this.singleStep = singleStep;
    this.recent = [];
    if (trace)
      this.cpu.hook_add(unicorn.HOOK_CODE, (_cpu, address) => {
        this.recent.push(Number(address));
        if (this.recent.length > 64) this.recent.shift();
      });
    this.modules = [];
    this.traps = new Map();
    this.executionBoundaries = new Map();
    this.regions = [];
    this.hostMappings = new Map();
    this.nextTrap = 0x01000000;
    this.heap = 0x20000000;
    if (
      !Number.isInteger(heapSize) ||
      heapSize < 0x10000 ||
      heapSize > 0x40000000 ||
      heapSize % 4096
    )
      throw new Error('PE32 heap size requires whole pages within the guest address space');
    this.heapLimit = this.heap + heapSize;
    this.allocations = new Map();
    this.freeBlocks = [];
    this.writeObservers = new Set();
    this.borrowedRanges = [];
    this.map(0, 0x10000);
    this.zero(0, 0x10000);
    this.map(this.nextTrap, 0x100000);
    this.map(
      this.heap,
      heapSize,
      'heap',
      executableHeap ? unicorn.PROT_ALL : unicorn.PROT_READ | unicorn.PROT_WRITE,
    );
    this.map(0x7fe00000, 0x100000, 'stack', unicorn.PROT_READ | unicorn.PROT_WRITE);
    this.zero(0x7fe00000, 0x100000);
    this.stackTop = 0x7feff000;
    this.stackBottom = 0x7fe00000;
    this.sentinel = 0x1000;
    this.store(0, 0xffffffff);
    this.store(0x18, 0);
    this.cpu.reg_write_i32(unicorn.X86_REG_CR4, 0x600);
    this.cpu.reg_write_i32(unicorn.X86_REG_FPCW, 0x37f);
    this.cpu.reg_write_i32(unicorn.X86_REG_FPTAG, 0xffff);
    this.cpu.reg_write_i32(unicorn.X86_REG_MXCSR, 0x1f80);
    this.cpu.hook_add(
      unicorn.HOOK_CODE,
      (_cpu, address) => {
        const trap = this.traps.get(Number(address));
        if (!trap) return;
        try {
          trap.callback(this);
        } catch (error) {
          this.pendingError = error;
          this.cpu.emu_stop();
        }
      },
      null,
      this.nextTrap,
      this.nextTrap + 0xfffff,
    );
  }
  map(address, size, kind = 'mapped', permissions = this.uc.PROT_ALL) {
    if (
      !Number.isInteger(address) ||
      address < 0 ||
      address % 4096 ||
      !Number.isSafeInteger(size) ||
      size <= 0
    )
      throw new Error('PE32 mapping requires a valid page-aligned guest range');
    size = Math.ceil(size / 4096) * 4096;
    if (address + size > 0x100000000)
      throw new Error('PE32 mapping exceeds the guest address space');
    if (this.regions.some((r) => address < r.address + r.size && address + size > r.address))
      throw new Error('Overlapping PE32 mapping');
    // The process owns one contiguous physical span for each guest mapping.
    // Unicorn's map_ptr splits permissions without copying/replacing that RAM,
    // so a VM range crossing protected pages keeps its physical identity.
    const allocation = this.uc._malloc(size + 4095);
    if (!allocation) throw new Error('PE32 RAM mapping allocation failed');
    const pointer = Math.ceil(allocation / 4096) * 4096;
    try {
      this.uc.HEAPU8.fill(0, pointer, pointer + size);
      const result = this.uc.ccall(
        'uc_mem_map_ptr',
        'number',
        ['pointer', 'number', 'number', 'number', 'pointer'],
        [
          this.uc.getValue(this.cpu.handle_ptr, '*'),
          BigInt(address),
          BigInt(size),
          permissions,
          pointer,
        ],
      );
      if (result !== this.uc.ERR_OK)
        throw new Error(`PE32 RAM mapping failed: ${this.uc.strerror(result)}`);
      this.hostMappings.set(address, allocation);
      this.ramViews.clear();
      this.executableRanges = null;
      this.regions.push({ address, size, kind, permissions });
    } catch (error) {
      this.uc._free(allocation);
      throw error;
    }
  }
  unmap(address) {
    const index = this.regions.findIndex((region) => region.address === address);
    if (index < 0) throw new Error('PE32 mapping is absent');
    this.cpu.mem_unmap(address, this.regions[index].size);
    const allocation = this.hostMappings.get(address);
    if (allocation) this.uc._free(allocation);
    this.hostMappings.delete(address);
    this.regions.splice(index, 1);
  }
  read(address, size) {
    const pointer = this.transfer(size),
      result = this.uc.ccall(
        'uc_mem_read',
        'number',
        ['pointer', 'number', 'pointer', 'number'],
        [this.uc.getValue(this.cpu.handle_ptr, '*'), BigInt(address >>> 0), pointer, BigInt(size)],
      );
    if (result !== this.uc.ERR_OK)
      throw new Error(`PE32 memory read failed: ${this.uc.strerror(result)}`);
    return this.uc.HEAPU8.slice(pointer, pointer + size);
  }
  view(address, size) {
    if (
      !Number.isInteger(address) ||
      address < 0 ||
      address > 0xffffffff ||
      !Number.isInteger(size) ||
      size < 0 ||
      address + size > 0x100000000
    )
      throw new RangeError('PE32 RAM view requires a valid guest range');
    if (!size) return new Uint8Array();
    const key = `${address}:${size}`;
    let cached = this.ramViews.get(key);
    if (cached) {
      if (cached.view.buffer !== this.uc.HEAPU8.buffer)
        cached.view = new Uint8Array(this.uc.HEAPU8.buffer, cached.pointer, size);
      return cached.view;
    }
    const output = this.transfer(4),
      result = this.uc.ccall(
        'uc_mem_host_ptr',
        'number',
        ['pointer', 'number', 'number', 'pointer'],
        [this.uc.getValue(this.cpu.handle_ptr, '*'), BigInt(address), BigInt(size), output],
      );
    if (result !== this.uc.ERR_OK)
      throw new Error(`PE32 RAM view failed: ${this.uc.strerror(result)}`);
    const pointer = this.uc.getValue(output, '*') >>> 0;
    // A borrowed view is valid until the WASM memory grows or this mapping is
    // changed. VM getters reacquire it on every access, never retain its buffer.
    if (!pointer || pointer + size > this.uc.HEAPU8.length)
      throw new Error('PE32 RAM view returned an invalid host span');
    cached = { pointer, view: new Uint8Array(this.uc.HEAPU8.buffer, pointer, size) };
    this.ramViews.set(key, cached);
    let begin = Math.floor(address / 4096) * 4096,
      end = Math.ceil((address + size) / 4096) * 4096;
    this.borrowedRanges = this.borrowedRanges.filter((range) => {
      if (range.end < begin || range.begin > end) return true;
      begin = Math.min(begin, range.begin);
      end = Math.max(end, range.end);
      return false;
    });
    this.borrowedRanges.push({ begin, end });
    return cached.view;
  }
  addressOf(bytes) {
    if (!(bytes instanceof Uint8Array) || bytes.buffer !== this.uc.HEAPU8.buffer) return null;
    for (const region of this.regions) {
      const allocation = this.hostMappings.get(region.address),
        pointer = Math.ceil(allocation / 4096) * 4096,
        offset = bytes.byteOffset - pointer;
      if (offset < 0 || offset + bytes.byteLength > region.size) continue;
      const address = region.address + offset;
      if (bytes.length && this.view(address, bytes.length).byteOffset !== bytes.byteOffset)
        throw new Error('Borrowed RAM view no longer matches its guest mapping');
      return address;
    }
    throw new Error('WASM host bytes do not belong to this guest process');
  }
  flushBorrowedCode() {
    // Direct DataView/typed-array stores do not pass through uc_mem_write.
    // Resolve current permissions, including VirtualProtect splits. Looking up
    // a code address on a non-executable page can fault in Unicorn's TLB path;
    // only executable intersections can contain translated instructions.
    if (!this.borrowedRanges.length) return;
    for (const range of this.borrowedRanges) this.invalidateExecutable(range.begin, range.end);
  }
  invalidateExecutable(begin, end) {
    this.executableRanges ??= this.cpu
      .mem_regions()
      .filter((region) => region.perms & this.uc.PROT_EXEC)
      .map((region) => ({ begin: Number(region.begin), end: Number(region.end) + 1 }));
    for (const executable of this.executableRanges) {
      const first = Math.max(begin, executable.begin),
        last = Math.min(end, executable.end);
      if (first >= last) continue;
      const result = this.uc.ccall(
        'uc_mem_invalidate',
        'number',
        ['pointer', 'number', 'number'],
        [this.uc.getValue(this.cpu.handle_ptr, '*'), BigInt(first), BigInt(last - first)],
      );
      if (result !== this.uc.ERR_OK)
        throw new Error(`PE32 executable cache invalidation failed: ${this.uc.strerror(result)}`);
    }
  }
  transfer(size) {
    if (!Number.isSafeInteger(size) || size < 0)
      throw new RangeError('PE32 memory transfer requires a nonnegative byte size');
    if (!this.transferPointer || size > this.transferSize) {
      const previous = this.transferPointer,
        capacity = Math.max(65536, size);
      this.transferPointer = 0;
      this.transferSize = 0;
      if (previous) this.uc._free(previous);
      const pointer = this.uc._malloc(capacity);
      if (!pointer) throw new Error('PE32 memory transfer allocation failed');
      this.transferPointer = pointer;
      this.transferSize = capacity;
    }
    return this.transferPointer;
  }
  write(address, bytes) {
    try {
      // Use the same Unicorn memory API as its JavaScript binding, with a
      // bulk typed-array transfer instead of per-byte getValue/setValue loops.
      // The transfer buffer belongs to the host, never to the guest snapshot.
      if (bytes.buffer === this.uc.HEAPU8.buffer && bytes.length > (this.transferSize ?? 0))
        bytes = bytes.slice();
      const pointer = this.transfer(bytes.length);
      this.uc.HEAPU8.set(bytes, pointer);
      const result = this.uc.ccall(
        'uc_mem_write',
        'number',
        ['pointer', 'number', 'pointer', 'number'],
        [
          this.uc.getValue(this.cpu.handle_ptr, '*'),
          BigInt(address >>> 0),
          pointer,
          BigInt(bytes.length),
        ],
      );
      if (result !== this.uc.ERR_OK)
        throw new Error(`Unicorn memory write failed: ${this.uc.strerror(result)}`);
      for (const observer of this.writeObservers)
        if (address < observer.end && address + bytes.length > observer.address)
          observer.written = true;
    } catch (cause) {
      throw new Error(
        `PE32 memory write at 0x${(address >>> 0).toString(16)} +${bytes.length} failed: ${cause}`,
        { cause },
      );
    }
  }
  watchWrites(address, size) {
    if (
      !Number.isInteger(address) ||
      address < 0 ||
      !Number.isInteger(size) ||
      size < 1 ||
      address + size > 0x100000000
    )
      throw new RangeError('PE32 write observation requires a valid byte range');
    const observer = { address, end: address + size, written: false };
    const hook = this.cpu.hook_add(
      this.uc.HOOK_MEM_WRITE,
      () => {
        observer.written = true;
      },
      null,
      address,
      address + size - 1,
    );
    this.writeObservers.add(observer);
    let closed = false;
    return {
      get written() {
        return observer.written;
      },
      close: () => {
        if (closed) return;
        this.cpu.hook_del(hook);
        this.writeObservers.delete(observer);
        closed = true;
      },
    };
  }
  beforeInstruction(address, name, callback) {
    if (this.executionBoundaries.has(address))
      throw new Error('PE32 instruction boundary already registered');
    const hook = this.cpu.hook_add(
      this.uc.HOOK_CODE,
      () => {
        if (this.skippingHost === address) {
          this.skippingHost = null;
          return;
        }
        try {
          this.lastTrap = name;
          const result = callback(this);
          if (result && typeof result.then === 'function') {
            if (!this.asyncEnabled) {
              Promise.resolve(result).catch(() => {});
              throw new Error(`PE32 asynchronous instruction boundary ${name} requires callAsync`);
            }
            this.pendingHost = { address, promise: Promise.resolve(result), finish() {} };
            this.cpu.emu_stop();
          }
        } catch (error) {
          this.pendingError = error;
          this.cpu.emu_stop();
        }
      },
      null,
      address,
      address,
    );
    this.executionBoundaries.set(address, { name, hook });
    try {
      // Adding a Unicorn hook does not rebuild already translated code. Late
      // features must become observable in a running World as well as after a
      // fresh-process restore. An unmapped/non-executable site has no old TB.
      this.invalidateExecutable(address, address + 1);
    } catch (error) {
      this.cpu.hook_del(hook);
      this.executionBoundaries.delete(address);
      throw error;
    }
    return () => {
      this.cpu.hook_del(hook);
      this.executionBoundaries.delete(address);
    };
  }
  zero(address, size) {
    const bytes = new Uint8Array(Math.min(size, 65536));
    for (let at = 0; at < size; at += bytes.length)
      this.write(address + at, bytes.subarray(0, Math.min(bytes.length, size - at)));
  }
  load(address) {
    const b = this.read(address, 4);
    return new DataView(b.buffer, b.byteOffset, 4).getUint32(0, true);
  }
  store(address, value) {
    const b = new Uint8Array(4);
    new DataView(b.buffer).setUint32(0, value, true);
    this.write(address, b);
  }
  stringBytes(address, wide = false, includeTerminator = false) {
    const unit = wide ? 2 : 1,
      limit = 1024 * 1024 * unit,
      chunks = [];
    for (let offset = 0; offset < limit; ) {
      const at = (address + offset) >>> 0,
        page = 4096 - (at & 4095),
        // Never probe the next page after a terminator. An unaligned wide
        // code unit can itself cross the boundary, as in the original read.
        size = Math.min(64, Math.max(unit, page - (page % unit)), limit - offset),
        bytes = this.read(at, size);
      let end = 0;
      while (end < size && (bytes[end] || (wide && bytes[end + 1]))) end += unit;
      if (end < size) {
        const tail = end + (includeTerminator ? unit : 0);
        if (!offset) return tail === size ? bytes : bytes.slice(0, tail);
        const result = new Uint8Array(offset + tail);
        let index = 0;
        for (const chunk of chunks) {
          result.set(chunk, index);
          index += chunk.length;
        }
        result.set(bytes.subarray(0, tail), offset);
        return result;
      }
      chunks.push(bytes);
      offset += size;
    }
    throw new Error('PE32 unterminated string');
  }
  string(address, wide = false) {
    const bytes = this.stringBytes(address, wide);
    if (!wide) return new TextDecoder('shift_jis').decode(bytes);
    const words = new Uint16Array(bytes.buffer),
      chunks = [];
    for (let at = 0; at < words.length; at += 8192)
      chunks.push(String.fromCharCode(...words.subarray(at, at + 8192)));
    return chunks.join('');
  }
  allocate(size, zero = false) {
    if (!Number.isSafeInteger(size) || size < 0) throw new Error('PE32 invalid allocation');
    const rounded = Math.ceil(Math.max(16, size) / 16) * 16;
    const reusable = this.freeBlocks.findIndex((block) => block.size >= rounded);
    let address;
    if (reusable >= 0) {
      const block = this.freeBlocks[reusable];
      address = block.address;
      if (block.size === rounded) this.freeBlocks.splice(reusable, 1);
      else {
        block.address += rounded;
        block.size -= rounded;
      }
    } else {
      if (this.heap + rounded > this.heapLimit) throw new Error('PE32 heap exhausted');
      address = this.heap;
      this.heap += rounded;
    }
    this.allocations.set(address, size);
    // New committed guest pages are zero, independently of the WASM allocator.
    // Reused heap blocks retain guest data unless HEAP_ZERO_MEMORY was requested.
    if (reusable < 0) this.zero(address, rounded);
    else if (zero && size) this.write(address, new Uint8Array(size));
    return address;
  }
  observeFree(listener) {
    this.freeObservers ??= new Set();
    this.freeObservers.add(listener);
    return () => this.freeObservers.delete(listener);
  }
  free(address) {
    if (!address) return true;
    const size = this.allocations.get(address);
    if (size === undefined) return false;
    this.allocations.delete(address);
    this.freeBlocks.push({ address, size: Math.ceil(Math.max(16, size) / 16) * 16 });
    this.freeBlocks.sort((a, b) => a.address - b.address);
    for (let i = 1; i < this.freeBlocks.length; ) {
      const previous = this.freeBlocks[i - 1],
        current = this.freeBlocks[i];
      if (previous.address + previous.size === current.address) {
        previous.size += current.size;
        this.freeBlocks.splice(i, 1);
      } else i++;
    }
    this.freeObservers?.forEach((listener) => listener(address));
    return true;
  }
  trap(name, args, callback, real = false) {
    const address = this.nextTrap;
    this.nextTrap += 32;
    if (this.nextTrap >= 0x01100000) throw new Error('PE32 host trap table exhausted');
    return this.defineTrap(address, name, args, callback, real);
  }
  defineTrap(
    address,
    name,
    args,
    callback,
    real = false,
    resultAddress = real ? this.allocate(4) : 0,
  ) {
    if (address < 0x01000000 || address >= this.nextTrap || address % 32)
      throw new Error('PE32 host trap address was not allocated');
    const bytes = real
      ? [0xd9, 0x05, ...word(resultAddress), 0xc2, (args * 4) & 255, (args * 4) >>> 8]
      : [0xc2, (args * 4) & 255, (args * 4) >>> 8];
    this.write(address, bytes);
    this.traps.set(address, {
      name,
      args,
      real,
      resultAddress,
      handler: callback,
      callback: () => {
        if (this.skippingHost === address) {
          this.skippingHost = null;
          return;
        }
        this.lastTrap = name;
        const sp = this.cpu.reg_read_i32(this.uc.X86_REG_ESP) >>> 0;
        const inputs = Array.from({ length: args }, (_, i) => this.load(sp + 4 + i * 4));
        const finish = (result) => {
          if (real) {
            const b = new Uint8Array(4);
            new DataView(b.buffer).setFloat32(0, result, true);
            this.write(resultAddress, b);
          } else if (result !== undefined)
            this.cpu.reg_write_i32(this.uc.X86_REG_EAX, result >>> 0);
        };
        const result = callback(inputs, this);
        if (result && typeof result.then === 'function') {
          if (!this.asyncEnabled) {
            Promise.resolve(result).catch(() => {});
            throw new Error(`PE32 asynchronous host service ${name} requires callAsync`);
          }
          this.pendingHost = { address, promise: Promise.resolve(result), finish };
          this.cpu.emu_stop();
        } else finish(result);
      },
    });
    return address;
  }
  budgetTransfer() {
    if (this.budgetPointer === null) throw new Error('PE32 process is closed');
    if (!this.uc._uc_emu_budget_query || !this.uc._uc_emu_budget_consume)
      throw new Error('The fixed CPU backend does not expose instruction-budget accounting');
    if (this.budgetPointer === undefined) {
      const pointer = this.uc._malloc(24);
      if (!pointer) throw new Error('PE32 instruction-budget transfer allocation failed');
      this.budgetPointer = pointer;
    }
    return this.budgetPointer;
  }
  instructionBudget() {
    const pointer = this.budgetTransfer(),
      result = this.uc.ccall(
        'uc_emu_budget_query',
        'number',
        ['pointer', 'pointer', 'pointer', 'pointer'],
        [this.uc.getValue(this.cpu.handle_ptr, '*'), pointer, pointer + 8, pointer + 16],
      );
    if (result !== this.uc.ERR_OK)
      throw new Error(`PE32 instruction-budget query failed: ${this.uc.strerror(result)}`);
    const view = new DataView(this.uc.HEAPU8.buffer, pointer, 20);
    return {
      counter: view.getBigUint64(0, true),
      limit: view.getBigUint64(8, true),
      active: view.getUint32(16, true) !== 0,
    };
  }
  consumeInstructions(additional) {
    if (!Number.isSafeInteger(additional) || additional < 0)
      throw new RangeError('PE32 simulated instruction count requires a nonnegative safe integer');
    const pointer = this.budgetTransfer(),
      result = this.uc.ccall(
        'uc_emu_budget_consume',
        'number',
        ['pointer', 'number', 'pointer'],
        [this.uc.getValue(this.cpu.handle_ptr, '*'), BigInt(additional), pointer + 16],
      );
    if (result !== this.uc.ERR_OK)
      throw new Error(`PE32 instruction-budget consumption failed: ${this.uc.strerror(result)}`);
    return this.uc.getValue(pointer + 16, 'i32') !== 0;
  }
  call(address, args = [], thisPointer, { resume = false } = {}) {
    let sp = this.stackTop;
    if (!resume) {
      for (let i = args.length - 1; i >= 0; i--) {
        sp -= 4;
        this.store(sp, args[i]);
      }
      sp -= 4;
      this.store(sp, this.sentinel);
      this.cpu.reg_write_i32(this.uc.X86_REG_ESP, sp);
      if (thisPointer !== undefined) this.cpu.reg_write_i32(this.uc.X86_REG_ECX, thisPointer >>> 0);
    }
    this.pendingError = null;
    this.flushBorrowedCode();
    try {
      if (this.singleStep) {
        let pc = address >>> 0;
        for (let i = 0; i < this.budget && pc !== this.sentinel; i++) {
          this.cpu.emu_start(pc, this.sentinel, 0, 1);
          pc = this.cpu.reg_read_i32(this.uc.X86_REG_EIP) >>> 0;
          if (this.pendingError) break;
        }
      } else this.cpu.emu_start(address >>> 0, this.sentinel, 0, this.budget);
    } catch (error) {
      const nativeFault = this.faultState();
      if (!this.pendingError) {
        const fault = new Error(
          `PE32 execution at0x${this.cpu.reg_read_i32(this.uc.X86_REG_EIP).toString(16)}: ${error}`,
        );
        fault.cause = error;
        fault.nativeFault = nativeFault;
        fault.trace = this.recent.map((a) => a.toString(16));
        fault.registers = Object.fromEntries(
          ['EAX', 'ECX', 'EDX', 'ESP', 'EBP', 'ESI', 'EDI', 'FPCW', 'FPSW', 'FPTAG'].map((name) => [
            name,
            (this.cpu.reg_read_i32(this.uc['X86_REG_' + name]) >>> 0).toString(16),
          ]),
        );
        for (const key of ['ECX', 'EDX']) {
          const a = this.cpu.reg_read_i32(this.uc['X86_REG_' + key]) >>> 0;
          try {
            const bytes = this.read(a, 64);
            fault[key + 'Memory'] = [...new Float32Array(bytes.buffer, bytes.byteOffset, 16)];
          } catch {
            /* The register need not point into mapped guest memory. */
          }
        }
        throw fault;
      }
      this.pendingError.nativeFault ??= nativeFault;
    }
    if (this.pendingError) {
      this.pendingError.nativeFault ??= this.faultState();
      throw this.pendingError;
    }
    if (this.pendingHost) {
      const suspended = new Error('PE32 host service suspended');
      suspended.hostSuspended = true;
      throw suspended;
    }
    if (this.cpu.reg_read_i32(this.uc.X86_REG_EIP) >>> 0 !== this.sentinel)
      throw new Error('PE32 execution instruction budget exhausted');
    return this.cpu.reg_read_i32(this.uc.X86_REG_EAX) >>> 0;
  }
  faultState() {
    const registers = Object.fromEntries(
      ['EAX', 'EBX', 'ECX', 'EDX', 'ESI', 'EDI', 'EBP', 'ESP'].map((name) => [
        name,
        this.cpu.reg_read_i32(this.uc['X86_REG_' + name]) >>> 0,
      ]),
    );
    return {
      pc: this.cpu.reg_read_i32(this.uc.X86_REG_EIP) >>> 0,
      registers,
      stackAddress: registers.ESP,
      stack: Array.from({ length: 16 }, (_, i) => {
        try {
          return this.load(registers.ESP + i * 4);
        } catch {
          return null;
        }
      }),
    };
  }
  async callAsync(address, args = [], thisPointer) {
    if (this.asyncEnabled)
      throw new Error('PE32 asynchronous native execution cannot be reentered');
    this.asyncEnabled = true;
    let resume = false;
    try {
      for (;;) {
        try {
          return this.call(address, args, thisPointer, { resume });
        } catch (error) {
          if (!error.hostSuspended) throw error;
          const pending = this.pendingHost;
          this.awaitingHost = true;
          let result;
          try {
            result = await pending.promise;
          } finally {
            this.awaitingHost = false;
          }
          pending.finish(result);
          this.pendingHost = null;
          address = this.cpu.reg_read_i32(this.uc.X86_REG_EIP) >>> 0;
          if (address !== pending.address)
            throw new Error('PE32 suspended host continuation moved');
          this.skippingHost = address;
          resume = true;
        }
      }
    } finally {
      this.asyncEnabled = false;
      this.pendingHost = null;
      this.skippingHost = null;
      this.awaitingHost = false;
    }
  }
  async callFromHost(address, args = [], thisPointer) {
    // The host callback runs inside Unicorn's code hook until it yields. A
    // microtask lets that hook stop the emulator before entering guest code.
    await Promise.resolve();
    if (!this.asyncEnabled || !this.awaitingHost || !this.pendingHost)
      throw new Error('Nested native calls require a suspended host callback');
    const saved = {
      registers: this.registers(),
      pendingHost: this.pendingHost,
      skippingHost: this.skippingHost,
      stackTop: this.stackTop,
      pendingError: this.pendingError,
    };
    const sp = this.cpu.reg_read_i32(this.uc.X86_REG_ESP) >>> 0;
    if (sp - 0x100 < this.stackBottom)
      throw new Error('Nested native call exhausted the guest stack');
    this.stackTop = (sp - 0x100) & ~15;
    this.asyncEnabled = false;
    this.pendingHost = null;
    this.skippingHost = null;
    this.awaitingHost = false;
    try {
      return await this.callAsync(address, args, thisPointer);
    } finally {
      this.writeRegisters(saved.registers);
      this.stackTop = saved.stackTop;
      this.pendingHost = saved.pendingHost;
      this.skippingHost = saved.skippingHost;
      this.pendingError = saved.pendingError;
      this.asyncEnabled = true;
      this.awaitingHost = true;
    }
  }
  loadModule(bytes, resolveImport, name = 'particle.ppi') {
    const pe = parsePE32(bytes);
    let base = pe.base;
    while (
      this.regions.some((r) => base < r.address + r.size && base + pe.image.length > r.address)
    )
      base = (base + 0x1000000) >>> 0;
    if (base !== pe.base && !pe.relocations.length)
      throw new Error('PPI cannot relocate into available guest address space');
    const v = new DataView(pe.image.buffer),
      delta = base - pe.base;
    for (const offset of pe.relocations)
      v.setUint32(offset, v.getUint32(offset, true) + delta, true);
    this.map(base, pe.image.length);
    for (const symbol of pe.imports) v.setUint32(symbol.address, resolveImport(symbol, this), true);
    this.write(base, pe.image);
    const module = {
      name,
      base,
      pe,
      export: (symbol) => {
        const entry = pe.exports.get(typeof symbol === 'string' ? pe.names.get(symbol) : symbol);
        if (!entry || entry.forward)
          throw new Error(
            `PPI export ${symbol} unavailable${entry?.forward ? ': ' + entry.forward : ''}`,
          );
        return base + entry.address;
      },
    };
    this.modules.push(module);
    return module;
  }
  registers() {
    const registers = {};
    for (const name of ['EAX', 'EBX', 'ECX', 'EDX', 'ESI', 'EDI', 'ESP', 'EBP', 'EIP', 'EFLAGS'])
      registers[name] = this.cpu.reg_read(this.uc['X86_REG_' + name], 4);
    for (const [name, size] of FLOATING_POINT_REGISTERS)
      registers[name] = this.cpu.reg_read(this.uc['X86_REG_' + name], size);
    return registers;
  }
  writeRegisters(registers) {
    for (const [name, bytes] of Object.entries(registers))
      this.cpu.reg_write(this.uc['X86_REG_' + name], bytes);
  }
  snapshot() {
    if (this.asyncEnabled || this.pendingHost)
      throw new Error('Cannot checkpoint a running PE32 host service');
    return {
      registers: this.registers(),
      heap: this.heap,
      heapLimit: this.heapLimit,
      nextTrap: this.nextTrap,
      allocations: [...this.allocations],
      freeBlocks: structuredClone(this.freeBlocks),
      traps: [...this.traps].map(([address, { name, args, real, resultAddress }]) => ({
        address,
        name,
        args,
        real,
        resultAddress,
      })),
      executionBoundaries: [...this.executionBoundaries].map(([address, { name }]) => [
        address,
        name,
      ]),
      memoryPermissions: this.cpu.mem_regions().map(({ begin, end, perms }) => ({
        address: Number(begin),
        size: Number(end - begin + 1n),
        permissions: perms,
      })),
      regions: this.regions.map(({ address, size, kind, permissions }) => ({
        kind,
        permissions,
        address,
        size,
        bytes: encodeMemory(
          this.read(
            address,
            address === 0x20000000
              ? this.heap - address
              : address === 0x1000000
                ? this.nextTrap - address
                : size,
          ),
        ),
      })),
    };
  }
  restore(state) {
    if (
      JSON.stringify(state.executionBoundaries) !==
      JSON.stringify([...this.executionBoundaries].map(([address, { name }]) => [address, name]))
    )
      throw new Error('PE32 checkpoint instruction boundaries differ');
    for (const region of [...this.regions])
      if (
        region.kind === 'virtual' &&
        !state.regions.some(
          (saved) => saved.address === region.address && saved.size === region.size,
        )
      )
        this.unmap(region.address);
    for (const saved of state.regions)
      if (
        saved.kind === 'virtual' &&
        !this.regions.some((region) => region.address === saved.address)
      )
        this.map(saved.address, saved.size, 'virtual');
    if (
      state.regions.length !== this.regions.length ||
      state.regions.some(
        (saved) =>
          !this.regions.some(
            (region) => region.address === saved.address && region.size === saved.size,
          ) || saved.bytes.length > saved.size,
      )
    )
      throw new Error('PE32 snapshot mapping does not match loaded DLL');
    for (const trap of state.traps)
      if (this.traps.get(trap.address)?.name !== trap.name)
        throw new Error(`PE32 snapshot host function mismatch at0x${trap.address.toString(16)}`);
    if (
      state.heapLimit !== this.heapLimit ||
      state.heap < 0x20000000 ||
      state.heap > this.heapLimit
    )
      throw new Error('PE32 invalid snapshot heap');
    if (this.heap > state.heap) this.write(state.heap, new Uint8Array(this.heap - state.heap));
    for (const region of state.regions) {
      this.write(region.address, decodeMemory(region.bytes));
      this.regions.find((current) => current.address === region.address).permissions =
        region.permissions;
    }
    for (const { address, size, permissions } of state.memoryPermissions)
      this.cpu.mem_protect(address, size, permissions);
    this.writeRegisters(state.registers);
    this.heap = state.heap;
    this.nextTrap = state.nextTrap;
    this.allocations = new Map(state.allocations);
    this.freeBlocks = structuredClone(state.freeBlocks);
  }
  close() {
    try {
      this.cpu.close();
    } finally {
      for (const allocation of this.hostMappings.values()) this.uc._free(allocation);
      this.hostMappings.clear();
      if (this.transferPointer) this.uc._free(this.transferPointer);
      if (this.budgetPointer) this.uc._free(this.budgetPointer);
      this.budgetPointer = null;
      this.transferPointer = 0;
      this.transferSize = 0;
      this.borrowedRanges.length = 0;
      this.ramViews.clear();
      this.freeObservers?.clear();
    }
  }
}

function word(value) {
  return [value & 255, (value >>> 8) & 255, (value >>> 16) & 255, (value >>> 24) & 255];
}

function encodeMemory(bytes) {
  const blocks = [];
  for (let at = 0; at < bytes.length; at += 32768) {
    const block = bytes.subarray(at, at + 32768);
    if (!block.some((value) => value !== 0)) continue;
    let text = '';
    for (let i = 0; i < block.length; i += 4096)
      text += String.fromCharCode(...block.subarray(i, i + 4096));
    blocks.push({ offset: at, data: btoa(text) });
  }
  return { length: bytes.length, blocks };
}
function decodeMemory(state) {
  if (
    !Number.isSafeInteger(state.length) ||
    state.length < 0 ||
    state.length > 256 * 1024 * 1024 ||
    !Array.isArray(state.blocks)
  )
    throw new Error('Invalid PE32 snapshot memory');
  const bytes = new Uint8Array(state.length);
  for (const block of state.blocks) {
    const data = atob(block.data);
    if (
      !Number.isSafeInteger(block.offset) ||
      block.offset < 0 ||
      block.offset + data.length > bytes.length
    )
      throw new Error('Invalid PE32 snapshot memory block');
    for (let i = 0; i < data.length; i++) bytes[block.offset + i] = data.charCodeAt(i);
  }
  return bytes;
}
