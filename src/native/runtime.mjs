// SPDX-License-Identifier: MPL-2.0
import { readKCS, nativeReply, formatNativeAt, encodeCP932 } from '../kcs.mjs';
import { KCSScheduler } from '../kcs/scheduler.mjs';
import { nativeCatalog } from './catalog.mjs';
import { nativeABI, nativeABIBehavior } from './abi/index.mjs';
import { NATIVE_SEMANTICS } from './abi/semantics.mjs';
import { NativeHandles } from './handles.mjs';
import { NativeBufferMemory } from './buffer-memory.mjs';
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
import {
  NativeDataBuffers,
  NATIVE_DATA_BUFFER_IDS,
  nativeDataBuffer,
  nativeDataBufferCodec,
} from './data-buffer.mjs';
import { nativeRecordQueueCodec } from './record-queue.mjs';
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
import { nativeDataString } from './data-text.mjs';

export class UnsupportedKCSNative extends Error {
  constructor(details) {
    super(
      `Unsupported ${details.profile}/${details.table} native 0x${details.id.toString(16)} in ${details.script} at 0x${details.pc.toString(16)}`,
    );
    this.name = 'UnsupportedKCSNative';
    this.details = structuredClone(details);
  }
}

// These synchronous primitive families consume only the fields captured below.
// Keep each invocation independent: guest memory or a service getter can enter
// another native, replace services, or change the caller's selected bank.
const primitiveIDs = new Set([
  ...NATIVE_BANK_IDS,
  0x2d,
  0x207,
  ...Array.from({ length: 4 }, (_, i) => 0x203 + i),
]);
const ownServiceDescriptor = Object.getOwnPropertyDescriptor;
const hasOwnServiceField = Object.hasOwn;
const applyServiceGetter = Reflect.apply;
function primitiveService(current, key) {
  const field = ownServiceDescriptor(current, key);
  if (!field?.enumerable) return undefined;
  return hasOwnServiceField(field, 'value')
    ? field.value
    : field.get
      ? applyServiceGetter(field.get, current, [])
      : undefined;
}
function nativePrimitive(runtime, id, args, machine, task, current) {
  if (id === 0x2d || id === 0x207)
    return nativeStandard(id, args, machine, { profile: runtime.profile });
  if (NATIVE_BANK_IDS.includes(id)) {
    const variableExpressionContext = primitiveService(current, 'variableExpressionContext'),
      profile = runtime.profile,
      variables = runtime.variableBank(task, id === 0xd1),
      allowVariableInitialization = task.context.allowVariableInitialization !== false;
    return nativeBank(id, args, machine, {
      profile,
      variables,
      allowVariableInitialization,
      variableExpressionContext,
    });
  }
  return nativeDictionary(id, args, machine, {
    profile: runtime.profile,
    handles: primitiveService(current, 'handles'),
  });
}

// One runtime owns an ABI profile, handle space, task graph and shared memory.
// A recovered declaration is not an implementation. Every dispatch must return
// an explicit control reply or report an unsupported call with its guest state.
export class NativeRuntime {
  // Ownership only, not cached service values; replacing services must not
  // retain the old container or its resources for the lifetime of the runtime.
  #primitiveServices = new WeakSet();
  constructor({ profile, read, services = {}, shared, budget }) {
    const abi = nativeABI(profile);
    this.profile = profile;
    this.read = read;
    this.handles = this.createHandles();
    this.handlers = new Map();
    this.calls = new Map();
    this.tables = new Map(
      Object.keys(abi.tables).map((table) => [table, nativeCatalog(profile, table)]),
    );
    this.services = {
      ...services,
      handles: this.handles,
      read,
      xmlEncoding: abi.xmlEncoding,
      profile,
      ...(abi.math ? { math: abi.math } : {}),
      format:
        services.format ||
        ((address, machine) =>
          new TextDecoder('shift_jis').decode(nativeDataString(formatNativeAt(address, machine)))),
      formatBytes:
        services.formatBytes ||
        (services.format
          ? (address, machine) => encodeCP932(services.format(address, machine))
          : formatNativeAt),
    };
    this.#primitiveServices.add(this.services);
    this.imageDataBuffers = new NativeDataBuffers({
      memory: new NativeBufferMemory({
        resolveReference: (ref, reader) =>
          ref.kind === 'task' ? this.taskReferenceBytes(ref, reader) : this.vmReferenceBytes(ref),
      }),
      handles: this.handles,
      read,
      diagnostic: services.diagnostic,
    });
    this.services.imageDataBuffers = () => this.imageDataBuffers;
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
    handles.registerType('record-queue', nativeRecordQueueCodec);
    handles.registerType('history-cursor', nativeHistoryCursorCodec);
    handles.registerType('gallery-table', nativeGalleryTableCodec);
    handles.registerType('global-file', {
      snapshot: (file) => file.snapshot(),
      restore: (state) => {
        const file = new NativeGlobalFile(
          0,
          nativeABIBehavior(this.profile, 'globalFile.growthBytes'),
        );
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
  // Registered handlers own their World/services through their installer and
  // receive (args, machine, task, scheduler). Only built-in fallbacks prepare
  // the per-call service object below.
  register(table, id, handler) {
    const entries = this.tables.get(table);
    if (
      !entries ||
      !Number.isSafeInteger(id) ||
      id < 0 ||
      typeof handler !== 'function' ||
      (!entries[id] && !Object.hasOwn(NATIVE_SEMANTICS[table], id))
    )
      throw new Error('Invalid native registration');
    // Installers share implementations across versions. A later catalogue
    // operation does not create a slot or handler in a shorter native table.
    if (!entries[id]) return false;
    const key = `${table}:${id}`;
    if (this.handlers.has(key)) throw new Error(`Duplicate native registration ${key}`);
    this.handlers.set(key, handler);
    return true;
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
    const unsupported = () =>
      new UnsupportedKCSNative({
        profile: this.profile,
        table,
        id,
        task: task.id,
        script: task.name,
        pc: machine.pc,
        args,
        source: machine.debug,
      });
    if (entry.status === 'unknown') throw unsupported();
    // A reentrant native observer must see all earlier owned text writes.
    if (this.textPublicationBarrier)
      return this.textPublicationBarrier().then(() =>
        this.dispatchNative(table, id, args, machine, task, scheduler),
      );
    const key = `${table}:${id}`;
    this.calls.set(key, (this.calls.get(key) || 0) + 1);
    const primitive = table === 'main' && primitiveIDs.has(id);
    let reply, currentServices;
    if (entry.status === 'reserved') reply = nativeReply(2);
    else if (entry.status === 'constant-zero') reply = nativeReply(1, 0);
    else if (this.handlers.has(key)) reply = this.handlers.get(key)(args, machine, task, scheduler);
    else if (primitive && this.#primitiveServices.has((currentServices = this.services)))
      reply = nativePrimitive(this, id, args, machine, task, currentServices);
    else if (table === 'main') {
      const services = {
        ...(primitive ? currentServices : this.services),
        profile: this.profile,
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
      if (table === 'main' && [0x114, 0x115, 0x116, 0xf3, 0xfd, 0x150, 0xe7].includes(id)) {
        const abi = nativeABI(this.profile);
        const existingOnly =
          ((id === 0x150 || id === 0xe7) && abi.scene?.historyCaptureUsesExistingBank) ||
          (id === 0x116 && abi.stringBank?.expandUsesExistingBank);
        const lookupOnly = (id === 0xf3 || id === 0xfd) && abi.stringBank?.cssOwnerLookupOnly;
        services.strings = this.stringBank(task, !(existingOnly || lookupOnly));
        if (lookupOnly) services.createStrings = () => this.stringBank(task);
      }
      services.sceneData = this.sceneData(task);
      services.initializeSceneData = () => {
        if (task.context.sceneData) {
          const previous = this.handles.release(task.context.sceneData, 'scene-data');
          services.world?.m2?.scenePreparation?.discard(previous);
          services.world?.graphics?.images?.scenePreparation?.discard(previous);
          task.context.sceneData = 0;
        }
        return this.sceneData(task, true);
      };
      services.sceneDataForTask = (id) => {
        const world = this.services.world,
          resolved = world ? world.resolveTaskID(id, task.id) : id,
          record = world?.objects.objects.get(resolved);
        const owner =
          (scheduler ?? this.scheduler).tasks.get(resolved) ??
          (record?.kind === 12 ? record : null);
        return owner?.context ? this.sceneData(owner) : null;
      };
      services.globalEntries = createGlobalEntries(this.handles);
      services.variableBankForTask = (id) => {
        const owner = scheduler.tasks.get(
          this.services.world ? this.services.world.resolveTaskID(id, task.id) : id,
        );
        return owner ? this.variableBank(owner, false) : null;
      };
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
      if (value === undefined) throw unsupported();
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
  vmReferenceBytes(reference) {
    const machine = this.scheduler.tasks.get(reference.taskID)?.machine;
    if (
      !machine ||
      machine.memoryID !== reference.memoryID ||
      machine.memory.length !== reference.length
    )
      throw new Error('Native VM buffer source interpreter is absent or replaced');
    return machine.memory;
  }
  vmDataAddress(taskID, machine) {
    if (this.scheduler.tasks.get(taskID)?.machine !== machine)
      throw new Error('Native VM data address requires its actual owning interpreter');
    return this.imageDataBuffers.process.borrow({
      kind: 'vm',
      taskID,
      memoryID: machine.memoryID,
      length: machine.memory.length,
    });
  }
  releaseVMData(taskID) {
    this.imageDataBuffers.process.releaseReferences(taskID);
  }
  taskCallerLayout(record) {
    const layout = nativeABI(this.profile).task?.kindQueryCallerView;
    if (
      !layout ||
      record?.kind !== layout.taskKind ||
      (record.state !== 'active' && record.state !== 'releasing') ||
      !Number.isInteger(record.nativeID) ||
      record.nativeID < -0x80000000 ||
      record.nativeID > 0xffffffff
    )
      throw new Error('Native caller task has no reviewed live record layout');
    return layout;
  }
  taskReferenceBytes(reference, reader) {
    const record = this.services.objects?.objects.get(reference.taskID),
      layout = this.taskCallerLayout(record);
    if (reference.length !== layout.byteLength)
      throw new Error('Native caller task reference has the wrong readable span');
    if (reader !== undefined && !Object.hasOwn(layout.readBy, reader))
      throw new Error('Native caller task address has no reviewed read contract for this native');
    const bytes = new Uint8Array(layout.byteLength),
      view = new DataView(bytes.buffer);
    view.setUint32(layout.fields.vtable, layout.vtableWord, true);
    view.setUint32(layout.fields.nativeTaskID, record.nativeID, true);
    return bytes;
  }
  taskCallerAddress(taskID) {
    const layout = this.taskCallerLayout(this.services.objects?.objects.get(taskID));
    return this.imageDataBuffers.process.borrow({
      kind: 'task',
      taskID,
      length: layout.byteLength,
    });
  }
  releaseTaskData(taskID) {
    this.imageDataBuffers.process.releaseReferences(taskID, 'task');
  }
  validateBufferReferences(memory, scheduler, records = this.services.objects?.objects) {
    if (!Array.isArray(scheduler?.tasks)) throw new Error('Native checkpoint tasks are invalid');
    const tasks = new Map(scheduler.tasks.map((task) => [task.id, task])),
      vmOwners = new Set(),
      taskOwners = new Set();
    this.imageDataBuffers.process.validateState(memory, (reference) => {
      if (reference.kind === 'task') {
        const record = records?.get(reference.taskID),
          layout = this.taskCallerLayout(record);
        if (
          taskOwners.has(reference.taskID) ||
          record.state !== 'active' ||
          reference.length !== layout.byteLength
        )
          throw new Error('Native caller task checkpoint reference does not match its owner');
        taskOwners.add(reference.taskID);
        return;
      }
      const saved = tasks.get(reference.taskID)?.machine;
      if (
        vmOwners.has(reference.taskID) ||
        !saved ||
        saved.memoryID !== reference.memoryID ||
        !(saved.memory instanceof Uint8Array) ||
        saved.memory.length !== reference.length
      )
        throw new Error('Native VM buffer checkpoint source does not match its interpreter');
      vmOwners.add(reference.taskID);
    });
  }
  snapshot() {
    const scheduler = this.scheduler.snapshot(),
      imageDataBuffers = this.imageDataBuffers.snapshot();
    this.validateBufferReferences(imageDataBuffers.memory, scheduler);
    return {
      profile: this.profile,
      handles: this.handles.snapshot(),
      imageDataBuffers,
      scheduler,
    };
  }
  async restore(state, records) {
    if (state.profile !== this.profile)
      throw new Error('Native checkpoint ABI profile does not match');
    this.validateBufferReferences(state.imageDataBuffers?.memory, state.scheduler, records);
    const previous = { records: this.handles.records, next: this.handles.next };
    const previousBuffers = this.imageDataBuffers.snapshot();
    try {
      this.imageDataBuffers.restore(state.imageDataBuffers);
      this.handles.restore(state.handles);
      await this.scheduler.restore(state.scheduler);
    } catch (error) {
      Object.assign(this.handles, previous);
      this.imageDataBuffers.restore(previousBuffers);
      throw error;
    }
  }
}
