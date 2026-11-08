// SPDX-License-Identifier: MPL-2.0
import { readKCS, nativeReply, formatNative, formatNativeAt, encodeCP932 } from '../kcs.mjs';
import { KCSScheduler } from '../kcs/scheduler.mjs';
import { nativeCatalog, NATIVE_PROFILES } from './catalog.mjs';
import { NativeHandles } from './handles.mjs';
import { nativeStandard } from './standard.mjs';
import { nativeTask } from './task.mjs';
import { nativeXML } from './xml.mjs';
import { nativeNameTableCodec } from './nametable.mjs';
import { nativeConfiguration } from './config.mjs';
import { NATIVE_BANK_IDS, NativeVariableBank, nativeBank } from './bank.mjs';
import { nativeEnvironment } from './environment.mjs';
import { NativeStringBank, nativeStringBank } from './string-bank.mjs';
import { nativeGallery, nativeGalleryCodec } from './gallery.mjs';
import { NativeGlobalFile, nativePersistence, createGlobalEntries } from './persistence.mjs';
import { nativeFiles } from './storage.mjs';
import { nativeMotion } from './motion.mjs';
import { NativeSceneData, nativeSceneData } from './scene-data.mjs';
import { nativeCharacterNames, nativeCharacterNamesCodec } from './character-names.mjs';
import { nativeDictionary, nativeDictionaryCodec } from './dictionary.mjs';
import { NATIVE_DATA_BUFFER_IDS, nativeDataBuffer, nativeDataBufferCodec } from './data-buffer.mjs';
import { nativeRecordStack, nativeRecordStackCodec } from './record-stack.mjs';
import { nativeResourceCache } from './resource-cache.mjs';
import { NATIVE_HEAP_DATA_IDS, nativeHeapData } from './heap-data.mjs';
import { nativeHistoryCursor, nativeHistoryCursorCodec } from './history-cursor.mjs';
import { nativeGalleryTable, nativeGalleryTableCodec } from './gallery-tables.mjs';
import { nativeTileGameCodec } from './tile-game.mjs';
import { nativeDatabaseCodec } from './database.mjs';
import { nativeOrderedMap } from './ordered-map.mjs';
import { nativeArguments } from './arguments.mjs';
import { nativeContentDatabaseCodec } from './content-databases.mjs';
import { nativeSectionTableCodec } from './section-table.mjs';
import { nativeImageOwnerCodec } from './image-owner.mjs';

export class UnsupportedKCSNative extends Error {
  constructor(details) {
    super(
      `Unsupported ${details.profile}/${details.table} native 0x${details.id.toString(16)} in ${details.script} at 0x${details.pc.toString(16)}`,
    );
    this.name = 'UnsupportedKCSNative';
    this.details = structuredClone(details);
  }
}

// One runtime owns an ABI profile, handle space, task graph and shared memory.
// A recovered declaration is not an implementation. Every dispatch must return
// an explicit control reply or report an unsupported call with its guest state.
export class NativeRuntime {
  constructor({ profile, read, services = {}, shared, budget }) {
    if (!NATIVE_PROFILES[profile]) throw new Error(`Unknown CatSystem2 native profile ${profile}`);
    this.profile = profile;
    this.read = read;
    this.handles = this.createHandles();
    this.handlers = new Map();
    this.calls = new Map();
    this.tables = new Map(
      Object.keys(NATIVE_PROFILES[profile].tables).map((table) => [
        table,
        nativeCatalog(profile, table),
      ]),
    );
    this.services = {
      ...services,
      handles: this.handles,
      read,
      xmlEncoding: NATIVE_PROFILES[profile].xmlEncoding,
      format:
        services.format || ((address, machine) => formatNative(machine.string(address), machine)),
      formatBytes:
        services.formatBytes ||
        (services.format
          ? (address, machine) => encodeCP932(services.format(address, machine))
          : formatNativeAt),
    };
    this.scheduler = new KCSScheduler({
      shared,
      budget,
      load: async (name) => {
        const bytes = await read(name, 'kcs');
        if (!bytes) throw new Error(`Missing KCS resource ${name}`);
        return { ...(await readKCS(bytes)), name };
      },
      native: (table, id, args, machine, task, scheduler) =>
        this.native(table, id, args, machine, task, scheduler),
      diagnostic: (detail, task) =>
        this.services.diagnostic?.({
          ...detail,
          table: task.abi,
          task: task.id,
          script: task.name,
        }),
    });
  }
  createHandles() {
    const handles = new NativeHandles();
    handles.registerType('tile-game', nativeTileGameCodec);
    handles.registerType('database', nativeDatabaseCodec);
    handles.registerType('content-database', nativeContentDatabaseCodec);
    handles.registerType('section-table', nativeSectionTableCodec);
    handles.registerType('image-owner', nativeImageOwnerCodec);
    handles.registerType('variable-bank', {
      snapshot: (bank) => bank.snapshot(),
      restore: (state) => {
        const bank = new NativeVariableBank();
        bank.restore(state);
        return bank;
      },
    });
    handles.registerType('string-bank', {
      snapshot: (bank) => bank.snapshot(),
      restore: (state) => {
        const bank = new NativeStringBank();
        bank.restore(state);
        return bank;
      },
    });
    handles.registerType('cg-registration', nativeGalleryCodec);
    handles.registerType('character-names', nativeCharacterNamesCodec);
    handles.registerType('nametable', nativeNameTableCodec);
    handles.registerType('dictionary', nativeDictionaryCodec);
    handles.registerType('image-data', nativeDataBufferCodec);
    handles.registerType('record-stack', nativeRecordStackCodec);
    handles.registerType('history-cursor', nativeHistoryCursorCodec);
    handles.registerType('gallery-table', nativeGalleryTableCodec);
    handles.registerType('global-file', {
      snapshot: (file) => file.snapshot(),
      restore: (state) => {
        const file = new NativeGlobalFile();
        file.restore(state);
        return file;
      },
    });
    handles.registerType('scene-data', {
      snapshot: (data) => data.snapshot(),
      restore: (state) => new NativeSceneData().restore(state),
    });
    return handles;
  }
  variableBank(task, create = true) {
    if (!task.context.variableBank && create)
      task.context.variableBank = this.handles.add('variable-bank', new NativeVariableBank());
    return task.context.variableBank
      ? this.handles.get(task.context.variableBank, 'variable-bank')
      : null;
  }
  stringBank(task, create = true) {
    if (!task.context.stringBank && create)
      task.context.stringBank = this.handles.add('string-bank', new NativeStringBank());
    return task.context.stringBank
      ? this.handles.get(task.context.stringBank, 'string-bank')
      : null;
  }
  sceneData(task, create = false) {
    if (!task.context.sceneData && create)
      task.context.sceneData = this.handles.add(
        'scene-data',
        new NativeSceneData({ languages: this.services.sceneLanguages }),
      );
    return task.context.sceneData ? this.handles.get(task.context.sceneData, 'scene-data') : null;
  }
  bankView(handle, type = 'variable-bank') {
    const bank = () => this.handles.get(handle, type);
    const index = (key) =>
      typeof key === 'string' && /^(0|[1-9]\d*)$/.test(key) ? Number(key) : null;
    return new Proxy(Object.create(null), {
      get: (_target, key) =>
        index(key) === null
          ? undefined
          : type === 'variable-bank'
            ? bank().get(index(key)) | 0
            : bank().get(index(key)),
      set: (_target, key, value) => {
        const n = index(key);
        if (n === null) throw new Error(`Invalid ${type} view property ${String(key)}`);
        bank().set(n, value);
        return true;
      },
      ownKeys: () =>
        type === 'variable-bank'
          ? Array.from({ length: bank().capacity }, (_, i) => String(i))
          : [...bank().entries.keys()].map(String),
      getOwnPropertyDescriptor: (_target, key) =>
        index(key) === null ? undefined : { enumerable: true, configurable: true },
    });
  }
  register(table, id, handler) {
    if (!this.tables.get(table)?.[id] || typeof handler !== 'function')
      throw new Error('Invalid native registration');
    const key = `${table}:${id}`;
    if (this.handlers.has(key)) throw new Error(`Duplicate native registration ${key}`);
    this.handlers.set(key, handler);
  }
  native(table, id, args, machine, task, scheduler) {
    const annotate = (error) => {
      error.details ??= {
        profile: this.profile,
        table,
        id,
        task: task.id,
        script: task.name,
        pc: machine.pc,
        args: [...args],
        source: structuredClone(machine.debug),
      };
      throw error;
    };
    try {
      const reply = this.dispatchNative(table, id, args, machine, task, scheduler);
      return reply && typeof reply.then === 'function' ? reply.catch(annotate) : reply;
    } catch (error) {
      return annotate(error);
    }
  }
  dispatchNative(table, id, args, machine, task, scheduler) {
    const entry = this.tables.get(table)?.[id];
    if (!Number.isInteger(id) || id < 0 || !entry)
      throw new Error(`Native ID is outside ${this.profile}/${table}: ${id}`);
    const key = `${table}:${id}`;
    this.calls.set(key, (this.calls.get(key) || 0) + 1);
    const services = {
      ...this.services,
      owner: task.id,
      contextName: task.context.contextName ?? '',
    };
    services.markStringsDirty = () => {
      const record = this.services.world?.objects.objects.get(task.id);
      if (record) record.scriptStringDirty = 1;
    };
    if (table === 'main' && NATIVE_BANK_IDS.includes(id)) {
      services.variables = this.variableBank(task, id === 0xd1);
      services.allowVariableInitialization = task.context.allowVariableInitialization !== false;
    }
    if (table === 'main' && id === 0x21b) services.variables = this.variableBank(task, false);
    if (table === 'main' && [0x114, 0x115, 0x116, 0xf3, 0xfd, 0x150, 0xe7].includes(id))
      services.strings = this.stringBank(task);
    services.sceneData = this.sceneData(task);
    services.initializeSceneData = () => {
      if (task.context.sceneData) {
        this.handles.release(task.context.sceneData, 'scene-data');
        task.context.sceneData = 0;
      }
      return this.sceneData(task, true);
    };
    services.sceneDataForTask = (id) => {
      const owner = scheduler.tasks.get(
        this.services.world ? this.services.world.resolveTaskID(id, task.id) : id,
      );
      return owner ? this.sceneData(owner) : null;
    };
    services.globalEntries = createGlobalEntries(this.handles);
    services.variableBankForTask = (id) => {
      const owner = scheduler.tasks.get(
        this.services.world ? this.services.world.resolveTaskID(id, task.id) : id,
      );
      return owner ? this.variableBank(owner, false) : null;
    };
    let reply;
    if (entry.status === 'reserved') reply = nativeReply(2);
    else if (entry.status === 'constant-zero') reply = nativeReply(1, 0);
    else if (this.handlers.has(key))
      reply = this.handlers.get(key)(args, machine, task, scheduler, services);
    else if (table === 'main') {
      reply = nativeFiles(id, args, machine, services);
      if (reply === undefined) reply = nativeStandard(id, args, machine, services);
      if (reply === undefined) reply = nativeArguments(id, args, machine, services);
      if (reply === undefined) reply = nativeTask(id, args, machine, task, services);
      if (reply === undefined) reply = nativeXML(id, args, machine, services);
      if (reply === undefined) reply = nativeCharacterNames(id, args, machine, services);
      if (reply === undefined) reply = nativeDictionary(id, args, machine, services);
      if (reply === undefined) reply = nativeOrderedMap(id, args, machine, services);
      if (reply === undefined) reply = nativeRecordStack(id, args, machine, services);
      if (reply === undefined) reply = nativeResourceCache(id, args, machine, services);
      if (reply === undefined && NATIVE_HEAP_DATA_IDS.includes(id))
        reply = nativeHeapData(id, args, machine, services);
      if (reply === undefined && NATIVE_DATA_BUFFER_IDS.includes(id))
        reply = nativeDataBuffer(id, args, machine, services);
      if (reply === undefined) reply = nativeConfiguration(id, args, machine, services);
      if (reply === undefined) reply = nativeBank(id, args, machine, services);
      if (reply === undefined) reply = nativeEnvironment(id, args, machine, services);
      if (reply === undefined) reply = nativeStringBank(id, args, machine, services);
      if (reply === undefined) reply = nativeGallery(id, args, machine, services);
      if (reply === undefined) reply = nativePersistence(id, args, machine, services);
      if (reply === undefined) reply = nativeMotion(id, args, machine, services);
      if (reply === undefined) reply = nativeSceneData(id, args, machine, services);
      if (reply === undefined) reply = nativeHistoryCursor(id, args, machine, services);
      if (reply === undefined) reply = nativeGalleryTable(id, args, machine, services);
    }
    const validate = (value) => {
      if (value === undefined)
        throw new UnsupportedKCSNative({
          profile: this.profile,
          table,
          id,
          task: task.id,
          script: task.name,
          pc: machine.pc,
          args,
          source: machine.debug,
        });
      const checked = nativeReply(value.control, value.value, value.wait);
      if (entry.controlCodes.length && !entry.controlCodes.includes(checked.control))
        throw new Error(
          `Native ${key} control ${checked.control} disagrees with the fixed ABI (${entry.controlCodes.join(',')})`,
        );
      return checked;
    };
    return reply && typeof reply.then === 'function' ? reply.then(validate) : validate(reply);
  }
  spawn(name, { table = 'main', ...options } = {}) {
    if (!this.tables.has(table)) throw new Error(`Unknown native table ${table}`);
    return this.scheduler.spawn(name, { ...options, abi: table });
  }
  tick() {
    return this.scheduler.tick();
  }
  snapshot() {
    return {
      profile: this.profile,
      handles: this.handles.snapshot(),
      scheduler: this.scheduler.snapshot(),
    };
  }
  async restore(state) {
    if (state.profile !== this.profile)
      throw new Error('Native checkpoint ABI profile does not match');
    const previous = { records: this.handles.records, next: this.handles.next };
    this.handles.restore(state.handles);
    try {
      await this.scheduler.restore(state.scheduler);
    } catch (error) {
      Object.assign(this.handles, previous);
      throw error;
    }
  }
}
