// SPDX-License-Identifier: MPL-2.0
import { PE32Process } from './pe32.mjs';
import { PPIWindowsServices } from './native-services.mjs';
import { PPI_ABI } from './abi.mjs';
import { PPI_HOST_CONTRACTS } from './contracts.mjs';
import { ParticleRandom } from './random.mjs';
import { NativePPI } from './native.mjs';
import { withFloatingPointThread } from './floating-point.mjs';

const realSlots = new Set([3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16, 17, 18, 27, 29, 30]);
const contextSlots = new Set([0, 1, 31, 33, 34]);
const TEB_STATIC_TLS_VECTOR = 0x2c;
async function identity(bytes) {
  return Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256', bytes)), (n) =>
    n.toString(16).padStart(2, '0'),
  ).join('');
}
function keyFor(name, hash) {
  return name ? name.replaceAll('\\', '/').toLowerCase() : hash;
}

// One runtime represents one guest process. DLL statics, CRT state, TLS, host
// function identity and random streams are shared by all its particle banks.
export class NativePPIRuntime {
  static async open(options) {
    return new NativePPIRuntime(await options.unicornFactory(), options);
  }
  constructor(unicorn, options = {}) {
    if (options.nativeThread != null && typeof options.nativeThread !== 'function')
      throw new TypeError('PPI nativeThread requires a synchronous process provider');
    this.options = options;
    this.process = new PE32Process(unicorn, options);
    this.services = new PPIWindowsServices(this.process, options);
    this.random = options.random || new ParticleRandom();
    this.nextStaticTLS = 0;
    this.modules = new Map();
    this.instances = new Map();
    const table = this.process.allocate(35 * 4);
    this.hostTable = table;
    this.hostFunctions = this.process.allocate(4);
    this.process.store(this.hostFunctions, table);
    for (let slot = 0; slot < 35; slot++) {
      const contract = PPI_HOST_CONTRACTS[slot];
      const address = this.process.trap(
        `PPF.${contract.name}`,
        contract.parameters.length,
        (args) => {
          const instance = contextSlots.has(slot) ? this.instances.get(args[0]) : this.current;
          if (!instance)
            throw new Error(`PPI ${contract.name} callback has no live particle context`);
          if (instance.version < contract.since)
            throw new Error(
              `PPI host slot ${slot} (${contract.name}) is outside version 0x${instance.version.toString(16)}`,
            );
          return instance.host(slot, args);
        },
        realSlots.has(slot),
      );
      this.process.store(table + slot * 4, address);
    }
  }
  invoke(instance, callback, entry = 'callback') {
    if (this.current) throw new Error('PPI host cannot reenter native execution');
    this.current = instance;
    try {
      return this.withThread(callback);
    } catch (cause) {
      const error = new Error(
        `PPI ${instance.name || instance.module?.name || 'particle.ppi'} SHA256=${instance.identity} version=0x${instance.version.toString(16)} ${entry}: ${cause instanceof Error ? cause.message : cause}`,
        { cause },
      );
      error.code = 'CATSYSTEM2_PPI_NATIVE';
      error.plugin = {
        name: instance.module?.name,
        sha256: instance.identity,
        version: instance.version,
      };
      error.entry = entry;
      throw error;
    } finally {
      this.current = null;
    }
  }
  withThread(callback) {
    return withFloatingPointThread(this.process, this.options.nativeThread?.(), callback);
  }
  loadModule(bytes, hash, name) {
    return this.withThread(() => this.loadModuleInThread(bytes, hash, name));
  }
  loadModuleInThread(bytes, hash, name) {
    const key = keyFor(name, hash),
      existing = this.modules.get(key);
    if (existing) {
      if (existing.identity !== hash) throw new Error(`PPI DLL changed while loaded: ${name}`);
      return existing;
    }
    const p = this.process;
    const module = p.loadModule(
      bytes,
      (symbol) => this.services.resolve(symbol),
      name || 'particle.ppi',
    );
    Object.assign(module, { key, identity: hash, references: 0 });
    // The Windows loader initializes TLS and the DLL before an export is called.
    this.initializeTLS(module);
    if (module.pe.entry && !p.call(module.base + module.pe.entry, [module.base, 1, 0]))
      throw new Error('PPI DLL_PROCESS_ATTACH failed');
    module.version = p.call(module.export(3));
    if (
      p.call(module.export(4)) !== PPI_ABI.pluginType ||
      !PPI_ABI.nativeVersions.includes(module.version)
    )
      throw new Error(`Unsupported native PPI type/version 0x${module.version.toString(16)}`);
    this.modules.set(key, module);
    return module;
  }
  initializeTLS(module) {
    const p = this.process,
      directory = module.pe.tls;
    module.tlsCallbacks = [];
    if (!directory.address) return;
    const at = module.base + directory.address;
    const start = p.load(at),
      end = p.load(at + 4),
      indexAddress = p.load(at + 8),
      callbacks = p.load(at + 12),
      zeroFill = p.load(at + 16);
    if (end < start || end - start + zeroFill > 0x4000000)
      throw new Error('Invalid PPI TLS data size');
    const index = this.nextStaticTLS++,
      data = p.allocate(end - start + zeroFill, true);
    if (end > start) p.write(data, p.read(start, end - start));
    p.store(indexAddress, index);
    const slot = p.teb + TEB_STATIC_TLS_VECTOR;
    if (!p.load(slot)) p.store(slot, p.allocate(4096, true));
    if (index >= 1024) throw new Error('PPI static TLS vector exhausted');
    p.store(p.load(slot) + index * 4, data);
    module.tlsIndex = index;
    module.tlsData = data;
    if (callbacks)
      for (let i = 0; i < 1024; i++) {
        const callback = p.load(callbacks + i * 4);
        if (!callback) return;
        module.tlsCallbacks.push(callback);
        p.call(callback, [module.base, 1, 0]);
      }
    if (callbacks) throw new Error('Unterminated PPI TLS callback table');
  }
  async create(bytes, options) {
    if (this.closed) throw new Error('PPI runtime is closed');
    const hash = await identity(bytes);
    let instance;
    try {
      const module = this.loadModule(bytes, hash, options.name);
      module.references++;
      instance = new NativePPI(this, { ...this.options, ...options });
      instance.load(module);
      return instance;
    } catch (error) {
      error.nativePPI = {
        imports: Object.fromEntries(this.services.calls),
        host: Object.fromEntries(instance?.calls || []),
        lastTrap: this.process.lastTrap,
      };
      if (instance?.id) this.instances.delete(instance.id);
      throw error;
    }
  }
  releaseModule(module) {
    return this.withThread(() => this.releaseModuleInThread(module));
  }
  releaseModuleInThread(module) {
    if (--module.references > 0) return;
    const p = this.process;
    if (module.pe.entry) p.call(module.base + module.pe.entry, [module.base, 0, 0]);
    for (const callback of module.tlsCallbacks) p.call(callback, [module.base, 0, 0]);
    if (module.tlsIndex !== undefined) {
      p.free(module.tlsData);
      p.store(p.load(p.teb + TEB_STATIC_TLS_VECTOR) + module.tlsIndex * 4, 0);
    }
    this.modules.delete(module.key);
    p.modules = p.modules.filter((candidate) => candidate !== module);
    p.unmap(module.base);
  }
  snapshot() {
    if (this.current) throw new Error('Cannot save PPI state during native callback');
    return {
      process: this.process.snapshot(),
      services: this.services.snapshot(),
      random: this.random.snapshot(),
      hostFunctions: this.hostFunctions,
      nextStaticTLS: this.nextStaticTLS,
      modules: [...this.modules.values()].map(
        ({ key, identity, name, base, version, tlsIndex, tlsData, tlsCallbacks }) => ({
          key,
          identity,
          name,
          base,
          version,
          tlsIndex,
          tlsData,
          tlsCallbacks,
        }),
      ),
      instances: [...this.instances.values()].map((instance) => instance.saveState()),
    };
  }
  restore(state) {
    if (this.current) throw new Error('Cannot restore PPI state during native callback');
    if (
      state.hostFunctions !== this.hostFunctions ||
      state.modules.length !== this.modules.size ||
      state.modules.some((m) => {
        const module = this.modules.get(m.key);
        return (
          !module ||
          module.identity !== m.identity ||
          module.base !== m.base ||
          module.version !== m.version
        );
      })
    )
      throw new Error('PPI snapshot modules do not match loaded runtime');
    if (state.instances.length !== this.instances.size)
      throw new Error('PPI snapshot instances do not match runtime');
    // A standalone newly-created instance may have a different context address
    // after initialization. The sole object is rebound to the saved address.
    const singleton = state.instances.length === 1 ? [...this.instances.values()][0] : null;
    const next = new Map();
    for (const saved of state.instances) {
      const instance = this.instances.get(saved.id) || singleton;
      if (!instance || instance.module.key !== saved.moduleKey)
        throw new Error('PPI snapshot particle context does not match runtime');
      instance.loadState(saved);
      next.set(instance.id, instance);
    }
    this.nextStaticTLS = state.nextStaticTLS;
    for (const saved of state.modules)
      Object.assign(this.modules.get(saved.key), {
        tlsIndex: saved.tlsIndex,
        tlsData: saved.tlsData,
        tlsCallbacks: saved.tlsCallbacks,
      });
    this.process.restore(state.process);
    this.services.restore(state.services);
    this.random.restore(state.random);
    this.instances = next;
  }
  static async fromSnapshot(state, options) {
    if (typeof options.readPlugin !== 'function')
      throw new TypeError('PPI restore requires readPlugin({name,identity})');
    // Reconstructing DLL imports is not a call on the live engine thread.
    // Its saved process replaces this temporary loader state atomically below.
    const runtime = await NativePPIRuntime.open({ ...options, nativeThread: null });
    try {
      // Imports in unloaded modules can leave host function pointers in saved
      // heap blocks. Recreate their identities in the original allocation order.
      for (const trap of state.process.traps)
        if (!runtime.process.traps.has(trap.address)) {
          const split = trap.name.indexOf('!');
          if (split < 0) throw new Error('Unknown PPI snapshot callback');
          const dll = trap.name.slice(0, split),
            name = trap.name.slice(split + 1);
          runtime.services.resolve({
            dll,
            ...(name.startsWith('#') ? { ordinal: Number(name.slice(1)) } : { name }),
          });
        }
      for (const saved of state.modules) {
        const bytes = await options.readPlugin({ name: saved.name, identity: saved.identity });
        if (!(bytes instanceof Uint8Array) || (await identity(bytes)) !== saved.identity)
          throw new Error(`PPI restore DLL identity mismatch: ${saved.name}`);
        runtime.loadModule(bytes, saved.identity, saved.name);
      }
      for (const saved of state.instances) {
        const instanceOptions = await options.instanceOptions?.(saved);
        const instance = new NativePPI(runtime, {
          ...options,
          ...saved.options,
          ...instanceOptions,
        });
        instance.module = runtime.modules.get(saved.moduleKey);
        instance.identity = saved.identity;
        instance.version = saved.version;
        instance.loadState(saved);
        instance.module.references++;
        runtime.instances.set(saved.id, instance);
      }
      runtime.restore(state);
      runtime.options.nativeThread = options.nativeThread;
      return runtime;
    } catch (error) {
      runtime.process.close();
      runtime.closed = true;
      throw error;
    }
  }
  close() {
    if (this.closed) return;
    for (const instance of [...this.instances.values()]) {
      instance.ownsRuntime = false;
      instance.close();
    }
    this.process.close();
    this.closed = true;
  }
}
