// SPDX-License-Identifier: MPL-2.0
import { FESPlayer } from '../fes/player.mjs';
import { FESCoordinator } from './fes-coordinator.mjs';
import { FESImageCache } from './fes-image-cache.mjs';
import { FESInput } from './fes-input.mjs';
import { NATIVE_UNWRITTEN_WORD, nativeEngineWord } from './engine-message.mjs';
import { encodeCP932 } from '../kcs/strings.mjs';
import { NativeDictionary } from './dictionary.mjs';

export function createNativeFESTask(world, record) {
  const implementation = world.base(record);
  const input = new FESInput(record, world),
    imageCacheModel = new FESImageCache(world, record.id),
    baseMessage = implementation.message;
  Object.assign(implementation, {
    input,
    player: null,
    surface: null,
    soundTaskID: null,
    sleepValue: 0,
    stringsInherited: false,
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
    configurePlayer() {
      const player = this.player;
      player.motionLibrary = world.motionLibrary;
      player.nativeSources = world.fesSources;
      player.nativeOwner = record.id;
      player.runtimeFactory = (instance) => new FESCoordinator(world, instance, imageCacheModel);
      player.nativeSound = world.fesSound;
      player.nativeSoundTaskID = this.soundTaskID;
      player.nativeImages = world.imagesFES;
      player.nativeControls = world.controlsFES;
      player.nativeText = world.text.fes;
      player.nativeLog = world.text.log;
      player.nativeInput = input;
      this.bindVariableContext();
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
    bindVariableContext() {
      const key = this.variableContextKey();
      this.player.nativeVariableContext = (instance) => {
        instance.nativeVariableContextKey ??= key;
        const bank = this.variableBank();
        bank?.selectContext(instance.nativeVariableContextKey);
        return bank?.context(instance.nativeVariableContextKey) ?? null;
      };
    },
    async initialize(variableBank) {
      const runtime = world.runtime;
      if (this.player) await this.closeInterpreter();
      record.context.variableBank = variableBank;
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
      this.soundTaskID = nativeEngineWord(
        await world.sendNativeEngine(0, record.id, world.engineMessages.layout.rootStart + 3),
        'FES initialization sound-task query',
      );
      this.configurePlayer();
      this.variableBank()?.registerContext(this.variableContextKey());
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
      return this.loadSource(name);
    },
    async loadSource(name) {
      if (!this.player)
        throw new Error('Native FES source loading requires message 331 initialization');
      // The original reader reports a failed file callback to 62C480/332;
      // the task then records -2. Empty and missing files are valid failures.
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
      this.player.root.nativeDictionary = this.nativeDictionary;
      this.player.root.runtimeID = record.id;
      this.player.root.variableBank = record.context.variableBank;
      record.exitCode = -1;
      if (this.surface !== null) world.graphics.bindFES(this.surface, this.player, record.id);
      await world.graphics.initializeFES(record, this.player);
      world.host.nativeFESLoaded?.(record, this.player, world);
      return true;
    },
    async tick() {
      const player = this.player,
        live = () =>
          this.player === player && record.state !== 'releasing' && !player?.root?.runtime?.closed;
      if (this.sleepValue || !player?.root || !live()) return;
      this.variableBank()?.selectContext(this.variableContextKey());
      await input.tick();
      if (!live()) return;
      await player.step();
      if (!live()) return;
      await this.syncObjects();
      if (live() && player.root.finished !== null) record.exitCode = player.root.finished;
    },
    async syncObjects() {
      await world.graphics.syncFES(record, this.player);
      await input.sync();
    },
    snapshot() {
      return {
        player: this.player?.snapshot() ?? null,
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
      this.surface = state.surface;
      this.soundTaskID = state.soundTaskID;
      this.sleepValue = state.sleepValue;
      this.stringsInherited = state.stringsInherited;
      imageCacheModel.entries = new Map(state.imageCache);
      input.restore(state.input);
      if (!state.player) return;
      const runtime = world.runtime;
      this.player = new FESPlayer(
        world.game,
        world.images,
        world.fesHost(record),
        runtime.bankView(record.context.variableBank),
        runtime.bankView(record.context.stringBank, 'string-bank'),
      );
      this.configurePlayer();
      await this.player.restore(state.player);
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
      // 755F10 unregisters its private variable context before object storage
      // and the FES image cache are released.
      this.variableBank()?.unregisterContext(this.variableContextKey());
      for (const instance of this.player?.instances || []) {
        if (instance.kcsTaskID != null) await world.objects.release(instance.kcsTaskID);
      }
      world.host.nativeFESClosed?.(record, world);
      await world.graphics.closeFES(record, this.player);
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
        const instance = this.player.root;
        await this.player.notify('MES_CHANGECONFIG');
        instance.runtime.configurationDirty = true;
        for (const object of instance.objects) {
          object.dirty = true;
          if ([9, 10].includes(object.nativeType))
            await world.fesSound.configurationChanged(instance, object);
        }
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
        await this.tick();
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
        const label = memory.string(lParam),
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
        const memory =
          context.payload ||
          context.machine ||
          world.objects.machine(context.nativeSenderWorldID ?? words[0]);
        if (!memory) throw new Error('FES notification requires sender memory');
        const name = wParam ? memory.string(wParam) : null,
          index = name === null ? 0 : memory.load(wParam + 32);
        await this.player.notify(memory.string(lParam), name, index);
        if (!input.state.sleeping) {
          await world.graphics.syncFES(record, this.player, { resourcesOnly: true });
          await input.sync();
          await world.graphics.flushFESRedraw(this.player.root);
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
        if (message === 338)
          this.player.root.createObjects(lParam, memory.string(wParam), memory.load(wParam + 32));
        else await this.player.root.applyObjects(memory.string(wParam), memory.string(lParam));
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
          await world.graphics.setFESSleep(record, this.player, lParam);
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
        // 758840/7587E0 do not select their interpreter. They copy the bank's
        // currently selected context, unlike the scalar 757BB0/757BE0 calls.
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
          this.privateContext();
          bank?.setName(memory.string(wParam), 0, lParam);
        }
        return NATIVE_UNWRITTEN_WORD;
      }
      if (message === 346 || message === 347) {
        const bank = this.variableBank();
        if (this.player && bank) {
          let key = context.nativeVariableContextKey;
          if (key === undefined && context.nativePointer) {
            const tasks = await world.getNativeFeature('task-memory');
            key = tasks.worldID(lParam);
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
        const key = encodeCP932(memory.string(wParam));
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
