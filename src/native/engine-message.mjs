// SPDX-License-Identifier: MPL-2.0
import { nativeABI } from './abi/index.mjs';
// Task packet routing: game 5DD130..5DEC70; SDK 4B9360..4BB030.
import { encodeCP932 } from '../kcs/strings.mjs';

export const NATIVE_UNWRITTEN_WORD = Symbol('native engine output word was not written');
export function nativeEngineWord(value, label = 'Native engine query') {
  if (!Number.isInteger(value) || value < -0x80000000 || value > 0xffffffff)
    throw new Error(`${label} has no initialized 32-bit output word`);
  return value >>> 0;
}
const SDK = 'sdk-4.01-engine-2.6.1.74',
  GAME = 'nekopara-vol3-engine-2.6.1.76',
  RELEASED_BRANCH = 'released native task branch';
export const NATIVE_ENGINE_MESSAGE_LAYOUTS = Object.freeze({
  [SDK]: Object.freeze({
    base: 0x4b9360,
    route: 0x4b96e0,
    packet: 0x4b9610,
    send: 0x4b9aa0,
    up: 0x4b9b80,
    topUp: 0x4bb030,
    root: 0x4baba0,
    rootCtor: 0x4b9d50,
    baseCtor: 0x4b8cd0,
    rootStart: nativeABI('sdk-4.01-engine-2.6.1.74').messages.root.start,
    captionWide: nativeABI('sdk-4.01-engine-2.6.1.74').messages.root.captionWide,
    rootField: nativeABI('sdk-4.01-engine-2.6.1.74').messages.root.field,
    soundReset: nativeABI('sdk-4.01-engine-2.6.1.74').messages.root.soundReset,
  }),
  [GAME]: Object.freeze({
    base: 0x5dd130,
    route: 0x5dd4a0,
    packet: 0x5dd3e0,
    send: 0x5dd860,
    up: 0x5dd940,
    topUp: 0x5dec70,
    root: 0x5deac0,
    rootCtor: 0x5ddaf0,
    baseCtor: 0x5dcab0,
    rootStart: nativeABI('nekopara-vol3-engine-2.6.1.76').messages.root.start,
    captionWide: nativeABI('nekopara-vol3-engine-2.6.1.76').messages.root.captionWide,
    rootField: nativeABI('nekopara-vol3-engine-2.6.1.76').messages.root.field,
    soundReset: nativeABI('nekopara-vol3-engine-2.6.1.76').messages.root.soundReset,
  }),
});
const idOf = (record) => nativeEngineWord(record.nativeID ?? record.id, 'Native task identity');
export const nativeTaskKeyOrder = (left, right) => (left | 0) - (right | 0);
const bytesAt = (memory, address, count) => {
  if (typeof memory.bytes === 'function') return memory.bytes(address, count);
  if (typeof memory.read === 'function') return memory.read(address, count);
  throw new Error('Native task message requires byte-addressable sender memory');
};
const putBytes = (memory, address, bytes) => {
  if (typeof memory.write === 'function') memory.write(address, bytes);
  else if (typeof memory.bytes === 'function') memory.bytes(address, bytes.length).set(bytes);
  else throw new Error('Native task message requires writable sender memory');
};
const readWord = (memory, address) => {
  if (typeof memory.load === 'function') return memory.load(address) >>> 0;
  const bytes = bytesAt(memory, address, 4);
  return new DataView(bytes.buffer, bytes.byteOffset, 4).getUint32(0, true);
};
function readString(memory, address, wide) {
  const bytes = [];
  for (let at = address; ; at += wide ? 2 : 1) {
    const next = bytesAt(memory, at, wide ? 2 : 1);
    if (!next[0] && (!wide || !next[1])) break;
    bytes.push(...next);
  }
  if (!wide) return new TextDecoder('shift_jis').decode(Uint8Array.from(bytes));
  return String.fromCharCode(
    ...Array.from({ length: bytes.length / 2 }, (_, i) => bytes[i * 2] | (bytes[i * 2 + 1] << 8)),
  );
}
function stringBytes(text, wide) {
  if (!wide) return Uint8Array.from([...encodeCP932(text), 0]);
  const bytes = new Uint8Array((text.length + 1) * 2),
    view = new DataView(bytes.buffer);
  for (let i = 0; i < text.length; i++) view.setUint16(i * 2, text.charCodeAt(i), true);
  return bytes;
}

export class NativeEngineMessages {
  constructor(world) {
    if (!NATIVE_ENGINE_MESSAGE_LAYOUTS[world?.profile] || !(world.objects?.objects instanceof Map))
      throw new Error('Native engine messages require their profiled task world');
    this.world = world;
    this.layout = NATIVE_ENGINE_MESSAGE_LAYOUTS[world.profile];
  }
  get records() {
    return this.world.objects.objects;
  }
  closestTop(worldID) {
    let record = this.records.get(typeof worldID === 'object' ? worldID.id : worldID);
    const seen = new Set();
    while (record) {
      if (seen.has(record.id)) throw new Error('Native task parent cycle');
      seen.add(record.id);
      if (record.kind === 1) return record;
      record = this.records.get(record.parent);
    }
    return null;
  }
  children(record) {
    return [...this.registry(record).keys()]
      .sort(nativeTaskKeyOrder)
      .map((id) => this.lookupPointer(record, id))
      .filter((child) => child?.parent === record.id);
  }
  async eachChild(record, callback, { teardown = false } = {}) {
    let previous = -Infinity;
    for (;;) {
      const key = [...this.registry(record).keys()]
        .filter((id) => (id | 0) > previous)
        .sort(nativeTaskKeyOrder)[0];
      if (key === undefined) break;
      previous = key | 0;
      const child = this.lookupPath(record, key, teardown).pointer;
      if (child?.parent === record.id) await callback(child);
    }
  }
  registry(record) {
    return new Map(record.nativeTaskRoutes ?? []);
  }
  attach(record) {
    let branch = record,
      parent = this.records.get(record.parent);
    while (parent) {
      parent.nativeTaskRoutes ??= new Map();
      const old = parent.nativeTaskRoutes.get(idOf(record));
      if (old !== undefined && old !== branch.id)
        throw new Error(
          `Duplicate native task ID ${idOf(record)} in task ${parent.id}'s route map`,
        );
      parent.nativeTaskRoutes.set(idOf(record), branch.id);
      if (parent.kind === 1) break;
      branch = parent;
      parent = this.records.get(parent.parent);
    }
  }
  release(record) {
    this.unregister(record, { erase: true });
  }
  markReleased(record) {
    if (record.queryCallerAddress) {
      this.world.runtime.imageDataBuffers.process.free(record.queryCallerAddress);
      delete record.queryCallerAddress;
    }
    const routes = this.records.get(record.parent)?.nativeTaskRoutes;
    for (const [key, branch] of routes ?? [])
      if (branch === record.id) routes.set(key, RELEASED_BRANCH);
  }
  callerAddress(id) {
    const record = this.records.get(id);
    if (!record) throw new Error('Native query caller is absent');
    if (record.queryCallerAddress) return record.queryCallerAddress;
    const projection = this.world.nativeEngine?.features.get('task-memory')?.refs.entries.get(id);
    if (projection) return projection.pointer;
    const memory = this.world.runtime.imageDataBuffers.process;
    record.queryCallerAddress = memory.allocate(4);
    memory.store(record.queryCallerAddress, record.queryCallerAddress);
    return record.queryCallerAddress;
  }
  unregister(record, { erase = false } = {}) {
    const parents = [];
    let parent = this.records.get(record.parent);
    while (parent && this.registry(parent).has(idOf(record))) {
      parents.push(parent);
      parent = this.records.get(parent.parent);
    }
    // 5DD9D0/4B9C10 recurse before updating the local entry. The helper
    // follows parent pointers and does not stop at a Top boundary.
    for (const owner of parents.reverse()) {
      if (erase) owner.nativeTaskRoutes.delete(idOf(record));
      else owner.nativeTaskRoutes.set(idOf(record), null);
    }
  }
  branch(record, nativeID, teardown = false) {
    const branch = record.nativeTaskRoutes?.get(nativeID);
    if (branch === RELEASED_BRANCH) {
      if (teardown) return null;
      throw new Error(
        `Native task route ${nativeID} crosses a released branch of task ${record.id}`,
      );
    }
    return this.records.get(branch) ?? null;
  }
  lookupPath(record, nativeID, teardown = false) {
    let pointer = null;
    const visited = new Set();
    while (record) {
      if (idOf(record) === nativeID) return { found: true, pointer: record };
      if (visited.has(record.id)) throw new Error('Native task route cycle');
      visited.add(record.id);
      if (!record.nativeTaskRoutes?.has(nativeID)) break;
      pointer = this.branch(record, nativeID, teardown);
      if (!pointer) return { found: true, pointer: null };
      record = pointer;
    }
    // The original lookup returns false while leaving the last branch in
    // its output word. A present null entry instead returns true.
    return { found: false, pointer };
  }
  lookupPointer(record, nativeID) {
    return this.lookupPath(record, nativeID).pointer;
  }
  pruneNullRoutes(record) {
    for (const key of this.registry(record).keys())
      if (!this.lookupPointer(record, key)) record.nativeTaskRoutes.delete(key);
  }
  lookup(record, nativeID) {
    const { found, pointer } = this.lookupPath(record, nativeID);
    return found ? pointer : null;
  }
  resolve(senderWorldID, nativeID) {
    nativeID = nativeEngineWord(nativeID, 'Native task lookup');
    let record = this.records.get(senderWorldID);
    const seen = new Set();
    while (record) {
      if (seen.has(record.id)) throw new Error('Native task parent cycle');
      seen.add(record.id);
      const { found, pointer } = this.lookupPath(record, nativeID);
      if (found && pointer) return pointer.id;
      if (pointer || record.kind === 1) return null;
      record = this.records.get(record.parent);
    }
    return null;
  }
  allocateNativeID(topWorldID) {
    const top = this.records.get(topWorldID);
    if (!top || top.kind !== 1)
      throw new Error('Native task ID allocation requires its owning Top');
    let id = 0;
    while (this.lookupPath(top, id).found) {
      if (++id > 0xffffffff) throw new Error('Native task ID space exhausted');
    }
    return id;
  }
  creation(parentWorldID) {
    const top = this.closestTop(parentWorldID);
    if (!top) throw new Error(`Native parent task ${parentWorldID} has no Top namespace`);
    return { nativeID: this.allocateNativeID(top.id), namespace: top.id, frameRate: top.frameRate };
  }
  memory(sender, context) {
    const memory =
      context.payload ||
      context.machine ||
      this.world.objects.machine?.(context.nativeSenderWorldID ?? sender);
    if (!memory) throw new Error(`Native task message from ${sender} requires sender memory`);
    return memory;
  }
  sharedBytes(record) {
    const reference = record.sharedDataRef;
    if (!reference) return record.sharedData;
    if (reference.kind === 'runtime') {
      const bytes = this.world.runtime?.scheduler.shared;
      if (!bytes || reference.address + reference.length > bytes.length)
        throw new Error('Native runtime shared-data range is unavailable');
      return bytes.subarray(reference.address, reference.address + reference.length);
    }
    if (!reference.length) return new Uint8Array();
    const memory =
      reference.kind === 'engine'
        ? this.world.nativeEngine?.process
        : reference.kind === 'vm' || reference.kind === 'vm-block'
          ? (this.world.runtime?.scheduler.tasks.get(reference.taskID)?.machine ??
            this.world.objects.machine?.(reference.taskID))
          : null;
    if (!memory) throw new Error(`Native task ${record.id} shared-data source is unavailable`);
    if (reference.memoryID !== undefined && reference.memoryID !== memory.memoryID)
      throw new Error('Native shared-data source interpreter was replaced');
    if (reference.kind === 'vm-block') {
      const index = memory.blockIndex(reference.blockID);
      if (index < 0) throw new Error('Native shared-data source allocation was released');
      const bytes = memory.blockBytes(index);
      if (reference.offset + reference.length > bytes.length)
        throw new Error('Native shared allocation range is unavailable');
      return bytes.subarray(reference.offset, reference.offset + reference.length);
    }
    if (reference.kind === 'engine' && typeof memory.view === 'function')
      return memory.view(reference.address, reference.length);
    return bytesAt(memory, reference.address, reference.length);
  }
  normalizeSharedVM(taskID, address, length) {
    const visited = new Set();
    let expectedMemoryID;
    while (address >= 0x80000000) {
      if (visited.has(taskID)) throw new Error('Native VM shared-data reference cycle');
      visited.add(taskID);
      const source = this.records.get(taskID),
        machine =
          this.world.runtime?.scheduler.tasks.get(taskID)?.machine ??
          this.world.objects.machine?.(taskID),
        offset = address - 0x80000000,
        reference = source?.scriptSharedBound ? source.sharedDataRef : null;
      if (!machine) throw new Error('Native VM shared-data source is unavailable');
      if (expectedMemoryID !== undefined && expectedMemoryID !== machine.memoryID)
        throw new Error('Native shared-data source interpreter was replaced');
      if (reference?.kind === 'engine' || reference?.kind === 'runtime')
        return { reference: { ...reference, address: (reference.address + offset) >>> 0, length } };
      if (reference?.kind === 'vm-block')
        return { reference: { ...reference, offset: reference.offset + offset, length } };
      if (reference?.kind === 'vm') {
        expectedMemoryID = reference.memoryID;
        taskID = reference.taskID;
        address = (reference.address + offset) >>> 0;
        continue;
      }
      const bytes = machine.shared,
        shared = this.world.runtime?.scheduler.shared;
      if (
        shared &&
        bytes.buffer === shared.buffer &&
        bytes.byteOffset === shared.byteOffset &&
        bytes.length === shared.length
      )
        return { reference: { kind: 'runtime', address: offset, length } };
      return { reference: null, data: bytesAt(machine, address, length) };
    }
    const machine =
      this.world.runtime?.scheduler.tasks.get(taskID)?.machine ??
      this.world.objects.machine?.(taskID);
    if (machine?.memoryID === undefined)
      return { reference: { kind: 'vm', taskID, address, length } };
    if (expectedMemoryID !== undefined && expectedMemoryID !== machine.memoryID)
      throw new Error('Native shared-data source interpreter was replaced');
    const common = { taskID, memoryID: machine.memoryID, length };
    if (address < machine.memory.length) return { reference: { kind: 'vm', ...common, address } };
    let base = machine.memory.length;
    for (let index = 0; index < machine.blocks.length; index++) {
      const bytes = machine.blockBytes(index);
      if (address < base + bytes.length)
        return {
          reference: {
            kind: 'vm-block',
            ...common,
            blockID: machine.blockIDs[index],
            offset: address - base,
          },
        };
      base += bytes.length;
    }
    throw new Error('Native VM shared-data allocation is unavailable');
  }
  bindSharedData(record, sender, length, address, context) {
    sender = context.nativeSenderWorldID ?? sender;
    const memory = length ? this.memory(sender, context) : null;
    const vm = this.world.objects.machine?.(sender);
    const data = length ? bytesAt(memory, address, length) : new Uint8Array();
    let reference =
      context.nativePointer && this.world.nativeEngine
        ? { kind: 'engine', address, length }
        : !length
          ? null
          : memory === this.world.nativeEngine?.process
            ? { kind: 'engine', address, length }
            : memory === vm
              ? { kind: 'vm', taskID: sender, address, length }
              : null;
    let storage = data;
    if (reference?.kind === 'vm') {
      const normalized = this.normalizeSharedVM(sender, address, length);
      reference = normalized.reference;
      if (!reference) storage = normalized.data;
    }
    record.sharedDataAddress = address >>> 0;
    record.sharedDataRef = reference;
    record.sharedData = reference ? new Uint8Array() : storage;
    if (!record.sharedDataRef && length && typeof memory.bytes !== 'function')
      throw new Error(
        'Native shared data requires a live byte view or a restorable memory reference',
      );
  }
  base(record) {
    record.context ??= {
      contextName:
        this.world.runtime?.scheduler.tasks.get(record.creator)?.context.contextName || '',
    };
    record.exitCode ??= -1;
    record.flags ??= record.kind;
    record.userValue ??= 0;
    record.nativeID ??= record.id;
    if (record.namespace === undefined)
      record.namespace =
        record.parent === null ? null : (this.closestTop(record.parent)?.id ?? null);
    if (!record.nativeTaskRoutes) {
      record.nativeTaskRoutes = new Map();
      this.attach(record);
    }
    const protocol = this;
    return {
      async message(words, context = {}) {
        const [sender, message, w, l] = words;
        context.nativeUnhandled = false;
        switch (message) {
          case 2: {
            const child = protocol.records.get(l),
              existing = protocol.registry(record).get(w);
            if (existing !== undefined && existing !== null) return 0;
            if (!child || idOf(child) !== w)
              throw new Error('Native task registration requires its actual task identity');
            const previousParent = child.parent;
            child.parent = record.id;
            record.nativeTaskRoutes.set(w, child.id);
            try {
              await protocol.world.nativeEngine?.features.get('task-memory')?.sync(child);
              await child.implementation.parentAssigned?.(record.id);
            } catch (error) {
              child.parent = previousParent;
              if (existing === undefined) record.nativeTaskRoutes.delete(w);
              else record.nativeTaskRoutes.set(w, existing);
              throw error;
            }
            delete child.detached;
            return NATIVE_UNWRITTEN_WORD;
          }
          case 3:
            record.destroyRequested = true;
            return NATIVE_UNWRITTEN_WORD;
          case 13:
            return nativeEngineWord(record.flags, 'Native task kind/flags');
          case 15:
            return protocol.dumpSize(record, context);
          case 16:
            return protocol.dump(record, sender, l, context);
          case 17:
            return NATIVE_UNWRITTEN_WORD;
          case 23:
            return record.exitCode >>> 0;
          case 24:
            record.exitCode = l | 0;
            return NATIVE_UNWRITTEN_WORD;
          case 29:
            record.userValue = l >>> 0;
            return NATIVE_UNWRITTEN_WORD;
          default:
            context.nativeUnhandled = true;
            return NATIVE_UNWRITTEN_WORD;
        }
      },
      snapshot: () => ({}),
      restore() {},
    };
  }
  async root(record, { restoring = false } = {}) {
    const protocol = this,
      base = this.base(record),
      layout = this.layout,
      root = {
        ...base,
        input: null,
        sound: null,
        caption: '.',
        field: 0,
        get sharedData() {
          return protocol.sharedBytes(record);
        },
        async message(words, context = {}) {
          const [sender, message, w, l] = words;
          context.nativeUnhandled = false;
          if ([1, 2, 3].includes(message)) return base.message(words, context);
          if (!layout.captionWide && message === 15) return protocol.dumpSize(record, context);
          if (!layout.captionWide && message === 16)
            return protocol.dump(record, sender, l, context);
          const operation = message - layout.rootStart;
          if (operation === 0) protocol.bindSharedData(record, sender, w, l, context);
          else if (operation === 1) return Number(protocol.registry(record).has(w));
          else if (operation === 2 || operation === 3) {
            const selected = protocol.records.get(operation === 2 ? root.input : root.sound);
            if (!selected) throw new Error('Native Top input/sound task is absent');
            return idOf(selected);
          } else if (operation === 5)
            root.caption = readString(protocol.memory(sender, context), l, layout.captionWide);
          else if (operation === 6)
            putBytes(
              protocol.memory(sender, context),
              l,
              stringBytes(root.caption, layout.captionWide),
            );
          else if (operation === 7)
            await protocol.send(root.sound, record.id, layout.soundReset, 0, 0, context);
          else if (operation === 8) root.field = l >>> 0;
          else if (operation === 4 && !layout.captionWide) {
            if (context.writeNativeTaskDump) await context.writeNativeTaskDump(record);
            else await protocol.saveDump(record, sender, w, l, context);
          }
          context.nativeUnhandled = false;
          return NATIVE_UNWRITTEN_WORD;
        },
        snapshot: () => ({
          input: root.input,
          sound: root.sound,
          caption: root.caption,
          field: root.field,
        }),
        restore(state) {
          root.input = state.input;
          root.sound = state.sound;
          root.caption = state.caption;
          root.field = state.field;
        },
      };
    record.sharedData ??= new Uint8Array();
    record.sharedDataRef ??= null;
    record.sharedDataAddress ??= 0;
    if (!restoring) {
      root.input = await this.world.objects.create({
        kind: 11,
        parent: record.id,
        name: 'INPUT TASK',
        ...this.creation(record.id),
      });
      root.sound = await this.world.objects.create({
        kind: 13,
        parent: record.id,
        name: 'SOUND TASK',
        ...this.creation(record.id),
      });
    }
    return root;
  }
  async dumpSize(record, context) {
    let size =
      60 + (record.kind === 1 && !this.layout.captionWide ? this.sharedBytes(record).length : 0);
    await this.eachChild(record, async (child) => {
      const reply = await this.send(child.id, record.id, 15, 0, 0, context);
      size = (size + nativeEngineWord(reply, 'Native child dump size')) >>> 0;
    });
    return size;
  }
  async dump(record, sender, address, context) {
    const memory = this.memory(sender, context),
      header = record.nativeDumpHeader?.slice() ?? bytesAt(memory, address, 60).slice();
    if (header.length !== 60) throw new Error('Native task dump header must contain 60 bytes');
    const type = stringBytes(record.nativeTypeName ?? '', false),
      name = stringBytes(record.name, false);
    if (type.length > 16 || name.length > 32)
      throw new Error('Native task dump name exceeds its mapped header field');
    if (!record.nativeDumpHeader || record.nativeTypeName !== undefined) header.set(type, 0);
    header.set(name, 16);
    const view = new DataView(header.buffer),
      shared =
        record.kind === 1 && !this.layout.captionWide ? this.sharedBytes(record) : new Uint8Array();
    view.setUint32(48, idOf(record), true);
    view.setUint32(56, shared.length, true);
    let size = 60 + shared.length,
      children = 0;
    putBytes(memory, address, header);
    if (shared.length) putBytes(memory, address + 60, shared);
    const hadPayload = Object.hasOwn(context, 'payload'),
      oldPayload = context.payload;
    context.payload = memory;
    try {
      await this.eachChild(record, async (child) => {
        const reply = await this.send(child.id, record.id, 16, 0, address + size, context);
        size = (size + nativeEngineWord(reply, 'Native child dump bytes')) >>> 0;
        children++;
      });
    } finally {
      if (hadPayload) context.payload = oldPayload;
      else delete context.payload;
    }
    const count = new Uint8Array(4);
    new DataView(count.buffer).setUint32(0, children, true);
    putBytes(memory, address + 52, count);
    return size;
  }
  async saveDump(record, sender, tag, filenameAddress, context) {
    const filename = readString(this.memory(sender, context), filenameAddress, false),
      size = await this.dumpSize(record, context),
      bytes = new Uint8Array(size + 20),
      view = new DataView(bytes.buffer),
      memory = { bytes: (at, count) => bytes.subarray(at, at + count) };
    view.setUint32(0, 0x00535343 /* exe-address-check: non-address - CSS file signature */, true);
    view.setUint32(4, size, true);
    view.setUint32(8, tag >>> 0, true);
    const hadPayload = Object.hasOwn(context, 'payload'),
      oldPayload = context.payload;
    context.payload = memory;
    try {
      await this.dump(record, sender, 20, context);
    } finally {
      if (hadPayload) context.payload = oldPayload;
      else delete context.payload;
    }
    if (typeof this.world.storage?.write !== 'function')
      throw new Error('Native SDK task dump requires its file service');
    const name = `${record.implementation.caption}\\${filename}`.replaceAll('\\', '/');
    if (!(await this.world.storage.write(name, bytes)))
      this.world.host.nativeLog?.(`Native task dump write failed: ${name}`);
  }
  async invoke(record, packet, context, output) {
    context.nativeUnhandled = false;
    context.nativeSenderWorldID = packet.senderWorldID;
    context.flags = packet[5];
    if (record.destroyRequested) return 0;
    const result = await record.implementation.message(
      [packet[1], packet[2], packet[3], packet[4]],
      context,
    );
    if (typeof result === 'number')
      output.value = nativeEngineWord(result, `Task ${record.id} message ${packet[2]}`);
    else if (result !== undefined && result !== NATIVE_UNWRITTEN_WORD)
      throw new Error(`Task ${record.id} message ${packet[2]} returned an invalid output word`);
    return Number(!!context.nativeUnhandled);
  }
  async route(record, packet, context, output) {
    if (packet[2] === 11 || packet[2] === 12) {
      const memory = this.memory(packet.senderWorldID, context),
        embedded = Array.from({ length: 6 }, (_, i) => readWord(memory, packet[4] + i * 4));
      embedded[0] = idOf(record);
      embedded[1] = packet[1];
      embedded.senderWorldID = packet.senderWorldID;
      let control = 1;
      if (packet[2] === 11 || record.flags >>> 0 === packet[3])
        control = await this.invoke(record, embedded, context, output);
      await this.eachChild(record, async (child) => {
        control = await this.route(child, packet, context, output);
      });
      return control;
    }
    if (packet[0] === idOf(record)) {
      const unhandled = await this.invoke(record, packet, context, output);
      if (unhandled && packet[5])
        await this.eachChild(record, async (child) => {
          packet[0] = idOf(child);
          await this.route(child, packet, context, output);
          if (packet[2] === 2 && !record.nativeTaskRoutes.has(packet[3]))
            record.nativeTaskRoutes.set(packet[3], child.id);
        });
      return 1;
    }
    const child = this.branch(record, packet[0]);
    if (!child) return 0;
    const control = await this.route(child, packet, context, output);
    if (packet[2] === 2 && !record.nativeTaskRoutes.has(packet[3]))
      record.nativeTaskRoutes.set(packet[3], child.id);
    return control;
  }
  async registerTask(top, packet, context, output) {
    const name = readString(this.memory(packet.senderWorldID, context), packet[4], false),
      id = await this.world.objects.create({
        kind: packet[3],
        name,
        creator: packet.senderWorldID,
        detached: true,
        effectiveFrame: ((top.effectiveFrame ?? 0) - (top.pausedFrames ?? 0)) >>> 0,
        fromHost: context.fromHost,
        ...this.creation(top.id),
      }),
      nativeID = idOf(this.records.get(id)),
      hadNewTask = Object.hasOwn(context, 'nativeNewTask'),
      oldNewTask = context.nativeNewTask;
    context.nativeNewTask = id;
    packet[2] = 2;
    packet[3] = nativeID;
    packet[4] = id;
    try {
      // The PE reply starts with the allocated pointer, even if routing
      // cannot find the parent. It must survive an ID lookup miss.
      const out = context.nativePointer && context.nativeResult,
        p = out && this.world.nativeEngine.process;
      if (p) {
        const tasks = await this.world.getNativeFeature('task-memory');
        p.store(out, await tasks.pointer(id));
      }
      const control = await this.route(top, packet, context, output);
      if (output.value === NATIVE_UNWRITTEN_WORD) {
        output.value = nativeID;
        context.nativeCreatedTask = id;
      } else {
        if (output.value !== 0) throw new Error('Unexpected native task registration result');
        if (p) p.store(out, 0);
        context.nativeCreatedTask = null;
      }
      return control;
    } catch (error) {
      try {
        await this.world.objects.release(id, { rollback: true, fromHost: context.fromHost });
      } catch (cleanup) {
        error.cleanup = cleanup;
      }
      throw error;
    } finally {
      if (hadNewTask) context.nativeNewTask = oldNewTask;
      else delete context.nativeNewTask;
    }
  }
  async upward(record, packet, context, output) {
    if (record.kind === 1) {
      if (packet[2] === 1) return this.registerTask(record, packet, context, output);
      return this.route(record, packet, context, output);
    }
    const parent = this.records.get(record.parent);
    if (!parent) return 0;
    if (packet[2] !== 1 && (packet[2] <= 10 || packet[2] > 12) && packet[0] === idOf(record))
      return this.route(record, packet, context, output);
    const branch = packet[2] !== 1 && this.branch(record, packet[0]);
    if (branch) return this.route(branch, packet, context, output);
    return this.upward(parent, packet, context, output);
  }
  async dispatchNative(senderWorldID, targetNativeID, message, w = 0, l = 0, context = {}) {
    const origin = this.records.get(senderWorldID);
    if (!origin) throw new Error(`Native message origin ${senderWorldID} is absent`);
    const packet = [
      nativeEngineWord(targetNativeID),
      nativeEngineWord(context.nativeSender ?? idOf(origin)),
      nativeEngineWord(message),
      nativeEngineWord(w),
      nativeEngineWord(l),
      nativeEngineWord(context.flags ?? 0),
    ];
    packet.senderWorldID = senderWorldID;
    const output = { value: NATIVE_UNWRITTEN_WORD };
    context.nativeUnhandled = true;
    context.nativeSenderWorldID = senderWorldID;
    let control;
    if (message !== 1 && (message <= 10 || message > 12) && packet[0] === idOf(origin))
      control = await this.route(origin, packet, context, output);
    else {
      const branch = message !== 1 && this.branch(origin, packet[0]);
      control = branch
        ? await this.route(branch, packet, context, output)
        : await this.upward(origin, packet, context, output);
    }
    return { routed: !!control, handled: !context.nativeUnhandled, result: output.value };
  }
  async dispatch(target, sender, message, w = 0, l = 0, context = {}) {
    const record = this.records.get(target);
    if (!record) {
      context.nativeUnhandled = true;
      return { routed: false, handled: false, result: NATIVE_UNWRITTEN_WORD };
    }
    const source = this.records.get(sender),
      packet = [
        idOf(record),
        source ? idOf(source) : sender >>> 0,
        nativeEngineWord(message),
        nativeEngineWord(w),
        nativeEngineWord(l),
        nativeEngineWord(context.flags ?? 0),
      ];
    packet.senderWorldID = sender;
    context.nativeSenderWorldID = sender;
    const output = { value: NATIVE_UNWRITTEN_WORD },
      control = await this.route(record, packet, context, output);
    return { routed: !!control, handled: !context.nativeUnhandled, result: output.value };
  }
  async send(...args) {
    return (await this.dispatch(...args)).result;
  }
}
