// SPDX-License-Identifier: MPL-2.0
// Screen-effect tasks keep their original constructors, receivers, animation
// and renderer callbacks. The platform owns the one view/device/target set.
import { mapABIMessage } from '../src/native/abi/messages.mjs';
import { encodeCP932 } from '../src/kcs/strings.mjs';
import { NATIVE_UNWRITTEN_WORD } from '../src/native/engine-message.mjs';
import { installNativeTaskMemory } from '../src/native/task-memory.mjs';
import { NativeScreenEffectRenderer } from './screen-effect-render-original.mjs';

const layouts = (rows) =>
  Object.freeze(
    Object.fromEntries(
      rows.map(([kind, construct, size, vtable, receiver, callback]) => [
        kind,
        Object.freeze({ construct, size, vtable, receiver, callback }),
      ]),
    ),
  );
export const NATIVE_SCREEN_EFFECT_LAYOUTS = Object.freeze({
  'nekopara-vol3-engine-2.6.1.76': layouts([
    [35, 0x5f6ec0, 0x218, 0x8ce554, 0x5f7290, 0x5f7380],
    [36, 0x5f7710, 0x1b4, 0x8ce578, 0x5f7b60, 0x5f7c80],
    [37, 0x5f82d0, 0xa0, 0x8ce59c, 0x5f8af0, 0x5f8bb0],
    [38, 0x5f8fa0, 0x10c, 0x8ce5c4, 0x5f9310, 0x5f9400],
    [39, 0x5f9610, 0x130, 0x8ce5e8, 0x5f9cd0, 0x5f9dd0],
    [50, 0x5fa430, 0x14c, 0x8ce640, 0x5fb4a0, 0x5fb600],
    [51, 0x5fc310, 0x13c, 0x8ce664, 0x5fcda0, 0x5fcec0],
    [52, 0x5fdca0, 0xc4, 0x8ce688, 0x5fea00, 0x5feb30],
    [57, 0x5ff0f0, 0xfc, 0x8ce6b8, 0x5ffb70, 0x5ffda0],
    [58, 0x600340, 0x148, 0x8ce6e4, 0x6010e0, 0x6012b0],
  ]),
  'sdk-4.01-engine-2.6.1.74': layouts([
    [35, 0x4d1700, 0x218, 0x993834, 0x4d1ad0, 0x4d1bc0],
    [36, 0x4d1f50, 0x1b4, 0x993858, 0x4d23a0, 0x4d24c0],
    [37, 0x4d2b10, 0xa0, 0x99387c, 0x4d3330, 0x4d33f0],
    [38, 0x4d37e0, 0x10c, 0x9938a4, 0x4d3b50, 0x4d3c40],
    [39, 0x4d3e50, 0x130, 0x9938c8, 0x4d44d0, 0x4d45d0],
    [50, 0x4d4c50, 0x14c, 0x993920, 0x4d5c00, 0x4d5d60],
    [51, 0x4d6af0, 0x13c, 0x993944, 0x4d7510, 0x4d7630],
    [52, 0x4d8320, 0xc4, 0x993968, 0x4d9080, 0x4d91b0],
    [57, 0x4d9770, 0xfc, 0x993998, 0x4da1f0, 0x4da420],
    [58, 0x4da9c0, 0x148, 0x9939c4, 0x4db760, 0x4db930],
  ]),
});
const kinds = new Set([35, 36, 37, 38, 39, 50, 51, 52, 57, 58]);
const PAYLOAD_BYTES = Object.freeze({
  378: 88,
  380: 36,
  382: 12,
  384: 12,
  387: 20,
  390: 24,
  394: 36,
  516: 20,
  519: 24,
  521: 28,
});
export function screenEffectRawMessage(profile, message) {
  return mapABIMessage(profile, 'screen', 'raw', message);
}
function canonicalMessage(profile, kind, message) {
  return mapABIMessage(profile, 'screen', 'canonical', message, kind);
}
export class NativeScreenEffects {
  static async open(engine, world) {
    const taskMemory = await world.getNativeFeature('task-memory'),
      platform = await world.getNativeFeature('graphics-platform');
    if (typeof platform.ensureRenderer !== 'function')
      throw new Error('Original screen effects require native renderer initialization');
    return new NativeScreenEffects(engine, world, taskMemory, platform);
  }
  constructor(engine, world, taskMemory, platform) {
    Object.assign(this, { engine, world, taskMemory, platform, process: engine.process });
    this.abi = NATIVE_SCREEN_EFFECT_LAYOUTS[engine.profile];
    if (!this.abi) throw new Error(`Screen effects are unavailable in ${engine.profile}`);
    this.routeTrap = this.process.trap('native screen-effect task router', 7, (args) =>
      this.route(args),
    );
    for (const layout of Object.values(this.abi))
      this.process.store(layout.vtable + 16, this.routeTrap);
    this.rendering = new NativeScreenEffectRenderer(this);
    engine.registerFeature('screen-effects', this);
  }
  async create(record, options = {}) {
    const task = new NativeScreenEffectTask(this, record);
    if (!options.restoring) await task.construct();
    return task;
  }
  async route([sender, target, raw, w, l, flags, out]) {
    const senderID = this.world.resolveTaskID(sender, this.engine.currentTaskID);
    if (senderID === null) throw new Error('Original screen-effect sender is outside its Top');
    const targetID = raw !== 1 ? this.world.resolveTaskID(target, senderID) : null,
      record = this.world.objects.objects.get(targetID);
    if (raw !== 1 && (!record || record.state !== 'active')) return 0;
    const context = {
        payload: this.platform.memory,
        nativePointer: true,
        nativeResult: out,
        flags,
        fromHost: true,
        nativeSenderWorldID: senderID,
      },
      value = await this.world.sendNativeEngine(
        target,
        senderID,
        canonicalMessage(this.engine.profile, record?.kind, raw),
        w,
        l,
        context,
      );
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
    return trap.name === 'native screen-effect task router'
      ? { args: 7, real: false, handler: (args) => this.route(args) }
      : null;
  }
  close() {
    this.rendering.close();
  }
}

export class NativeScreenEffectTask {
  constructor(owner, record) {
    Object.assign(this, { owner, record, world: owner.world, pointer: 0 });
    this.base = this.world.base(record);
    this.abi = owner.abi[record.kind];
    if (!this.abi) throw new Error(`Unrecovered screen-effect task kind ${record.kind}`);
    record.flags ??= 0;
  }
  get runsBaseLogic() {
    return this.abi.baseLogic !== false;
  }
  async invoke(
    address,
    args = [],
    { fromHost = this.owner.process.asyncEnabled, messageContext } = {},
  ) {
    const { engine, process: p, platform, taskMemory } = this.owner;
    if (p.asyncEnabled) await taskMemory.push();
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
    if (this.owner.requiresRenderer !== false) await this.owner.platform.ensureRenderer();
    const p = this.owner.process,
      name = encodeCP932(this.record.name + '\0');
    if (name.length > 32) throw new RangeError('Screen-effect task name exceeds its Base record');
    const source = p.allocate(name.length, true);
    this.pointer = p.allocate(this.abi.size, true);
    this.owner.taskMemory.bind(this.record, this.pointer, { ready: false });
    p.write(source, name);
    try {
      await this.invoke(this.abi.construct, [
        this.record.nativeID ?? this.record.id,
        source,
        this.record.frameRate,
        this.owner.platform.refs.view,
      ]);
      // The original task factory assigns the concrete kind after the
      // derived constructor returns (5DDA90 / 4B9CC0).
      this.record.flags = this.record.kind;
      p.store(this.pointer + 64, this.record.flags);
      await this.owner.taskMemory.ready(this.record);
    } finally {
      p.free(source);
    }
  }
  async message([sender, message, w, l], context = {}) {
    if (!this.pointer) throw new Error('Original screen-effect task is not constructed');
    if (message === 2 && context.nativeNewTask !== undefined)
      l = await this.owner.taskMemory.pointer(context.nativeNewTask);
    const p = this.owner.process,
      allocations = [];
    const payloadSize =
      this.abi.payloadBytes?.[message] ?? (this.owner.payloadBytes || PAYLOAD_BYTES)[message];
    if (!context.nativePointer && payloadSize) {
      const memory =
          context.payload ||
          context.machine ||
          this.world.objects.machine(context.nativeSenderWorldID ?? sender),
        size = payloadSize;
      if (!memory) throw new Error(`Screen-effect message ${message} requires sender memory`);
      const bytes =
          typeof memory.bytes === 'function' ? memory.bytes(l, size) : memory.read(l, size),
        source = p.allocate(size, true);
      p.write(source, bytes);
      allocations.push(source);
      l = source;
    }
    const packet = p.allocate(24, true),
      out = context.nativeResult || p.allocate(4, true);
    allocations.push(packet);
    if (!context.nativeResult) allocations.push(out);
    [
      this.record.nativeID ?? this.record.id,
      sender,
      (this.owner.rawMessage || screenEffectRawMessage)(this.owner.engine.profile, message),
      w,
      l,
      context.flags ?? 0,
    ].forEach((word, index) => p.store(packet + index * 4, word));
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
      output = p.allocate(4, true);
    try {
      await this.invoke(p.load(p.load(this.pointer) + 8), [frame >>> 0, output]);
    } finally {
      p.free(output);
    }
  }
  drawTick(frame) {
    const p = this.owner.process;
    return this.invoke(p.load(p.load(this.pointer) + 12), [frame >>> 0]);
  }
  snapshot() {
    return { pointer: this.pointer };
  }
  restore(state) {
    this.pointer = state.pointer;
    if (this.owner.process.load(this.pointer + 4) !== (this.record.nativeID ?? this.record.id))
      throw new Error('Screen-effect checkpoint task identity differs');
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
      this.closed = true;
    }
  }
}

export function installNativeScreenEffects(world) {
  installNativeTaskMemory(world);
  world.registerNativeFeature('screen-effects', (engine) =>
    NativeScreenEffects.open(engine, world),
  );
  for (const kind of kinds)
    world.objects.register(kind, async (record, _objects, options) =>
      (await world.getNativeFeature('screen-effects')).create(record, options),
    );
}
