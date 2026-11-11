// SPDX-License-Identifier: MPL-2.0
// Shared Windows host services for independent plugin and transition processes.
import { NATIVE_ABIS } from './abi/index.mjs';
import { PPIWindowsServices } from '../ppi/native-services.mjs';
import { installNativeFileTimes } from './file-time.mjs';
import { installWindowsPrintf } from './windows-format.mjs';
import { installNativeFileSearch } from './file-search.mjs';
import { nativeVirtualFilePath } from './file-path.mjs';
import { NativeWindowsModules } from './windows-modules.mjs';
import { NativeWindowsEvents } from './windows-events.mjs';
import { NativeWindowsClasses } from './windows-class.mjs';
import { NativeWindowsMenus } from './windows-menus.mjs';
import { NativeWindowsViews } from './windows-views.mjs';
import { NativeWindowsMessages } from './windows-messages.mjs';
import { NativeWindowsIME } from './windows-ime.mjs';
import { NativeWindowsAccelerators } from './windows-accelerators.mjs';
import { NativeWindowsThreadHandles } from './windows-thread-handles.mjs';
import { NativeCOMTaskMemory } from './windows-com-memory.mjs';
import { installNativeKnownFolders } from './windows-folders.mjs';
import { installNativeVolumeInformation } from './windows-volume.mjs';
import { installNativeEntropy } from './windows-entropy.mjs';
const windowsKey = ({ dll, name, ordinal }) => `${dll.toLowerCase()}!${name ?? '#' + ordinal}`;
export class NativeEngineWindows extends PPIWindowsServices {
  constructor(process, options = {}) {
    super(process, options);
    this.overrides = new Map();
    this.files = new Map();
    this.nextFile = 0x50000000;
    this.readFile = options.readFile;
    this.writeFile = options.writeFile;
    this.statFile = options.statFile;
    this.removeFile = options.removeFile;
    this.setFileTimes = options.setFileTimes;
    this.setFileAttributes = options.setFileAttributes;
    this.copyFile = options.copyFile;
    this.moveFile = options.moveFile;
    this.diskSpace = options.diskSpace;
    this.listFiles = options.listFiles;
    this.directories = new Set(['']);
    installNativeKnownFolders(this);
    installNativeVolumeInformation(this);
    this.errorMode = 0;
    this.fileProviders = new Map();
    this.events = new NativeWindowsEvents(this);
    this.windowClasses = new NativeWindowsClasses(this);
    this.windowMenus = new NativeWindowsMenus(this);
    this.windowViews = new NativeWindowsViews(this);
    this.ime = new NativeWindowsIME(this);
    this.messageQueue = new NativeWindowsMessages(this);
    this.accelerators = new NativeWindowsAccelerators(this);
    this.threadHandles = new NativeWindowsThreadHandles(this);
    this.comMemory = new NativeCOMTaskMemory(this);
    this.comApartments = new Map();
    this.comClasses = new Map();
    this.register('OLE32.dll', 'CoInitialize', {
      count: 1,
      fn: ([reserved]) => this.initializeCOM(reserved, 2),
    });
    this.register('OLE32.dll', 'CoInitializeEx', {
      count: 2,
      fn: ([reserved, flags]) => this.initializeCOM(reserved, flags),
    });
    this.register('OLE32.dll', 'CoUninitialize', {
      count: 0,
      fn: () => {
        const apartment = this.comApartments.get(process.teb);
        if (apartment && --apartment.depth === 0) this.comApartments.delete(process.teb);
      },
    });
    this.register('OLE32.dll', 'CoCreateInstance', {
      count: 5,
      fn: ([clsid, outer, context, iid, out]) => {
        if (!out) return 0x80004003; // E_POINTER
        process.store(out, 0);
        if (!clsid || !iid) return 0x80004003;
        if (outer) return 0x80040110; // CLASS_E_NOAGGREGATION
        if (!context) return 0x80070057; // E_INVALIDARG
        if (!this.comDepth) return 0x800401f0; // CO_E_NOTINITIALIZED
        const key = Array.from({ length: 4 }, (_, i) => process.load(clsid + i * 4)).join(',');
        const factory = context & 1 && this.comClasses.get(key);
        return factory ? factory(iid, out) : 0x80040154; // REGDB_E_CLASSNOTREG
      },
    });
    installNativeFileTimes(this, {
      ...options,
      wallNow: options.wallNow ?? (options.clock ? () => options.clock.utcNow() : undefined),
    });
    installWindowsPrintf(this);
    installNativeFileSearch(this);
    this.overrides.set('kernel32.dll!GetUserDefaultUILanguage', {
      count: 0,
      fn: () => {
        const value = options.configuration?.fields.uiLanguage;
        if (!Number.isInteger(value))
          throw new Error('Native UI language requires the browser language service');
        return value;
      },
    });
    this.cwd = '';
    this.wideCommand = process.allocate(128, true);
    this.writeString(this.wideCommand, 'catsystem2-web', true);
    const def = (name, count, fn) => this.register('KERNEL32.dll', name, { count, fn });
    // The mounted browser environment starts with an empty, read-only Windows
    // registry. D3DX's optional HKLM tuning lookup follows its native fallback.
    for (const suffix of ['A', 'W'])
      for (const [name, count] of [
        ['RegOpenKey', 3],
        ['RegOpenKeyEx', 5],
      ])
        this.overrides.set(`advapi32.dll!${name}${suffix}`, {
          count,
          fn: (args) => {
            const output = args[count - 1];
            if (output) process.store(output, 0);
            return 2;
          },
        });
    def('GetCommandLineW', 0, () => this.wideCommand);
    def('GetLogicalDrives', 0, () => 4);
    def('SetErrorMode', 1, ([mode]) => {
      const previous = this.errorMode;
      this.errorMode = mode >>> 0;
      return previous;
    });
    def('GetErrorMode', 0, () => this.errorMode);
    def('InitializeSListHead', 1, ([pointer]) => {
      process.zero(pointer, 8);
    });
    def('InterlockedFlushSList', 1, ([pointer]) => {
      const first = process.load(pointer);
      process.zero(pointer, 8);
      return first;
    });
    def('LoadLibraryExW', 3, ([name, file, flags]) => {
      if (file || flags & ~0x800) throw new Error('Unsupported native LoadLibraryExW flags');
      const module = process
        .string(name, true)
        .toLowerCase()
        .replace(/\.dll$/, '');
      if (['kernel32', 'kernelbase'].includes(module)) return 0x10000;
      // The original CRT falls back to classic TLS when optional API sets are
      // absent. No replacement CRT initialization is injected into the DLL.
      const handle =
        module.startsWith('api-ms-win-') || module === 'advapi32'
          ? 0
          : this.moduleHandle(module + '.dll');
      if (!handle) this.lastError = 126;
      return handle;
    });
    def('FreeLibrary', 1, ([handle]) => {
      if (handle === 0x10000) return 1;
      if (process.modules.some((module) => module.base === handle))
        throw new Error('Native module is owned by the engine process');
      this.lastError = 6;
      return 0;
    });
    for (const suffix of ['A', 'W']) {
      const wide = suffix === 'W';
      def(`GetDriveType${suffix}`, 1, ([root]) => {
        const path = root ? process.string(root, wide) : 'C:\\';
        return !path || /^c:(?:[\\/]|$)/i.test(path) ? 3 : 1;
      });
      def(`GetLogicalDriveStrings${suffix}`, 2, ([capacity, out]) => {
        if (capacity < 5) return 5;
        this.writeString(out, 'C:\\\0', wide);
        return 4;
      });
      def(`lstrcpy${suffix}`, 2, ([out, input]) => {
        process.write(out, process.stringBytes(input, wide, true));
        return out;
      });
      def(`lstrcat${suffix}`, 2, ([out, input]) => {
        const at = out + process.stringBytes(out, wide).length;
        process.write(at, process.stringBytes(input, wide, true));
        return out;
      });
      def(`lstrcpyn${suffix}`, 3, ([out, input, count]) => {
        if (count) {
          const bytes = process.stringBytes(input, wide).subarray(0, (count - 1) * (wide ? 2 : 1));
          process.write(out, bytes);
          process.zero(out + bytes.length, wide ? 2 : 1);
        }
        return out;
      });
      def(
        `lstrlen${suffix}`,
        1,
        ([input]) => process.stringBytes(input, wide).length / (wide ? 2 : 1),
      );
      for (const insensitive of [false, true])
        def(`lstrcmp${insensitive ? 'i' : ''}${suffix}`, 2, ([left, right]) => {
          let a = process.string(left, wide),
            b = process.string(right, wide);
          if (insensitive) {
            a = a.toLowerCase();
            b = b.toLowerCase();
          }
          return a === b ? 0 : a < b ? -1 : 1;
        });
      def(
        `CreateFile${suffix}`,
        7,
        async ([name, access, share, security, creation, flags, template]) => {
          if (
            ![0x80000000, 0x40000000, 0xc0000000].includes(access) ||
            ![1, 2, 3, 4, 5].includes(creation) ||
            security ||
            template ||
            share & ~7 ||
            flags & ~0x18000080
          )
            throw new Error('Unsupported native engine file-open contract');
          const path = this.path(process.string(name, wide));
          let bytes = await this.read(path);
          const writable = Boolean(access & 0x40000000);
          if (writable && (await this.stat(path))?.attributes & 1) {
            this.lastError = 5;
            return 0xffffffff;
          }
          if ((creation === 1 && bytes) || (!bytes && (creation === 3 || creation === 5))) {
            this.lastError = bytes ? 80 : 2;
            return 0xffffffff;
          }
          if (!writable && creation !== 3)
            throw new Error('Native file creation requires write access');
          const dirty = writable && (!bytes || creation === 2 || creation === 5);
          if (dirty) bytes = new Uint8Array();
          const handle = this.nextFile++;
          this.files.set(handle, {
            path,
            bytes: new Uint8Array(bytes),
            position: 0,
            writable,
            dirty,
          });
          return handle;
        },
      );
      def(`GetFileAttributes${suffix}`, 1, async ([name]) => {
        const path = this.path(process.string(name, wide));
        if (this.directories.has(path.toLowerCase())) return 0x10;
        const bytes = await this.read(path);
        if (!bytes) {
          this.lastError = 2;
          return 0xffffffff;
        }
        return (await this.stat(path))?.attributes ?? 0x80;
      });
      def(`SetFileAttributes${suffix}`, 2, async ([name, attributes]) => {
        const path = this.path(process.string(name, wide));
        if ((await this.read(path)) === null) {
          this.lastError = 2;
          return 0;
        }
        if (await this.setAttributes(path, attributes)) return 1;
        this.lastError = 5;
        return 0;
      });
      def(`CreateDirectory${suffix}`, 2, async ([name, security]) => {
        if (security) throw new Error('Native directory security attributes are unavailable');
        const path = this.path(process.string(name, wide)).toLowerCase();
        if (this.directories.has(path) || (await this.read(path)) !== null) {
          this.lastError = 183;
          return 0;
        }
        this.directories.add(path);
        return 1;
      });
      def(`DeleteFile${suffix}`, 1, async ([name]) => {
        const path = this.path(process.string(name, wide));
        if ([...this.files.values()].some((f) => f.path.toLowerCase() === path.toLowerCase())) {
          this.lastError = 32;
          return 0;
        }
        if ((await this.read(path)) === null) {
          this.lastError = 2;
          return 0;
        }
        if ((await this.stat(path))?.attributes & 1) {
          this.lastError = 5;
          return 0;
        }
        if (await this.remove(path)) return 1;
        this.lastError = 5;
        return 0;
      });
      def(`CopyFile${suffix}`, 3, async ([from, to, failIfExists]) => {
        const source = this.path(process.string(from, wide)),
          target = this.path(process.string(to, wide));
        if (source.toLowerCase() === target.toLowerCase()) {
          this.lastError = 87;
          return 0;
        }
        if ((await this.read(source)) === null) {
          this.lastError = 2;
          return 0;
        }
        if (failIfExists && (await this.read(target)) !== null) {
          this.lastError = 80;
          return 0;
        }
        if ((await this.stat(target))?.attributes & 1) {
          this.lastError = 5;
          return 0;
        }
        if ([...this.files.values()].some((f) => f.path.toLowerCase() === target.toLowerCase())) {
          this.lastError = 32;
          return 0;
        }
        if (await this.copy(source, target, Boolean(failIfExists))) return 1;
        this.lastError = 5;
        return 0;
      });
      def(`MoveFile${suffix}`, 2, async ([from, to]) => {
        const source = this.path(process.string(from, wide)),
          target = this.path(process.string(to, wide));
        if ((await this.read(source)) === null) {
          this.lastError = 2;
          return 0;
        }
        if ((await this.read(target)) !== null) {
          this.lastError = 183;
          return 0;
        }
        if (
          [...this.files.values()].some((f) =>
            [source.toLowerCase(), target.toLowerCase()].includes(f.path.toLowerCase()),
          )
        ) {
          this.lastError = 32;
          return 0;
        }
        if (await this.move(source, target)) return 1;
        this.lastError = 5;
        return 0;
      });
      def(`GetDiskFreeSpaceEx${suffix}`, 4, async ([, available, total, free]) => {
        const space = await this.diskSpace?.(),
          outputs = [
            [available, space?.availableBytes],
            [total, space?.totalBytes],
            [free, space?.freeBytes],
          ];
        if (!space || outputs.some(([, bytes]) => !Number.isSafeInteger(bytes) || bytes < 0)) {
          this.lastError = 50;
          return 0;
        }
        for (const [out, bytes] of outputs) if (out) this.write64(out, BigInt(bytes));
        return 1;
      });
      def(
        `GetDiskFreeSpace${suffix}`,
        5,
        async ([, sectors, bytesPerSector, freeClusters, totalClusters]) => {
          const space = await this.diskSpace?.();
          if (
            !space ||
            ![space.availableBytes, space.totalBytes].every(
              (n) => Number.isSafeInteger(n) && n >= 0,
            )
          ) {
            this.lastError = 50;
            return 0;
          }
          let clusterSectors = 8;
          while (Math.floor(space.totalBytes / (clusterSectors * 512)) > 0xffffffff)
            clusterSectors *= 2;
          for (const [out, value] of [
            [sectors, clusterSectors],
            [bytesPerSector, 512],
            [freeClusters, Math.floor(space.availableBytes / (clusterSectors * 512))],
            [totalClusters, Math.floor(space.totalBytes / (clusterSectors * 512))],
          ])
            if (out) process.store(out, value);
          return 1;
        },
      );
      def(`GetFullPathName${suffix}`, 4, ([name, capacity, out, part]) => {
        const path =
            'C:\\catsystem2-web\\' + this.path(process.string(name, wide)).replaceAll('/', '\\'),
          required = path.length + 1;
        if (capacity < required) return required;
        this.writeString(out, path, wide);
        if (part) process.store(part, out + (path.lastIndexOf('\\') + 1) * (wide ? 2 : 1));
        return path.length;
      });
      def(`GetCurrentDirectory${suffix}`, 2, ([capacity, out]) => {
        const path = 'C:\\catsystem2-web' + (this.cwd ? '\\' + this.cwd.replaceAll('/', '\\') : ''),
          required = path.length + 1;
        if (capacity < required) return required;
        this.writeString(out, path, wide);
        return path.length;
      });
    }
    def('ReadFile', 5, ([handle, out, size, read, overlapped]) => {
      if (overlapped)
        throw new Error('Native asynchronous Windows OVERLAPPED reads require their scheduler');
      const file = this.files.get(handle);
      if (!file) {
        this.lastError = 6;
        return 0;
      }
      const bytes = file.bytes.subarray(file.position, file.position + size);
      process.write(out, bytes);
      file.position += bytes.length;
      if (read) process.store(read, bytes.length);
      return 1;
    });
    this.overrides.set('kernel32.dll!WriteFile', {
      count: 5,
      fn: ([handle, input, size, written, overlapped]) => {
        if (overlapped) throw new Error('Native OVERLAPPED writes require their scheduler');
        const file = this.files.get(handle);
        if (!file?.writable) {
          this.lastError = file ? 5 : 6;
          return 0;
        }
        if (file.position + size > 0x10000000)
          throw new Error('Native file write exceeds the mounted resource limit');
        if (file.position + size > file.bytes.length) {
          const bytes = new Uint8Array(file.position + size);
          bytes.set(file.bytes);
          file.bytes = bytes;
        }
        file.bytes.set(process.read(input, size), file.position);
        file.position += size;
        file.dirty = true;
        if (written) process.store(written, size);
        return 1;
      },
    });
    def('GetFileSize', 2, ([handle, high]) => {
      const file = this.files.get(handle);
      if (!file) {
        this.lastError = 6;
        return 0xffffffff;
      }
      if (high) process.store(high, 0);
      return file.bytes.length;
    });
    def('GetFileSizeEx', 2, ([handle, out]) => {
      const file = this.files.get(handle);
      if (!file) {
        this.lastError = 6;
        return 0;
      }
      this.write64(out, BigInt(file.bytes.length));
      return 1;
    });
    def('SetFilePointer', 4, ([handle, low, high, origin]) => {
      const file = this.files.get(handle);
      if (!file) {
        this.lastError = 6;
        return 0xffffffff;
      }
      const offset = high
          ? Number(BigInt.asIntN(64, BigInt(process.load(high)) * 0x100000000n + BigInt(low)))
          : low | 0,
        base =
          origin === 0 ? 0 : origin === 1 ? file.position : origin === 2 ? file.bytes.length : NaN,
        position = base + offset;
      if (!Number.isSafeInteger(position) || position < 0 || position > 0xffffffff) {
        this.lastError = 131;
        return 0xffffffff;
      }
      file.position = position;
      if (high) process.store(high, 0);
      this.lastError = 0;
      return position;
    });
    def('CloseHandle', 1, async ([handle]) => {
      if (this.events.close(handle) || this.threadHandles.close(handle)) return 1;
      const file = this.files.get(handle);
      if (!file) {
        this.lastError = 6;
        return 0;
      }
      this.files.delete(handle);
      if (file.dirty) {
        const written = await this.write(file.path, file.bytes);
        if (written === false || written === 0) {
          this.lastError = 29;
          return 0;
        }
      }
      if (
        file.pendingTimes &&
        Object.keys(file.pendingTimes).length &&
        !(await this.setTimes(file.path, file.pendingTimes))
      ) {
        this.lastError = 5;
        return 0;
      }
      return 1;
    });
    def('GetFileType', 1, ([handle]) => {
      if (this.files.has(handle)) return 1;
      this.lastError = 6;
      return 0;
    });
    if (options.clock)
      this.registerHostModule(
        'winmm.dll',
        new Map(
          [...this.winmmDefinitions.keys()].map((name) => [
            name,
            this.resolve({ dll: 'WINMM.dll', name }),
          ]),
        ),
      );
    if (NATIVE_ABIS[options.profile]?.capabilities.systemEntropy) installNativeEntropy(this);
  }
  path(value) {
    return nativeVirtualFilePath(value, this.cwd);
  }
  registerFiles(name, provider) {
    if (this.fileProviders.has(name))
      throw new Error(`Native file provider ${name} already registered`);
    this.fileProviders.set(name, provider);
  }
  async read(path) {
    for (const provider of this.fileProviders.values()) {
      const result = await provider.read?.(path);
      if (result !== undefined) return result;
    }
    if (!this.readFile) throw new Error(`Native engine file provider missing for ${path}`);
    return this.readFile(path);
  }
  async write(path, bytes) {
    for (const provider of this.fileProviders.values()) {
      const result = await provider.write?.(path, bytes);
      if (result !== undefined) return result;
    }
    if (!this.writeFile) throw new Error(`Native engine write provider missing for ${path}`);
    return this.writeFile(path, bytes);
  }
  async stat(path) {
    for (const provider of this.fileProviders.values()) {
      const result = await provider.stat?.(path);
      if (result !== undefined) return result;
    }
    return this.statFile ? this.statFile(path) : null;
  }
  async setTimes(path, times) {
    for (const provider of this.fileProviders.values()) {
      const result = await provider.setTimes?.(path, times);
      if (result !== undefined) return result;
    }
    return this.setFileTimes ? this.setFileTimes(path, times) : false;
  }
  async setAttributes(path, attributes) {
    for (const provider of this.fileProviders.values()) {
      const result = await provider.setAttributes?.(path, attributes);
      if (result !== undefined) return result;
    }
    return this.setFileAttributes ? this.setFileAttributes(path, attributes) : false;
  }
  async remove(path) {
    for (const provider of this.fileProviders.values()) {
      const result = await provider.remove?.(path);
      if (result !== undefined) return result;
    }
    return this.removeFile ? this.removeFile(path) : false;
  }
  async copy(from, to, failIfExists) {
    for (const provider of this.fileProviders.values()) {
      const result = await provider.copy?.(from, to, failIfExists);
      if (result !== undefined) return result;
    }
    return this.copyFile ? this.copyFile(from, to, failIfExists) : false;
  }
  async move(from, to) {
    for (const provider of this.fileProviders.values()) {
      const result = await provider.move?.(from, to);
      if (result !== undefined) return result;
    }
    return this.moveFile ? this.moveFile(from, to) : false;
  }
  async list() {
    const entries = new Map();
    for (const provider of this.fileProviders.values())
      for (const entry of (await provider.list?.()) ?? [])
        if (!entries.has(entry.name.toLowerCase())) entries.set(entry.name.toLowerCase(), entry);
    for (const entry of (await this.listFiles?.()) ?? [])
      if (!entries.has(entry.name.toLowerCase())) entries.set(entry.name.toLowerCase(), entry);
    return [...entries.values()];
  }
  registerHostModule(name, exports) {
    this.hostModules ??= new NativeWindowsModules(this);
    return this.hostModules.register(name, exports);
  }
  get comDepth() {
    return this.comApartments.get(this.process.teb)?.depth ?? 0;
  }
  initializeCOM(reserved, flags) {
    if (reserved || flags & ~14) return 0x80070057; // E_INVALIDARG
    const teb = this.process.teb,
      mode = flags & 2,
      apartment = this.comApartments.get(teb);
    if (apartment) {
      if (apartment.mode !== mode) return 0x80010106; // RPC_E_CHANGED_MODE
      apartment.depth++;
      return 1; // S_FALSE
    }
    this.comApartments.set(teb, { mode, depth: 1 });
    return 0;
  }
  registerCOMClass(guid, factory) {
    const key = guid.join(',');
    if (this.comClasses.has(key)) throw new Error('Duplicate native COM class');
    this.comClasses.set(key, factory);
  }
  moduleHandle(name) {
    return this.hostModules?.handle(name) || super.moduleHandle(name);
  }
  register(dll, name, definition) {
    const symbol = { dll, name },
      key = windowsKey(symbol);
    this.overrides.set(key, definition);
    if (/^(kernel32|kernelbase)\.dll$/i.test(dll)) this.definitions.set(name, definition);
    const callback = (args) => {
        this.calls.set(key, (this.calls.get(key) ?? 0) + 1);
        return definition.fn(args, this.process);
      },
      address = this.functions.get(key);
    if (address)
      this.process.defineTrap(
        address,
        `engine:${key}`,
        definition.count,
        callback,
        definition.real ?? false,
        definition.real ? this.process.traps.get(address)?.resultAddress : 0,
      );
    else
      this.functions.set(
        key,
        this.process.trap(`engine:${key}`, definition.count, callback, definition.real ?? false),
      );
    return this.functions.get(key);
  }
  resolve(symbol) {
    const override = this.overrides?.get(windowsKey(symbol));
    return override
      ? this.register(symbol.dll, symbol.name ?? `#${symbol.ordinal}`, override)
      : super.resolve(symbol);
  }
  recoverTrap(trap) {
    const key = trap.name.replace(/^engine:/, ''),
      match = /^([^!]+)!([^!]+)$/.exec(key);
    if (!match) return null;
    const [, dll, name] = match,
      definition = this.overrides.get(key) ?? this.importDefinition({ dll, name });
    if (definition)
      return {
        args: definition.count,
        real: definition.real ?? false,
        handler: (args) => {
          this.calls.set(key, (this.calls.get(key) ?? 0) + 1);
          return definition.fn(args, this.process);
        },
      };
    if (trap.args !== 0) return null;
    return {
      args: 0,
      real: false,
      handler: () => {
        throw new Error(`Unimplemented native Windows import ${key}`);
      },
    };
  }
  snapshot() {
    return {
      ...super.snapshot(),
      functions: [...this.functions],
      wideCommand: this.wideCommand,
      cwd: this.cwd,
      directories: [...this.directories],
      finds: structuredClone([...this.finds]),
      nextFind: this.nextFind,
      errorMode: this.errorMode,
      events: this.events.snapshot(),
      windowClasses: this.windowClasses.snapshot(),
      windowMenus: this.windowMenus.snapshot(),
      windowViews: this.windowViews.snapshot(),
      ime: this.ime.snapshot(),
      messageQueue: this.messageQueue.snapshot(),
      accelerators: this.accelerators.snapshot(),
      threadHandles: this.threadHandles.snapshot(),
      comMemory: this.comMemory.snapshot(),
      comApartments: structuredClone([...this.comApartments]),
      ...(this.hostModules ? { hostModules: this.hostModules.snapshot() } : {}),
      nextFile: this.nextFile,
      files: [...this.files].map(([handle, file]) => [handle, { ...file, bytes: [...file.bytes] }]),
    };
  }
  restore(state) {
    super.restore(state);
    this.functions = new Map(state.functions);
    this.wideCommand = state.wideCommand;
    this.cwd = state.cwd;
    this.directories = new Set(state.directories);
    this.finds = new Map(structuredClone(state.finds));
    this.nextFind = state.nextFind;
    this.errorMode = state.errorMode;
    this.events.restore(state.events);
    this.windowClasses.restore(state.windowClasses);
    this.windowMenus.restore(state.windowMenus);
    this.windowViews.restore(state.windowViews);
    this.ime.restore(state.ime);
    this.messageQueue.restore(state.messageQueue);
    this.accelerators.restore(state.accelerators);
    this.threadHandles.restore(state.threadHandles);
    this.comMemory.restore(state.comMemory);
    const apartments = new Map(structuredClone(state.comApartments)),
      owners = new Set([this.process.teb]);
    for (const thread of this.threadHandles.threads.values())
      if (thread.context) owners.add(thread.context.teb);
    if (
      apartments.size !== state.comApartments.length ||
      [...apartments].some(
        ([teb, apartment]) =>
          !owners.has(teb) ||
          ![0, 2].includes(apartment?.mode) ||
          !Number.isSafeInteger(apartment.depth) ||
          apartment.depth < 1,
      )
    )
      throw new Error('Invalid native COM apartment checkpoint');
    this.comApartments = apartments;
    if (state.hostModules) {
      if (!this.hostModules)
        throw new Error('Native checkpoint Windows module providers are absent');
      this.hostModules.restore(state.hostModules);
    }
    this.nextFile = state.nextFile;
    this.files = new Map(
      state.files.map(([handle, file]) => [
        handle,
        { ...file, bytes: Uint8Array.from(file.bytes) },
      ]),
    );
  }
}
