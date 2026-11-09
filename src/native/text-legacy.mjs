// SPDX-License-Identifier: MPL-2.0
// Original task 8 keeps its own forty-byte character records, parser, ruby,
// reveal schedule and bitmap. It does not share the later STRING writer ABI.
import { mapABIMessage } from './abi/messages.mjs';
import { NativeGraphicTask } from './graphics.mjs';
import { NativeKCSMemory } from './kcs-memory.mjs';
import { installNativeTaskMemory } from './task-memory.mjs';
import { encodeCP932 } from '../kcs/strings.mjs';
import { nativeReply } from '../kcs.mjs';

const ABI = {
  'nekopara-vol3-engine-2.6.1.76': {
    construct: 0x5e3ff0,
    message: 0x5e4c70,
    frame: 0x5e4b90,
    main: 0xa2dd38,
  },
  'sdk-4.01-engine-2.6.1.74': {
    construct: 0x4c0310,
    message: 0x4c0f50,
    frame: 0x4c0e70,
    main: 0xb3c900,
  },
};
export const NATIVE_LEGACY_TEXT_IDS = Object.freeze([
  ...Array.from({ length: 17 }, (_, i) => 0x7b + i),
  0x187,
  0x1a2,
  0x1c8,
  0x22d,
]);

export class NativeLegacyTextRuntime {
  static async open(engine, world) {
    await world.getNativeFeature('text');
    const platform = await world.getNativeFeature('graphics-platform'),
      tasks = await world.getNativeFeature('task-memory');
    return new NativeLegacyTextRuntime(engine, world, platform, tasks);
  }
  constructor(engine, world, platform, taskMemory) {
    Object.assign(this, { engine, world, platform, taskMemory, process: engine.process });
    this.abi = ABI[engine.profile];
    if (!this.abi) throw new Error(`Legacy native text is unavailable in ${engine.profile}`);
    this.routeTrap = this.process.trap('legacy text task message router', 7, (args) =>
      this.route(args),
    );
    engine.registerFeature('legacy-text', this);
  }
  async create(record, { restoring = false } = {}) {
    const task = new NativeLegacyTextTask(this, record);
    this.world.graphics.tasks.set(record.id, task);
    if (!restoring) await task.construct();
    return task;
  }
  async route([sender, target, rawMessage, w, l, flags, out]) {
    const origin = this.engine.currentTaskID,
      senderWorldID = this.world.resolveTaskID ? this.world.resolveTaskID(sender, origin) : sender,
      targetWorldID = this.world.resolveTaskID
        ? this.world.resolveTaskID(target, senderWorldID)
        : target,
      record = this.world.objects.objects.get(targetWorldID);
    if (senderWorldID == null)
      throw new Error(`Legacy native text sender ${sender} is outside its Top namespace`);
    if (!record || record.state !== 'active') return 0;
    const message = mapABIMessage(this.engine.profile, 'base', 'canonical', rawMessage),
      context = {
        payload: this.platform.memory,
        nativePointer: true,
        nativeResult: out,
        flags,
        fromHost: true,
        nativeSenderWorldID: senderWorldID,
      },
      value = this.world.sendNativeEngine
        ? await this.world.sendNativeEngine(target, senderWorldID, message, w, l, context)
        : await record.implementation.message([sender, message, w, l], context);
    if (out && Number.isInteger(value)) this.process.store(out, value);
    if (Number.isInteger(value)) this.resultWritten = true;
    return 1;
  }
  async apply(id, args, machine, task) {
    const count = { 0x187: 1, 0x1a2: 4, 0x1c8: 2, 0x22d: 2 }[id];
    if (count && args.length !== count)
      throw new Error(`Legacy text native 0x${id.toString(16)} has an invalid argument count`);
    if (id === 0x88 && args[1]) {
      const bitmap = this.world.graphics.images.get(args[1]);
      return this.platform.withBitmap(
        bitmap,
        async (pointer) => {
          const container = this.process.allocate(4, true);
          this.process.store(container, pointer);
          try {
            return await this.applyGuest(id, [args[0], container, ...args.slice(2)], machine, task);
          } finally {
            this.process.free(container);
          }
        },
        task.id,
      );
    }
    return this.applyGuest(id, args, machine, task);
  }
  async applyGuest(id, args, machine, task) {
    let mapping;
    if (machine.memoryID != null && this.world.getNativeFeature) {
      const memory = await this.world.getNativeFeature('task-memory');
      memory.vmPointer(task.id);
      mapping = memory.mapMachine(task.id, machine);
    }
    const p = this.process,
      bridge = new NativeKCSMemory(p, machine, mapping),
      caller = p.allocate(32, true),
      vtable = p.allocate(32, true),
      parameters = p.allocate(Math.max(4, args.length * 4), true),
      output = p.allocate(4, true);
    p.store(caller, vtable);
    p.store(caller + 4, this.world.nativeTaskID ? this.world.nativeTaskID(task.id) : task.id);
    p.store(vtable + 16, this.routeTrap);
    args.forEach((value, i) => p.store(parameters + i * 4, value));
    // 187 initializes its separate message payload word to zero. It writes that
    // payload as its result even if no receiver exists; this differs from the
    // wrappers that return the engine transport's untouched output word.
    this.resultWritten = id === 0x187;
    try {
      const control = await this.engine.call(
        p.load(this.abi.main + id * 4),
        [bridge.pointer, caller, parameters, output],
        undefined,
        { task: task.id },
      );
      if ([1, 3].includes(control) && !this.resultWritten)
        throw new Error(`Legacy text native 0x${id.toString(16)} queried an unwritten task result`);
      return nativeReply(control, [1, 3].includes(control) ? p.load(output) : undefined);
    } finally {
      bridge.close();
      for (const at of [caller, vtable, parameters, output]) p.free(at);
    }
  }
  snapshot() {
    return { routeTrap: this.routeTrap };
  }
  restore(state) {
    this.routeTrap = state.routeTrap;
  }
  recoverTrap(trap) {
    return trap.name === 'legacy text task message router'
      ? { args: 7, real: false, handler: (args) => this.route(args) }
      : null;
  }
}

export class NativeLegacyTextTask {
  constructor(owner, record) {
    Object.assign(this, { owner, record, world: owner.world, pointer: 0 });
    this.plane = new NativeGraphicTask(owner.world.graphics, record);
  }
  get graph() {
    return this.plane.graph;
  }
  get state() {
    return this.plane.state;
  }
  sync() {
    return this.plane.sync();
  }
  drawGPU(gpu) {
    return this.plane.drawGPU(gpu);
  }
  async invoke(address, args = [], { fromHost = this.owner.process.asyncEnabled } = {}) {
    const { engine, process, platform, taskMemory } = this.owner;
    if (process.asyncEnabled) await taskMemory.push();
    platform.sync();
    try {
      return await (fromHost
        ? engine.callFromHost(address, args, this.pointer, { task: this.record.id })
        : engine.call(address, args, this.pointer, { task: this.record.id }));
    } finally {
      platform.pull();
    }
  }
  async construct() {
    const p = this.owner.process,
      name = encodeCP932(this.record.name + '\0');
    if (name.length > 32)
      throw new RangeError('Legacy text task name exceeds its original common record');
    const source = p.allocate(name.length, true);
    this.pointer = p.allocate(0x770, true);
    this.owner.taskMemory.bind(this.record, this.pointer, { ready: false });
    p.write(source, name);
    try {
      await this.invoke(this.owner.abi.construct, [
        this.record.nativeID ?? this.record.id,
        source,
        this.record.frameRate,
        this.owner.platform.refs.view,
      ]);
      await this.owner.taskMemory.ready(this.record);
    } finally {
      p.free(source);
    }
  }
  async message([sender, message, w, l], context = {}) {
    const p = this.owner.process,
      owned = [],
      copies = [],
      memory =
        context.payload ||
        context.machine ||
        this.world.objects.machine(context.nativeSenderWorldID ?? sender);
    const allocate = (bytes) => {
        const at = p.allocate(bytes.length, true);
        owned.push(at);
        p.write(at, bytes);
        return at;
      },
      copy = (address, size, output = false) => {
        if (!memory) throw new Error(`Legacy text message ${message} requires sender memory`);
        const bytes = memory.bytes(address, size),
          pointer = allocate(bytes);
        if (output)
          copies.push(() => {
            const value = p.read(pointer, size);
            if (memory.write) memory.write(address, value);
            else bytes.set(value);
          });
        return pointer;
      };
    if (!this.pointer) throw new Error('Legacy text task has no original instance');
    if (!context.nativePointer) {
      if ([14, 103].includes(message)) {
        if (!memory) throw new Error(`Legacy text message ${message} requires source text`);
        const bytes = [];
        for (let i = 0; i < 1024 * 1024; i++) {
          const value = memory.bytes(l + i, 1)[0];
          bytes.push(value);
          if (!value) break;
          if (i === 1024 * 1024 - 1)
            throw new Error('Legacy text source exceeds its original address space');
        }
        l = allocate(Uint8Array.from(bytes));
      } else if (message === 101) l = copy(l, 1116);
      else if ([117, 123].includes(message)) l = copy(l, 20);
      else if (message === 119 && (l || context.payload)) l = copy(l, 4, true);
      else if (message === 116 && l)
        return this.owner.platform.withBitmap(
          this.world.graphics.images.get(l),
          (pointer) =>
            this.message([sender, message, w, pointer], { ...context, nativePointer: true }),
          this.record.id,
        );
    }
    const out = context.nativeResult || p.allocate(4, true);
    if (!context.nativeResult) owned.push(out);
    const writes = p.watchWrites(out, 4);
    try {
      const rawMessage = mapABIMessage(this.owner.engine.profile, 'textLegacy', 'raw', message),
        unhandled = await this.invoke(this.owner.abi.message, [
          sender,
          rawMessage,
          w,
          l,
          context.flags ?? 0,
          out,
        ]);
      context.nativeUnhandled = Boolean(unhandled);
      for (const write of copies) write();
      return writes.written ? p.load(out) : undefined;
    } finally {
      writes.close();
      for (const at of owned) p.free(at);
    }
  }
  async tick(frame) {
    const p = this.owner.process,
      out = p.allocate(4, true);
    try {
      await this.invoke(this.owner.abi.frame, [frame >>> 0, out]);
    } finally {
      p.free(out);
    }
  }
  async drawTick(frame) {
    const p = this.owner.process;
    await this.invoke(p.load(p.load(this.pointer) + 12), [frame >>> 0]);
  }
  characters() {
    const p = this.owner.process,
      count = p.load(this.pointer + 688),
      capacity = p.load(this.pointer + 768),
      start = p.load(this.pointer + 684);
    if (count > capacity || count > 1000000)
      throw new Error('Legacy text character buffer is invalid');
    return p.read(start, count * 40);
  }
  snapshot() {
    return { pointer: this.pointer, plane: this.plane.snapshot() };
  }
  async restore(state) {
    this.pointer = state.pointer;
    await this.plane.restore(state.plane);
    if (this.owner.process.load(this.pointer + 4) !== (this.record.nativeID ?? this.record.id))
      throw new Error('Legacy text checkpoint task identity differs');
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
      await this.plane.close();
      this.closed = true;
    }
  }
}

export function installNativeLegacyText(world) {
  installNativeTaskMemory(world);
  world.registerNativeFeature('legacy-text', (engine) =>
    NativeLegacyTextRuntime.open(engine, world),
  );
  world.objects.register(8, async (record, _objects, options) =>
    (await world.getNativeFeature('legacy-text')).create(record, options),
  );
  for (const id of NATIVE_LEGACY_TEXT_IDS)
    world.runtime.register('main', id, async (args, machine, task) =>
      (await world.getNativeFeature('legacy-text')).apply(id, args, machine, task),
    );
}
