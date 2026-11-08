// SPDX-License-Identifier: MPL-2.0
// Original 64-byte image collections, their Script-owned list and all wrappers.
// Pixel/decoder/retained-renderer state remains in the shared engine process.
import { nativeReply } from '../kcs/vm.mjs';
import { NativeKCSMemory } from './kcs-memory.mjs';
import { installNativeEngineFiles } from './engine-files.mjs';

const rows = [
  [0x2c6, 1, 1, 0x654110, 0x51ef30],
  [0x2c7, 1, 2, 0x653d30, 0x51eb50],
  [0x2c8, 3, 2, 0x654080, 0x51eea0],
  [0x2c9, 4, 2, 0x6543f0, 0x51f1d0],
  [0x2ca, 3, 2, 0x654010, 0x51ee30],
  [0x2cb, 3, 2, 0x653fa0, 0x51edc0],
  [0x2cc, 2, 2, 0x653da0, 0x51ebc0],
  [0x2cd, 3, 1, 0x653f30, 0x51ed50],
  [0x2ce, 3, 1, 0x6543a0, 0x51f180],
  [0x2cf, 3, 1, 0x654350, 0x51f130],
  [0x2d0, 3, 1, 0x6542d0, 0x51f0b0],
  [0x2d1, 1, 1, 0x6540e0, 0x51ef00],
  [0x2d2, 2, 2, 0x654420, 0x51f200],
  [0x2d3, 2, 2, 0x654270, 0x51f050],
  [0x2d4, 7, 1, 0x653e40, 0x51ec60],
  [0x2d5, 2, 1, 0x653630, 0x51e490],
  [0x2d6, 3, 2, 0x653690, 0x51e4f0],
  [0x2d7, 2, 2, 0x653e20, 0x51ec40],
  [0x2d8, 2, 2, 0x654320, 0x51f100],
  [0x2d9, 2, 2, 0x6542b0, 0x51f090],
  [0x2da, 3, 2, 0x654290, 0x51f070],
  [0x2db, 13, 2, 0x643fb0, 0x51c660],
  [0x2dc, 13, 2, 0x644a80, 0x51d0c0],
  [0x2dd, 2, 1, 0x653c50, 0x51eab0],
  [0x2de, 10, 2, 0x6536f0, 0x51e550],
  [0x2df, 10, 2, 0x653990, 0x51e7f0],
  [0x2e0, 6, 2, 0x653dc0, 0x51ebe0],
  [0x2e1, 2, 2, 0x6536b0, 0x51e510],
];
export const NATIVE_IMAGE_OWNER_CONTRACTS = Object.freeze(
  rows.map(([id, words, control, game, sdk]) =>
    Object.freeze({ id, words, control, handlers: [game, sdk] }),
  ),
);
export const NATIVE_IMAGE_OWNER_IDS = Object.freeze(rows.map(([id]) => id));
const byID = new Map(NATIVE_IMAGE_OWNER_CONTRACTS.map((spec) => [spec.id, spec]));
export const nativeImageOwnerCodec = Object.freeze({
  snapshot: (value) => ({ ...value }),
  restore: (value) => ({ ...value }),
});

export class NativeImageOwners {
  constructor(engine, world) {
    Object.assign(this, { engine, world, process: engine.process });
    this.sdk = engine.profile === 'sdk-4.01-engine-2.6.1.74';
    if (!this.sdk && engine.profile !== 'nekopara-vol3-engine-2.6.1.76')
      throw new Error('Native image owners require a reviewed engine profile');
    this.profileIndex = Number(this.sdk);
    this.releaseAddress = this.sdk ? 0x5e3210 : 0x7424d0;
    this.listConstruct = this.sdk ? 0x4c4b40 : 0x5e8820;
    this.listClear = this.sdk ? 0x6363e0 : 0x79d8d0;
    engine.refs.imageOwners ??= { pointers: new Set(), contexts: new Map() };
    const p = this.process;
    this.memory = {
      load: (address) => p.load(address),
      store: (address, value) => p.store(address, value),
      bytes: (address, count) => p.read(address, count),
      write: (address, bytes) => p.write(address, bytes),
      string: (address, wide = false) => p.string(address, wide),
    };
    this.send = p.trap(
      'image owner wrapper task packet transport',
      7,
      async ([sender, target, rawMessage, w, l, flags, out]) => {
        const origin = engine.currentTaskID;
        if (origin == null) throw new Error('Native image draw packet has no calling task');
        const senderWorldID = world.resolveTaskID ? world.resolveTaskID(sender, origin) : sender;
        if (senderWorldID == null)
          throw new Error('Native image draw sender is outside its Top namespace');
        const message = this.sdk ? rawMessage + 5 : rawMessage;
        if (message !== 280 && message !== 282)
          throw new Error('Unexpected native image owner draw message');
        const context = {
          payload: this.memory,
          nativePointer: true,
          fromHost: true,
          nativeResult: out,
          flags,
        };
        const value = await world.sendNativeEngine(target, senderWorldID, message, w, l, context);
        if (out && Number.isInteger(value)) p.store(out, value);
        if (typeof context.nativeRouted !== 'boolean')
          throw new Error('Native image draw transport did not report its routing result');
        return Number(context.nativeRouted);
      },
    );
    this.vtable = p.allocate(32, true);
    p.store(this.vtable + 16, this.send);
    engine.registerFeature('image-owners', this);
  }
  get refs() {
    return this.engine.refs.imageOwners;
  }
  call(address, args, pointer, task) {
    return this.process.asyncEnabled
      ? this.engine.callFromHost(address, args, pointer, { task })
      : this.engine.call(address, args, pointer, { task });
  }
  pointer(handle) {
    if (!handle) return 0;
    const pointer = this.world.runtime.handles.get(handle, 'image-owner').pointer;
    if (!this.refs.pointers.has(pointer) || this.process.allocations.get(pointer) !== 64)
      throw new Error('Native image owner is absent or released');
    return pointer;
  }
  async context(task) {
    const p = this.process,
      platform = await this.world.getNativeFeature('graphics-platform');
    await platform.ensureRenderer();
    let record = this.refs.contexts.get(task.id);
    if (!record) {
      const actual = this.world.objects.machine(task.id) === task.machine;
      const pointer = actual
        ? await (await this.world.getNativeFeature('task-memory')).pointer(task.id)
        : p.allocate(160, true);
      // 5E8820 and the SDK Script initializer construct this eight-byte list
      // with twelve-byte circular nodes. Only identities are kept outside RAM.
      const list = p.allocate(8);
      await this.call(this.listConstruct, [], list, task.id);
      p.store(pointer + 156, list);
      record = { pointer, list, owned: !actual };
      this.refs.contexts.set(task.id, record);
    }
    p.store(record.pointer + 4, this.world.nativeTaskID?.(task.id) ?? task.id);
    p.store(record.pointer + 116, platform.refs.view);
    return record.pointer;
  }
  async apply(id, args, machine, task) {
    const spec = byID.get(id);
    if (!spec) return undefined;
    const create = id === 0x2c6 || id === 0x2dd,
      draw = id === 0x2db || id === 0x2dc,
      words = Array.from(args);
    while (!words.length) words.push(machine.nativeArgument(0));
    let count = spec.words;
    if (!create && !draw && !words[0] && ![0x2d5, 0x2de, 0x2df, 0x2e0].includes(id)) count = 1;
    if (id === 0x2e0 && !words[0]) count = 5;
    if (id === 0x2de || id === 0x2df) {
      while (words.length < 6) words.push(machine.nativeArgument(words.length));
      if (!words[5]) count = 6;
    }
    while (words.length < count) words.push(machine.nativeArgument(words.length));
    const handle = words[0];
    if (draw) words[2] = this.pointer(words[2]);
    else if (!create) {
      // Attribute-copy checks both words before dereferencing either owner.
      // A null operand leaves the other word unexamined in the original.
      if (id !== 0x2d5 || (words[0] && words[1])) {
        words[0] = this.pointer(words[0]);
        if (id === 0x2d5) words[1] = this.pointer(words[1]);
      }
      if (id === 0x2de || id === 0x2df) words[5] = this.pointer(words[5]);
    }
    const world = this.world,
      memory =
        world.objects.machine(task.id) === machine
          ? await world.getNativeFeature('task-memory')
          : null;
    if (memory) memory.vmPointer(task.id);
    const host = await this.context({ ...task, machine }),
      p = this.process,
      bridge = new NativeKCSMemory(p, machine, memory?.mapMachine(task.id, machine)),
      argv = p.allocate(words.length * 4),
      out = p.allocate(4),
      packetHost = draw ? p.allocate(160) : 0;
    try {
      words.forEach((word, i) => p.store(argv + i * 4, word));
      p.store(out, 0xcccccccc);
      if (draw) {
        p.write(packetHost, p.read(host, 160));
        p.store(packetHost, this.vtable);
      }
      const control = await this.call(
        spec.handlers[this.profileIndex],
        [bridge.pointer, packetHost || host, argv, out],
        undefined,
        task.id,
      );
      if (control !== spec.control)
        throw new Error('Native image wrapper control differs from its reviewed contract');
      if (create) {
        const pointer = p.load(out);
        if (!pointer) return nativeReply(control, 0);
        if (p.allocations.get(pointer) !== 64)
          throw new Error('Original image constructor returned no 64-byte owner');
        this.refs.pointers.add(pointer);
        return nativeReply(
          control,
          world.runtime.handles.add('image-owner', { pointer, owner: task.id }),
        );
      }
      if (id === 0x2c7 && handle) {
        world.runtime.handles.release(handle, 'image-owner');
        if (!p.allocations.has(words[0])) this.refs.pointers.delete(words[0]);
      }
      return nativeReply(control, control === 1 || control === 3 ? p.load(out) : undefined);
    } finally {
      try {
        bridge.close();
      } finally {
        if (packetHost) p.free(packetHost);
        p.free(out);
        p.free(argv);
      }
    }
  }
  async releaseOwner(owner, { dispose = false } = {}) {
    const record = this.refs.contexts.get(owner);
    if (!record) return;
    const p = this.process,
      list = record.list,
      head = p.load(list);
    let node = p.load(head);
    while (node !== head) {
      const pointer = p.load(node + 8);
      if (pointer) {
        await this.call(this.releaseAddress, [], pointer, owner);
        if (!p.allocations.has(pointer)) this.refs.pointers.delete(pointer);
      }
      node = p.load(node);
    }
    // The original Script releases every image before resetting the circular
    // list and freeing its nodes. A destructor may synchronously inspect it.
    await this.call(this.listClear, [], list, owner);
    for (const [handle, value] of this.world.runtime.handles.records)
      if (value.type === 'image-owner' && value.value.owner === owner)
        this.world.runtime.handles.release(handle, 'image-owner');
    if (dispose) {
      if (p.allocations.has(record.pointer)) p.store(record.pointer + 156, 0);
      p.free(head);
      p.free(list);
      if (record.owned) p.free(record.pointer);
      this.refs.contexts.delete(owner);
    }
  }
  snapshot() {
    return { vtable: this.vtable };
  }
  restore(state) {
    if (!(this.refs.pointers instanceof Set) || !(this.refs.contexts instanceof Map))
      throw new Error('Invalid native image-owner registry');
    this.vtable = state.vtable;
  }
  async close() {
    if (this.closed) return;
    for (const owner of [...this.refs.contexts.keys()])
      await this.releaseOwner(owner, { dispose: true });
    this.process.free(this.vtable);
    this.closed = true;
  }
}

export function installNativeImageOwners(world) {
  installNativeEngineFiles(world);
  world.registerNativeFeature('image-owners', async (engine) => {
    await world.getNativeFeature('engine-files');
    await world.getNativeFeature('data-buffers');
    await world.getNativeFeature('retained-draw');
    await world.getNativeFeature('graphics-platform');
    return new NativeImageOwners(engine, world);
  });
  for (const id of NATIVE_IMAGE_OWNER_IDS)
    world.runtime.register('main', id, async (args, machine, task) =>
      (await world.getNativeFeature('image-owners')).apply(id, args, machine, task),
    );
}
