// SPDX-License-Identifier: MPL-2.0
import { originalOwner, requireCheckpointRestoreOwner } from './original-adapter.mjs';
import { GameFiles, matchesArchiveRange, captureArchiveRange } from '../files.mjs';
import { findNativeFileEntries } from './file-search.mjs';
import { nativeVirtualFilePath } from './file-path.mjs';
import { StageRenderer } from '../render/stage.mjs';
import { nativeABI, nativeABIBehavior } from './abi/index.mjs';
import { installNativeConfigurationCommands } from './config.mjs';
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
import { installFESCoordinator } from './fes-coordinator.mjs';
import { installNativeImagePersistence } from './image-persistence.mjs';
import { NativeFESSourceArena } from './fes-source.mjs';
import { NATIVE_APPLICATION_SERVICES_MESSAGE } from './application-services-message.mjs';
import { installNativeMatrices } from './matrix.mjs';
import { installNativeText } from './text-task.mjs';
import { NativeGlobalStrings } from './global-strings.mjs';
import { NativeFESSoundConfiguration } from './fes-sound-config.mjs';
import { installNativeM2 } from './emote.mjs';
import { NativeResourceCache } from './resource-cache.mjs';
import { installNativeMovies } from './movie.mjs';
import { installNativeMotionPersistence } from './motion-persistence.mjs';
import { installNativeScriptReplacements } from './script-replacement.mjs';
import { installNativePlainText } from './text-plain.mjs';
import { installNativeUTF8 } from './utf8.mjs';
import { NativeWindow } from './window.mjs';
import { installNativeWindowCommands } from './window-commands.mjs';
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
import { nativeDataString } from './data-text.mjs';
import { installNativeScalarMath } from './scalar-math.mjs';
import { installNativeInputCommands } from './input-commands.mjs';
import {
  installNativeRegistry,
  snapshotNativeRegistry,
  restoreNativeRegistry,
  flushNativeRegistry,
  closeNativeRegistry,
} from './registry.mjs';
import { installNativeRectangles } from './rectangles.mjs';
import { installNativeImageFiles } from './image-file.mjs';
import { installNativeImageComposites } from './image-composite.mjs';
import { installNativeRenderSources } from './render-sources.mjs';
import { NativeSaveSlots } from './save-slots.mjs';
import { installNativeUnicodeOutput } from './unicode-output.mjs';
import { encodeCP932 } from '../kcs/strings.mjs';
import { encodeNativeCP932, decodeNativeCP932 } from './cp932.mjs';
import { NativeSystemClock } from './clock.mjs';
import { initializeNativeStartupInputs, initializeNativeStartupSound } from './startup-inputs.mjs';
import { NativeDispatchContext } from './dispatch-context.mjs';
import { createEffekseerTask } from '../effekseer/task.mjs';
import { binaryIdentity } from '../identity.mjs';
import { nativeModuleMetadata } from './profile.mjs';
import { nativeCategoryFilename, readNativeResource } from './resource-file.mjs';
import { EffekseerWorld, EFFEKSEER_FRAME_EXECUTOR } from '../effekseer/world.mjs';

const MAX_SOUND_PROBE_BYTES = 256 * 1024;

// The world owns the task graph. A KCS program is attached to a native script
// task rather than being run until a convenient UI request and discarded.
export class NativeWorld {
  #soundOpen = null;

  constructor({
    game,
    images,
    host,
    profile,
    nativeModule = null,
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
    startupDocument,
    transitionalExe = null,
    prepareSceneWorkers = true,
    sceneWorkers = null,
    installM2 = installNativeM2,
    particleRegistry,
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
      startupDocument,
      transitionalExe,
      prepareSceneWorkers,
      sceneWorkers,
    });
    this.calculations = { matrix: new Uint8Array(64) };
    if (nativeABI(profile).motion?.currentMatrixFallback)
      this.motionLibrary = motionLibrary.withCalculations(this.calculations);
    this.transitionalExe?.installWorldRuntime?.(this);
    this.dispatchContext = new NativeDispatchContext();
    this.nativeModule = nativeModuleMetadata(profile, nativeModule);
    this.effekseer = new EffekseerWorld({
      dispatch: this.dispatchContext,
      hasNativeProcess: () => originalOwner(this),
      resourceServices: () => ({
        resolveCategory: (name, category) => nativeCategoryFilename(this.game, name, category),
        readNative: (name, mode) => readNativeResource(this, name, mode),
        roundTripCP932: (name) => decodeNativeCP932(encodeNativeCP932(name)),
        identify: binaryIdentity,
        disposeTexture: (frame) => this.getNativeGPU?.()?.releaseTextureFrame(frame),
        onWarning: (detail) => this.host.nativeDiagnostic?.(detail),
      }),
    });
    this.stageRenderer = new StageRenderer();
    this.clock = new NativeSystemClock({
      now: host.nativeTimeGetTime ? () => host.nativeTimeGetTime() : null,
    });
    const readSource = (name) => (game.readNative ? game.readNative(name, 3) : game.read(name)),
      readResource = (name) => this.resourceCache.read(name);
    this.resourceCache = new NativeResourceCache({
      enabled: configuration.fields.general.cache,
      read: readSource,
      diagnostic: (detail) => host.nativeDiagnostic?.(detail),
    });
    this.game = Object.create(game);
    this.game.read = readResource;
    const ordinarySoundSource = () =>
      !this.transitionalExe &&
      this.game.read === readResource &&
      this.resourceCache.sourceRead === readSource &&
      game.readNative === GameFiles.prototype.readNative &&
      game.nativeCandidates === GameFiles.prototype.nativeCandidates;
    this.captureSoundRange = (name) => {
      const cache = this.resourceCache;
      if (
        !ordinarySoundSource() ||
        cache.pending ||
        cache.entries.some(({ filename }) => filename.toLowerCase() === name.toLowerCase())
      )
        return undefined;
      const candidate = game.nativeCandidates(name, 3).find((entry) => entry.hit);
      if (!candidate) return null;
      if (candidate.kind !== 'archive') return undefined;
      return captureArchiveRange(candidate.hit, game.nativeSearch) ?? undefined;
    };
    this.readPreparedSoundRange = (name, witness) => {
      if (!ordinarySoundSource()) return this.game.read(name);
      const cache = this.resourceCache;
      return cache.read(name, (path) => {
        if (!ordinarySoundSource() || this.resourceCache !== cache) return cache.sourceRead(path);
        return game.readNative(path, 3, ({ hit, kind }) =>
          kind === 'archive' && matchesArchiveRange(witness.range, hit, game.nativeSearch)
            ? witness.bytes
            : hit.file.read(hit.offset, hit.size),
        );
      });
    };
    this.canOpenSoundFile = async (name, owner) => {
      const cache = this.resourceCache,
        frame = this.frameSettled;
      if (
        !this.running ||
        !frame ||
        !ordinarySoundSource() ||
        this.runtime.scheduler.tasks.get(owner.id) !== owner
      )
        return Boolean(await this.game.read(name));
      // The content cache and native search still choose the effective source.
      const bytes = await cache.read(name, (path) => {
        if (
          this.frameSettled !== frame ||
          this.resourceCache !== cache ||
          this.runtime.scheduler.tasks.get(owner.id) !== owner ||
          !ordinarySoundSource()
        )
          return cache.sourceRead(path);
        return game.readNative(path, 3, ({ hit, kind }) => {
          if (kind !== 'archive') return hit.file.read(hit.offset, hit.size);
          const prepared =
            this.audio?.game === game
              ? this.sound.sceneVoicePreparation?.openedBytes(path, owner, hit)
              : null;
          return prepared ?? this.#readSoundRange(game, hit, frame, owner);
        });
      });
      return Boolean(bytes);
    };
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
      readArchive: (name, mode) => readNativeResource(this, name, mode),
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
    this.objects.markReleasedIdentity = (record) => {
      this.runtime.releaseTaskData(record.id);
      this.engineMessages.markReleased(record);
    };
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
    this.window = this.transitionalExe?.createWindow?.(this) ?? new NativeWindow(this);
    this.configurationDirty = false;
    this.preferencesName = 'setup.xml';
    this.configurationFlush = null;
    this.fesConfiguration = new NativeFESConfiguration({
      configuration,
      languages: () => configuration.language?.entries || [],
      isWindow: () => {
        const query = nativeABI(profile).fes.windowedCapability
          ? host.nativeWindowedAvailable
          : host.nativeIsWindow;
        if (typeof query !== 'function')
          throw new Error('Native window state service is unavailable');
        return Number(query.call(host, this));
      },
      emit: (event) => {
        const [type, value] = event,
          screenEvent = nativeABI(profile).messages.screenEvent;
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
    this.saveSlots = new NativeSaveSlots(this);
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
      library: this.motionLibrary,
    });
    this.runtime.services.world = this;
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
    if (nativeABI(this.profile).capabilities.effekseerTask)
      this.objects.register(61, (record, _objects, options) =>
        createEffekseerTask(this, record, options),
      );
    this.runtime.services.importImageFrame = (frame, owner) => {
      const images = this.graphics.images,
        handle = images.create(frame.width, frame.height, owner),
        bitmap = images.get(handle);
      for (const name of ['canvasWidth', 'canvasHeight', 'offsetX', 'offsetY', 'baseX', 'baseY'])
        bitmap.state[name] = frame[name] ?? 0;
      bitmap.state.rgba = new Uint8ClampedArray(frame.rgba);
      return handle;
    };
    this.runtime.services.view = this.graphics.view;
    installNativeImagePersistence(this);
    installNativeSound(this);
    installNativeMovies(this);
    installNativeMotionPersistence(this);
    installNativeScriptReplacements(this);
    installNativePlainText(this);
    installNativeUTF8(this);
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
    this.configurationRefresh = installNativeConfigurationCommands(this);
    installNativeScalarMath(this);
    installNativeInputCommands(this);
    installNativeRegistry(this);
    installNativeRectangles(this);
    installNativeImageFiles(this);
    installNativeImageComposites(this);
    installNativeRenderSources(this);
    installNativeUnicodeOutput(this);
    installNativeFormattedFileOutput(this);
    if (nativeABI(this.profile).capabilities.windowReturnTitle)
      this.runtime.register('main', 0x41e, (args) => {
        if (args.length) throw new Error('Native return-title window request expects no arguments');
        this.window.post(0x468);
        return nativeReply(2);
      });
    this.fesSound = new NativeFESSound(this, {
      onStart: (instance, object, frame) =>
        host.nativeFESSoundStarted?.(instance, object, frame, this),
    });
    installNativeParticles(this, { registry: particleRegistry });
    installNativeMatrices(this);
    installNativeText(this, { glyphs: host.nativeTextGlyphs?.() });
    installM2(this);
    installFESCoordinator(this);
    for (const [kind, factory] of Object.entries(factories))
      this.objects.register(Number(kind), factory);
    this.transitionalExe?.installWorldFeatures?.(this);
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
    input.services = (
      this.transitionalExe?.createInputBrowserServices ?? createNativeInputBrowserServices
    )(this, record, input);
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
      tick: (frame, context) => input.tick(frame, context),
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
  findNativeFiles(pattern) {
    // The platform directory/provider state is already JS-owned. Reading it
    // never constructs the transitional engine or executes a Win32 thunk.
    const context = {
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
    if (typeof provider !== 'function')
      throw new TypeError('Default font provider must be a synchronous byte reader');
    const bytes = provider.call(this.host, this);
    if (!(bytes instanceof Uint8Array))
      throw new TypeError('Default font provider must return synchronous CP932 bytes');
    return new Uint8Array(nativeDataString(bytes));
  }
  getNativeGPU() {
    return this.stageRenderer?.gpu ?? this.host.nativeGPU?.(this);
  }

  withExecutor(executor, operation) {
    return this.dispatchContext.run(executor, operation);
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
  applicationTitle() {
    const source = this.configuration.getField('application.title'),
      mode = nativeABIBehavior(this.profile, 'startup.titleMode');
    if (mode === 'raw') return source;
    if (mode === 'global-string') return this.globalStrings.get(source);
    throw new Error(`Unreviewed application title policy ${this.profile}`);
  }
  refreshTitle() {
    const title = this.applicationTitle();
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
      valid = index < language.entries.length;
    if (reloadMainFirst) {
      // Private message 46F reloads the option table before calling the
      // range-checked main-language handler, unlike the menu command.
      await this.globalStrings.reload(1, this.globalStrings.optionFilename());
    }
    if (field === 'sub') language.sub = valid ? index : 0xffffffff;
    else {
      if (!valid) return;
      await this.globalStrings.languageChanged(field);
      if (field === 'ui') {
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
    this.window.refreshLanguageMenu();
  }
  async processWindowMessages(context = {}) {
    if (this.closed || this.disposalRequested) {
      this.windowMessages.length = 0;
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
  async dispatchWindowMessage(message, context = {}) {
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
    await this.host.nativeWindowMessage?.(message, this, context);
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
      nativeFESScriptBytes(bytes) {
        return world.configuration.scriptReplacements.apply(bytes);
      },
      nativeFESArgumentBytes(token) {
        const bank = record.context?.stringBank
            ? world.runtime.handles.get(record.context.stringBank, 'string-bank')
            : null,
          source = token instanceof Uint8Array ? token : encodeCP932(token);
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
      fesTokens(line) {
        return world.fesSoundConfiguration.tokens(line);
      },
      fesMacroLiterals() {
        return {
          string: nativeABIBehavior(world.profile, 'fes.macroLiterals.string'),
          character: nativeABIBehavior(world.profile, 'fes.macroLiterals.character'),
        };
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
          : world.fesConfiguration.get(name, ex1, ex2, context);
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
        if (world.objects.objects.get(record.id) !== record)
          throw new Error('FES message source owner is no longer live');
        const [code, a = 0, b = 0] = values;
        return (
          await world.runtime.scheduler.send(id, [
            world.nativeTaskID(record.id),
            code >>> 0,
            a >>> 0,
            b >>> 0,
          ])
        ).result;
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
    await this.imageFiles.initialize();
    await initializeNativeStartupInputs(this);
    await this.initializeApplicationServices(name);
    await this.tick();
    return this.main;
  }
  async initializeSteamService() {
    if (nativeABIBehavior(this.profile, 'capabilities.steam')) await this.steamService.initialize();
  }
  async initializeApplicationServices(name) {
    for (const service of nativeABIBehavior(this.profile, 'startup.applicationServices')) {
      switch (service) {
        case 'steam-if-capable':
          await this.initializeSteamService();
          break;
        case 'startup-sound':
          await initializeNativeStartupSound(this);
          break;
        case 'textures':
          this.graphics.initializeTextures();
          break;
        case 'global-strings':
          await this.globalStrings.initialize();
          break;
        case 'title':
          this.refreshTitle();
          break;
        case 'm2':
          if (!this.m2) throw new Error(`Unreviewed M2 startup service ${this.profile}`);
          await this.m2.initialize();
          break;
        case 'root-script':
          this.root = await this.objects.create({
            kind: 1,
            name: 'BASE TASK',
            frameRate: this.configuration.screen.fps,
          });
          this.main = await this.spawnScript(name, { parent: this.root });
          break;
        default:
          throw new Error(`Unreviewed application startup service ${service}`);
      }
    }
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
  async #readSoundRange(game, hit, frame, owner) {
    const { file, offset, size } = hit,
      previous = this.#soundOpen,
      epoch = game.nativeSearch;
    if (
      previous?.frame === frame &&
      previous.owner === owner &&
      matchesArchiveRange(previous.range, hit, epoch)
    )
      return previous.bytes;
    const range = size <= MAX_SOUND_PROBE_BYTES ? captureArchiveRange(hit, epoch) : null,
      bytes = await file.read(offset, size);
    if (
      range &&
      bytes instanceof Uint8Array &&
      bytes.length === size &&
      frame === this.frameSettled &&
      matchesArchiveRange(range, hit, game.nativeSearch)
    )
      this.#soundOpen = { frame, owner, range, bytes };
    return bytes;
  }
  async tick() {
    if (this.running || this.frameSettled) throw new Error('Native world frame must be serialized');
    let settle;
    this.frameSettled = new Promise((resolve) => {
      settle = resolve;
    });
    try {
      return await this.withExecutor(this.effekseer.frameExecutor, (executorEntry) =>
        this.#tickFrame(executorEntry),
      );
    } finally {
      // frameSettled is the existing checkpoint/close safe point. Publish it
      // only after the frame executor entry has left, including on rejection.
      this.#soundOpen = null;
      this.frameSettled = null;
      settle();
    }
  }
  async #tickFrame(executorEntry) {
    if (this.dispatchContext.executorID(executorEntry) !== EFFEKSEER_FRAME_EXECUTOR)
      throw new Error('Native frame requires its explicit logical executor');
    const dispatch = { executorEntry };
    this.clock.advance(this.configuration.screen.fps);
    this.running = true;
    this.runtime.scheduler.running = true;
    this.frame++;
    this.runtime.scheduler.frame = this.frame;
    try {
      await this.processWindowMessages(dispatch);
      if (this.quitRequested || this.disposalRequested) return;
      await this.movies.settle();
      await this.objects.tick(this.frame, dispatch);
      await this.configurationRefresh.consume(dispatch);
      await this.objects.drawTick(this.frame, dispatch);
    } finally {
      this.runtime.scheduler.running = false;
      this.running = false;
    }
    await this.flushConfiguration();
  }
  snapshot(audioTime = this.audio?.context?.currentTime) {
    if (this.running || this.frameSettled)
      throw new Error('Native world checkpoint requires a settled frame');
    if (this.quitRequested || this.disposalRequested) throw new Error('Native world is closing');
    const movies = this.movies.snapshot();
    return {
      frame: this.frame,
      clock: this.clock.snapshot(),
      effekseer: this.effekseer.snapshot(),
      root: this.root,
      main: this.main.id,
      menu: [...this.menu],
      windowMessages: structuredClone(this.windowMessages),
      window: this.window.snapshot(),
      configurationDirty: this.configurationDirty,
      configurationRefresh: this.configurationRefresh.snapshot(),
      runtime: this.runtime.snapshot(),
      graphics: this.graphics.snapshot(),
      calculations: { matrix: this.calculations.matrix.slice() },
      tileGame: this.tileGame.snapshot(),
      sound: this.sound.snapshot(audioTime),
      particles: this.particles.snapshot(),
      text: this.text.snapshot(),
      m2: this.m2?.snapshot() ?? null,
      objects: this.objects.snapshot(),
      configuration: this.configuration.snapshot(),
      soundConfiguration: this.soundConfiguration.snapshot(),
      fesSources: this.fesSources.snapshot(),
      ...(this.transitionalExe?.snapshotWorld?.(this) ?? {}),
      platformRegistry: snapshotNativeRegistry(this),
      nativeModule: this.nativeModule && {
        name: this.nativeModule.name,
        resource: this.nativeModule.resource.slice(),
      },
      globalStrings: this.globalStrings.snapshot(),
      random: this.random.snapshot(),
      inputBindings: this.inputBindings?.snapshot() ?? null,
      resourceCache: this.resourceCache.snapshot(),
      imageFiles: this.imageFiles.snapshot(),
      movies,
    };
  }
  async restore(state) {
    if (this.running || this.objects.objects.size)
      throw new Error('Native world restore requires a fresh, idle world');
    const originalCheckpoint = requireCheckpointRestoreOwner(state, this.transitionalExe);
    this.window.restore(state.window);
    const module = nativeModuleMetadata(this.profile, state.nativeModule);
    if (
      this.nativeModule &&
      (!module ||
        this.nativeModule.name !== module.name ||
        this.nativeModule.resource.length !== module.resource.length ||
        this.nativeModule.resource.some((byte, i) => byte !== module.resource[i]))
    )
      throw new Error('Checkpoint main module differs from its selected source');
    if (module && typeof this.game.has === 'function' && !this.game.has(module.name))
      throw new Error('Checkpoint main module is not mounted');
    this.nativeModule = module;
    if (nativeABIBehavior(this.profile, 'startup.applicationServices').includes('steam-if-capable'))
      await this.initializeSteamService();
    if (!Number.isSafeInteger(state.frame) || state.frame < 0)
      throw new Error('Invalid native world checkpoint frame');
    this.clock.restore(state.clock);
    this.calculations.matrix.set(state.calculations.matrix);
    this.tileGame.restore(state.tileGame);
    this.configuration.restore(state.configuration);
    this.configurationRefresh.restore(state.configurationRefresh);
    await this.text.restore(state.text);
    this.globalStrings.restore(state.globalStrings);
    this.soundConfiguration.restore(state.soundConfiguration);
    this.random.restore(state.random);
    this.resourceCache.restore(state.resourceCache);
    this.imageFiles.restore(state.imageFiles);
    if (state.inputBindings) {
      this.inputBindings ??= new NativeInputBindings(this.input, this.configuration);
      this.inputBindings.restore(state.inputBindings);
    }
    this.frame = state.frame;
    this.root = state.root;
    await restoreNativeRegistry(this, state.platformRegistry);
    await this.runtime.restore(
      state.runtime,
      new Map(state.objects.objects.map((record) => [record.id, record])),
    );
    const bankSelections = new Map(
      [...this.runtime.handles.records]
        .filter(([, record]) => record.type === 'variable-bank')
        .map(([handle, record]) => [handle, record.value.selectedContext]),
    );
    await this.graphics.restore(state.graphics, {
      restoreContext: !originalCheckpoint,
    });
    this.fesSources.restore(state.fesSources);
    await this.transitionalExe?.restoreWorld?.(this, state);
    await this.effekseer.restore(state.effekseer);
    if (state.m2) await this.m2.restore(state.m2);
    this.restoring = true;
    try {
      await this.objects.restore(state.objects);
      this.effekseer.validateReferences();
    } finally {
      this.restoring = false;
    }
    for (const task of this.graphics.tasks.values()) task.sync?.();
    // Restore the providers before exposing any VM to callers. Lazy binding on
    // its first native call would discard writes made to its checkpoint copy
    // after restore returned, and would temporarily split borrowed aliases.
    this.transitionalExe?.bindWorldMachines?.(this);
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
    this.graphics.synchronizeView();
    for (const [handle, key] of bankSelections)
      this.runtime.handles.get(handle, 'variable-bank').selectedContext = key;
  }
  async close({ flushFiles = true } = {}) {
    if (this.closed) return;
    if (this.running || this.frameSettled)
      throw new Error('Native world close requires a settled frame');
    this.dispatchContext.assertSettled();
    this.effekseer.assertSettled();
    this.disposalRequested = true;
    this.graphics.images.scenePreparation.discard();
    this.sound?.sceneVoicePreparation?.discard();
    this.windowMessages.length = 0;
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
    await attempt(() => this.text.close());
    if (flushFiles) await attempt(() => this.flushConfiguration());
    await attempt(() => this.runtime.services.files.closeAll({ flush: flushFiles }));
    await attempt(() => closeNativeRegistry(this));
    await attempt(() => this.m2?.close({ flushFiles }));
    await attempt(() => this.particles.close());
    await attempt(() => this.movies.close());
    await attempt(() => this.graphics.cursor.close());
    await attempt(() => this.screenEffects.close());
    await attempt(() => this.resourceCache.close());
    this.imageFiles.close();
    if (this.ownsSteam) await attempt(() => this.steamService.close());
    await attempt(() => this.transitionalExe?.closeWorld?.(this));
    await attempt(() => this.graphics.texturePages?.close());
    await attempt(() => this.stageRenderer?.dispose());
    await attempt(() => this.effekseer.close());
    await attempt(() => this.dispatchContext.close());
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
    await flushNativeRegistry(this);
  }
}
