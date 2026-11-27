// SPDX-License-Identifier: MPL-2.0
import { originalFeature } from './original-adapter.mjs';
import { FESPlayer } from '../fes/player.mjs';
import { fesPreloadLine } from '../fes/program.mjs';
import { fesNarrowText, fesByteView } from '../fes/tokens.mjs';
import { FESCoordinator } from './fes-coordinator.mjs';
import { FESImageCache } from './fes-image-cache.mjs';
import { FESInput } from './fes-input.mjs';
import { NATIVE_UNWRITTEN_WORD, nativeEngineWord } from './engine-message.mjs';
import { encodeCP932 } from '../kcs/strings.mjs';
import { NativeDictionary } from './dictionary.mjs';
import { nativeABI } from './abi/index.mjs';

// KCSMachine.bytes is the sender's existing mapped byte service. Keep the
// current KCS string safety budget, without decoding a label's identity.
function labelBytes(memory, address) {
  const result = [];
  for (let index = 0; index < 1024 * 1024; index++) {
    const value = memory.bytes((address + index) >>> 0, 1);
    if (!(value instanceof Uint8Array) || value.length !== 1)
      throw new TypeError('FES labels require byte-addressable sender memory');
    if (!value[0]) return Uint8Array.from(result);
    result.push(value[0]);
  }
  throw new Error('FES unterminated label');
}

export function createNativeFESTask(world, record) {
  const implementation = world.base(record);
  const input = new FESInput(record, world),
    imageCacheModel = new FESImageCache(world, record.id),
    baseMessage = implementation.message;
  Object.assign(implementation, {
    input,
    player: null,
    childTasks: { kcsTaskID: null, childTaskID: null },
    pendingPlayer: null,
    retainedPlayers: new Map(),
    nextCoreGeneration: 1,
    runEnabled: false,
    surface: null,
    soundTaskID: null,
    sleepValue: 0,
    stringsInherited: false,
    validatedVariableBankHandle: 0,
    nativeDictionary: null,
    resultValue: 0,
    imageCacheModel,
    cacheImage(name, pointer) {
      imageCacheModel.insert(name, pointer);
    },
    imageData(name) {
      return imageCacheModel.data(name);
    },
    loadImage(name, selector) {
      return imageCacheModel.load(name, selector);
    },
    configurePlayer(player = this.player) {
      player.motionLibrary = world.motionLibrary;
      player.nativeSources = world.fesSources;
      player.nativeOwner = record.id;
      player.runtimeFactory = (instance) => {
        // Native execkcs/execfes slots belong to the task, not its replaceable
        // Core. All callers, including send/end/exit-code, use the same slots.
        for (const key of ['kcsTaskID', 'childTaskID'])
          Object.defineProperty(instance, key, {
            enumerable: true,
            get: () => this.childTasks[key],
            set: (id) => {
              this.childTasks[key] = id;
            },
          });
        return new FESCoordinator(world, instance, imageCacheModel);
      };
      player.nativeSound = world.fesSound;
      player.nativeSoundTaskID = this.soundTaskID;
      player.nativeImages = world.imagesFES;
      player.nativeControls = world.controlsFES;
      player.nativeText = world.text.fes;
      player.nativeLog = world.text.log;
      player.nativeInput = input;
      player.nativeInitialObject = (entry) => {
        const source =
          entry.initialCore === player.nativeCoreGeneration
            ? player
            : this.retainedPlayers.get(entry.initialCore);
        const instance = source?.root,
          object = instance?.collection.graph.get(entry.initialHandle);
        if (!instance) throw new Error('FES initial BUTTON has no live Core owner');
        return { instance, object };
      };
      player.nativeReleaseInitial = (entry) => this.releaseInitialOwner(entry);
      this.bindVariableContext(player);
    },
    variableContextKey() {
      return (record.context.fesVariableContextKey ??= `fes:${record.id}`);
    },
    variableBank() {
      const handle = record.context.variableBank;
      return handle ? world.runtime.handles.get(handle, 'variable-bank') : null;
    },
    privateContext() {
      const bank = this.variableBank();
      bank?.selectContext(this.variableContextKey());
      return bank?.context(this.variableContextKey()) ?? null;
    },
    bindVariableContext(player = this.player) {
      const key = player.nativeVariableContextKey,
        handle = player.nativeVariableBankHandle,
        variableBank = () => (handle ? world.runtime.handles.get(handle, 'variable-bank') : null);
      player.nativeVariableContext = (instance) => {
        instance.nativeVariableContextKey ??= key;
        const bank = variableBank();
        bank?.selectContext(instance.nativeVariableContextKey);
        return bank?.context(instance.nativeVariableContextKey) ?? null;
      };
      if (nativeABI(world.profile).fes.localAccessUsesNativeTypes)
        player.nativeNamedVariable = (instance, name, index) => {
          const bytes = typeof name === 'string' ? encodeCP932(name) : name,
            bank = variableBank();
          if (bytes.length > 32 || !bank?.selectContext(instance.nativeVariableContextKey ?? key))
            return undefined;
          return bank.findName(bytes, index);
        };
    },
    async initialize(variableBank) {
      const runtime = world.runtime;
      if (this.player?.root) {
        if (this.pendingPlayer) throw new Error('FES task already has a pending Core handoff');
        this.pendingPlayer = this.player;
        this.player.nativeCoreReplaced = true;
        this.player.root.runtime.platform.closed = true;
      }
      record.context.variableBank = variableBank;
      if (this.nextCoreGeneration === Number.MAX_SAFE_INTEGER)
        throw new RangeError('FES Core identity space is exhausted');
      const generation = this.nextCoreGeneration++;
      record.context.fesVariableContextKey =
        generation === 1 ? `fes:${record.id}` : `fes:${record.id}:${generation}`;
      if (!this.stringsInherited) {
        if (record.parent !== null)
          await world.sendEngine(record.parent, record.id, 177, 0, 0, {
            payload: {
              store: (_at, handle) => {
                if (handle) record.context.stringBank = handle;
              },
            },
          });
        this.stringsInherited = true;
      }
      this.player = new FESPlayer(
        world.game,
        world.images,
        world.fesHost(record),
        runtime.bankView(record.context.variableBank),
        runtime.bankView(record.context.stringBank, 'string-bank'),
      );
      Object.assign(this.player, {
        nativeCoreGeneration: generation,
        nativeVariableBankHandle: variableBank,
        nativeVariableContextKey: this.variableContextKey(),
      });
      this.soundTaskID = nativeEngineWord(
        await world.sendNativeEngine(0, record.id, world.engineMessages.layout.rootStart + 3),
        'FES initialization sound-task query',
      );
      this.configurePlayer();
      const bank = this.variableBank();
      bank?.registerContext(this.variableContextKey());
      this.validatedVariableBankHandle = bank ? variableBank : 0;
      this.bindVariableContext();
      world.applyFESLanguage(this.player);
      this.player.saveObject = 0;
      this.nativeDictionary = new NativeDictionary();
      this.resultValue = 0;
      record.exitCode = -1;
      record.context.contextName = '';
      if (record.parent !== null)
        await world.sendEngine(record.parent, record.id, 25, 0, 0, {
          payload: {
            writeString: (text) => {
              record.context.contextName = text;
            },
          },
        });
    },
    async load(name, sender) {
      const bank = world.runtime.variableBank(sender, false);
      await this.initialize(bank?.words ? sender.context.variableBank : 0);
      const loaded = await this.loadSource(name);
      // The host convenience loader schedules ordinary advancement. The SDK
      // wrappers use initialize/loadSource and explicitly start with Main448.
      if (loaded) this.runEnabled = true;
      return loaded;
    },
    async loadSource(name) {
      if (!this.player)
        throw new Error('Native FES source loading requires message 331 initialization');
      // A failed file callback reaches the FES task as message 332.
      // The task records -2 for empty and missing files.
      const resolved = world.game.resolveCategory
        ? world.game.resolveCategory(name, 'fes')
        : /\.fes$/i.test(name)
          ? name
          : `${name}.fes`;
      if (resolved === null || !world.game.has(resolved)) {
        record.exitCode = -2;
        return false;
      }
      await this.player.start(name);
      if (this.pendingPlayer) {
        const previous = this.pendingPlayer;
        previous.root.runtime.transferResourcesTo(this.player.root.runtime);
        this.pendingPlayer = null;
        if (
          this.player.root.runtime.resources.entries.some(
            (entry) => entry.savedType === 6 && entry.initialCore === previous.nativeCoreGeneration,
          )
        )
          this.retainedPlayers.set(previous.nativeCoreGeneration, previous);
        else await this.reclaimPlayer(previous);
      }
      this.player.root.nativeDictionary = this.nativeDictionary;
      this.player.root.runtimeID = record.id;
      this.player.root.variableBank = record.context.variableBank;
      const bank = record.context.stringBank
        ? world.runtime.handles.get(record.context.stringBank, 'string-bank')
        : null;
      for (let index = 0; ; index++) {
        const bytes = fesPreloadLine(
          this.player.root.program.preload,
          index,
          bank ? (line) => bank.expandBytes(line) : undefined,
        );
        if (bytes === null) break;
        await imageCacheModel.preload(fesNarrowText(bytes));
      }
      record.exitCode = -1;
      if (this.surface !== null) world.graphics.bindFES(this.surface, this.player, record.id);
      await world.graphics.initializeFES(record, this.player);
      world.host.nativeFESLoaded?.(record, this.player, world);
      return true;
    },
    async tick(frameWord = record.effectiveFrame, context = {}) {
      const player = this.player,
        live = () =>
          this.player === player && record.state !== 'releasing' && !player?.root?.runtime?.closed;
      if (!this.runEnabled || this.sleepValue || !player?.root || !live()) return;
      this.variableBank()?.selectContext(this.variableContextKey());
      await input.tick();
      if (!live()) return;
      await player.step(frameWord, context);
      if (!live()) return;
      await this.syncObjects(context);
      if (live() && player.root.finished !== null) record.exitCode = player.root.finished;
    },
    async syncObjects(context = {}) {
      await world.graphics.syncFES(record, this.player, { executorEntry: context.executorEntry });
      await input.sync();
    },
    async reclaimPlayer(player) {
      for (const instance of player.instances) await instance.runtime.close({ metadataOnly: true });
      this.unregisterPlayerContext(player);
    },
    unregisterPlayerContext(player) {
      const handle = player.nativeVariableBankHandle;
      if (handle && world.runtime.handles.records.has(handle))
        world.runtime.handles
          .get(handle, 'variable-bank')
          .unregisterContext(player.nativeVariableContextKey);
    },
    async releaseInitialOwner(removed) {
      const generation = removed.initialCore,
        player = this.retainedPlayers.get(generation);
      if (!player) return;
      const entries =
        (this.player?.root ?? this.pendingPlayer?.root)?.runtime.resources.entries ?? [];
      if (
        entries.some(
          (entry) => entry !== removed && entry.savedType === 6 && entry.initialCore === generation,
        )
      )
        return;
      this.retainedPlayers.delete(generation);
      await this.reclaimPlayer(player);
    },
    snapshotCore(player) {
      return player
        ? {
            generation: player.nativeCoreGeneration,
            bank: player.nativeVariableBankHandle,
            key: player.nativeVariableContextKey,
            surface: player.surface ?? null,
            drawBinding: player.nativeDraw ?? null,
            player: player.snapshot(),
          }
        : null;
    },
    snapshot() {
      return {
        player: this.player?.snapshot() ?? null,
        coreGeneration: this.player?.nativeCoreGeneration ?? null,
        nextCoreGeneration: this.nextCoreGeneration,
        pendingCore: this.snapshotCore(this.pendingPlayer),
        retainedCores: [...this.retainedPlayers.values()].map((player) =>
          this.snapshotCore(player),
        ),
        childTasks: { ...this.childTasks },
        runEnabled: this.runEnabled,
        input: input.snapshot(),
        surface: this.surface,
        drawBinding: this.player?.nativeDraw ?? null,
        soundTaskID: this.soundTaskID,
        sleepValue: this.sleepValue,
        stringsInherited: this.stringsInherited,
        saveObject: this.player?.saveObject,
        nativeDictionary: this.player?.root ? null : (this.nativeDictionary?.snapshot() ?? null),
        resultValue: this.player?.root?.resultValue ?? this.resultValue,
        imageCache: imageCacheModel.snapshot(),
      };
    },
    async restore(state) {
      if (
        !Number.isSafeInteger(state.nextCoreGeneration) ||
        state.nextCoreGeneration < 1 ||
        !Array.isArray(state.retainedCores)
      )
        throw new Error('Invalid FES Core ownership checkpoint');
      this.nextCoreGeneration = state.nextCoreGeneration;
      for (const key of ['kcsTaskID', 'childTaskID']) {
        const id = state.childTasks?.[key];
        if (id !== null && (!Number.isSafeInteger(id) || id < 0))
          throw new Error('Invalid FES task child slot');
        if (state.player?.root && state.player.root[key] !== id)
          throw new Error('FES Core and task child slots disagree');
        this.childTasks[key] = id;
      }
      if (typeof state.runEnabled !== 'boolean') throw new Error('Invalid FES running gate');
      this.runEnabled = state.runEnabled;
      this.surface = state.surface;
      this.soundTaskID = state.soundTaskID;
      this.sleepValue = state.sleepValue;
      this.stringsInherited = state.stringsInherited;
      imageCacheModel.entries = new Map(state.imageCache);
      input.restore(state.input);
      const generations = new Set(),
        restoreCore = async (saved) => {
          if (
            !saved ||
            !Number.isSafeInteger(saved.generation) ||
            saved.generation < 1 ||
            saved.generation >= this.nextCoreGeneration ||
            generations.has(saved.generation) ||
            saved.key !==
              (saved.generation === 1
                ? `fes:${record.id}`
                : `fes:${record.id}:${saved.generation}`) ||
            !Number.isInteger(saved.bank) ||
            saved.bank < 0
          )
            throw new Error('Invalid FES Core ownership record');
          for (const key of ['kcsTaskID', 'childTaskID'])
            if (saved.player?.root && saved.player.root[key] !== state.childTasks[key])
              throw new Error('FES retained Core and task child slots disagree');
          generations.add(saved.generation);
          const player = new FESPlayer(
            world.game,
            world.images,
            world.fesHost(record),
            world.runtime.bankView(saved.bank),
            world.runtime.bankView(record.context.stringBank, 'string-bank'),
          );
          Object.assign(player, {
            nativeCoreGeneration: saved.generation,
            nativeVariableBankHandle: saved.bank,
            nativeVariableContextKey: saved.key,
            surface: saved.surface ?? this.surface,
            nativeDraw: saved.drawBinding ?? null,
          });
          this.configurePlayer(player);
          await player.restore(saved.player);
          return player;
        };
      for (const saved of state.retainedCores) {
        const player = await restoreCore(saved);
        if (
          !player.root ||
          player.root.runtime.resources.entries.length ||
          player.root.runtime.ownedTaskIDs.size
        )
          throw new Error('Retained FES Core must only own borrowed semantic objects');
        player.root.runtime.platform.closed = true;
        player.nativeCoreReplaced = true;
        this.retainedPlayers.set(saved.generation, player);
      }
      if (state.pendingCore !== null) {
        this.pendingPlayer = await restoreCore(state.pendingCore);
        if (!this.pendingPlayer.root)
          throw new Error('Pending FES Core requires its resource owner');
        this.pendingPlayer.root.runtime.platform.closed = true;
        this.pendingPlayer.nativeCoreReplaced = true;
      }
      if (!state.player) {
        if (state.coreGeneration !== null || this.pendingPlayer || this.retainedPlayers.size)
          throw new Error('FES task resources require an initialized Core');
        return;
      }
      if (state.coreGeneration !== this.nextCoreGeneration - 1)
        throw new Error('FES active Core is not the current generation');
      this.validatedVariableBankHandle = this.variableBank() ? record.context.variableBank : 0;
      this.player = await restoreCore({
        generation: state.coreGeneration,
        bank: record.context.variableBank ?? 0,
        key: this.variableContextKey(),
        player: state.player,
      });
      const resources = (this.player.root ?? this.pendingPlayer?.root)?.runtime.resources;
      for (const entry of resources?.entries ?? [])
        if (
          entry.savedType === 6 &&
          entry.initialHandle !== 0 &&
          entry.initialCore !==
            (this.player.root ? this.player : this.pendingPlayer).nativeCoreGeneration &&
          !this.retainedPlayers.has(entry.initialCore)
        )
          throw new Error('FES resource has no initial Core owner');
      for (const [generation, player] of this.retainedPlayers) {
        const entries =
          resources?.entries.filter(
            (entry) => entry.savedType === 6 && entry.initialCore === generation,
          ) ?? [];
        if (!entries.length) throw new Error('Retained FES Core has no live resource borrower');
        for (const entry of entries) {
          const object = player.root.collection.graph.get(entry.initialHandle);
          if (object && object.nativeType !== 6)
            throw new Error('FES initial borrower has no BUTTON owner');
          player.root.runtime.images.validateEntry(player.root, object, entry);
        }
      }
      this.nativeDictionary =
        this.player.root?.nativeDictionary ||
        (state.nativeDictionary === null
          ? new NativeDictionary()
          : new NativeDictionary().restore(state.nativeDictionary));
      this.resultValue = state.resultValue;
      this.player.saveObject = state.saveObject;
      if (this.player.root) {
        this.player.root.runtimeID = record.id;
        this.player.root.variableBank = record.context.variableBank;
        this.player.root.resultValue = this.resultValue;
      }
      this.player.nativeInput = input;
      this.player.nativeDraw = state.drawBinding ?? null;
      if (world.graphics.drawTasks.get(this.surface)?.state.renderer)
        world.graphics.bindFES(this.surface, this.player, record.id);
      if (!world.restoring) await world.graphics.syncFES(record, this.player);
      world.host.nativeFESLoaded?.(record, this.player, world);
    },
    async closeInterpreter() {
      // Unregister the private variable context before object storage
      // and the FES image cache are released.
      // The supplying Script may already have released this validated bank
      // during final platform disposal. Ordinary VM access remains strict.
      const handle = record.context.variableBank,
        releasedDuringDisposal =
          world.disposalRequested &&
          handle &&
          handle === this.validatedVariableBankHandle &&
          !world.runtime.handles.records.has(handle);
      if (!releasedDuringDisposal)
        this.variableBank()?.unregisterContext(this.variableContextKey());
      for (const key of ['kcsTaskID', 'childTaskID']) {
        const id = this.childTasks[key];
        if (id != null && world.objects.objects.has(id)) await world.objects.release(id);
        this.childTasks[key] = null;
      }
      world.host.nativeFESClosed?.(record, world);
      await world.graphics.closeFES(record, this.player);
      if (this.pendingPlayer) {
        await world.graphics.closeFES(record, this.pendingPlayer);
        this.unregisterPlayerContext(this.pendingPlayer);
        this.pendingPlayer = null;
      }
      for (const player of this.retainedPlayers.values()) await this.reclaimPlayer(player);
      this.retainedPlayers.clear();
      await input.close();
      this.player = null;
    },
    async close() {
      await this.closeInterpreter();
      imageCacheModel.close();
    },
    async message(words, context = {}) {
      const [, message, wParam, lParam] = words;
      if (message === 3 && this.player) {
        this.privateContext();
        this.variableBank()?.setName('_EXITCODE_', 0, -1);
        for (const instance of this.player.instances)
          for (const object of instance.objects)
            if ([9, 10].includes(object.nativeType))
              await world.fesSound.destructionRequested(instance, object);
        return baseMessage(words, context);
      }
      if ([27, 28].includes(message)) {
        this.privateContext();
        await world.controlsFES.message(record, this.player, words, context);
        return NATIVE_UNWRITTEN_WORD;
      }
      if (message === 19) {
        if (!this.player?.root)
          throw new Error('Native FES configuration notification requires a loaded interpreter');
        const player = this.player,
          instance = player.root,
          stages = nativeABI(world.profile).fes.configurationMessage,
          live = () =>
            this.player === player &&
            record.state !== 'releasing' &&
            !instance.runtime.closed &&
            world.objects.objects.get(record.id) === record;
        if (!live()) return NATIVE_UNWRITTEN_WORD;
        if (stages.liveObjects) instance.runtime.configurationWillChange();
        if (stages.notification) {
          try {
            await player.notify(stages.notification);
          } catch (error) {
            if (live()) throw error;
          }
        }
        if (!live()) return NATIVE_UNWRITTEN_WORD;
        await instance.runtime.configurationChanged();
        return NATIVE_UNWRITTEN_WORD;
      }
      if (message === 176 || message === 177) {
        if (message === 176 || lParam || context.payload)
          world.engineMessages
            .memory(words[0], context)
            .store(lParam, record.context[message === 176 ? 'variableBank' : 'stringBank'] || 0);
        return NATIVE_UNWRITTEN_WORD;
      }
      if ([9, 10, 64, 65, 337].includes(message))
        this.variableBank()?.selectContext(this.variableContextKey());
      if ([9, 10, 64, 65].includes(message)) return input.message(words, context);
      if (message === 331) {
        await this.initialize(lParam);
        return NATIVE_UNWRITTEN_WORD;
      }
      if (message === 332) {
        const memory = world.engineMessages.memory(words[0], context);
        await this.loadSource(memory.string(lParam));
        return NATIVE_UNWRITTEN_WORD;
      }
      if (message === 25 || message === 26) {
        if (lParam || context.payload) {
          const memory =
            context.payload ||
            context.machine ||
            world.objects.machine(context.nativeSenderWorldID ?? words[0]);
          if (!memory) throw new Error('FES context message requires sender memory');
          if (message === 25) memory.writeString(record.context.contextName || '', lParam);
          else record.context.contextName = memory.string(lParam);
        }
        return NATIVE_UNWRITTEN_WORD;
      }
      if (message === 333) {
        this.runEnabled = true;
        await this.tick(record.effectiveFrame, context);
        return NATIVE_UNWRITTEN_WORD;
      }
      if (message === 334) {
        const surface = world.resolveTaskID(lParam, context.nativeSenderWorldID ?? record.id);
        world.graphics.bindFES(surface, this.player, record.id);
        this.surface = surface;
        return NATIVE_UNWRITTEN_WORD;
      }
      if (message === 335) {
        if (!this.player) throw new Error('FES jump requires a loaded interpreter');
        const memory =
          context.payload ||
          context.machine ||
          world.objects.machine(context.nativeSenderWorldID ?? words[0]);
        if (!memory) throw new Error('FES jump requires sender memory');
        const label = fesByteView(labelBytes(memory, lParam)),
          root = this.player.root;
        if (!root.program.blocks[label]) return 0;
        root.label = label;
        root.suspended = null;
        return 1;
      }
      if (message === 336) {
        if (!this.player)
          throw new Error('Native FES save-object binding requires its interpreter');
        this.player.saveObject = lParam;
        return NATIVE_UNWRITTEN_WORD;
      }
      if (message === 337) {
        if (!this.player) throw new Error('FES notification requires a loaded interpreter');
        const player = this.player,
          root = player.root,
          live = () =>
            this.player === player &&
            player.root === root &&
            !root?.runtime?.closed &&
            record.state !== 'releasing' &&
            world.objects.objects.get(record.id) === record;
        const memory =
          context.payload ||
          context.machine ||
          world.objects.machine(context.nativeSenderWorldID ?? words[0]);
        if (!memory) throw new Error('FES notification requires sender memory');
        const name = wParam ? labelBytes(memory, wParam) : null,
          index = name === null ? 0 : memory.load(wParam + 32) | 0;
        await player.notify(labelBytes(memory, lParam), name, index);
        if (!live()) return NATIVE_UNWRITTEN_WORD;
        // A successful native notification also completes its trailing MOT phase.
        root?.runtime?.afterStep();
        if (!input.state.sleeping) {
          await world.graphics.syncFES(record, player, {
            resourcesOnly: true,
            executorEntry: context.executorEntry,
          });
          if (!live()) return NATIVE_UNWRITTEN_WORD;
          await input.sync();
          if (!live()) return NATIVE_UNWRITTEN_WORD;
          await world.graphics.flushFESRedraw(root);
        }
        return NATIVE_UNWRITTEN_WORD;
      }
      if (message === 338 || message === 339) {
        if (!this.player)
          throw new Error('FES object initialization requires a loaded interpreter');
        const memory =
          context.payload ||
          context.machine ||
          world.objects.machine(context.nativeSenderWorldID ?? words[0]);
        if (!memory) throw new Error('FES object initialization requires sender memory');
        if (message === 338) {
          const count = memory.load(wParam + 32) | 0;
          this.player.root.createObjects(lParam, labelBytes(memory, wParam), count);
        } else await this.player.root.applyObjects(memory.string(wParam), memory.string(lParam));
        return NATIVE_UNWRITTEN_WORD;
      }
      if (message === 340) {
        if (!this.player) throw new Error('Native FES local assignment requires its interpreter');
        const words = this.privateContext()?.words;
        if (words && wParam >>> 0 <= 511) words[wParam >>> 0] = lParam >>> 0;
        return NATIVE_UNWRITTEN_WORD;
      }
      if (message === 341) {
        if (!this.player) throw new Error('Native FES local query requires its loaded interpreter');
        return this.privateContext()?.words[wParam >>> 0] ?? 0;
      }
      if (message === 342) {
        if (this.sleepValue !== lParam) {
          this.sleepValue = lParam;
          await world.graphics.setFESSleep(record, this.player, lParam, context);
        }
        context.nativeUnhandled = true;
        return NATIVE_UNWRITTEN_WORD;
      }
      if (message === 343 || message === 344) {
        const root = this.player?.root;
        if (!this.player) return 0;
        if (message === 343 && !lParam) return 2048;
        if (message === 343 && wParam >>> 0 < 2048) return 0;
        const memory =
          context.payload ||
          context.machine ||
          world.objects.machine(context.nativeSenderWorldID ?? words[0]);
        if (!memory || typeof memory.bytes !== 'function')
          throw new Error('FES local-bank transfer requires sender byte memory');
        // Bulk transfers use the bank's currently selected context. Scalar accesses
        // select the interpreter context explicitly.
        const words = this.variableBank()?.privateWords;
        if (!words && (message === 343 || wParam >>> 0))
          throw new Error('Native FES bulk local transfer dereferences an absent private context');
        if (message === 343) {
          memory.bytes(lParam, 2048).set(new Uint8Array(words.buffer));
          return 2048;
        }
        const size = Math.min(wParam >>> 0, 2048);
        if (size) new Uint8Array(words.buffer).set(memory.bytes(lParam, size));
        if (size && root?.program.blocks._LOAD_) {
          root.label = '_LOAD_';
          root.suspended = null;
        }
        return NATIVE_UNWRITTEN_WORD;
      }
      if (message === 345) {
        if (this.player) {
          const memory = world.engineMessages.memory(words[0], context),
            bank = this.variableBank();
          if (bank) {
            if (nativeABI(world.profile).fes.localAccessUsesNativeTypes) {
              const name = labelBytes(memory, wParam);
              // The original scratch has four extra bytes for the index word.
              // Writing index zero terminates the stored 32-byte key.
              if (
                name.length > 35 &&
                (bank.context(this.variableContextKey()) || bank.privateNames)
              )
                throw new RangeError('Native FES local name exceeds its 36-byte key scratch');
              this.privateContext();
              bank.setName(name.subarray(0, 32), 0, lParam);
            } else {
              this.privateContext();
              bank.setName(memory.string(wParam), 0, lParam);
            }
          }
        }
        return NATIVE_UNWRITTEN_WORD;
      }
      if (message === 346 || message === 347) {
        const bank = this.variableBank();
        if (this.player && bank) {
          let key = context.nativeVariableContextKey;
          if (key === undefined && context.nativePointer) {
            key = await originalFeature(world, 'task-memory', 'worldID', lParam);
          }
          if (key === undefined)
            throw new Error('Native FES context copy requires the caller private-context identity');
          const own = this.variableContextKey();
          bank.copyContext(message === 346 ? key : own, message === 346 ? own : key);
        }
        return NATIVE_UNWRITTEN_WORD;
      }
      if (message === 348 || message === 349) {
        if (!this.player) throw new Error('Native FES result access requires its interpreter');
        if (message === 348) return this.player.root?.resultValue ?? this.resultValue;
        this.resultValue = 0;
        if (this.player.root) this.player.root.resultValue = 0;
        return NATIVE_UNWRITTEN_WORD;
      }
      if (message === 351 || message === 352) {
        if (!this.player) return NATIVE_UNWRITTEN_WORD;
        const memory =
          context.payload ||
          context.machine ||
          world.objects.machine(context.nativeSenderWorldID ?? words[0]);
        if (!memory) throw new Error('FES named word access requires sender memory');
        const key = memory.bytes ? labelBytes(memory, wParam) : encodeCP932(memory.string(wParam));
        if (message === 351) memory.store(lParam, this.nativeDictionary.get(key));
        else this.nativeDictionary.set(key, lParam);
        return NATIVE_UNWRITTEN_WORD;
      }
      if (message === 350) {
        if (lParam) {
          const memory = world.engineMessages.memory(words[0], context),
            buffers = world.runtime.imageDataBuffers,
            pointer = context.nativePointer ? lParam : buffers.pointer(lParam);
          await this.cacheImage(memory.string(wParam), pointer);
        }
        return NATIVE_UNWRITTEN_WORD;
      }
      return baseMessage(words, context);
    },
  });
  return implementation;
}
