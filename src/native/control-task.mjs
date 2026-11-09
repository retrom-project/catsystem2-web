// SPDX-License-Identifier: MPL-2.0
// Scroll, Scroll2 and Slider retain their original Base-derived tasks. Their
// image slicing, button children, drag arithmetic and repeat timer run in PE32.
import { encodeCP932 } from '../kcs/strings.mjs';
import { NATIVE_UNWRITTEN_WORD } from './engine-message.mjs';
import { installNativeTaskMemory } from './task-memory.mjs';
import { registerNativeFESObjectType } from './fes-objects.mjs';
import { NativeFESControls, nativeFESControlAdapter } from './fes-controls.mjs';
import { nativeRectangleDefinitions } from './windows-rectangles.mjs';

const ABI = Object.freeze({
  'nekopara-vol3-engine-2.6.1.76': {
    40: { construct: 0x62e7a0, vtable: 0x8d2c7c, size: 0x3d8 },
    41: { construct: 0x630cf0, vtable: 0x8d2cd4, size: 0x2b4 },
    42: { construct: 0x632710, vtable: 0x8d2d04, size: 0x258 },
  },
  'sdk-4.01-engine-2.6.1.74': {
    40: { construct: 0x505b80, vtable: 0x997d64, size: 0x3d8 },
    41: { construct: 0x5080c0, vtable: 0x997dc4, size: 0x2b4 },
    42: { construct: 0x5099c0, vtable: 0x997df4, size: 0x258 },
  },
});
export function canonicalMessage(profile, kind, message) {
  if (!profile.startsWith('sdk-')) return message;
  // The Top and Sound receivers translate their own profile-specific packets.
  if (kind === 1 || kind === 13) return message;
  const start = { 15: 267, 34: 326, 40: 348, 41: 363, 42: 354, 48: 444 }[kind];
  if (start !== undefined && message >= start) return message + 5;
  if (kind === 49 && message >= 463) return message + 26;
  return message >= 37 ? message + 2 : message;
}
function rawMessage(profile, kind, message) {
  if (!profile.startsWith('sdk-')) return message;
  const start = { 40: 353, 41: 368, 42: 359 }[kind];
  return message >= start ? message - 5 : message >= 39 ? message - 2 : message;
}

export class NativeControlRuntime {
  static async open(engine, world) {
    await world.getNativeFeature('data-buffers');
    const tasks = await world.getNativeFeature('task-memory'),
      platform = await world.getNativeFeature('graphics-platform');
    await world.getNativeFeature('engine-files');
    return new NativeControlRuntime(engine, world, tasks, platform);
  }
  constructor(engine, world, taskMemory, platform) {
    Object.assign(this, { engine, world, process: engine.process, taskMemory, platform });
    this.abi = ABI[engine.profile];
    if (!this.abi) throw new Error(`Original controls are unavailable in ${engine.profile}`);
    for (const [name, definition] of nativeRectangleDefinitions(this.process))
      engine.registerWindows('USER32.dll', name, definition);
    this.routeTrap = this.process.trap('native control task message router', 7, (args) =>
      this.route(args),
    );
    for (const layout of Object.values(this.abi))
      this.process.store(layout.vtable + 16, this.routeTrap);
    engine.registerFeature('controls', this);
  }
  async create(record, options = {}) {
    const task = new NativeControlTask(this, record);
    if (!options.restoring) await task.construct();
    return task;
  }
  async route([sender, target, raw, w, l, flags, out]) {
    const senderWorldID = this.world.resolveTaskID(sender, this.engine.currentTaskID);
    if (senderWorldID == null)
      throw new Error(`Native control sender ${sender} is outside its Top namespace`);
    const targetWorldID = raw !== 1 ? this.world.resolveTaskID(target, senderWorldID) : null,
      record = this.world.objects.objects.get(targetWorldID);
    if (raw !== 1 && (!record || record.state !== 'active')) return 0;
    const context = {
        payload: this.platform.memory,
        nativePointer: true,
        nativeResult: out,
        flags,
        fromHost: true,
        nativeSenderWorldID: senderWorldID,
      },
      message = canonicalMessage(this.engine.profile, record?.kind, raw),
      value = await this.world.sendNativeEngine(target, senderWorldID, message, w, l, context);
    if (raw !== 1 && out && Number.isInteger(value)) this.process.store(out, value);
    return raw === 1 ? Number(Boolean(context.nativeRouted)) : 1;
  }
  snapshot() {
    return { routeTrap: this.routeTrap };
  }
  restore(state) {
    this.routeTrap = state.routeTrap;
  }
  recoverTrap(trap) {
    return trap.name === 'native control task message router'
      ? { args: 7, real: false, handler: (args) => this.route(args) }
      : null;
  }
}

export class NativeControlTask {
  constructor(owner, record) {
    Object.assign(this, { owner, record, world: owner.world, pointer: 0 });
    record.flags = 0;
    this.base = this.world.base(record);
    this.abi = owner.abi[record.kind];
    if (!this.abi) throw new Error(`Unknown original control task kind ${record.kind}`);
  }
  async invoke(
    address,
    args = [],
    { fromHost = this.owner.process.asyncEnabled, messageContext } = {},
  ) {
    const { engine, process, platform, taskMemory } = this.owner;
    if (process.asyncEnabled) await taskMemory.push();
    platform.sync();
    try {
      return await (fromHost
        ? engine.callFromHost(address, args, this.pointer, { task: this.record.id, messageContext })
        : engine.call(address, args, this.pointer, { task: this.record.id, messageContext }));
    } finally {
      platform.pull();
    }
  }
  async construct() {
    const p = this.owner.process,
      name = encodeCP932(this.record.name + '\0');
    if (name.length > 32) throw new RangeError('Native control name exceeds its Base record');
    const source = p.allocate(name.length, true);
    this.pointer = p.allocate(this.abi.size, true);
    this.owner.taskMemory.bind(this.record, this.pointer, { ready: false });
    p.write(source, name);
    try {
      await this.invoke(this.abi.construct, [
        this.record.nativeID ?? this.record.id,
        source,
        this.record.frameRate,
      ]);
      await this.owner.taskMemory.ready(this.record);
    } finally {
      p.free(source);
    }
  }
  async message([sender, message, w, l], context = {}) {
    if (!this.pointer) throw new Error('Native control task has no original instance');
    if (message === 2 && context.nativeNewTask !== undefined)
      l = await this.owner.taskMemory.pointer(context.nativeNewTask);
    const p = this.owner.process,
      allocations = [],
      memory =
        context.payload ||
        context.machine ||
        this.world.objects.machine(context.nativeSenderWorldID ?? sender),
      copy = (address, size) => {
        if (!memory) throw new Error(`Native control message ${message} requires sender memory`);
        const source =
            typeof memory.bytes === 'function'
              ? memory.bytes(address, size)
              : memory.read(address, size),
          pointer = p.allocate(size, true);
        allocations.push(pointer);
        p.write(pointer, source);
        return pointer;
      };
    if (!context.nativePointer) {
      const sizes = { 6: 8, 353: 292, 356: 12, 359: 292, 362: 8, 368: 292, 370: 12 };
      if (sizes[message]) l = copy(l, sizes[message]);
    }
    const packet = p.allocate(24, true),
      out = context.nativeResult || p.allocate(4, true);
    allocations.push(packet);
    if (!context.nativeResult) allocations.push(out);
    const words = [
      this.record.nativeID ?? this.record.id,
      sender,
      rawMessage(this.owner.engine.profile, this.record.kind, message),
      w,
      l,
      context.flags ?? 0,
    ];
    words.forEach((value, index) => p.store(packet + index * 4, value));
    const writes = p.watchWrites(out, 4);
    try {
      const unhandled = await this.invoke(
        p.load(p.load(this.pointer) + 24),
        [packet, out],
        this.owner.taskMemory.messageOptions(this.record, context),
      );
      context.nativeUnhandled = Boolean(unhandled);
      return writes.written ? p.load(out) : NATIVE_UNWRITTEN_WORD;
    } finally {
      writes.close();
      for (const pointer of allocations) p.free(pointer);
    }
  }
  async tick(frame) {
    const p = this.owner.process,
      out = p.allocate(4, true);
    try {
      await this.invoke(p.load(p.load(this.pointer) + 8), [frame >>> 0, out]);
    } finally {
      p.free(out);
    }
  }
  async drawTick(frame) {
    const p = this.owner.process;
    await this.invoke(p.load(p.load(this.pointer) + 12), [frame >>> 0]);
  }
  snapshot() {
    return { pointer: this.pointer };
  }
  restore(state) {
    this.pointer = state.pointer;
    if (this.owner.process.load(this.pointer + 4) !== (this.record.nativeID ?? this.record.id))
      throw new Error('Native control checkpoint task identity differs');
  }
  async close({ fromHost = this.owner.process.asyncEnabled } = {}) {
    if (this.closed) return;
    try {
      if (this.pointer)
        await this.invoke(this.owner.process.load(this.owner.process.load(this.pointer)), [1], {
          fromHost,
        });
    } finally {
      this.owner.taskMemory.unbind(this.record.id);
      await this.owner.platform.releaseOwnerImages(this.record.id);
      this.closed = true;
    }
  }
}

export function installNativeControls(world) {
  installNativeTaskMemory(world);
  world.registerNativeFeature('controls', (engine) => NativeControlRuntime.open(engine, world));
  for (const kind of [40, 41, 42])
    world.objects.register(kind, async (record, _objects, options) =>
      (await world.getNativeFeature('controls')).create(record, options),
    );
  for (const type of [13, 14, 15])
    registerNativeFESObjectType(world, type, (runtime) => nativeFESControlAdapter(runtime, type));
  world.controlsFES = new NativeFESControls(world);
}
