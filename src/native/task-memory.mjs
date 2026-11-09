// SPDX-License-Identifier: MPL-2.0
// The common native task prefix is a view of the World's task graph. A base
// prefix never stands in for an implemented derived task factory.
import { encodeCP932 } from '../kcs/strings.mjs';
import { NATIVE_UNWRITTEN_WORD } from './engine-message.mjs';

export class NativeTaskMemory {
  constructor(engine, world) {
    this.engine = engine;
    this.world = world;
    this.process = engine.process;
    this.sdk = engine.profile.startsWith('sdk-');
    this.views = new Map();
    this.releasingPrefixes = new Set();
    this.sharedBindings = new Map();
    this.memoryBindings = new Map();
    this.inlineSharedSources = new WeakMap();
    this.mappingMachines = new Set();
    this.hostSources = new WeakMap();
    this.inlineHostBindings = new Map();
    this.frameFields = new Uint8Array(24);
    this.frameWords = new DataView(this.frameFields.buffer);
    if (engine.module) this.installBaseReceiver();
    this.detachDestruction = this.process.beforeInstruction(
      this.sdk ? 0x4b9120 : 0x5dcf00,
      'native BaseTask destruction',
      (p) => {
        const pointer = p.cpu.reg_read_i32(p.uc.X86_REG_ECX) >>> 0,
          id = this.worldID(pointer),
          entry = this.refs.entries.get(id),
          record = this.world.objects.objects.get(id);
        if (entry?.owned || !record) return;
        return (async () => {
          await this.world.objects.baseDestruction(id, { fromHost: true });
          await this.prune();
        })();
      },
    );
    engine.registerFeature('task-memory', this);
  }
  installBaseReceiver() {
    if (this.baseReceiverInstalled) return;
    this.engine.patch(
      this.sdk ? 0x4b9360 : 0x5dd130,
      'shared native BaseTask receiver',
      2,
      (args) => this.baseMessage(args),
      { calleePops: true },
    );
    this.baseReceiverInstalled = true;
  }
  async baseMessage([packet, out]) {
    const p = this.process,
      [, sender, rawMessage, w, l, flags] = Array.from({ length: 6 }, (_, i) =>
        p.load(packet + i * 4),
      ),
      pointer = p.cpu.reg_read_i32(p.uc.X86_REG_ECX) >>> 0,
      id = this.worldID(pointer),
      record = this.world.objects.objects.get(id),
      message = this.sdk && rawMessage >= 37 ? rawMessage + 2 : rawMessage;
    if (message === 3 && this.releasingPrefixes.has(pointer)) {
      p.store(pointer + 84, 1);
      return 0;
    }
    if (!record) {
      // Canonical tasks can already be gone when the final owned mirror is
      // destroyed. The original BaseDtor's private self-notification only
      // sets this one common field; it must not resurrect a World task.
      if (id !== undefined && message === 3) {
        p.store(pointer + 84, 1);
        return 0;
      }
      throw new Error('Native BaseTask receiver has no live task binding');
    }
    const incoming =
        this.engine.currentMessageContext?.receiver === id
          ? this.engine.currentMessageContext.context
          : {},
      senderWorldID =
        incoming.nativeSenderWorldID ??
        (this.world.resolveTaskID ? this.world.resolveTaskID(sender, id) : sender),
      context = {
        ...incoming,
        payload: {
          load: (address) => p.load(address),
          store: (address, value) => p.store(address, value),
          read: (address, size) => p.read(address, size),
          write: (address, bytes) => p.write(address, bytes),
          string: (address, wide = false) => p.string(address, wide),
          writeString: (address, text, wide = false) =>
            this.engine.kernel.writeString(address, text, wide),
        },
        nativePointer: true,
        nativeResult: out,
        nativeSenderWorldID: senderWorldID,
        flags,
        fromHost: true,
      },
      child = message === 2 ? this.worldID(l) : undefined;
    if (message === 2 && child === undefined)
      throw new Error('Native BaseTask registration has no actual child binding');
    const value = await this.world.base(record).message([sender, message, w, child ?? l], context);
    incoming.nativeUnhandled = Boolean(context.nativeUnhandled);
    if (out && Number.isInteger(value)) p.store(out, value);
    if (!context.nativeUnhandled) {
      if (message === 3) p.store(pointer + 84, 1);
      if (message === 24) p.store(pointer + 80, record.exitCode);
      if (message === 29) p.store(pointer + 92, record.userValue);
      if (message === 2 && value === NATIVE_UNWRITTEN_WORD) p.store(l + 12, pointer);
    }
    return Number(Boolean(context.nativeUnhandled));
  }
  messageOptions(record, context) {
    return { task: record.id, messageContext: { receiver: record.id, context } };
  }
  get refs() {
    return (this.engine.refs.tasks ??= {
      entries: new Map(),
      byPointer: new Map(),
      machines: new Map(),
      shared: new Map(),
      arenas: new Map(),
    });
  }
  call(address, args, pointer) {
    return this.process.asyncEnabled
      ? this.engine.callFromHost(address, args, pointer)
      : this.process.callAsync(address, args, pointer);
  }
  bind(record, pointer, { ready = true } = {}) {
    const previous = this.refs.entries.get(record.id);
    if (previous?.owned && previous.pointer !== pointer)
      throw new Error('An owned common task prefix must be released before a derived binding');
    if (!Number.isInteger(pointer) || !pointer)
      throw new Error('Native task binding needs a guest pointer');
    this.refs.entries.set(record.id, { pointer, owned: false, ready });
    this.refs.byPointer.set(pointer, record.id);
    return pointer;
  }
  unbind(id) {
    const entry = this.refs.entries.get(id);
    if (!entry) return;
    if (entry.owned) throw new Error('Owned common task prefixes require their native destructor');
    this.refs.byPointer.delete(entry.pointer);
    this.refs.entries.delete(id);
  }
  worldID(pointer) {
    return this.refs.byPointer.get(pointer);
  }
  machine(id) {
    const machine = this.world.objects.machine(id);
    return machine?.memory instanceof Uint8Array && machine.shared instanceof Uint8Array
      ? machine
      : null;
  }
  async ready(record) {
    const entry = this.refs.entries.get(record.id);
    if (!entry) throw new Error('Native task constructor did not bind its prefix');
    entry.ready = true;
    await this.sync(record, entry);
  }
  async pointer(id, synchronized) {
    if (id === null) return 0;
    const record = this.world.objects.objects.get(id);
    if (!record) throw new Error(`Native task prefix refers to missing World task ${id}`);
    let entry = this.refs.entries.get(id);
    const actual = record.implementation?.pointer;
    if (actual && entry?.pointer !== actual) {
      if (entry?.owned) {
        synchronized?.clear();
        await this.release(entry);
        this.refs.entries.delete(id);
      }
      this.bind(record, actual);
      entry = this.refs.entries.get(id);
    }
    if (!entry) {
      if (record.state === 'creating')
        throw new Error(`Native task ${id} has not bound its constructor`);
      const p = this.process,
        name = encodeCP932(record.name + '\0');
      if (name.length > 32)
        throw new RangeError('Native task name exceeds its 32-byte common record');
      const source = p.allocate(name.length),
        pointer = p.allocate(0x400, true);
      p.write(source, name);
      try {
        // An original constructor can call back into the task graph.
        synchronized?.clear();
        await this.call(
          this.sdk ? 0x4b8cd0 : 0x5dcab0,
          [record.nativeID ?? id, source, record.frameRate],
          pointer,
        );
      } catch (error) {
        p.free(pointer);
        throw error;
      } finally {
        p.free(source);
      }
      entry = { pointer, owned: true, ready: true };
      this.refs.entries.set(id, entry);
      this.refs.byPointer.set(pointer, id);
    }
    if (entry.ready && !synchronized?.has(entry)) {
      await this.sync(record, entry, synchronized);
      synchronized?.add(entry);
    }
    return entry.pointer;
  }
  async sync(record, entry = this.refs.entries.get(record.id), synchronized) {
    if (!entry?.ready) return;
    const p = this.process,
      at = entry.pointer;
    p.store(at + 4, record.nativeID ?? record.id);
    p.store(at + 12, await this.pointer(record.parent, synchronized));
    p.store(at + 64, record.flags ?? record.kind);
    p.store(at + 72, record.frameRate);
    const frame = this.frameWords;
    frame.setUint32(0, record.exitCode ?? -1, true);
    frame.setUint32(4, Number(Boolean(record.destroyRequested)), true);
    frame.setUint32(8, record.pausedFrames ?? 0, true);
    frame.setUint32(12, record.userValue ?? 0, true);
    frame.setUint32(16, record.lastFrame ?? 0, true);
    frame.setUint32(20, record.effectiveFrame ?? 0, true);
    p.write(at + 80, this.frameFields);
    if (this.engine.features.get('renderer')?.initialized === true) {
      const view = this.engine.features.get('graphics-platform')?.refs.view;
      if (!view) throw new Error('Initialized native renderer has no shared view');
      if (record.kind === 1) p.store(at + 104, view);
      else if (record.kind === 12) p.store(at + 116, view);
    }
    if (record.kind === 12) {
      const machine = this.machine(record.id);
      if (machine) {
        p.store(at + 112, this.vmPointer(record.id));
        if (record.scriptSharedBound) {
          const mapping = this.refs.machines.get(record.id);
          p.store(at + 132, mapping.shared.pointer);
          p.store(at + 136, machine.shared.length);
        }
      }
    }
    // Root shared-data storage is owned by the engine-message service. When
    // its source is already guest memory, both views use the same address.
    if (record.kind === 1 && record.sharedData !== undefined) {
      const shared = record.sharedDataRef,
        root = record.implementation;
      let address, length;
      if (shared?.kind === 'engine') {
        address = shared.address;
        length = shared.length;
      } else if (shared?.kind === 'runtime') {
        address = this.runtimeBuffer().pointer + shared.address;
        length = shared.length;
      } else if (shared?.kind === 'vm' || shared?.kind === 'vm-block') {
        const reference = this.externalSharedReference(record.id, shared);
        if (!reference) throw new Error('Native Top shared-data source is absent');
        record.sharedDataRef = { ...reference };
        address = reference.address;
        length = reference.length;
      } else if (!record.sharedData.length) {
        address = record.sharedDataAddress ?? 0;
        length = 0;
      } else {
        const storage = this.inlineRoot(record);
        address = storage.pointer;
        length = storage.capacity;
      }
      p.store(at + 112, address);
      p.store(at + 116, length);
      if (root) {
        for (const [offset, id] of [
          [120, root.input],
          [124, root.sound],
        ]) {
          const child = this.world.objects.objects.get(id);
          // Root's stored device IDs outlive those children during BaseDtor.
          // A later sibling's raw destructor can still inspect this prefix.
          if (child) p.store(at + offset, child.nativeID ?? id);
        }
        const caption = root.caption ?? '.',
          bytes = this.sdk ? encodeCP932(caption + '\0') : new Uint8Array((caption.length + 1) * 2);
        if (!this.sdk)
          for (let i = 0; i < caption.length; i++)
            new DataView(bytes.buffer).setUint16(i * 2, caption.charCodeAt(i), true);
        if (bytes.length > (this.sdk ? 260 : 520))
          throw new RangeError('Native Top caption exceeds its original record');
        p.write(at + 128, bytes);
        p.store(at + (this.sdk ? 392 : 652), root.field ?? 0);
      }
    }
  }
  inlineRoot(record) {
    const bytes = record.sharedData;
    let pointer = this.process.addressOf(bytes),
      source;
    if (pointer === null) {
      source = this.hostSources.get(bytes.buffer);
      if (source?.storage?.released) source = null;
      if (!source) {
        const previous = this.refs.shared.get(record.id),
          arenas = (this.refs.inlineArenas ??= new Map()),
          restored = previous?.inlineID && arenas.get(previous.inlineID);
        if (restored && !this.inlineHostBindings.has(record.id)) {
          source = {
            inlineID: previous.inlineID,
            storage: restored,
            bias: previous.pointer - bytes.byteOffset,
            mirror: true,
          };
        } else {
          const size = bytes.buffer.byteLength,
            allocationBase = this.allocateBlock(size, true),
            storage = {
              pointer: allocationBase + 4,
              capacity: size,
              allocationBase,
              heapHeader: true,
            },
            inlineID = this.refs.nextInlineID ?? 1;
          this.process.store(allocationBase, 1);
          this.refs.nextInlineID = inlineID + 1;
          this.refs.arenas.set(allocationBase, size + 4);
          arenas.set(inlineID, storage);
          source = { inlineID, storage, bias: storage.pointer, mirror: true };
        }
        this.hostSources.set(bytes.buffer, source);
      }
      pointer = source.bias + bytes.byteOffset;
      if (
        pointer < source.storage.pointer ||
        pointer + bytes.length > source.storage.pointer + source.storage.capacity
      )
        throw new Error('Native inline shared span exceeds its source allocation');
      if (source.mirror) {
        this.writeHostChanges({ pointer, bytes, source });
        this.inlineHostBindings.set(record.id, { pointer, bytes, source, baseline: bytes.slice() });
      }
    }
    const storage = { pointer, capacity: bytes.length, external: true, inlineID: source?.inlineID };
    this.refs.shared.set(record.id, storage);
    record.sharedDataRef = { kind: 'engine', address: pointer, length: bytes.length };
    record.sharedData = new Uint8Array();
    this.pullHostBindings();
    return storage;
  }
  writeHostChanges(binding) {
    const { pointer, bytes, source, baseline } = binding;
    let begin = -1;
    for (let i = 0; i <= bytes.length; i++) {
      let changed = false;
      if (i < bytes.length) {
        let previous = baseline?.[i];
        if (previous === undefined) {
          const address = pointer + i,
            prior = [...this.inlineHostBindings.values()].find(
              (other) =>
                other.source === source &&
                address >= other.pointer &&
                address < other.pointer + other.bytes.length,
            );
          if (prior) previous = prior.baseline[address - prior.pointer];
        }
        changed = previous === undefined || previous !== bytes[i];
      }
      if (changed && begin < 0) begin = i;
      if (!changed && begin >= 0) {
        this.process.write(pointer + begin, bytes.subarray(begin, i));
        begin = -1;
      }
    }
  }
  pullHostBindings() {
    for (const [id, binding] of this.inlineHostBindings) {
      const reference = this.world.objects.objects.get(id)?.sharedDataRef;
      if (
        reference?.kind !== 'engine' ||
        reference.address !== binding.pointer ||
        reference.length !== binding.bytes.length
      )
        this.inlineHostBindings.delete(id);
      else {
        const bytes = this.process.read(binding.pointer, binding.bytes.length);
        binding.bytes.set(bytes);
        binding.baseline = bytes;
      }
    }
  }
  buffer(storage, bytes) {
    if (!(bytes instanceof Uint8Array))
      throw new TypeError('Native task storage needs a byte view');
    if (!storage || storage.capacity < bytes.length) {
      if (storage?.pointer) this.releaseBuffer(storage, true);
      storage = {
        pointer: bytes.length ? this.process.allocate(bytes.length) : 0,
        capacity: bytes.length,
      };
      if (storage.pointer) this.refs.arenas.set(storage.pointer, storage.capacity);
    }
    if (bytes.length) {
      this.process.write(storage.pointer, bytes);
      this.views.set(storage.pointer, bytes);
    }
    return storage;
  }
  releaseBuffer(storage, replacing = false) {
    const count =
      [
        ...this.refs.shared.values(),
        ...[...this.refs.machines.values()].flatMap((value) => [
          value.memory,
          value.shared,
          ...value.blocks,
        ]),
      ].filter((value) => value === storage).length - Number(replacing);
    if (count > 0 || !storage.pointer || storage.external) return;
    this.freeVMBuffer(storage);
  }
  runtimeBuffer() {
    const scheduler = this.world.runtime?.scheduler;
    if (!scheduler || typeof scheduler.bindShared !== 'function')
      throw new Error('Native runtime shared memory requires the canonical scheduler');
    let storage = this.refs.runtimeShared;
    if (!storage || (this.runtimeBinding && scheduler.sharedBinding !== this.runtimeBinding)) {
      const bytes = scheduler.shared.slice();
      if (!storage || storage.capacity !== bytes.length) {
        // Retired runtime allocations can still be borrowed by explicit raw
        // engine references. They remain owned until process teardown.
        storage = {
          pointer: bytes.length ? this.process.allocate(bytes.length) : 0,
          capacity: bytes.length,
        };
        if (storage.pointer) this.refs.arenas.set(storage.pointer, storage.capacity);
        this.refs.runtimeShared = storage;
      }
      if (storage.pointer) this.process.write(storage.pointer, bytes);
    }
    if (!this.runtimeBinding || scheduler.sharedBinding !== this.runtimeBinding) {
      // On a fresh restore, the process already contains the single canonical
      // runtime arena. The scheduler and every default VM borrow that arena.
      this.runtimeBinding = { bytes: () => this.process.view(storage.pointer, storage.capacity) };
      scheduler.bindShared(this.runtimeBinding);
    }
    return storage;
  }
  externalSharedReference(id, reference) {
    if (reference?.kind === 'engine') return reference;
    if (reference?.kind === 'runtime') {
      const storage = this.runtimeBuffer();
      if (reference.address < 0 || reference.address + reference.length > storage.capacity)
        throw new Error('Native runtime shared-memory alias exceeds its source');
      return {
        kind: 'engine',
        address: storage.pointer + reference.address,
        length: reference.length,
      };
    }
    if (!['vm', 'vm-block'].includes(reference?.kind)) return null;
    const source = this.machine(reference.taskID);
    if (!source || source.memoryID !== reference.memoryID)
      throw new Error('Native borrowed VM memory is dangling after its owner was replaced');
    const mapping = this.mappingMachines.has(reference.taskID)
      ? this.refs.machines.get(reference.taskID)
      : this.mapMachine(reference.taskID, source);
    let pointer, offset, size;
    if (reference.kind === 'vm') {
      pointer = mapping.memory.pointer;
      offset = reference.address;
      size = mapping.memory.capacity;
    } else {
      const index = mapping.blockIDs.indexOf(reference.blockID);
      if (index < 0) throw new Error('Native borrowed VM allocation has been released');
      pointer = mapping.blocks[index].pointer;
      offset = reference.offset;
      size = mapping.blocks[index].capacity;
    }
    if (!Number.isInteger(offset) || offset < 0 || offset + reference.length > size)
      throw new Error('Native borrowed VM memory exceeds its source allocation');
    return { kind: 'engine', address: pointer + offset, length: reference.length };
  }
  bindSharedMachine(id, machine, reference = this.world.objects.objects.get(id)?.sharedDataRef) {
    let external = this.externalSharedReference(id, reference);
    const scheduler = this.world.runtime?.scheduler,
      task = scheduler?.tasks.get(id);
    if (!external && task && task.defaultSharedBinding === machine.sharedBinding) {
      const storage = this.runtimeBuffer();
      external = { kind: 'engine', address: storage.pointer, length: storage.capacity };
      // Keep the scheduler's default provider token so later global bindings
      // and fresh scheduler-created tasks retain the same runtime identity.
      this.sharedBindings.set(id, { machine, address: external.address, length: external.length });
      return true;
    }
    if (!external) return false;
    const { address, length } = external;
    if (reference?.kind === 'vm' || reference?.kind === 'vm-block') {
      const record = this.world.objects.objects.get(id);
      if (record?.sharedDataRef === reference) {
        record.sharedDataRef = { kind: 'engine', address, length };
      }
    }
    if (typeof machine.bindShared !== 'function')
      throw new Error('Native KCS RAM alias requires an external shared-memory binding');
    const previous = this.sharedBindings.get(id);
    if (
      previous?.machine !== machine ||
      previous.address !== address ||
      previous.length !== length
    ) {
      // Validate now. Subsequent getter calls reacquire the physical view so
      // growth, checkpoint restoration and changed mappings cannot leave a
      // permanently cached detached Uint8Array in the VM.
      this.process.view(address, length);
      this.sharedBindings.set(id, { machine, address, length });
    }
    machine.bindShared({ bytes: () => this.process.view(address, length) });
    return true;
  }
  liveBuffer(storage, bytes, { block = false } = {}) {
    const original = bytes;
    if (!storage) {
      const address = this.process.addressOf(bytes),
        existing = this.hostSources.get(bytes.buffer);
      if (address !== null)
        storage = { pointer: address, capacity: bytes.length, live: true, external: true };
      else if (
        existing &&
        !existing.storage.released &&
        existing.bias + bytes.byteOffset >= existing.storage.pointer &&
        existing.bias + bytes.byteOffset + bytes.length <=
          existing.storage.pointer + existing.storage.capacity
      ) {
        const pointer = existing.bias + bytes.byteOffset;
        if (
          pointer === existing.storage.pointer &&
          bytes.length === existing.storage.capacity &&
          existing.inlineID
        ) {
          storage = existing.storage;
          this.refs.inlineArenas.delete(existing.inlineID);
        } else storage = { pointer, capacity: bytes.length, external: true };
        existing.mirror = false;
        for (const [id, binding] of this.inlineHostBindings)
          if (binding.source === existing) this.inlineHostBindings.delete(id);
      } else {
        const source = bytes.slice();
        const allocationBase = block
          ? this.allocateBlock(source.length)
          : this.process.allocate(source.length);
        storage = {
          // Native zero-byte allocations still own a non-NULL payload. The
          // VM's inverse address lookup excludes that empty range; NULL here
          // would change both allocation identity and failed translations.
          pointer: allocationBase + (block ? 4 : 0),
          capacity: source.length,
          live: true,
          ...(block ? { allocationBase, heapHeader: true } : {}),
        };
        if (block) this.process.store(allocationBase, 1);
        this.refs.arenas.set(allocationBase, source.length + (block ? 4 : 0));
        this.process.write(storage.pointer, source);
      }
    } else if (storage.capacity !== bytes.length)
      throw new Error('A live native VM arena changed size without a new allocation identity');
    storage.live = true;
    if (original.buffer !== this.process.uc.HEAPU8.buffer)
      this.hostSources.set(original.buffer, {
        storage,
        bias: storage.pointer - original.byteOffset,
        mirror: false,
      });
    return storage;
  }
  allocateBlock(size, zero = false) {
    const pointer = this.engine.kernel.heapAllocate(1, zero ? 8 : 0, size + 4);
    if (!pointer) throw new Error('Native VM payload allocation failed');
    return pointer;
  }
  freeVMBuffer(storage) {
    if (!storage || storage.external || !storage.pointer) return;
    this.views.delete(storage.pointer);
    const allocationBase = storage.allocationBase ?? storage.pointer;
    this.refs.arenas.delete(allocationBase);
    if (storage.heapHeader) {
      const references = this.process.load(allocationBase);
      if ((references | 0) > 1) {
        this.process.store(allocationBase, references - 1);
        storage.released = true;
        return;
      }
    }
    if (
      !(storage.heapHeader
        ? this.engine.kernel.heapRelease(1, allocationBase)
        : this.process.free(allocationBase))
    )
      throw new Error('Native VM arena was already released');
    storage.released = true;
  }
  dropMachine(id, mapping) {
    this.refs.machines.delete(id);
    this.freeVMBuffer(mapping.memory);
    for (const storage of mapping.blocks) this.freeVMBuffer(storage);
    if (mapping.shared) this.releaseBuffer(mapping.shared);
    if (mapping.vm)
      for (const pointer of [
        mapping.vm.pointer,
        mapping.vm.container,
        mapping.vm.head,
        mapping.vm.scratch,
        ...mapping.vm.nodes,
      ])
        this.freeVMBuffer({ pointer });
    this.memoryBindings.delete(id);
    this.sharedBindings.delete(id);
  }
  mapMachine(id, machine) {
    let mapping = this.refs.machines.get(id);
    if (this.mappingMachines.has(id)) return mapping;
    this.mappingMachines.add(id);
    try {
      if (mapping && mapping.memoryID !== machine.memoryID) {
        this.dropMachine(id, mapping);
        mapping = null;
      }
      if (!mapping) {
        mapping = { memoryID: machine.memoryID, blocks: [], blockIDs: [] };
        this.refs.machines.set(id, mapping);
      }
      mapping.memory = this.liveBuffer(mapping.memory, machine.memory);
      const previousMemory = this.memoryBindings.get(id);
      if (previousMemory?.machine === machine && previousMemory.binding !== machine.memoryBinding)
        this.process.write(mapping.memory.pointer, machine.memory.slice());
      const memoryPointer = mapping.memory.pointer,
        memorySize = mapping.memory.capacity,
        memoryBinding = { bytes: () => this.process.view(memoryPointer, memorySize) };
      machine.bindMemory(memoryBinding);
      this.memoryBindings.set(id, { machine, binding: memoryBinding });

      const oldBlocks = new Map(mapping.blockIDs.map((key, index) => [key, mapping.blocks[index]])),
        blockIDs = machine.blockIDs;
      mapping.blocks = blockIDs.map((key, index) => {
        const storage = this.liveBuffer(oldBlocks.get(key), machine.blockBytes(index), {
          block: true,
        });
        oldBlocks.delete(key);
        const pointer = storage.pointer,
          size = storage.capacity;
        machine.bindBlock(index, { bytes: () => this.process.view(pointer, size) });
        return storage;
      });
      mapping.blockIDs = blockIDs;
      for (const storage of oldBlocks.values()) this.freeVMBuffer(storage);

      const record = this.world.objects.objects.get(id),
        reference = record?.sharedDataRef;
      if (this.bindSharedMachine(id, machine, reference)) {
        const previous = mapping.shared,
          binding = this.sharedBindings.get(id);
        mapping.shared = { pointer: binding.address, capacity: binding.length, external: true };
        if (previous && !previous.external) this.releaseBuffer(previous);
      } else {
        const previousBinding = this.sharedBindings.get(id);
        if (
          mapping.shared?.external ||
          (previousBinding?.machine === machine &&
            previousBinding.binding !== machine.sharedBinding)
        ) {
          const previous = mapping.shared;
          mapping.shared = null;
          if (previous) this.releaseBuffer(previous);
        }
        if (!mapping.shared) {
          const bytes = machine.shared,
            key = `${bytes.byteOffset}:${bytes.byteLength}`,
            ranges = this.inlineSharedSources.get(bytes.buffer) ?? new Map();
          this.inlineSharedSources.set(bytes.buffer, ranges);
          const candidate = ranges.get(key);
          if (candidate && !candidate.released && this.refs.arenas.has(candidate.pointer))
            mapping.shared = candidate;
          else {
            mapping.shared = this.liveBuffer(null, bytes);
            ranges.set(key, mapping.shared);
          }
        }
        const pointer = mapping.shared.pointer,
          size = mapping.shared.capacity,
          binding = { bytes: () => this.process.view(pointer, size) };
        machine.bindShared(binding);
        this.sharedBindings.set(id, { machine, binding });
      }
      if (mapping.vm) this.updateVM(id, machine, mapping);
      machine.bindAllocator({
        allocated: (blockID) => {
          const current = this.mapMachine(id, machine),
            index = current.blockIDs.indexOf(blockID);
          if (index < 0) throw new Error('A newly allocated native VM block is absent');
          return this.virtualAddress(current, current.blocks[index].pointer);
        },
        released: () => this.mapMachine(id, machine),
        blockForAddress: (address) => {
          let pointer;
          try {
            pointer = this.guestAddress(id, machine, address);
          } catch {
            return null;
          }
          const current = this.refs.machines.get(id),
            index = current.blocks.findIndex((block) => block.pointer === pointer);
          return index < 0 ? null : current.blockIDs[index];
        },
      });
      return mapping;
    } finally {
      this.mappingMachines.delete(id);
    }
  }
  virtualAddress(mapping, pointer) {
    // 877080 tests the continuous data/stack span before shared and the
    // allocation list. Empty payload ranges never match an inverse lookup.
    for (const [storage, base] of [
      [mapping.memory, 0],
      [mapping.shared, 0x80000000],
    ])
      if (pointer >= storage.pointer && pointer - storage.pointer < storage.capacity)
        return (base + pointer - storage.pointer) >>> 0;
    let base = mapping.memory.capacity;
    for (const storage of mapping.blocks) {
      if (pointer >= storage.pointer && pointer - storage.pointer < storage.capacity)
        return (base + pointer - storage.pointer) >>> 0;
      base += storage.capacity;
    }
    return 0xffffffff;
  }
  updateVM(id, machine, mapping) {
    const p = this.process,
      vm = mapping.vm,
      allocate = (size) => {
        const pointer = p.allocate(size, true);
        this.refs.arenas.set(pointer, size);
        return pointer;
      };
    for (const [offset, value] of [
      [20, mapping.memory.pointer],
      [32, machine.fp],
      [36, machine.memory.length],
      [40, mapping.shared.pointer],
      [44, machine.shared.length],
      [48, vm.container],
      [1388, vm.scratch],
    ])
      p.store(vm.pointer + offset, value);
    const oldNodes = new Map(vm.nodeIDs.map((key, index) => [key, vm.nodes[index]]));
    vm.nodes = mapping.blockIDs.map((key) => {
      const node = oldNodes.get(key) ?? allocate(16);
      oldNodes.delete(key);
      return node;
    });
    vm.nodeIDs = [...mapping.blockIDs];
    for (const pointer of oldNodes.values()) this.freeVMBuffer({ pointer });
    p.store(vm.container, vm.head);
    p.store(vm.container + 4, machine.blocks.length);
    const nodes = [vm.head, ...vm.nodes.slice(0, machine.blocks.length)];
    nodes.forEach((pointer, index) => {
      p.store(pointer, nodes[(index + 1) % nodes.length]);
      p.store(pointer + 4, nodes[(index + nodes.length - 1) % nodes.length]);
    });
    machine.blocks.forEach((bytes, index) => {
      p.store(vm.nodes[index] + 8, mapping.blocks[index].pointer);
      p.store(vm.nodes[index] + 12, bytes.length);
    });
    const record = this.world.objects.objects.get(id),
      task = this.refs.entries.get(id);
    if (record?.kind === 12 && task?.ready) p.store(task.pointer + 112, vm.pointer);
  }
  vmPointer(id) {
    const machine = this.machine(id);
    if (!machine) return 0;
    const mapping = this.mapMachine(id, machine);
    if (!mapping.vm) {
      const allocate = (size) => {
        const pointer = this.process.allocate(size, true);
        this.refs.arenas.set(pointer, size);
        return pointer;
      };
      mapping.vm = {
        pointer: allocate(1408),
        container: allocate(8),
        head: allocate(16),
        scratch: allocate(8192),
        nodes: [],
        nodeIDs: [],
      };
      this.updateVM(id, machine, mapping);
    }
    return mapping.vm.pointer;
  }
  guestAddress(id, machine, address, length = 1) {
    const mapping = this.mapMachine(id, machine),
      [, offset] = machine.region(address, length);
    if (address >= 0x80000000) return mapping.shared.pointer + offset;
    if (address < machine.memory.length || (length === 0 && address === machine.memory.length))
      return mapping.memory.pointer + offset;
    let base = machine.memory.length;
    for (const [index, bytes] of machine.blocks.entries()) {
      if (address < base + bytes.length) return mapping.blocks[index].pointer + offset;
      base += bytes.length;
    }
    throw new Error('Native task address refers to an unknown VM allocation');
  }
  async release(entry) {
    try {
      if (entry.owned) {
        this.releasingPrefixes.add(entry.pointer);
        await this.call(this.process.load(this.process.load(entry.pointer)), [1], entry.pointer);
      }
    } finally {
      this.releasingPrefixes.delete(entry.pointer);
      this.refs.byPointer.delete(entry.pointer);
    }
  }
  releaseOrder(entries) {
    const byPointer = new Map(
        [...this.refs.entries.values()].map((entry) => [entry.pointer, entry]),
      ),
      depth = (entry, seen = new Set()) => {
        if (seen.has(entry.pointer)) throw new Error('Native common task prefix parent cycle');
        seen.add(entry.pointer);
        const parent = byPointer.get(this.process.load(entry.pointer + 12));
        return parent ? 1 + depth(parent, seen) : 0;
      };
    return entries.sort((a, b) => depth(b[1]) - depth(a[1]));
  }
  async push() {
    if (this.closing || this.pushing) return;
    this.pushing = true;
    this.views.clear();
    try {
      for (const [id, binding] of this.inlineHostBindings) {
        const reference = this.world.objects.objects.get(id)?.sharedDataRef;
        if (
          reference?.kind !== 'engine' ||
          reference.address !== binding.pointer ||
          reference.length !== binding.bytes.length
        )
          this.inlineHostBindings.delete(id);
        else this.writeHostChanges(binding);
      }
      this.pullHostBindings();
      await this.prune();
      // Siblings share ancestors. Sync each ready prefix once in this pass;
      // the next native call must see current World state again.
      const synchronized = new Set();
      for (const record of this.world.objects.objects.values())
        if (record.state === 'active') {
          await this.pointer(record.id, synchronized);
          const machine = this.machine(record.id);
          if (machine) this.mapMachine(record.id, machine);
        }
    } finally {
      this.pushing = false;
    }
  }
  releaseMachine(id) {
    const mapping = this.refs.machines.get(id);
    if (mapping) this.dropMachine(id, mapping);
  }
  async prune() {
    for (const id of [...this.refs.machines.keys()]) if (!this.machine(id)) this.releaseMachine(id);
    const stale = this.releaseOrder(
      [...this.refs.entries].filter(([id]) => !this.world.objects.objects.has(id)),
    );
    for (const [id, entry] of stale) {
      this.sharedBindings.delete(id);
      this.refs.entries.delete(id);
      await this.release(entry);
    }
  }
  beforeCall() {
    return this.push();
  }
  afterCall() {
    for (const [pointer, bytes] of this.views) bytes.set(this.process.read(pointer, bytes.length));
    this.views.clear();
    this.pullHostBindings();
  }
  snapshot() {
    return {};
  }
  restore() {
    this.sharedBindings.clear();
    this.memoryBindings.clear();
    this.inlineSharedSources = new WeakMap();
    this.hostSources = new WeakMap();
    this.inlineHostBindings.clear();
    this.runtimeBinding = null;
    if (
      !['entries', 'byPointer', 'machines', 'shared', 'arenas'].every(
        (key) => this.refs[key] instanceof Map,
      )
    )
      throw new Error('Native task prefix checkpoint registry is invalid');
    if (this.refs.runtimeShared) this.runtimeBuffer();
  }
  async close() {
    if (this.closed) return;
    this.closing = true;
    const errors = [];
    try {
      for (const [, entry] of this.releaseOrder([...this.refs.entries]))
        try {
          await this.release(entry);
        } catch (error) {
          errors.push(error);
        }
    } catch (error) {
      errors.push(error);
    } finally {
      for (const [id, mapping] of [...this.refs.machines])
        try {
          this.dropMachine(id, mapping);
        } catch (error) {
          errors.push(error);
        }
      const shared = new Set(this.refs.shared.values());
      this.refs.shared.clear();
      for (const storage of shared)
        try {
          this.releaseBuffer(storage);
        } catch (error) {
          errors.push(error);
        }
      for (const storage of this.refs.inlineArenas?.values() ?? [])
        if (!storage.released)
          try {
            this.freeVMBuffer(storage);
          } catch (error) {
            errors.push(error);
          }
      for (const pointer of this.refs.arenas.keys())
        if (this.engine.kernel.heaps.get(1).blocks.has(pointer))
          this.engine.kernel.heapRelease(1, pointer);
        else this.process.free(pointer);
      this.refs.entries.clear();
      this.refs.byPointer.clear();
      this.refs.machines.clear();
      this.refs.shared.clear();
      this.refs.arenas.clear();
      this.views.clear();
      this.sharedBindings.clear();
      this.memoryBindings.clear();
      this.inlineHostBindings.clear();
      this.detachDestruction();
      this.closed = true;
    }
    if (errors.length) throw new AggregateError(errors, 'Native task memory cleanup failed');
  }
}

export function installNativeTaskMemory(world) {
  if (world.nativeTaskMemoryInstalled) return;
  world.nativeTaskMemoryInstalled = true;
  world.registerNativeFeature('task-memory', (engine) => new NativeTaskMemory(engine, world));
}
