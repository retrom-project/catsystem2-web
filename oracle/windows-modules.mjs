// SPDX-License-Identifier: MPL-2.0
// Explicit Windows platform DLL exports, used by the original delay loader.
// Registering a provider holds one reference for its process lifetime.
const keyOf = (name) => {
  const key = String(name).split(/[\\/]/).at(-1).toLowerCase();
  return key.includes('.') ? key : key + '.dll';
};
const sameBinding = (a, b) =>
  a?.type === b?.type &&
  (a?.type === 'trap'
    ? a.name === b.name && a.args === b.args && a.real === b.real
    : a?.type === 'fixed' && a.address === b.address);

export class NativeWindowsModules {
  constructor(kernel) {
    this.kernel = kernel;
    this.process = kernel.process;
    this.modules = new Map();
    this.providers = new Map();
    this.nextHandle = 0x70010000;
    const p = this.process,
      fallback = (name) =>
        kernel.overrides.get(`kernel32.dll!${name}`)?.fn ?? kernel.definitions.get(name)?.fn,
      getProcAddress = fallback('GetProcAddress'),
      getFileNames = ['A', 'W'].map((suffix) => fallback(`GetModuleFileName${suffix}`)),
      loadExWide = fallback('LoadLibraryExW'),
      freeLibrary = fallback('FreeLibrary'),
      register = (name, count, fn) => kernel.register('KERNEL32.dll', name, { count, fn });
    for (const suffix of ['A', 'W']) {
      const wide = suffix === 'W',
        load = ([name, file = 0, flags = 0]) => {
          if (name) {
            const module = this.modules.get(keyOf(p.string(name, wide)));
            if (module) {
              if (file || flags & ~0x800) {
                kernel.lastError = 87;
                return 0;
              }
              module.references++;
              return module.handle;
            }
          }
          if (wide && loadExWide) return loadExWide([name, file, flags]);
          if (name && !file && !(flags & ~0x800)) {
            const handle = kernel.moduleHandle(p.string(name, wide));
            if (handle) return handle;
          }
          kernel.lastError = name ? 126 : 87;
          return 0;
        };
      register(`LoadLibrary${suffix}`, 1, load);
      register(`LoadLibraryEx${suffix}`, 3, load);
      register(`GetModuleFileName${suffix}`, 3, (args) => {
        const [handle, out, capacity] = args,
          module = this.byHandle(handle);
        if (!module) return getFileNames[Number(wide)](args);
        if (!capacity) {
          kernel.lastError = 122;
          return 0;
        }
        const text = `C:\\catsystem2-web\\${module.name}`;
        kernel.writeString(out, text.slice(0, capacity - 1), wide);
        if (text.length >= capacity) {
          kernel.lastError = 122;
          return capacity;
        }
        return text.length;
      });
    }
    register('GetProcAddress', 2, (args) => {
      const [handle, input] = args,
        module = this.byHandle(handle);
      if (!module) return getProcAddress(args);
      const name = input < 65536 ? input : p.string(input),
        address = module.exports.get(name);
      if (!address) kernel.lastError = 127;
      return address ?? 0;
    });
    register('FreeLibrary', 1, (args) => {
      const module = this.byHandle(args[0]);
      if (!module) return freeLibrary(args);
      module.references = Math.max(1, module.references - 1);
      return 1;
    });
  }
  byHandle(handle) {
    return [...this.modules.values()].find((module) => module.handle === handle);
  }
  handle(name) {
    return this.modules.get(keyOf(name))?.handle ?? 0;
  }
  binding(address) {
    const trap = this.process.traps.get(address);
    return trap
      ? { type: 'trap', name: trap.name, args: trap.args, real: trap.real }
      : { type: 'fixed', address };
  }
  register(name, exports) {
    const key = keyOf(name);
    if (key.length <= 4 || !key.endsWith('.dll') || this.modules.has(key))
      throw new Error(`Invalid or duplicate Windows platform module ${name}`);
    const entries = exports instanceof Map ? [...exports] : Object.entries(exports);
    for (const [symbol, address] of entries)
      if (
        !(
          (typeof symbol === 'string' && symbol.length > 0 && !symbol.includes('\0')) ||
          (Number.isInteger(symbol) && symbol > 0 && symbol < 65536)
        ) ||
        !Number.isInteger(address) ||
        address <= 0 ||
        address > 0xffffffff
      )
        throw new Error('Windows platform exports require actual guest function addresses');
    const module = { name: key, handle: this.nextHandle, references: 1, exports: new Map(entries) };
    this.nextHandle += 16;
    this.modules.set(key, module);
    // A provider declares identities independently of this process's temporary
    // trap allocation order. The restored process owns the saved addresses.
    this.providers.set(
      key,
      new Map(entries.map(([symbol, address]) => [symbol, this.binding(address)])),
    );
    return module.handle;
  }
  snapshot() {
    return {
      nextHandle: this.nextHandle,
      modules: [...this.modules].map(([name, module]) => [
        name,
        {
          ...module,
          exports: [...module.exports].map(([symbol, address]) => [
            symbol,
            { address, binding: this.binding(address) },
          ]),
        },
      ]),
    };
  }
  restore(state) {
    const actual = new Map();
    for (const [name, module] of state.modules) {
      const provider = this.providers.get(name),
        entries = new Map(module.exports);
      if (
        !provider ||
        actual.has(name) ||
        entries.size !== module.exports.length ||
        provider.size !== entries.size ||
        [...entries].some(
          ([symbol, entry]) =>
            !Number.isInteger(entry?.address) ||
            entry.address <= 0 ||
            entry.address > 0xffffffff ||
            !sameBinding(provider.get(symbol), entry.binding) ||
            !sameBinding(this.binding(entry.address), entry.binding),
        )
      )
        throw new Error(`Windows checkpoint module ${name} has no matching platform provider`);
      actual.set(name, {
        ...module,
        exports: new Map([...entries].map(([symbol, entry]) => [symbol, entry.address])),
      });
    }
    if (actual.size !== this.modules.size)
      throw new Error('Windows checkpoint platform module set differs');
    this.modules = actual;
    this.nextHandle = state.nextHandle;
  }
}
