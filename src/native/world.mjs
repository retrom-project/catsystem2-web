// SPDX-License-Identifier: MPL-2.0
import { NativeRuntime } from './runtime.mjs';
import { NativeObjects } from './objects.mjs';
import { NativeEngineMessages } from './engine-message.mjs';
import { NativeFileAccess, installNativeFormattedFileOutput } from './storage.mjs';
import { installNativeVersionQuery } from './version-query.mjs';
import { installNativeScriptMessageBox } from './script-message-box.mjs';
import { NativeMotionRegistry } from './motion.mjs';
import {
  NativeSoundConfiguration,
  nativeSoundConfiguration,
  serializeNativeSoundPreferences,
} from './sound-config.mjs';
import { nativeReply } from '../kcs/vm.mjs';
import { NATIVE_FES_IDS, nativeFES } from './fes.mjs';
import { createNativeFESTask } from './fes-task.mjs';
import { createNativeScriptTask, installNativeScripts } from './script-task.mjs';
import { installNativeSDKJavaScriptTasks } from './sdk-javascript-task.mjs';
import { installNativeGraphics } from './graphics.mjs';
import { NativeInput, nativeInput, NATIVE_INPUT_IDS } from './input.mjs';
import { NativeInputBindings } from './input-bindings.mjs';
import { createNativeInputBrowserServices } from './input-browser.mjs';
import { NATIVE_INPUT_CONTROL_IDS, nativeInputControl } from './input-control.mjs';
import { GalleryLibrary } from '../gallery.mjs';
import { NativeGlobalFile } from './persistence.mjs';
import { nativeLegacySoundCategory } from './sound-values.mjs';
import { installNativeSound } from './sound.mjs';
import { installNativeParticles } from './particles.mjs';
import { NativeFESConfiguration } from './fes-config.mjs';
import { serializeNativePreferences } from './preferences.mjs';
import { NativeFESSound } from './fes-sound.mjs';
import { installNativeImagePersistence } from './image-persistence.mjs';
import { NativeFESSourceArena } from './fes-source.mjs';
import { NativeEngineProcess } from './engine-process.mjs';
import { checkNativeDirectXStartup } from './engine-system-information.mjs';
import { initializeNativeDesktop } from './engine-desktop.mjs';
import { initializeNativeStartupInstance } from './engine-startup-instance.mjs';
import { initializeNativeWindowClass } from './engine-window-class.mjs';
import { initializeNativeStartupMenu, refreshNativeLanguageMenu } from './engine-startup-menu.mjs';
import { initializeNativeAccelerators } from './engine-startup-accelerators.mjs';
import {
  initializeNativeApplicationWindow,
  NATIVE_APPLICATION_SERVICES_MESSAGE,
} from './engine-startup-application.mjs';
import { runNativeWindowPump } from './engine-window-pump.mjs';
import {
  createNativeStartupWindow,
  initializeNativeWindowOwner,
  setNativeWindowCaption,
} from './engine-startup-window.mjs';
import { readNativeStartupPreferences } from './engine-preferences.mjs';
import { readNativeStartupSoundConfiguration } from './engine-startup-sound.mjs';
import { loadNativeGameStartupLanguage } from './engine-language.mjs';
import { installNativeMatrices } from './matrix.mjs';
import { installNativeText } from './text-task.mjs';
import { NativeGlobalStrings } from './global-strings.mjs';
import { NativeGlobalStringsBridge } from './global-strings-bridge.mjs';
import { NativeScriptReplacementsBridge } from './script-replacements-bridge.mjs';
import { NativeRandomMemory } from './random-memory.mjs';
import { NativeFESSoundConfiguration } from './fes-sound-config.mjs';
import { installNativeM2 } from './emote.mjs';
import { NativeDataBuffers } from './data-buffer.mjs';
import { NativeInputDevice } from './input-device.mjs';
import { NativeResourceCache } from './resource-cache.mjs';
import { installNativeMovies } from './movie.mjs';
import { installNativeMotionPersistence } from './motion-persistence.mjs';
import { installNativeScriptReplacements } from './script-replacement.mjs';
import { installNativePlainText } from './text-plain.mjs';
import { installNativeUTF8 } from './utf8.mjs';
import { installNativeWindowEvents } from './window-events.mjs';
import { NativeWindow } from './window.mjs';
import { installNativeWindowCommands } from './window-commands.mjs';
import { inspectNativeM2Bootstrap } from './emote-bootstrap.mjs';
import { installNativeSteam } from './steam.mjs';
import { installNativeRecordQueues } from './record-queue.mjs';
import { installNativeTileGame } from './tile-game.mjs';
import { installNativeDatabases } from './database.mjs';
import { installNativeSceneCheckpoints } from './scene-checkpoint.mjs';
import { installNativeContentDatabases } from './content-databases.mjs';
import { installNativeScriptXML } from './script-xml.mjs';
import { installNativeTaskCommands } from './task-command.mjs';
import { installNativeTaskDump } from './task-dump.mjs';
import { installNativeSectionTables } from './section-table.mjs';
import { installNativeImageOwners } from './image-owner.mjs';
import { installNativeGeometry } from './geometry.mjs';
import { installNativeDrawCommands } from './draw-commands.mjs';
import { installNativeTilePlaneCommand } from './tile-plane-command.mjs';
import { installNativeNameTables } from './nametable.mjs';
import { installNativeEffectCommands } from './effect-commands.mjs';
import { installNativeViewGeometry } from './view-geometry.mjs';
import { installNativeScreenCapture } from './screen-capture.mjs';
import { installNativeBitmapMemory } from './bitmap-memory.mjs';
import { installNativeImageCommands } from './image-commands.mjs';
import { installNativeConfigurationQueries } from './configuration-query.mjs';
import { installNativeScalarMath } from './scalar-math.mjs';
import { installNativeInputCommands } from './input-commands.mjs';
import { installNativeRegistry } from './registry.mjs';
import { installNativeRectangles } from './rectangles.mjs';
import { installNativeImageFiles } from './image-file.mjs';
import { installNativeImageComposites } from './image-composite.mjs';
import { installNativeRenderSources } from './render-sources.mjs';
import { NativeSaveSlots } from './save-slots.mjs';
import { installNativeUnicodeOutput } from './unicode-output.mjs';
import { encodeCP932 } from '../kcs/strings.mjs';
import { NativeSystemClock } from './clock.mjs';

// The world owns the task graph. A KCS program is attached to a native script
// task rather than being run until a convenient UI request and discarded.
export class NativeWorld {
  constructor({
    game,
    images,
    host,
    profile,
    configuration,
    soundConfiguration,
    storage,
    audio,
    random,
    motionLibrary,
    sceneLanguages = [],
    steam = null,
    factories = {},
    bootstrapOwner = null,
  }) {
    Object.assign(this, {
      game,
      images,
      host,
      profile,
      configuration,
      storage,
      audio,
      random,
      motionLibrary,
      bootstrapOwner,
    });
    this.clock = new NativeSystemClock({
      now: host.nativeTimeGetTime ? () => host.nativeTimeGetTime() : null,
    });
    this.resourceCache = new NativeResourceCache({
      enabled: configuration.fields.general.cache,
      read: (name) => (game.readNative ? game.readNative(name, 3) : game.read(name)),
      diagnostic: (detail) => host.nativeDiagnostic?.(detail),
    });
    this.game = Object.create(game);
    this.game.read = (name) => this.resourceCache.read(name);
    if (game.readCategory)
      this.game.readCategory = (name, category) => {
        const resolved = game.resolveCategory ? game.resolveCategory(name, category) : name;
        return resolved === null ? Promise.resolve(null) : this.game.read(resolved);
      };
    this.game.require = async (name) => {
      const bytes = await this.game.read(name);
      if (bytes === null) throw new Error(`Missing resource: ${name}`);
      return bytes;
    };
    if (game.requireCategory)
      this.game.requireCategory = async (name, category) => {
        const bytes = await this.game.readCategory(name, category);
        if (bytes === null) throw new Error(`Missing ${category} resource: ${name}`);
        return bytes;
      };
    this.soundConfiguration = soundConfiguration || new NativeSoundConfiguration({ profile });
    this.globalStrings = new NativeGlobalStrings({
      profile,
      read: (name) => (this.game.readLoose ? this.game.readLoose(name) : this.game.read(name)),
      readArchive: (name) =>
        this.game.readArchive ? this.game.readArchive(name) : Promise.resolve(null),
      configuration,
    });
    if (game.nativeResources)
      game.nativeResources.soundCategory = (file) =>
        this.soundConfiguration.master
          ? this.soundConfiguration.get('int', { by: 'filename', query: file })
          : nativeLegacySoundCategory(configuration, file);
    this.input = new NativeInput({
      cursor: (visible) => {
        this.graphics.cursor.setVisible(visible);
      },
      textInput: (text, options) => host.inputText(text, options),
      configuration,
    });
    this.objects = new NativeObjects();
    this.engineMessages = new NativeEngineMessages(this);
    this.objects.releaseIdentity = (record) => this.engineMessages.release(record);
    this.objects.unregisterIdentity = (record) => this.engineMessages.unregister(record);
    this.objects.markReleasedIdentity = (record) => this.engineMessages.markReleased(record);
    this.objects.pruneRoutes = (record) => this.engineMessages.pruneNullRoutes(record);
    this.objects.notify = (...args) => this.sendEngine(...args);
    this.objects.childrenProvider = (record) => this.engineMessages.children(record);
    this.objects.eachChildProvider = (record, callback, options) =>
      this.engineMessages.eachChild(record, callback, options);
    this.objects.identity = ({ parent }) =>
      parent === null ? {} : this.engineMessages.creation(parent);
    this.menu = new Map();
    this.frame = 0;
    this.running = false;
    this.windowMessages = [];
    this.window = new NativeWindow(this);
    this.configurationDirty = false;
    this.preferencesName = 'setup.xml';
    this.configurationFlush = null;
    this.fesConfiguration = new NativeFESConfiguration({
      configuration,
      languages: () => configuration.language?.entries || [],
      isWindow: () => {
        if (!host.nativeIsWindow) throw new Error('Native window state service is unavailable');
        return Number(host.nativeIsWindow(this));
      },
      emit: (event) => {
        const [type, value] = event,
          screenEvent = profile === 'sdk-4.01-engine-2.6.1.74' ? 0x15 : 0x12;
        const message =
          type === screenEvent ? 0x467 : type === 0x2b ? 0x46e : type === 0x2c ? 0x46f : null;
        if (message === null) throw new Error(`Unimplemented FES configuration event ${type}`);
        this.window.post(message, 0, message === 0x467 ? value : 0);
      },
      changed: (name) => {
        this.markConfigurationDirty();
        audio?.refresh?.();
        host.nativeConfigurationChanged?.(name, this);
      },
    });
    this.fesSources = new NativeFESSourceArena();
    this.fesSoundConfiguration = new NativeFESSoundConfiguration({
      soundConfiguration: this.soundConfiguration,
      configuration,
      changed: () => {
        this.markConfigurationDirty();
        this.audio?.refresh?.();
      },
    });
    this.nativeFeatureFactories = new Map();
    this.saveSlots = new NativeSaveSlots(this);
    this.nativeFeatureLoading = new Map();
    this.registerNativeFeature(
      'global-strings',
      (engine) => new NativeGlobalStringsBridge(engine, this.globalStrings),
    );
    this.registerNativeFeature(
      'script-replacements',
      (engine) => new NativeScriptReplacementsBridge(engine, this.configuration),
    );
    this.registerNativeFeature(
      'random-memory',
      (engine) => new NativeRandomMemory(engine, this.random),
    );
    this.registerNativeFeature('input-device', (engine) => new NativeInputDevice(engine, this));
    const globalFile = async (name) => {
      const bytes = await storage.read(name);
      if (!bytes) return new NativeGlobalFile();
      return NativeGlobalFile.fromFile(bytes);
    };
    this.galleries = new GalleryLibrary({
      read: (name) => game.read(name),
      readEntry: async (file, entry) => (await globalFile(file)).read(entry),
      writeEntry: async (file, entry, bytes) => {
        const data = await globalFile(file);
        data.remove(entry);
        data.write(entry, bytes);
        return storage.write(file, await data.file());
      },
      diagnostic: (detail) => host.nativeDiagnostic?.(detail),
    });
    this.runtime = new NativeRuntime({
      profile,
      read: (name, category) =>
        this.game.readCategory ? this.game.readCategory(name, category) : this.game.read(name),
      services: {
        nativeClipboard: host.nativeClipboard,
        nativeWindowHandle: () => this.window.handle,
        nativeDebugOutput: (bytes) => {
          if (typeof host.nativeDebugOutput !== 'function')
            throw new Error('Native debug output requires its browser console service');
          return host.nativeDebugOutput(bytes);
        },
        configuration,
        soundConfiguration: this.soundConfiguration,
        globalStrings: this.globalStrings,
        random,
        screen: game,
        sceneLanguages,
        resourceCache: this.resourceCache,
        resourceFilename: (name, category) =>
          game.nativeResources
            ? game.nativeResources.resolve(name, category)
            : game.resolveCategory
              ? game.resolveCategory(name, category)
              : name,
        persistence: storage,
        objects: this.objects,
        audio,
        clock: () => this.clock.now(),
        date: () => new Date(this.clock.utcNow()),
        systemMenu: {
          setEnabled: (id, enabled) => {
            this.menu.set(id, enabled);
            host.nativeMenuChanged?.(id, enabled);
          },
        },
        log: (text) => host.nativeLog?.(text),
        diagnostic: (detail) => host.nativeDiagnostic?.(detail),
      },
    });
    if (audio) {
      audio.configuration = configuration;
      audio.soundConfiguration = this.soundConfiguration;
    }
    this.runtime.services.files = new NativeFileAccess(storage, () => this.runtime.handles);
    this.runtime.services.motion = new NativeMotionRegistry({
      handles: this.runtime.handles,
      library: motionLibrary,
    });
    this.runtime.services.world = this;
    this.registerNativeFeature(
      'data-buffers',
      (engine) =>
        new NativeDataBuffers(engine, {
          handles: this.runtime.handles,
          read: this.runtime.read,
          diagnostic: (detail) => this.host.nativeDiagnostic?.(detail),
        }),
    );
    this.runtime.services.dataBuffers = async () =>
      (await this.getNativeFeature('data-buffers')).attachServices({
        handles: this.runtime.handles,
        read: this.runtime.read,
        diagnostic: (detail) => this.host.nativeDiagnostic?.(detail),
      });
    for (const id of [5, 7])
      this.runtime.register('main', id, (args, _machine, task) => {
        if (args.length) throw new Error(`Native task clock ${id} expects no arguments`);
        const record = this.objects.objects.get(task.id);
        if (!record) throw new Error(`Native task ${task.id} has no clock`);
        return nativeReply(
          1,
          id === 7
            ? record.frameRate
            : ((record.effectiveFrame ?? 0) - (record.pausedFrames ?? 0)) >>> 0,
        );
      });
    for (const id of NATIVE_INPUT_IDS)
      this.runtime.register('main', id, (args, machine, task) =>
        nativeInput(id, args, machine, task, this),
      );
    for (const id of NATIVE_INPUT_CONTROL_IDS)
      this.runtime.register('main', id, (args, machine, task) =>
        nativeInputControl(id, args, machine, task, this),
      );
    installNativeScripts(this);
    installNativeSDKJavaScriptTasks(this);
    installNativeVersionQuery(this);
    installNativeScriptMessageBox(this);
    this.runtime.services.objects.machine = (id) =>
      this.runtime.scheduler.tasks.get(id)?.machine ?? null;
    for (const id of NATIVE_FES_IDS)
      this.runtime.register('main', id, (args, machine, task) =>
        nativeFES(id, args, machine, task, this),
      );
    for (const entry of this.runtime.tables.get('main')) {
      if ((entry.id >= 0x3aa && entry.id <= 0x3c4) || [0x3e3, 0x3e8, 0x3e9].includes(entry.id))
        this.runtime.register('main', entry.id, (args, machine) =>
          nativeSoundConfiguration(entry.id, args, machine, this.runtime.services),
        );
    }
    this.objects.register(0, (record) => this.base(record));
    this.objects.register(1, (record, _objects, options) =>
      this.engineMessages.root(record, options),
    );
    this.objects.register(11, (record) => this.inputTask(record));
    this.objects.register(12, (record) => this.script(record));
    this.objects.register(34, (record) => this.fes(record));
    installNativeGraphics(this);
    this.runtime.services.importNativeBitmap = (pointer, owner, options) =>
      this.graphics.images.importNative(pointer, owner, options);
    this.runtime.services.view = this.graphics.view;
    installNativeImagePersistence(this);
    installNativeSound(this);
    installNativeMovies(this);
    installNativeMotionPersistence(this);
    installNativeScriptReplacements(this);
    installNativePlainText(this);
    installNativeUTF8(this);
    installNativeWindowEvents(this);
    installNativeWindowCommands(this);
    installNativeSteam(this, steam);
    installNativeRecordQueues(this);
    installNativeTileGame(this);
    installNativeDatabases(this);
    installNativeSceneCheckpoints(this);
    installNativeContentDatabases(this);
    installNativeScriptXML(this);
    installNativeTaskCommands(this);
    installNativeTaskDump(this);
    installNativeSectionTables(this);
    installNativeImageOwners(this);
    installNativeGeometry(this);
    installNativeDrawCommands(this);
    installNativeTilePlaneCommand(this);
    installNativeNameTables(this);
    installNativeEffectCommands(this);
    installNativeViewGeometry(this);
    installNativeBitmapMemory(this);
    installNativeScreenCapture(this);
    installNativeImageCommands(this);
    installNativeConfigurationQueries(this);
    installNativeScalarMath(this);
    installNativeInputCommands(this);
    installNativeRegistry(this);
    installNativeRectangles(this);
    installNativeImageFiles(this);
    installNativeImageComposites(this);
    installNativeRenderSources(this);
    installNativeUnicodeOutput(this);
    installNativeFormattedFileOutput(this);
    if (this.profile === 'nekopara-vol3-engine-2.6.1.76')
      this.runtime.register('main', 0x41e, (args) => {
        if (args.length) throw new Error('Native return-title window request expects no arguments');
        this.window.post(0x468);
        return nativeReply(2);
      });
    this.fesSound = new NativeFESSound(this, {
      onStart: (instance, object, frame) =>
        host.nativeFESSoundStarted?.(instance, object, frame, this),
    });
    installNativeParticles(this);
    installNativeMatrices(this);
    installNativeText(this, { glyphs: host.nativeTextGlyphs?.() });
    installNativeM2(this);
    for (const [kind, factory] of Object.entries(factories))
      this.objects.register(Number(kind), factory);
  }
  base(record) {
    return this.engineMessages.base(record);
  }
  get steam() {
    return this.steamService?.managerExists ? this.steamService : null;
  }
  inputFor(worldID) {
    const top = this.engineMessages.closestTop(worldID),
      id = top?.implementation?.input;
    return this.objects.objects.get(id)?.implementation?.inputState ?? null;
  }
  inputTask(record) {
    const world = this,
      base = this.base(record),
      primary = this.primaryInputTaskID === undefined,
      input = primary
        ? this.input
        : new NativeInput({
            cursor: (visible) => {
              this.graphics.cursor.setVisible(visible);
            },
            textInput: (text, options) => this.host.inputText(text, options),
            configuration: this.configuration,
          });
    if (primary) this.primaryInputTaskID = record.id;
    input.frameRate = record.frameRate;
    input.dispatch = (id, message, w, l, context = {}) =>
      this.engineMessages.dispatch(id, record.id, message, w, l, context);
    input.services = createNativeInputBrowserServices(this, record, input);
    return {
      ...base,
      inputState: input,
      async message(words, context = {}) {
        const [sender, message, w, l] = words,
          result = await input.message(message, w, l, {
            ...context,
            memory: () => world.engineMessages.memory(sender, context),
            resolveOwner: (id) => world.resolveTaskID(id, record.id),
          });
        return result === undefined ? base.message(words, context) : result;
      },
      tick: (frame) => input.tick(frame),
      snapshot: () => input.snapshot(),
      restore: (state) => input.restore(state),
    };
  }
  nativeTaskID(worldID) {
    const record = this.objects.objects.get(worldID);
    if (!record) throw new Error(`Native task ${worldID} is absent`);
    return record.nativeID;
  }
  resolveTaskID(nativeID, senderWorldID) {
    return this.engineMessages.resolve(senderWorldID, nativeID);
  }
  async sendNativeEngine(nativeID, senderWorldID, message, wParam = 0, lParam = 0, context = {}) {
    const reply = await this.engineMessages.dispatchNative(
      senderWorldID,
      nativeID,
      message,
      wParam,
      lParam,
      context,
    );
    context.nativeRouted = reply.routed;
    return reply.result;
  }
  registerNativeFeature(name, factory) {
    if (!name || typeof factory !== 'function' || this.nativeFeatureFactories.has(name))
      throw new Error(`Invalid or duplicate native process feature ${name}`);
    this.nativeFeatureFactories.set(name, factory);
  }
  ensureNativeEngine() {
    if (this.closed) throw new Error('Native world is closed');
    if (!this.nativeEngineLoading)
      this.nativeEngineLoading = NativeEngineProcess.open({
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
  getNativeGPU() {
    return this.stageRenderer?.gpu ?? this.host.nativeGPU?.(this);
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
  async sendEngine(id, sender, message, wParam = 0, lParam = 0, context = {}) {
    const reply = await this.engineMessages.dispatch(id, sender, message, wParam, lParam, context);
    context.nativeRouted = reply.routed;
    return reply.result;
  }
  imageLoaded(request) {
    this.host.imageLoaded?.(request);
  }
  applyFESLanguage(player) {
    const language = this.configuration.language;
    if (!language) return;
    const ui = language.entries[language.ui],
      main = language.entries[language.main];
    if (ui) player.language = ui.prefix;
    if (main) player.languageMain = main.prefix;
  }
  refreshTitle() {
    const title =
      this.nativeEngine?.kernel.windowViews.windows.get(this.window.handle)?.title ??
      this.globalStrings.get(this.configuration.getField('application.title'));
    this.host.nativeTitleChanged?.(title, this);
    return title;
  }
  markConfigurationDirty() {
    this.configurationDirty = true;
  }
  async flushConfiguration() {
    if (this.configurationFlush) await this.configurationFlush;
    const sound = this.soundConfiguration;
    if (!this.configurationDirty && !sound.dirty) return;
    const writes = [[this.preferencesName, serializeNativePreferences(this.configuration)]];
    if (sound.loaded && sound.filename)
      writes.push([sound.filename, serializeNativeSoundPreferences(sound)]);
    this.configurationDirty = false;
    sound.dirty = false;
    this.configurationFlush = (async () => {
      for (const [name, bytes] of writes)
        if (!(await this.storage.write(name, bytes)))
          throw new Error(`Native preference write failed: ${name}`);
    })()
      .catch((error) => {
        this.configurationDirty = true;
        throw error;
      })
      .finally(() => {
        this.configurationFlush = null;
      });
    await this.configurationFlush;
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
  }
  async processWindowMessages() {
    if (this.window.opened) {
      const exit = await runNativeWindowPump(this.nativeEngine, this.window.handle, {
        handles: (message, wParam) =>
          (message === NATIVE_APPLICATION_SERVICES_MESSAGE && this.startupScript !== undefined) ||
          this.window.handlesBrowserMessage(message, wParam),
        deliver: (message) => this.dispatchWindowMessage(message),
        stopping: () => this.disposalRequested || this.quitRequested,
      });
      if (exit !== null) this.quitRequested = true;
      return;
    }
    let processed = 0;
    while (this.windowMessages.length && !this.disposalRequested) {
      if (++processed > 10000) throw new Error('Native window message queue did not settle');
      await this.dispatchWindowMessage(this.windowMessages.shift());
    }
  }
  async dispatchWindowMessage(message) {
    if (
      message.message === NATIVE_APPLICATION_SERVICES_MESSAGE &&
      this.startupScript !== undefined
    ) {
      const name = this.startupScript;
      delete this.startupScript;
      await this.initializeApplicationServices(name);
      return;
    }
    if (await this.window.message(message)) return;
    if ([0x46e, 0x46f, 0x470].includes(message.message)) {
      const field = ['ui', 'main', 'sub'][message.message - 0x46e];
      await this.applyNativeLanguage(field, { reloadMainFirst: field === 'main' });
    } else if (message.message === 0x467 && !this.host.nativeWindowMessage)
      throw new Error('Native fullscreen/window mode service is unavailable');
    await this.host.nativeWindowMessage?.(message, this);
  }
  script(record) {
    return createNativeScriptTask(this, record);
  }
  fesHost(record) {
    const world = this;
    const hasChild = (owner) => owner.childTaskID != null || owner.kcsTaskID != null;
    return Object.assign(Object.create(this.host), {
      steam: world.steam,
      async initializeSteam() {
        const result = await world.steamService.initialize();
        this.steam = world.steam;
        return result;
      },
      nativeScriptReplace(text) {
        return new TextDecoder('shift_jis').decode(
          world.configuration.scriptReplacements.apply(encodeCP932(text)),
        );
      },
      nativeFESArgumentBytes(token) {
        const bank = record.context?.stringBank
            ? world.runtime.handles.get(record.context.stringBank, 'string-bank')
            : null,
          source = encodeCP932(token);
        return world.configuration.scriptReplacements.apply(
          bank ? bank.expandBytes(source) : source,
        );
      },
      nativeFESStringBytes(bytes) {
        const bank = record.context?.stringBank
          ? world.runtime.handles.get(record.context.stringBank, 'string-bank')
          : null;
        return bank ? bank.expandBytes(bytes) : bytes.slice();
      },
      nativeSteamBroadcast() {
        return world.window.broadcast();
      },
      nativeSaveCommand(verb, line, instance) {
        return world.saveSlots.command(instance, verb, line);
      },
      messageBox(message) {
        return world.window.action('fes-message-box', message);
      },
      postWindowMessage(message) {
        world.window.post(message.message, message.wParam, message.lParam);
      },
      soundConfigTokens(line) {
        return world.fesSoundConfiguration.tokens(line);
      },
      soundConfig(tokens, context) {
        return world.fesSoundConfiguration.get(tokens, context);
      },
      setSoundConfig(tokens, value, context) {
        return world.fesSoundConfiguration.set(tokens, value, context);
      },
      soundSelector(tokens, context, write) {
        return world.fesSoundConfiguration.selector(tokens, context, write);
      },
      nativeGlobalString(text) {
        return world.globalStrings.get(text);
      },
      config(name, ex1 = 0, ex2 = 0, context = {}) {
        return context.m2
          ? world.fesConfiguration.getM2(name, context.part)
          : world.fesConfiguration.get(name, ex1, ex2);
      },
      setConfig(name, value, ex1 = 0, ex2 = 0, context = {}) {
        return context.m2
          ? world.fesConfiguration.setM2(name, value, context.part)
          : world.fesConfiguration.set(name, value, ex1, ex2, context);
      },
      async startKCS(name, owner) {
        if (hasChild(owner)) {
          world.host.nativeDiagnostic?.({
            type: 'fes-child-active',
            task: record.id,
            request: name,
          });
          return null;
        }
        const task = await world.spawnScript(name, { parent: record.id, initialExecute: true });
        return task.id;
      },
      endKCS(id) {
        if (id != null) return world.objects.destroy(id, record.id);
      },
      async startFES(name, owner, parameters = []) {
        if (hasChild(owner)) {
          world.host.nativeDiagnostic?.({
            type: 'fes-child-active',
            task: record.id,
            request: name,
          });
          return null;
        }
        const id = await world.objects.create({
          kind: 34,
          parent: record.id,
          creator: record.id,
          name: 'FE Script',
        });
        const child = world.objects.objects.get(id),
          implementation = child.implementation;
        try {
          child.context = {
            variableBank: record.context.variableBank,
            stringBank: record.context.stringBank,
            contextName: record.context.contextName,
          };
          implementation.surface = record.implementation.surface;
          await implementation.load(name, { context: record.context });
          implementation.player.saveObject = record.implementation.player.saveObject;
          for (let i = 0; i < 16; i++) implementation.player.root.setLocal(i, parameters[i] | 0);
          await implementation.tick();
          return id;
        } catch (error) {
          await world.objects.release(id);
          throw error;
        }
      },
      endFES(id) {
        if (id != null) return world.objects.destroy(id, record.id);
      },
      childExitCode(id) {
        return id == null ? -1 : (world.objects.objects.get(id)?.exitCode ?? -1);
      },
      async send(values, instance, { target = 'parent' } = {}) {
        if (target !== 'parent' && target !== 'script')
          throw new Error(`Unknown FES message destination ${target}`);
        const id = target === 'script' ? instance.kcsTaskID : record.parent;
        if (id === null || id === undefined) return 0;
        const [code, a = 0, b = 0] = values;
        return (await world.runtime.scheduler.send(id, [record.id, code >>> 0, a >>> 0, b >>> 0]))
          .result;
      },
      openGallery(...args) {
        return world.galleries.open(...args);
      },
    });
  }
  fes(record) {
    return createNativeFESTask(this, record);
  }

  async initialize(name) {
    if (this.bootstrapOwner) {
      const engine = await this.ensureNativeEngine();
      engine.features
        .get('random-memory')
        .initialize({ fromClock: this.bootstrapOwner.seedFromClock });
      await readNativeStartupPreferences(
        engine,
        (name) => this.storage.readSaved?.(name),
        (detail) => this.host.nativeDiagnostic?.(detail),
      );
      // The game WinMain reads setup.xml before checking the EXE resources;
      // the SDK does its resource check before loading game defaults.
      if (this.profile === 'nekopara-vol3-engine-2.6.1.76' && engine.executableResources) {
        await loadNativeGameStartupLanguage(engine);
        await engine.executableResources.initialize();
      }
    }
    if (this.profile === 'nekopara-vol3-engine-2.6.1.76') await this.steamService.initialize();
    if (this.bootstrapOwner) {
      await checkNativeDirectXStartup(this.nativeEngine);
      await (await this.getNativeFeature('renderer')).initializeCapabilities();
      await initializeNativeStartupInstance(this.nativeEngine);
      await initializeNativeDesktop(this.nativeEngine);
      await initializeNativeWindowClass(this.nativeEngine);
      await initializeNativeStartupMenu(this.nativeEngine);
      await initializeNativeWindowOwner(this.nativeEngine);
      await createNativeStartupWindow(this.nativeEngine);
      await initializeNativeAccelerators(this.nativeEngine);
      await (await this.getNativeFeature('input-device')).pointer();
      await setNativeWindowCaption(this.nativeEngine);
      await initializeNativeApplicationWindow(this.nativeEngine);
      this.startupScript = name;
      try {
        await this.processWindowMessages();
        if (!this.main || this.quitRequested)
          throw new Error('Original application startup did not reach the Script entry');
      } finally {
        delete this.startupScript;
      }
      for (const { message, wParam, lParam } of this.windowMessages.splice(0))
        this.window.post(message, wParam, lParam);
    } else await this.initializeApplicationServices(name);
    await this.tick();
    return this.main;
  }
  async initializeApplicationServices(name) {
    if (this.bootstrapOwner)
      await readNativeStartupSoundConfiguration(
        this.nativeEngine,
        this.soundConfiguration,
        (name) => this.storage.readSaved?.(name),
        (detail) => this.host.nativeDiagnostic?.(detail),
      );
    this.graphics.initializeTextures();
    await this.globalStrings.initialize();
    this.refreshTitle();
    const m2Bootstrap = await inspectNativeM2Bootstrap(this.game, this.profile);
    if (m2Bootstrap?.required) await (await this.getNativeFeature('m2')).initialize();
    else if (m2Bootstrap) await (await this.getNativeFeature('graphics-platform')).ensureRenderer();
    this.root = await this.objects.create({
      kind: 1,
      name: 'BASE TASK',
      frameRate: this.configuration.screen.fps,
    });
    this.main = await this.spawnScript(name, { parent: this.root });
  }
  async spawnScript(name, { parent = this.root, context = {}, initialExecute = false } = {}) {
    const id = await this.objects.create({ kind: 12, parent, name });
    try {
      await this.objects.objects
        .get(id)
        .implementation.loadScript(name, { context, initialExecute });
      return this.runtime.scheduler.tasks.get(id);
    } catch (error) {
      await this.objects.release(id);
      throw error;
    }
  }
  async tick() {
    if (this.running) throw new Error('Native world frame must be serialized');
    this.clock.advance(this.configuration.screen.fps);
    let settle;
    this.frameSettled = new Promise((resolve) => {
      settle = resolve;
    });
    this.running = true;
    this.runtime.scheduler.running = true;
    this.frame++;
    this.runtime.scheduler.frame = this.frame;
    try {
      try {
        await this.processWindowMessages();
        if (this.quitRequested || this.disposalRequested) return;
        await this.movies.settle();
        await this.objects.tick(this.frame);
        await this.objects.drawTick(this.frame);
      } finally {
        this.runtime.scheduler.running = false;
        this.running = false;
      }
      await this.flushConfiguration();
    } finally {
      this.frameSettled = null;
      settle();
    }
  }
  snapshot() {
    if (this.running) throw new Error('Native world checkpoint requires a settled frame');
    if (this.quitRequested || this.disposalRequested) throw new Error('Native world is closing');
    const movies = this.movies.snapshot();
    return {
      frame: this.frame,
      clock: this.clock.snapshot(),
      root: this.root,
      main: this.main.id,
      menu: [...this.menu],
      windowMessages: structuredClone(this.windowMessages),
      configurationDirty: this.configurationDirty,
      runtime: this.runtime.snapshot(),
      graphics: this.graphics.snapshot(),
      sound: this.sound.snapshot(),
      particles: this.particles.snapshot(),
      objects: this.objects.snapshot(),
      configuration: this.configuration.snapshot(),
      soundConfiguration: this.soundConfiguration.snapshot(),
      fesSources: this.fesSources.snapshot(),
      nativeEngine: this.nativeEngine?.snapshot() ?? null,
      globalStrings: this.globalStrings.snapshot(),
      random: this.random.snapshot(),
      inputBindings: this.inputBindings?.snapshot() ?? null,
      resourceCache: this.resourceCache.snapshot(),
      movies,
    };
  }
  async restore(state) {
    if (this.running || this.objects.objects.size)
      throw new Error('Native world restore requires a fresh, idle world');
    if (this.profile === 'nekopara-vol3-engine-2.6.1.76') await this.steamService.initialize();
    if (!Number.isSafeInteger(state.frame) || state.frame < 0)
      throw new Error('Invalid native world checkpoint frame');
    this.clock.restore(state.clock);
    this.configuration.restore(state.configuration);
    this.globalStrings.restore(state.globalStrings);
    this.soundConfiguration.restore(state.soundConfiguration);
    this.random.restore(state.random);
    this.resourceCache.restore(state.resourceCache);
    if (state.inputBindings) {
      this.inputBindings ??= new NativeInputBindings(this.input, this.configuration);
      this.inputBindings.restore(state.inputBindings);
    }
    this.frame = state.frame;
    this.root = state.root;
    await this.runtime.restore(state.runtime);
    const bankSelections = new Map(
      [...this.runtime.handles.records]
        .filter(([, record]) => record.type === 'variable-bank')
        .map(([handle, record]) => [handle, record.value.selectedContext]),
    );
    await this.graphics.restore(state.graphics);
    this.fesSources.restore(state.fesSources);
    if (state.nativeEngine) {
      for (const [name] of state.nativeEngine.features) await this.getNativeFeature(name);
      const engine = await this.ensureNativeEngine();
      engine.restore(state.nativeEngine);
    }
    this.restoring = true;
    try {
      await this.objects.restore(state.objects);
    } finally {
      this.restoring = false;
    }
    // Restore the providers before exposing any VM to callers. Lazy binding on
    // its first native call would discard writes made to its checkpoint copy
    // after restore returned, and would temporarily split borrowed aliases.
    const taskMemory = this.nativeEngine?.features.get('task-memory');
    if (taskMemory)
      for (const task of this.runtime.scheduler.tasks.values())
        taskMemory.mapMachine(task.id, task.machine);
    for (const record of this.objects.objects.values())
      if (record.kind === 34 && record.implementation.player)
        await this.graphics.syncFES(record, record.implementation.player, { restoring: true });
    await this.sound.restore(state.sound);
    await this.movies.restore(state.movies);
    await this.particles.restore(state.particles);
    this.root = state.root;
    this.main = this.runtime.scheduler.tasks.get(state.main);
    if (!this.objects.objects.has(this.root) || !this.main)
      throw new Error('Native world checkpoint root/main is absent');
    this.frame = state.frame;
    this.menu = new Map(state.menu);
    this.windowMessages = structuredClone(state.windowMessages);
    this.configurationDirty = state.configurationDirty;
    for (const [handle, key] of bankSelections)
      this.runtime.handles.get(handle, 'variable-bank').selectedContext = key;
  }
  async close({ flushFiles = true } = {}) {
    if (this.closed) return;
    if (this.running) throw new Error('Native world close requires a settled frame');
    const errors = [],
      attempt = async (operation) => {
        try {
          await operation();
        } catch (error) {
          errors.push(error);
        }
      };
    for (const { id } of [...this.objects.objects.values()].filter(
      (record) => record.parent === null,
    ))
      await attempt(() => this.objects.release(id));
    for (const id of [...this.objects.objects.keys()])
      await attempt(() => this.objects.release(id));
    if (flushFiles) await attempt(() => this.flushConfiguration());
    await attempt(() => this.runtime.services.files.closeAll({ flush: flushFiles }));
    await attempt(() => this.particles.close());
    await attempt(() => this.movies.close());
    await attempt(() => this.graphics.cursor.close());
    await attempt(() => this.resourceCache.close());
    if (this.ownsSteam) await attempt(() => this.steamService.close());
    if (this.nativeEngineLoading)
      await attempt(async () => (await this.nativeEngineLoading).close());
    await attempt(() => this.graphics.texturePages?.close());
    await attempt(() => this.stageRenderer?.dispose());
    this.runtime.handles.records.clear();
    this.runtime.scheduler.tasks.clear();
    this.runtime.scheduler.events.length = 0;
    this.closed = true;
    if (errors.length) throw new AggregateError(errors, 'Native world cleanup failed');
  }
  async flush() {
    if (this.running) throw new Error('Native world flush requires a settled frame');
    await this.flushConfiguration();
    await this.runtime.services.files.flushAll();
  }
}
