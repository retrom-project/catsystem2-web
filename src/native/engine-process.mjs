// SPDX-License-Identifier: MPL-2.0
// Original EXE backend, reached only through an explicitly injected host.
import { nativeABI } from './abi/index.mjs';
import { PE32Process } from '../ppi/pe32.mjs';
import { loadUnicorn } from '../ppi/backend.mjs';
import { readEngineVersion, readPEVersionResource } from './profile.mjs';
import { NativeConfigurationMemory } from './config-memory.mjs';
import { nativeInflate, nativeDeflate } from './zlib.mjs';
import { installNativeResourceAPIs } from './windows-resources.mjs';
import { installNativeVersionAPIs } from './windows-version.mjs';
import { installNativeCThreadLocks } from './engine-workers.mjs';
import { NativeTextWindows } from './text-windows.mjs';
import { initializeNativeLanguage, releaseNativeLanguage } from './engine-language.mjs';
import { initializeNativeFileServer, releaseNativeFileServer } from './engine-file-server.mjs';
import {
  initializeNativeSystemInformation,
  releaseNativeSystemInformation,
} from './engine-system-information.mjs';
import { NativeExecutableResources } from './engine-executable-resources.mjs';
import { initializeSDKJavaScript, releaseSDKJavaScript } from './engine-sdk-javascript.mjs';
import { installNativeDesktopAPIs } from './engine-desktop.mjs';
import { releaseNativeStartupInstance } from './engine-startup-instance.mjs';
import { releaseNativeWindowClass } from './engine-window-class.mjs';
import { releaseNativeStartupMenu } from './engine-startup-menu.mjs';
import { releaseNativeWindowOwner } from './engine-startup-window.mjs';
import { releaseNativeConfigurationEvent } from './engine-configuration-event.mjs';
import {
  installNativeApplicationWindowBoundary,
  releaseNativeApplicationGraphics,
  releaseNativeApplicationWindow,
} from './engine-startup-application.mjs';
import { NativeEngineWindows } from './windows-services.mjs';
import { binaryIdentity as nativeImageIdentity } from '../identity.mjs';
export { NativeEngineWindows } from './windows-services.mjs';
export { binaryIdentity as nativeImageIdentity } from '../identity.mjs';
export const NATIVE_ENGINE_IMAGES = Object.freeze({
  'nekopara-vol3-engine-2.6.1.76': Object.freeze({
    sha256: 'ee6bf5cbb84191f3e998d033cdcd774763a78cd06912f7da053b329038bc8be0',
    version: '2.6.1.76',
    heap: 0xb91b6c,
    ownerGlobal: 0xb91bf8,
    settingsGlobal: 0xb91bfc,
    settingsOffset: nativeABI('nekopara-vol3-engine-2.6.1.76').layouts.engineImage.settingsOffset,
    ownerBootstrap: [
      0x7148f0,
      0x714970,
      0xb91c00,
      nativeABI('nekopara-vol3-engine-2.6.1.76').layouts.engineImage.ownerBootstrapOffsets[0],
      nativeABI('nekopara-vol3-engine-2.6.1.76').layouts.engineImage.ownerBootstrapOffsets[1],
    ],
    comImports: [0x8c6798, 0x8c679c],
    readGameDefaults: 0x7129d0,
    crtHelpers: [0x7a8807, 0x7ab2e1, 0x7ab24e, 0x79f8fb, 0x7ad3bb],
    zlib: 0x82c550,
    deflate: 0x82c3c0,
    d3dxBaseline: [0xb32f30, 0xb32e08],
    affineTrig: 0x5c3310,
    allocations: [
      [0x79ea57, nativeABI('nekopara-vol3-engine-2.6.1.76').layouts.engineImage.allocationWords[0]],
      [0x5cac7e, nativeABI('nekopara-vol3-engine-2.6.1.76').layouts.engineImage.allocationWords[1]],
    ],
    frees: [0x6f81d0],
  }),
  'sdk-4.01-engine-2.6.1.74': Object.freeze({
    sha256: '0e1dde51e86e9152d8e1d27b82efb15916cb9f82d23dd30990212fafd96c8b9f',
    version: '2.6.1.74',
    heap: 0xc9656c,
    ownerGlobal: 0xc965d0,
    settingsGlobal: 0xc965d4,
    settingsOffset: nativeABI('sdk-4.01-engine-2.6.1.74').layouts.engineImage.settingsOffset,
    ownerBootstrap: [
      0x5c5790,
      0x5c57e0,
      0xc965d8,
      nativeABI('sdk-4.01-engine-2.6.1.74').layouts.engineImage.ownerBootstrapOffsets[0],
      nativeABI('sdk-4.01-engine-2.6.1.74').layouts.engineImage.ownerBootstrapOffsets[1],
    ],
    comImports: [0x98e618, 0x98e624],
    readGameDefaults: 0x5c4180,
    crtHelpers: [0x63e90c, 0x64044e, 0x6403bb, 0x637b5b, 0x6427db],
    zlib: 0x869e70,
    deflate: 0x869ce0,
    d3dxBaseline: [0xc3bcd0, 0xc3bba8],
    affineTrig: 0x49fa90,
    allocations: [
      [0x636cc0, nativeABI('sdk-4.01-engine-2.6.1.74').layouts.engineImage.allocationWords[0]],
      [0x4a7bc0, nativeABI('sdk-4.01-engine-2.6.1.74').layouts.engineImage.allocationWords[1]],
    ],
    frees: [0x49c240, 0x4a7c70],
  }),
});
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
      installNativeCThreadLocks(engine);
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
        installNativeApplicationWindowBoundary(engine);
        if (options.bootstrapOwner.executableResources) {
          engine.executableResources = new NativeExecutableResources(engine);
          if (nativeABI(profile).startup.resourceCheck === 'before-defaults')
            await engine.executableResources.initialize();
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
    installNativeDesktopAPIs(this, text);
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
    await releaseNativeApplicationWindow(this);
    await releaseNativeWindowOwner(this);
    await releaseNativeStartupMenu(this);
    await releaseNativeWindowClass(this);
    await releaseNativeConfigurationEvent(this);
    await releaseNativeStartupInstance(this);
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
    this.image = NATIVE_ENGINE_IMAGES[this.profile];
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
        const result = await this.process.callAsync(address, args, thisPointer, { rasterBudget });
        if (this.kernel.threadHandles.hasWorkers) await this.kernel.threadHandles.pump();
        return result;
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
    this.kernel.messageQueue.cancelWaits();
    this.kernel.events.cancelWaits();
    if (this.pendingCalls) await this.queue;
    const errors = [];
    try {
      try {
        await releaseNativeApplicationGraphics(this);
      } catch (error) {
        errors.push(error);
      }
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
      this.kernel.messageQueue.cancelWaits();
      this.kernel.events.closeAll();
      try {
        this.kernel.threadHandles.closeAll();
      } catch (error) {
        errors.push(error);
      }
      this.kernel.comApartments.clear();
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
