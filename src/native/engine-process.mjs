// SPDX-License-Identifier: MPL-2.0
// Executes reviewed regions of a user-supplied engine image. Its executable
// entry point, TLS callbacks, platform bootstrap and Steam code are never run.
import { PE32Process } from '../ppi/pe32.mjs';
import { PPIWindowsServices } from '../ppi/native-services.mjs';
import { loadUnicorn } from '../ppi/backend.mjs';
import { readEngineVersion, readPEVersionResource } from './profile.mjs';
import { NativeConfigurationMemory } from './config-memory.mjs';
import { nativeInflate, nativeDeflate } from './zlib.mjs';
import { installNativeFileTimes } from './file-time.mjs';
import { installWindowsPrintf } from './windows-format.mjs';
import { installNativeFileSearch } from './file-search.mjs';
import { NativeWindowsModules } from './windows-modules.mjs';
import { installNativeResourceAPIs } from './windows-resources.mjs';
import { installNativeVersionAPIs } from './windows-version.mjs';
import { NativeWindowsEvents } from './windows-events.mjs';
import { NativeWindowsThreadHandles } from './windows-thread-handles.mjs';
import { NativeCOMTaskMemory } from './windows-com-memory.mjs';
import { installNativeKnownFolders } from './windows-folders.mjs';
import { installNativeVolumeInformation } from './windows-volume.mjs';
import { installNativeEntropy } from './windows-entropy.mjs';
import { NativeTextWindows } from './text-windows.mjs';
import { initializeNativeLanguage, releaseNativeLanguage } from './engine-language.mjs';
import { initializeNativeFileServer, releaseNativeFileServer } from './engine-file-server.mjs';
import {
  initializeNativeSystemInformation,
  releaseNativeSystemInformation,
} from './engine-system-information.mjs';
import { NativeExecutableResources } from './engine-executable-resources.mjs';
import { initializeSDKJavaScript, releaseSDKJavaScript } from './engine-sdk-javascript.mjs';

export const NATIVE_ENGINE_IMAGES = Object.freeze({
  'nekopara-vol3-engine-2.6.1.76': Object.freeze({
    sha256: 'ee6bf5cbb84191f3e998d033cdcd774763a78cd06912f7da053b329038bc8be0',
    version: '2.6.1.76',
    heap: 0xb91b6c,
    ownerGlobal: 0xb91bf8,
    settingsGlobal: 0xb91bfc,
    settingsOffset: 0x418,
    ownerBootstrap: [0x7148f0, 0x714970, 0xb91c00, 0x140e4, 0x27ed0],
    comImports: [0x8c6798, 0x8c679c],
    readGameDefaults: 0x7129d0,
    crtHelpers: [0x7a8807, 0x7ab2e1, 0x7ab24e, 0x79f8fb, 0x7ad3bb],
    zlib: 0x82c550,
    deflate: 0x82c3c0,
    d3dxBaseline: [0xb32f30, 0xb32e08],
    affineTrig: 0x5c3310,
    allocations: [
      [0x79ea57, 1],
      [0x5cac7e, 1],
    ],
    frees: [0x6f81d0],
  }),
  'sdk-4.01-engine-2.6.1.74': Object.freeze({
    sha256: '0e1dde51e86e9152d8e1d27b82efb15916cb9f82d23dd30990212fafd96c8b9f',
    version: '2.6.1.74',
    heap: 0xc9656c,
    ownerGlobal: 0xc965d0,
    settingsGlobal: 0xc965d4,
    settingsOffset: 0x210,
    ownerBootstrap: [0x5c5790, 0x5c57e0, 0xc965d8, 0x10924, 0x2114c],
    comImports: [0x98e618, 0x98e624],
    readGameDefaults: 0x5c4180,
    crtHelpers: [0x63e90c, 0x64044e, 0x6403bb, 0x637b5b, 0x6427db],
    zlib: 0x869e70,
    deflate: 0x869ce0,
    d3dxBaseline: [0xc3bcd0, 0xc3bba8],
    affineTrig: 0x49fa90,
    allocations: [
      [0x636cc0, 1],
      [0x4a7bc0, 3],
    ],
    frees: [0x49c240, 0x4a7c70],
  }),
});
export async function nativeImageIdentity(bytes) {
  return Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256', bytes)), (n) =>
    n.toString(16).padStart(2, '0'),
  ).join('');
}
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
    this.threadHandles = new NativeWindowsThreadHandles(this);
    this.comMemory = new NativeCOMTaskMemory(this);
    this.comDepth = 0;
    this.comClasses = new Map();
    this.register('OLE32.dll', 'CoInitialize', {
      count: 1,
      fn: ([reserved]) => {
        if (reserved) return 0x80070057;
        return this.comDepth++ ? 1 : 0;
      },
    });
    this.register('OLE32.dll', 'CoUninitialize', {
      count: 0,
      fn: () => {
        if (this.comDepth) this.comDepth--;
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
      this.registerHostModule('winmm.dll', {
        timeGetTime: this.resolve({ dll: 'WINMM.dll', name: 'timeGetTime' }),
      });
    if (NATIVE_ENGINE_IMAGES[options.profile]) installNativeEntropy(this);
  }
  path(value) {
    let path = value.replaceAll('\\', '/');
    if (/^c:\/catsystem2-web(?:\/|$)/i.test(path))
      path = path.replace(/^c:\/catsystem2-web\/?/i, '');
    // A single root separator selects the current virtual drive's root.
    else if (path.startsWith('/') && !path.startsWith('//')) path = path.slice(1);
    else if (/^[a-z]:|^\/\//i.test(path)) return path;
    else if (this.cwd) path = this.cwd + '/' + path;
    const parts = [];
    for (const part of path.split('/')) {
      if (!part || part === '.') continue;
      if (part === '..') {
        if (!parts.length) throw new Error('Native file path escaped the mounted directory');
        parts.pop();
      } else parts.push(part);
    }
    return parts.join('/');
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
      threadHandles: this.threadHandles.snapshot(),
      comMemory: this.comMemory.snapshot(),
      comDepth: this.comDepth,
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
    this.threadHandles.restore(state.threadHandles);
    this.comMemory.restore(state.comMemory);
    if (!Number.isSafeInteger(state.comDepth) || state.comDepth < 0)
      throw new Error('Invalid native COM initialization depth');
    this.comDepth = state.comDepth;
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

export class NativeEngineProcess {
  static async open({ game, profile, bytes, name, ...options }) {
    const image = NATIVE_ENGINE_IMAGES[profile];
    if (!image) throw new Error(`No reviewed native engine region profile ${profile}`);
    if (!bytes) {
      for (const candidate of game.names('exe')) {
        const source = await game.require(candidate);
        if ((await nativeImageIdentity(source)) === image.sha256) {
          if (bytes) throw new Error('Multiple matching native engine images');
          bytes = source;
          name = candidate;
        }
      }
      if (!bytes) throw new Error(`Required original engine SHA256 ${image.sha256} is not mounted`);
    }
    const identity = await nativeImageIdentity(bytes);
    if (identity !== image.sha256 || readEngineVersion(bytes) !== image.version)
      throw new Error('Native engine image identity does not match its reviewed profile');
    const engine = new NativeEngineProcess(await (options.unicornFactory ?? loadUnicorn)(), {
      ...options,
      game,
      profile,
    });
    try {
      engine.identity = identity;
      engine.name = name ?? 'engine.exe';
      installNativeResourceAPIs(
        engine.kernel,
        () => options.configuration?.fields.uiLanguage ?? 0x411,
      );
      installNativeVersionAPIs(engine.kernel, engine.name, readPEVersionResource(bytes).slice());
      // Only the private loader input receives IMAGE_FILE_DLL. The original
      // bytes and all executable instructions retain their user-mounted source.
      const mapped = new Uint8Array(bytes),
        header = new DataView(mapped.buffer),
        pe = header.getUint32(60, true);
      header.setUint16(pe + 22, header.getUint16(pe + 22, true) | 0x2000, true);
      engine.module = engine.process.loadModule(
        mapped,
        (symbol) => engine.resolve(symbol),
        engine.name,
      );
      if (engine.module.base !== 0x400000)
        throw new Error('Reviewed engine regions require their preferred image base');
      if (image.heap) engine.process.store(image.heap, 1);
      for (const [address, count] of image.allocations)
        engine.patch(address, 'CRT operator new', count, ([size]) => engine.process.allocate(size));
      for (const address of image.frees)
        engine.patch(address, 'CRT free', 1, ([pointer]) => {
          if (!engine.process.free(pointer))
            throw new Error('Native CRT freed an unknown allocation');
        });
      // These ordinary CRT helper functions initialize encoded null pointers,
      // their private heap and the current thread's C locale state. They do
      // not enter WinMain, PE TLS callbacks, or the game's platform bootstrap.
      for (const helper of image.crtHelpers) engine.process.call(helper);
      // The original startup fills the affine transform's fixed-point sine table.
      engine.process.call(image.affineTrig);
      // The original static table supplies the scalar D3DX dispatch used by
      // reviewed MOT handlers. This is initialized once before any feature
      // runs, and retains all original function pointers.
      engine.process.write(
        image.d3dxBaseline[1],
        engine.process.read(image.d3dxBaseline[0], 74 * 4),
      );
      if (options.bootstrapOwner) {
        // WinMain opens the application apartment before the platform owners.
        if (engine.process.call(engine.process.load(image.comImports[0]), [0]) !== 0)
          throw new Error('Native application COM initialization did not open a new apartment');
        engine.refs.applicationCOM = true;
        await initializeNativeSystemInformation(engine);
        if (options.bootstrapOwner.embeddedJavaScript) await initializeSDKJavaScript(engine);
        await initializeNativeFileServer(engine);
        await initializeNativeLanguage(engine);
        await engine.initializeOwner(image, options.bootstrapOwner);
        if (options.bootstrapOwner.executableResources) {
          engine.executableResources = new NativeExecutableResources(engine);
          if (profile.startsWith('sdk-')) await engine.executableResources.initialize();
        }
        if (options.bootstrapOwner.mountFiles) {
          await options.bootstrapOwner.mountFiles(engine);
          // WinMain reads config.int/gamedef.xml and copies the active
          // settings into its default block before reading user preferences.
          // Apply the browser's live preference projection after this copy.
          await engine.process.callAsync(image.readGameDefaults, [], engine.refs.owner);
        }
      } else {
        engine.refs.owner = engine.process.allocate(0x30000, true);
        engine.refs.settings = engine.refs.owner + image.settingsOffset;
        engine.process.store(image.ownerGlobal, engine.refs.owner);
        engine.process.store(image.settingsGlobal, engine.refs.settings);
      }
      if (options.configuration) engine.attachConfiguration(options.configuration);
      if (options.standardLibraries !== false) engine.installStandardLibraries();
      return engine;
    } catch (error) {
      engine.process.close();
      throw error;
    }
  }
  async initializeOwner(image, text) {
    if (!this.options.configuration)
      throw new Error('Original engine startup requires its browser configuration');
    const p = this.process,
      windows = (this.textWindows = new NativeTextWindows(p, { ...text, kernel: this.kernel })),
      [initialize, , defaultsGlobal, defaultsOffset, ownerBytes] = image.ownerBootstrap;
    for (const [dll, name] of [
      ['USER32.dll', 'GetDC'],
      ['USER32.dll', 'ReleaseDC'],
      ['GDI32.dll', 'EnumFontFamiliesA'],
      ['GDI32.dll', 'EnumFontFamiliesW'],
    ])
      this.registerWindows(dll, name, windows.definitions.get(name));
    // WinMain passes the default startup/setup filenames and normal run mode.
    // The original constructor reads startup.xml and owns both Settings blocks.
    await p.callAsync(initialize, [0, 0, 1]);
    const owner = p.load(image.ownerGlobal),
      settings = p.load(image.settingsGlobal),
      defaultSettings = p.load(defaultsGlobal);
    if (
      p.allocations.get(owner) !== ownerBytes ||
      settings !== owner + image.settingsOffset ||
      defaultSettings !== owner + defaultsOffset ||
      windows.objects.size
    )
      throw new Error('Original engine startup did not establish its owner and Settings blocks');
    Object.assign(this.refs, { owner, settings, defaultSettings, nativeOwner: true });
  }
  async releaseOwner() {
    if (!this.refs.nativeOwner) return;
    const image = NATIVE_ENGINE_IMAGES[this.profile],
      [, destroy, defaultsGlobal] = image.ownerBootstrap,
      p = this.process;
    await p.callAsync(destroy);
    if (
      p.load(image.ownerGlobal) ||
      p.load(image.settingsGlobal) ||
      p.load(defaultsGlobal) ||
      p.allocations.has(this.refs.owner)
    )
      throw new Error('Original engine owner did not release its Settings and allocation');
    this.refs.nativeOwner = false;
  }
  constructor(unicorn, options = {}) {
    this.options = options;
    this.profile = options.profile;
    this.process = new PE32Process(unicorn, {
      budget: 200000000,
      heapSize: 0x10000000,
      executableHeap: !NATIVE_ENGINE_IMAGES[options.profile],
      ...options,
    });
    this.kernel = new NativeEngineWindows(this.process, options);
    this.features = new Map();
    this.patches = [];
    this.loadedModules = [];
    this.refs = {};
    this.queue = Promise.resolve();
    this.pendingCalls = 0;
  }
  resolve(symbol) {
    const target = this.process.modules.find(
      (module) => module.name.toLowerCase() === symbol.dll.toLowerCase(),
    );
    if (target) {
      const key = symbol.name ?? symbol.ordinal;
      if (target.pe.names.has(key) || target.pe.exports.has(key)) return target.export(key);
    }
    return this.kernel.resolve(symbol);
  }
  registerWindows(dll, name, definition) {
    return this.kernel.register(dll, name, definition);
  }
  patch(address, name, count, callback, { calleePops = false, real = false } = {}) {
    if (this.patches.some((patch) => patch.address === address))
      throw new Error(`Native engine boundary already registered at 0x${address.toString(16)}`);
    const p = this.process,
      fn = calleePops
        ? callback
        : () => {
            const sp = p.cpu.reg_read_i32(p.uc.X86_REG_ESP) >>> 0;
            return callback(
              Array.from({ length: count }, (_, i) => p.load(sp + 4 + i * 4)),
              p,
            );
          },
      trap = p.trap(`engine:${name}:0x${address.toString(16)}`, calleePops ? count : 0, fn, real),
      jump = new Uint8Array(5);
    jump[0] = 0xe9;
    new DataView(jump.buffer).setInt32(1, trap - address - 5, true);
    p.write(address, jump);
    this.patches.push({ address, name, count, calleePops, real });
    return trap;
  }
  linkImports(module) {
    for (const source of this.process.modules)
      for (const symbol of source.pe.imports)
        if (symbol.dll.toLowerCase() === module.name.toLowerCase())
          this.process.store(
            source.base + symbol.address,
            module.export(symbol.name ?? symbol.ordinal),
          );
  }
  registerFeature(name, feature) {
    if (this.features.has(name)) throw new Error(`Native feature ${name} already registered`);
    this.features.set(name, feature);
  }
  installStandardLibraries() {
    const p = this.process,
      address = NATIVE_ENGINE_IMAGES[this.profile].zlib;
    this.patch(
      address,
      'zlib 1.2.3 inflate',
      4,
      async ([destination, capacity, source, length]) => {
        if (capacity > 0x10000000 || length > 0x10000000)
          throw new Error('Native zlib buffer exceeds the mapped resource limit');
        const result = await nativeInflate(p.read(source, length), p.read(destination, capacity));
        p.write(destination, result.bytes);
        return result.result;
      },
    );
    this.patch(
      NATIVE_ENGINE_IMAGES[this.profile].deflate,
      'zlib 1.2.3 deflate',
      4,
      async ([destination, capacity, source, length]) => {
        if (capacity > 0x10000000 || length > 0x10000000)
          throw new Error('Native zlib buffer exceeds the mapped resource limit');
        const result = await nativeDeflate(p.read(source, length), p.read(destination, capacity));
        p.write(destination, result.bytes);
        return result.result;
      },
    );
  }
  attachConfiguration(configuration) {
    if (this.configurationMemory) throw new Error('Native engine settings are already attached');
    this.configurationMemory = new NativeConfigurationMemory(
      this.process,
      configuration,
      this.refs,
    );
    this.configurationMemory.push();
    return this.configurationMemory;
  }
  call(address, args = [], thisPointer, { task, messageContext, rasterBudget } = {}) {
    if (this.closed) throw new Error('Native engine process is closed');
    this.pendingCalls++;
    const operation = this.queue.then(async () => {
      const previousTask = this.currentTaskID,
        previousMessage = this.currentMessageContext;
      this.currentTaskID = task;
      this.currentMessageContext = messageContext;
      let pushed = false;
      try {
        for (const feature of this.features.values()) await feature.beforeCall?.();
        this.configurationMemory?.push();
        pushed = true;
        return await this.process.callAsync(address, args, thisPointer, { rasterBudget });
      } finally {
        try {
          if (pushed) {
            for (const feature of this.features.values()) await feature.afterCall?.();
            if (this.configurationMemory?.pull()) this.options.configurationChanged?.();
          }
        } finally {
          this.currentTaskID = previousTask;
          this.currentMessageContext = previousMessage;
          this.pendingCalls--;
        }
      }
    });
    this.queue = operation.catch(() => {});
    return operation;
  }
  async callFromHost(
    address,
    args = [],
    thisPointer,
    { task = this.currentTaskID, messageContext = this.currentMessageContext, rasterBudget } = {},
  ) {
    if (this.closed) throw new Error('Native engine process is closed');
    const previousTask = this.currentTaskID,
      previousMessage = this.currentMessageContext;
    this.currentTaskID = task;
    this.currentMessageContext = messageContext;
    try {
      return await this.process.callFromHost(address, args, thisPointer, { rasterBudget });
    } finally {
      this.currentTaskID = previousTask;
      this.currentMessageContext = previousMessage;
    }
  }
  snapshot() {
    if (this.pendingCalls) throw new Error('Cannot checkpoint queued native engine calls');
    return {
      profile: this.profile,
      identity: this.identity,
      name: this.name,
      refs: structuredClone(this.refs),
      configuration: this.configurationMemory?.snapshotRefs(),
      process: this.process.snapshot(),
      kernel: this.kernel.snapshot(),
      patches: structuredClone(this.patches),
      features: [...this.features].map(([name, feature]) => [name, feature.snapshot()]),
    };
  }
  restore(state) {
    if (
      state.profile !== this.profile ||
      state.identity !== this.identity ||
      JSON.stringify(state.patches) !== JSON.stringify(this.patches)
    )
      throw new Error('Native engine checkpoint source or boundaries differ');
    for (const [name] of state.features)
      if (!this.features.has(name))
        throw new Error(`Native checkpoint feature ${name} is not installed`);
    const p = this.process,
      definitions = new Map([...p.traps.values()].map((trap) => [trap.name, trap])),
      restored = [];
    for (const trap of state.process.traps) {
      let definition = definitions.get(trap.name);
      if (!definition)
        for (const feature of this.features.values()) {
          definition = feature.recoverTrap?.(trap);
          if (definition) break;
        }
      definition ??= this.kernel.recoverTrap(trap);
      if (!definition || definition.args !== trap.args || definition.real !== trap.real)
        throw new Error(`Native checkpoint host ABI is unavailable: ${trap.name}`);
      restored.push([trap, definition.handler]);
    }
    p.traps.clear();
    if (
      !Number.isInteger(state.process.nextTrap) ||
      state.process.nextTrap < 0x01000000 ||
      state.process.nextTrap >= 0x01100000 ||
      state.process.nextTrap % 32
    )
      throw new Error('Native checkpoint host table range is invalid');
    p.nextTrap = state.process.nextTrap;
    for (const [trap, handler] of restored)
      p.defineTrap(trap.address, trap.name, trap.args, handler, trap.real, trap.resultAddress);
    p.restore(state.process);
    this.kernel.restore(state.kernel);
    this.refs = structuredClone(state.refs);
    if (state.configuration) {
      if (!this.configurationMemory) throw new Error('Native checkpoint settings codec is missing');
      this.configurationMemory.restoreRefs(state.configuration);
      this.configurationMemory.pull();
    }
    for (const [name, data] of state.features) this.features.get(name).restore(data);
  }
  async close() {
    if (this.closed) return;
    const errors = [];
    try {
      for (const feature of [...this.features.values()].reverse())
        try {
          await feature.close?.();
        } catch (error) {
          errors.push(error);
        }
      try {
        await releaseSDKJavaScript(this);
      } catch (error) {
        errors.push(error);
      }
      try {
        await this.releaseOwner();
      } catch (error) {
        errors.push(error);
      }
      try {
        releaseNativeLanguage(this);
      } catch (error) {
        errors.push(error);
      }
      try {
        await releaseNativeFileServer(this);
      } catch (error) {
        errors.push(error);
      }
      try {
        await releaseNativeSystemInformation(this);
      } catch (error) {
        errors.push(error);
      }
      if (this.refs.applicationCOM) {
        try {
          const address = NATIVE_ENGINE_IMAGES[this.profile].comImports[1];
          this.process.call(this.process.load(address));
          delete this.refs.applicationCOM;
        } catch (error) {
          errors.push(error);
        }
      }
    } finally {
      this.kernel.events.closeAll();
      this.kernel.threadHandles.closeAll();
      try {
        this.process.close();
      } catch (error) {
        errors.push(error);
      }
      this.closed = true;
    }
    if (errors.length) throw new AggregateError(errors, 'Native engine cleanup failed');
  }
}
