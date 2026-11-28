// SPDX-License-Identifier: MPL-2.0
// Explicit original composition. Methods are bound to the same owning World.
import { requireTransitionalHost } from './require-original-host.mjs';
import { findNativeFileEntries } from '../src/native/file-search.mjs';
import { nativeVirtualFilePath } from '../src/native/file-path.mjs';
import { nativeDataString } from '../src/native/data-text.mjs';
import { refreshNativeLanguageMenu } from './engine-startup-menu.mjs';
import { setNativeWindowCaption } from './engine-startup-window.mjs';
import { runNativeWindowPump } from './engine-window-pump.mjs';
import { NATIVE_APPLICATION_SERVICES_MESSAGE } from '../src/native/application-services-message.mjs';
import { NativeGlobalStringsBridge } from './global-strings-bridge.mjs';
import { NativeScriptReplacementsBridge } from './script-replacements-bridge.mjs';
import { NativeRandomMemory } from './random-memory.mjs';

class OriginalWorldRuntime {
  registerNativeFeature(name, factory) {
    if (!name || typeof factory !== 'function' || this.nativeFeatureFactories.has(name))
      throw new Error(`Invalid or duplicate native process feature ${name}`);
    this.nativeFeatureFactories.set(name, factory);
  }
  ensureNativeEngine() {
    if (this.closed) throw new Error('Native world is closed');
    if (!this.nativeEngineLoading)
      this.nativeEngineLoading = requireTransitionalHost(
        this.transitionalExe,
        this.profile,
        'process.open',
      )
        .open({
          game: this.game,
          profile: this.profile,
          configuration: this.configuration,
          bootstrapOwner: this.bootstrapOwner && {
            ...this.bootstrapOwner,
            displaySize: () => this.graphics.view.virtualSize(),
            touchPoints: () => this.host.nativeTouchPoints?.(),
            mountFiles: async (engine) => {
              // The native game defaults open through the same mounted file
              // adapter as gameplay. These factories do not await the World.
              for (const name of ['data-buffers', 'engine-files'])
                await this.nativeFeatureFactories.get(name)(engine, this);
            },
          },
          readFile: (name) => this.storage.read(name),
          writeFile: (name, bytes) => this.storage.write(name, bytes),
          statFile: (name) => this.storage.stat?.(name) ?? null,
          removeFile: (name) => this.storage.remove?.(name) ?? false,
          setFileTimes: (name, times) => this.storage.setTimes?.(name, times) ?? false,
          setFileAttributes: (name, attributes) =>
            this.storage.setAttributes?.(name, attributes) ?? false,
          copyFile: (from, to, fail) => this.storage.copy?.(from, to, fail) ?? false,
          moveFile: (from, to) => this.storage.move?.(from, to) ?? false,
          diskSpace: () => this.storage.diskSpace?.() ?? null,
          listFiles: () => this.storage.list?.() ?? [],
          random: this.random,
          clock: this.clock,
          now: () => this.clock.now(),
          epoch: this.clock.epoch,
          configurationChanged: () => this.markConfigurationDirty(),
        })
        .then(async (engine) => {
          try {
            new NativeGlobalStringsBridge(engine, this.globalStrings);
            new NativeScriptReplacementsBridge(engine, this.configuration);
            new NativeRandomMemory(engine, this.random);
          } catch (error) {
            try {
              await engine.close();
            } catch (cleanup) {
              error.cleanup = cleanup;
            }
            throw error;
          }
          this.nativeEngine = engine;
          return engine;
        })
        .catch((error) => {
          this.nativeEngineLoading = null;
          throw error;
        });
    return this.nativeEngineLoading;
  }
  getNativeFeature(name) {
    const factory = this.nativeFeatureFactories.get(name);
    if (!factory) throw new Error(`Native process feature ${name} is not installed`);
    if (!this.nativeFeatureLoading.has(name)) {
      const pending = (async () => {
        const engine = await this.ensureNativeEngine(),
          existing = engine.features.get(name);
        if (existing) return existing;
        const feature = await factory(engine, this);
        if (engine.features.get(name) !== feature)
          throw new Error(`Native process feature ${name} did not register its owner`);
        return feature;
      })().catch((error) => {
        this.nativeFeatureLoading.delete(name);
        throw error;
      });
      this.nativeFeatureLoading.set(name, pending);
    }
    return this.nativeFeatureLoading.get(name);
  }
  findNativeFiles(pattern) {
    // The platform directory/provider state is already JS-owned. Reading it
    // never constructs the transitional engine or executes a Win32 thunk.
    const context = this.nativeEngine?.kernel ?? {
      path: (name) => nativeVirtualFilePath(name),
      directories: new Set(['']),
      read: (name) => this.storage.read(name),
      stat: (name) => this.storage.stat?.(name) ?? null,
      list: () => this.storage.list?.() ?? [],
    };
    return findNativeFileEntries(context, pattern);
  }
  nativeDefaultFontBytes() {
    const provider = this.host.nativeDefaultFontBytes;
    let bytes;
    if (provider !== undefined) {
      if (typeof provider !== 'function')
        throw new TypeError('Default font provider must be a synchronous byte reader');
      bytes = provider.call(this.host, this);
    } else {
      const engine = this.nativeEngine,
        view = engine?.configurationMemory,
        settings = engine?.refs?.defaultSettings;
      if (typeof view?.defaultFontBytes !== 'function' || !settings)
        throw new Error('Default Settings font data view is unavailable');
      bytes = view.defaultFontBytes(settings);
    }
    if (!(bytes instanceof Uint8Array))
      throw new TypeError('Default font provider must return synchronous CP932 bytes');
    return new Uint8Array(nativeDataString(bytes));
  }
  refreshTitle() {
    const title =
      this.nativeEngine?.kernel.windowViews.windows.get(this.window.handle)?.title ??
      this.globalStrings.get(this.configuration.getField('application.title'));
    this.host.nativeTitleChanged?.(title, this);
    return title;
  }
  async applyNativeLanguage(field, { reloadMainFirst = false } = {}) {
    const language = this.configuration.language,
      index = language[field] >>> 0,
      valid = index < language.entries.length,
      bridge = this.nativeEngine?.features.get('global-strings');
    if (reloadMainFirst) {
      // Private message 46F reloads the option table before calling the
      // range-checked main-language handler, unlike the menu command.
      bridge?.invalidate([1]);
      await this.globalStrings.reload(1, this.globalStrings.optionFilename());
    }
    if (field === 'sub') language.sub = valid ? index : 0xffffffff;
    else {
      if (!valid) return;
      bridge?.invalidate(field === 'ui' ? [0, 1] : [1]);
      await this.globalStrings.languageChanged(field);
      if (field === 'ui') {
        if (this.nativeEngine?.kernel.windowViews.windows.has(this.window.handle))
          await setNativeWindowCaption(
            this.nativeEngine,
            this.globalStrings.get(this.configuration.getField('application.title')),
          );
        this.refreshTitle();
      }
      for (const record of this.objects.objects.values()) {
        const player = record.kind === 34 && record.implementation.player;
        if (!player) continue;
        this.applyFESLanguage(player);
        await player.refreshImages();
      }
    }
    this.markConfigurationDirty();
    if (this.nativeEngine) await refreshNativeLanguageMenu(this.nativeEngine);
    if (!this.window.opened) this.window.refreshLanguageMenu();
  }
  async processWindowMessages(context = {}) {
    if (this.closed || this.disposalRequested) {
      this.windowMessages.length = 0;
      return;
    }
    if (this.window.opened) {
      const exit = await runNativeWindowPump(this.nativeEngine, this.window.handle, {
        handles: (message, wParam) =>
          (message === NATIVE_APPLICATION_SERVICES_MESSAGE && this.startupScript !== undefined) ||
          this.window.handlesBrowserMessage(message, wParam),
        deliver: (message) => this.dispatchWindowMessage(message, context),
        stopping: () => this.disposalRequested || this.quitRequested,
      });
      if (exit !== null) this.quitRequested = true;
      return;
    }
    let processed = 0;
    while (this.windowMessages.length && !this.disposalRequested) {
      if (++processed > 10000) throw new Error('Native window message queue did not settle');
      const message = this.windowMessages.shift(),
        command = this.window.keyboardCommand(message);
      await this.dispatchWindowMessage(
        command === null ? message : { message: 0x111, wParam: 0x10000 | command, lParam: 0 },
        context,
      );
    }
  }
}

export function installOriginalWorldRuntime(world) {
  world.nativeFeatureFactories = new Map();
  world.nativeFeatureLoading = new Map();
  for (const name of Object.getOwnPropertyNames(OriginalWorldRuntime.prototype))
    if (name !== 'constructor')
      Object.defineProperty(
        world,
        name,
        Object.getOwnPropertyDescriptor(OriginalWorldRuntime.prototype, name),
      );
}

export function snapshotOriginalWorld(world) {
  return { nativeEngine: world.nativeEngine?.snapshot() ?? null };
}
export function hasOriginalWorldCheckpoint(state) {
  return Boolean(state.nativeEngine);
}
export async function restoreOriginalWorld(world, state) {
  if (!state.nativeEngine) return;
  for (const [name] of state.nativeEngine.features) await world.getNativeFeature(name);
  const engine = await world.ensureNativeEngine();
  // Keep the original restore order: feature construction, shared context, heap.
  world.graphics.restoreD3DContext(state.graphics.d3dContext);
  engine.restore(state.nativeEngine);
}
export function bindOriginalWorldMachines(world) {
  const taskMemory = world.nativeEngine?.features.get('task-memory');
  if (taskMemory)
    for (const task of world.runtime.scheduler.tasks.values())
      taskMemory.mapMachine(task.id, task.machine);
}
export async function closeOriginalWorld(world) {
  if (world.nativeEngineLoading) await (await world.nativeEngineLoading).close();
}
