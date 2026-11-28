// SPDX-License-Identifier: MPL-2.0
// Temporary derived task transport, removed with area effects in phase6.4.
import { encodeCP932 } from '../src/kcs/strings.mjs';
import { NATIVE_UNWRITTEN_WORD } from '../src/native/engine-message.mjs';
export class NativeOriginalEffectTask {
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
      this.abi.payloadBytes?.[message] ?? (this.owner.payloadBytes || {})[message];
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
      this.owner.rawMessage(this.owner.engine.profile, message),
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
