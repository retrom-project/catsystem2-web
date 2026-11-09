// SPDX-License-Identifier: MPL-2.0
import { encodeCP932 } from '../kcs/strings.mjs';
import { windowsMultiByteToWideChar } from './windows-multibyte.mjs';
import { windowsWideCharToMultiByte } from './windows-widechar.mjs';

const PAGE_SIZE = 4096,
  ALLOCATION_GRANULARITY = 65536;

export class PPIWindowsServices {
  constructor(process, { clock, now = () => performance.now(), epoch } = {}) {
    this.process = process;
    this.clock = clock;
    this.now = clock ? () => clock.now() : now;
    this.epoch = epoch ?? clock?.epoch ?? Date.now() - this.now();
    this.lastError = 0;
    this.tls = new Map();
    this.nextTLS = 0;
    this.locks = new Map();
    this.functions = new Map();
    this.calls = new Map();
    this.heaps = new Map([[1, { flags: 0, maximum: 0, blocks: new Set() }]]);
    this.nextHeap = 0x100;
    this.virtual = new Map();
    this.pageProtection = new Map();
    this.environment = process.allocate(4, true);
    this.command = process.allocate(64, true);
    this.writeString(this.command, 'catsystem2-web');
    this.definitions = new Map();
    const def = (name, count, fn) => this.definitions.set(name, { count, fn });
    def('GetProcessHeap', 0, () => 1);
    def('HeapCreate', 3, ([flags, initial, maximum]) => {
      if (flags & ~0x40005)
        throw new Error(`PPI unsupported HeapCreate flags 0x${flags.toString(16)}`);
      if (maximum && initial > maximum) {
        this.lastError = 87;
        return 0;
      }
      const handle = this.nextHeap++;
      this.heaps.set(handle, {
        flags,
        maximum: maximum ? Math.ceil(maximum / 4096) * 4096 : 0,
        blocks: new Set(),
      });
      return handle;
    });
    def('HeapDestroy', 1, ([handle]) => {
      const heap = this.heaps.get(handle);
      if (!heap || handle === 1) {
        this.lastError = 6;
        return 0;
      }
      for (const pointer of heap.blocks) process.free(pointer);
      this.heaps.delete(handle);
      return 1;
    });
    def('HeapAlloc', 3, ([handle, flags, size]) => this.heapAllocate(handle, flags, size));
    def('HeapFree', 3, ([handle, , pointer]) => this.heapRelease(handle, pointer));
    def('HeapSize', 3, ([handle, , pointer]) =>
      this.heaps.get(handle)?.blocks.has(pointer) ? process.allocations.get(pointer) : 0xffffffff,
    );
    def('HeapReAlloc', 4, ([handle, flags, pointer, size]) => {
      const heap = this.heaps.get(handle),
        previous = process.allocations.get(pointer);
      if (!heap?.blocks.has(pointer)) {
        this.lastError = 6;
        return 0;
      }
      if (flags & ~0x1d)
        throw new Error(`PPI unsupported HeapReAlloc flags 0x${flags.toString(16)}`);
      if (size <= Math.ceil(Math.max(previous, 16) / 16) * 16) {
        if (flags & 8 && size > previous)
          process.write(pointer + previous, new Uint8Array(size - previous));
        process.allocations.set(pointer, size);
        return pointer;
      }
      if (flags & 0x10) return 0;
      const next = this.heapAllocate(handle, flags, size, previous);
      if (!next) return 0;
      process.write(next, process.read(pointer, Math.min(previous, size)));
      heap.blocks.delete(pointer);
      process.free(pointer);
      return next;
    });
    def('VirtualAlloc', 4, (args) => this.virtualAllocate(...args));
    def('VirtualFree', 3, (args) => this.virtualFree(...args));
    def('VirtualProtect', 4, (args) => this.virtualProtect(...args));
    for (const name of ['GetSystemInfo', 'GetNativeSystemInfo'])
      def(name, 1, ([out]) => {
        // SYSTEM_INFO for the single virtual i686 processor. Its family,
        // model and stepping match the fixed backend's CPUID leaf 1.
        const values = [
          0,
          PAGE_SIZE,
          0x10000,
          0x7ffeffff,
          1,
          1,
          586,
          ALLOCATION_GRANULARITY,
          0x3c040006,
        ];
        for (let i = 0; i < values.length; i++) process.store(out + i * 4, values[i]);
      });
    def('TlsAlloc', 0, () => {
      if (this.nextTLS >= 1088) {
        this.lastError = 8;
        return 0xffffffff;
      }
      const index = this.nextTLS++;
      this.tls.set(index, 0);
      return index;
    });
    def('TlsFree', 1, ([index]) => Number(this.tls.delete(index)));
    def('TlsGetValue', 1, ([index]) => {
      this.lastError = this.tls.has(index) ? 0 : 87;
      return this.tls.get(index) || 0;
    });
    def('TlsSetValue', 2, ([index, value]) => {
      if (!this.tls.has(index)) {
        this.lastError = 87;
        return 0;
      }
      this.tls.set(index, value);
      return 1;
    });
    def('GetLastError', 0, () => this.lastError);
    def('SetLastError', 1, ([error]) => {
      this.lastError = error;
    });
    def('EncodePointer', 1, ([pointer]) => pointer ^ 0x7319c5e3);
    def('DecodePointer', 1, ([pointer]) => pointer ^ 0x7319c5e3);
    def('GetCurrentProcess', 0, () => 0xffffffff);
    def('GetCurrentProcessId', 0, () => 1);
    def('GetCurrentThreadId', 0, () => 1);
    def('IsDebuggerPresent', 0, () => 0);
    def('IsProcessorFeaturePresent', 1, ([feature]) => Number([3, 6, 7, 8, 10].includes(feature)));
    def('InterlockedIncrement', 1, ([pointer]) => {
      const value = process.load(pointer) + 1;
      process.store(pointer, value);
      return value;
    });
    def('InterlockedCompareExchange', 3, ([pointer, exchange, comparand]) => {
      const previous = process.load(pointer);
      if (previous === comparand) process.store(pointer, exchange);
      return previous;
    });
    def('InterlockedDecrement', 1, ([pointer]) => {
      const value = process.load(pointer) - 1;
      process.store(pointer, value);
      return value;
    });
    def('InitializeCriticalSection', 1, ([pointer]) => {
      this.locks.set(pointer, 0);
      process.write(pointer, new Uint8Array(24));
    });
    def('InitializeCriticalSectionAndSpinCount', 2, ([pointer]) => {
      this.locks.set(pointer, 0);
      process.write(pointer, new Uint8Array(24));
      return 1;
    });
    def('EnterCriticalSection', 1, ([pointer]) => {
      if (!this.locks.has(pointer)) throw new Error('PPI entered uninitialized critical section');
      this.locks.set(pointer, this.locks.get(pointer) + 1);
    });
    def('LeaveCriticalSection', 1, ([pointer]) => {
      const count = this.locks.get(pointer);
      if (!count) throw new Error('PPI left unowned critical section');
      this.locks.set(pointer, count - 1);
    });
    def('DeleteCriticalSection', 1, ([pointer]) => {
      if (this.locks.get(pointer)) throw new Error('PPI deleted owned critical section');
      this.locks.delete(pointer);
    });
    def('GetTickCount', 0, () => (this.clock ? this.clock.tickCount() : Math.trunc(this.now())));
    this.timerDefinition = this.definitions.get('GetTickCount');
    def('QueryPerformanceFrequency', 1, ([pointer]) => {
      this.write64(pointer, 1000000n);
      return 1;
    });
    def('QueryPerformanceCounter', 1, ([pointer]) => {
      this.write64(
        pointer,
        this.clock ? this.clock.performanceCounter() : BigInt(Math.trunc(this.now() * 1000)),
      );
      return 1;
    });
    def('GetSystemTimeAsFileTime', 1, ([pointer]) =>
      this.write64(
        pointer,
        this.clock
          ? this.clock.fileTime()
          : (BigInt(Math.trunc(this.epoch + this.now())) + 11644473600000n) * 10000n,
      ),
    );
    def('GetACP', 0, () => 932);
    def('GetOEMCP', 0, () => 932);
    def('GetCPInfo', 2, ([codepage, pointer]) => {
      if (![0, 1, 932].includes(codepage)) throw new Error(`PPI unsupported code page ${codepage}`);
      process.write(pointer, new Uint8Array(20));
      process.store(pointer, 2);
      process.write(pointer + 4, [63, 0, 0x81, 0x9f, 0xe0, 0xfc]);
      return 1;
    });
    def('IsValidCodePage', 1, ([codepage]) => Number([0, 1, 932, 1252, 65001].includes(codepage)));
    def('GetUserDefaultLCID', 0, () => 0x411);
    def('IsValidLocale', 2, ([locale]) =>
      Number([0x411, 0x409, 0x400, 0x800, 0x7f].includes(locale)),
    );
    def('GetCommandLineA', 0, () => this.command);
    def('GetEnvironmentStrings', 0, () => this.environment);
    def('GetEnvironmentStringsW', 0, () => this.environment);
    def('FreeEnvironmentStringsA', 1, () => 1);
    def('FreeEnvironmentStringsW', 1, () => 1);
    for (const suffix of ['A', 'W']) {
      def('GetModuleHandle' + suffix, 1, ([name]) =>
        !name
          ? 0x400000
          : /kernel32\.dll/i.test(process.string(name, suffix === 'W'))
            ? 0x10000
            : this.moduleHandle(process.string(name, suffix === 'W')),
      );
      def('GetModuleFileName' + suffix, 3, ([handle, pointer, capacity]) => {
        const module = process.modules.find((m) => m.base === (handle || 0x400000)),
          text = `C:\\catsystem2-web\\${module?.name || 'engine.exe'}`;
        this.writeString(pointer, text.slice(0, Math.max(0, capacity - 1)), suffix === 'W');
        return Math.min(text.length, capacity);
      });
      def('GetStartupInfo' + suffix, 1, ([pointer]) => {
        process.write(pointer, new Uint8Array(68));
        process.store(pointer, 68);
      });
    }
    def('GetModuleHandleExW', 3, ([flags, input, output]) => {
      const module =
        flags & 4
          ? process.modules.find((m) => input >= m.base && input < m.base + m.pe.image.length)
          : null;
      const handle =
        module?.base || (flags & 4 ? 0 : this.moduleHandle(process.string(input, true)));
      if (handle) process.store(output, handle);
      return Number(Boolean(handle));
    });
    def('GetProcAddress', 2, ([handle, input]) => {
      if (input < 65536) {
        const module = process.modules.find((m) => m.base === handle);
        return module?.pe.exports.has(input) ? module.export(input) : 0;
      }
      const name = process.string(input);
      if (handle === 0x10000)
        return this.definitions.has(name) ? this.resolve({ dll: 'KERNEL32.dll', name }) : 0;
      const module = process.modules.find((m) => m.base === handle);
      return module?.pe.names.has(name) ? module.export(name) : 0;
    });
    def('GetStdHandle', 1, () => 0xffffffff);
    def('GetFileType', 1, () => {
      this.lastError = 6;
      return 0;
    });
    def('GetConsoleCP', 0, () => 0);
    def('GetConsoleMode', 2, () => {
      this.lastError = 6;
      return 0;
    });
    def('SetHandleCount', 1, ([count]) => count);
    def('SetUnhandledExceptionFilter', 1, ([filter]) => {
      const previous = this.exceptionFilter || 0;
      this.exceptionFilter = filter;
      return previous;
    });
    def('MultiByteToWideChar', 6, (args) => windowsMultiByteToWideChar(this, args));
    def('WideCharToMultiByte', 8, (args) => windowsWideCharToMultiByte(this, args));
    const stringType = (type, input, size, output, wide) => {
      if (type !== 1) throw new Error(`PPI unsupported character classification ${type}`);
      const text =
        size === 0xffffffff
          ? process.string(input, wide) + '\0'
          : new TextDecoder(wide ? 'utf-16le' : 'shift_jis', { ignoreBOM: true }).decode(
              process.read(input, size * (wide ? 2 : 1)),
            );
      const bytes = new Uint8Array(text.length * 2),
        b = new DataView(bytes.buffer);
      for (let i = 0; i < text.length; i++) {
        const c = text[i],
          code = c.charCodeAt(0);
        let flags = 0x200;
        if (/\p{Uppercase_Letter}/u.test(c)) flags |= 1;
        if (/\p{Lowercase_Letter}/u.test(c)) flags |= 2;
        if (/[0-9]/.test(c)) flags |= 4;
        if (/\s/u.test(c)) flags |= 8;
        if (/\p{Punctuation}|\p{Symbol}/u.test(c)) flags |= 16;
        if (code < 32 || code === 127) flags |= 32;
        if (c === ' ' || c === '\t') flags |= 64;
        if (/[0-9a-fA-F]/.test(c)) flags |= 128;
        if (/\p{Letter}/u.test(c)) flags |= 256;
        b.setUint16(i * 2, flags, true);
      }
      process.write(output, bytes);
      return 1;
    };
    def('GetStringTypeW', 4, ([type, input, size, output]) =>
      stringType(type, input, size, output, true),
    );
    def('GetStringTypeA', 5, ([, type, input, size, output]) =>
      stringType(type, input, size, output, false),
    );
    const mapString = (flags, input, size, output, capacity, wide) => {
      if (flags & ~0x01000300 || !(flags & 0x300))
        throw new Error(`PPI unsupported locale mapping flags0x${flags.toString(16)}`);
      const text =
        size === 0xffffffff
          ? process.string(input, wide) + '\0'
          : new TextDecoder(wide ? 'utf-16le' : 'shift_jis', { ignoreBOM: true }).decode(
              process.read(input, size * (wide ? 2 : 1)),
            );
      const mapped = flags & 0x200 ? text.toUpperCase() : text.toLowerCase();
      const bytes = wide ? new Uint8Array(mapped.length * 2) : encodeCP932(mapped);
      if (wide) {
        const b = new DataView(bytes.buffer);
        for (let i = 0; i < mapped.length; i++) b.setUint16(i * 2, mapped.charCodeAt(i), true);
      }
      const required = wide ? mapped.length : bytes.length;
      if (!output || !capacity) return required;
      if (capacity < required) {
        this.lastError = 122;
        return 0;
      }
      process.write(output, bytes);
      return required;
    };
    def('LCMapStringW', 6, ([, flags, input, size, output, capacity]) =>
      mapString(flags, input, size, output, capacity, true),
    );
    def('LCMapStringA', 6, ([, flags, input, size, output, capacity]) =>
      mapString(flags, input, size, output, capacity, false),
    );
    for (const name of [
      'RaiseException',
      'RtlUnwind',
      'ExitProcess',
      'TerminateProcess',
      'UnhandledExceptionFilter',
    ])
      def(name, 0, () => {
        throw new Error(`PPI guest raised ${name}`);
      });
    // Stable host-function addresses also make restored DLL function pointers
    // independent of optional GetProcAddress calls during initialization.
    for (const name of [...this.definitions.keys()].sort())
      this.resolve({ dll: 'KERNEL32.dll', name });
    this.resolve({ dll: 'WINMM.dll', name: 'timeGetTime' });
  }
  importDefinition({ dll, name }) {
    return /^(kernel32|kernelbase)\.dll$/i.test(dll)
      ? this.definitions.get(name)
      : /^winmm\.dll$/i.test(dll) && name === 'timeGetTime'
        ? this.timerDefinition
        : null;
  }
  resolve(symbol) {
    const key = `${symbol.dll.toLowerCase()}!${symbol.name || '#' + symbol.ordinal}`;
    if (this.functions.has(key)) return this.functions.get(key);
    const definition = this.importDefinition(symbol);
    const address = this.process.trap(key, definition?.count || 0, (args) => {
      this.calls.set(key, (this.calls.get(key) || 0) + 1);
      if (!definition) throw new Error(`Unimplemented PPI import ${key}`);
      return definition.fn(args);
    });
    this.functions.set(key, address);
    return address;
  }
  moduleHandle(name) {
    return (
      this.process.modules.find(
        (m) => m.name.toLowerCase() === name.split(/[\\/]/).pop().toLowerCase(),
      )?.base || 0
    );
  }
  write64(address, value) {
    const bytes = new Uint8Array(8);
    new DataView(bytes.buffer).setBigUint64(0, value, true);
    this.process.write(address, bytes);
  }
  writeString(address, text, wide = false) {
    if (!wide) {
      this.process.write(address, encodeCP932(text + '\0'));
      return;
    }
    const bytes = new Uint8Array((text.length + 1) * 2),
      b = new DataView(bytes.buffer);
    for (let i = 0; i < text.length; i++) b.setUint16(i * 2, text.charCodeAt(i), true);
    this.process.write(address, bytes);
  }
  memoryPermissions(protection) {
    if (protection & 0x100) throw new Error('PPI PAGE_GUARD requires Windows exception dispatch');
    const flags = protection & 255;
    const permissions = { 1: 0, 2: 1, 4: 3, 8: 3, 16: 4, 32: 5, 64: 7, 128: 7 }[flags];
    if (permissions === undefined || protection & ~0x7ff)
      throw new Error(`Unsupported PPI page protection 0x${protection.toString(16)}`);
    return permissions;
  }
  virtualAllocate(address, size, type, protection) {
    const fail = (code) => {
      this.lastError = code;
      return 0;
    };
    if (!size || size > 128 * 1024 * 1024 || address + size > 0x80000000) return fail(87);
    if (type & ~0x183000) return fail(87);
    if (type & 0x80000) {
      const region = [...this.virtual.values()].find(
        (r) => address >= r.address && address + size <= r.address + r.size,
      );
      return region ? address : fail(487);
    }
    if (!(type & 0x3000)) return fail(87);
    let created = false;
    let region = [...this.virtual.values()].find(
      (r) => address && address >= r.address && address + size <= r.address + r.size,
    );
    if (!region) {
      if (address && !(type & 0x2000)) return fail(487);
      let base = address
        ? Math.floor(address / ALLOCATION_GRANULARITY) * ALLOCATION_GRANULARITY
        : type & 0x100000
          ? 0x70000000
          : 0x40000000;
      const length = Math.ceil((size + (address ? address - base : 0)) / PAGE_SIZE) * PAGE_SIZE;
      if (!address) {
        while (
          this.process.regions.some((r) => base < r.address + r.size && base + length > r.address)
        ) {
          base += type & 0x100000 ? -ALLOCATION_GRANULARITY : ALLOCATION_GRANULARITY;
          if (base < 0x10000 || base + length >= 0x7ffe0000) return fail(8);
        }
      }
      try {
        this.process.map(base, length, 'virtual');
      } catch {
        return fail(487);
      }
      this.process.zero(base, length);
      this.process.cpu.mem_protect(base, length, 0);
      created = true;
      region = { address: base, size: length, committed: new Map() };
      this.virtual.set(base, region);
    } else if (type & 0x2000) return fail(487);
    const start = created ? region.address : Math.floor(address / PAGE_SIZE) * PAGE_SIZE,
      end = created
        ? region.address + region.size
        : Math.ceil((address + size) / PAGE_SIZE) * PAGE_SIZE;
    if (type & 0x1000) {
      const permissions = this.memoryPermissions(protection);
      for (let page = start; page < end; page += 4096) {
        if (!region.committed.has(page)) this.process.write(page, new Uint8Array(4096));
        this.process.cpu.mem_protect(page, 4096, permissions);
        region.committed.set(page, protection);
      }
    }
    return created ? region.address : start;
  }
  virtualFree(address, size, type) {
    const region = [...this.virtual.values()].find(
      (r) => address >= r.address && address < r.address + r.size,
    );
    if (!region || ![0x4000, 0x8000].includes(type)) {
      this.lastError = 487;
      return 0;
    }
    if (type === 0x8000) {
      if (address !== region.address || size) {
        this.lastError = 87;
        return 0;
      }
      this.process.unmap(region.address);
      this.virtual.delete(region.address);
      return 1;
    }
    if (!size && address !== region.address) {
      this.lastError = 87;
      return 0;
    }
    const start = Math.floor(address / 4096) * 4096,
      end = size ? Math.ceil((address + size) / 4096) * 4096 : region.address + region.size;
    if (end > region.address + region.size) {
      this.lastError = 487;
      return 0;
    }
    for (let page = start; page < end; page += 4096) {
      this.process.write(page, new Uint8Array(4096));
      this.process.cpu.mem_protect(page, 4096, 0);
      region.committed.delete(page);
    }
    return 1;
  }
  protectionAt(page) {
    const region = [...this.virtual.values()].find(
      (r) => page >= r.address && page < r.address + r.size,
    );
    if (region) return region.committed.get(page);
    if (this.pageProtection.has(page)) return this.pageProtection.get(page);
    const module = this.process.modules.find(
      (m) => page >= m.base && page < m.base + m.pe.image.length,
    );
    if (module) {
      const section = module.pe.sections.find(
        (s) => page - module.base >= s.address && page - module.base < s.address + s.size,
      );
      if (!section) return 2;
      return section.flags & 0x20000000
        ? section.flags & 0x80000000
          ? 64
          : 32
        : section.flags & 0x80000000
          ? 4
          : 2;
    }
    return this.process.regions.some((r) => page >= r.address && page < r.address + r.size)
      ? 4
      : undefined;
  }
  virtualProtect(address, size, protection, previous) {
    const permissions = this.memoryPermissions(protection),
      start = Math.floor(address / 4096) * 4096,
      end = Math.ceil((address + size) / 4096) * 4096;
    if (!size || !previous || end > 0x80000000) {
      this.lastError = 87;
      return 0;
    }
    const old = this.protectionAt(start);
    for (let page = start; page < end; page += 4096)
      if (this.protectionAt(page) === undefined) {
        this.lastError = 487;
        return 0;
      }
    this.process.store(previous, old);
    for (let page = start; page < end; page += 4096) {
      this.process.cpu.mem_protect(page, 4096, permissions);
      const region = [...this.virtual.values()].find(
        (r) => page >= r.address && page < r.address + r.size,
      );
      if (region) region.committed.set(page, protection);
      else this.pageProtection.set(page, protection);
    }
    return 1;
  }
  heapAllocate(handle, flags, size, replaced = 0) {
    const heap = this.heaps.get(handle);
    if (!heap) {
      this.lastError = 6;
      return 0;
    }
    if (flags & ~0xd) throw new Error(`PPI unsupported HeapAlloc flags 0x${flags.toString(16)}`);
    if (heap.maximum) {
      const used = [...heap.blocks].reduce(
        (sum, pointer) =>
          sum + Math.ceil(Math.max(16, this.process.allocations.get(pointer)) / 16) * 16,
        0,
      );
      const required = Math.ceil(Math.max(16, size) / 16) * 16;
      if (used - replaced + required > heap.maximum || size >= 0x80000) {
        this.lastError = 8;
        if ((flags | heap.flags) & 4) throw new Error('PPI heap allocation exception');
        return 0;
      }
    }
    try {
      const pointer = this.process.allocate(size, Boolean(flags & 8));
      heap.blocks.add(pointer);
      return pointer;
    } catch (error) {
      if ((flags | heap.flags) & 4) throw error;
      this.lastError = 8;
      return 0;
    }
  }
  heapRelease(handle, pointer) {
    const heap = this.heaps.get(handle);
    if (!heap || (pointer && !heap.blocks.has(pointer))) {
      this.lastError = 6;
      return 0;
    }
    if (pointer) {
      heap.blocks.delete(pointer);
      this.process.free(pointer);
    }
    return 1;
  }
  snapshot() {
    return {
      lastError: this.lastError,
      tls: [...this.tls],
      nextTLS: this.nextTLS,
      locks: [...this.locks],
      exceptionFilter: this.exceptionFilter || 0,
      heaps: [...this.heaps].map(([handle, heap]) => [
        handle,
        { ...heap, blocks: [...heap.blocks] },
      ]),
      nextHeap: this.nextHeap,
      virtual: [...this.virtual].map(([address, region]) => [
        address,
        { ...region, committed: [...region.committed] },
      ]),
      pageProtection: [...this.pageProtection],
    };
  }
  restore(state) {
    this.lastError = state.lastError;
    this.tls = new Map(state.tls);
    this.nextTLS = state.nextTLS;
    this.locks = new Map(state.locks);
    this.exceptionFilter = state.exceptionFilter;
    this.heaps = new Map(
      state.heaps.map(([handle, heap]) => [handle, { ...heap, blocks: new Set(heap.blocks) }]),
    );
    this.nextHeap = state.nextHeap;
    for (const page of this.pageProtection.keys()) {
      const region = this.process.regions.find(
        (r) => page >= r.address && page < r.address + r.size,
      );
      if (region) this.process.cpu.mem_protect(page, 4096, region.permissions);
    }
    this.virtual = new Map(
      state.virtual.map(([address, region]) => [
        address,
        { ...region, committed: new Map(region.committed) },
      ]),
    );
    this.pageProtection = new Map(state.pageProtection);
    for (const region of this.virtual.values()) {
      this.process.cpu.mem_protect(region.address, region.size, 0);
      for (const [page, protection] of region.committed)
        this.process.cpu.mem_protect(page, 4096, this.memoryPermissions(protection));
    }
    for (const [page, protection] of this.pageProtection)
      this.process.cpu.mem_protect(page, 4096, this.memoryPermissions(protection));
  }
}
