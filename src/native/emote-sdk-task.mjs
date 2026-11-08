// SPDX-License-Identifier: MPL-2.0
// The frozen SDK's M2Plane class only derives from SimplePlane. It contains
// no E-mote manager, driver import, model parser or animation implementation.
import { NativeGraphicTask } from './graphics.mjs';
import { encodeCP932 } from '../kcs/strings.mjs';
export class NativeSDKM2Tasks {
  static async open(engine, world) {
    const platform = await world.getNativeFeature('graphics-platform'),
      taskMemory = await world.getNativeFeature('task-memory');
    return new NativeSDKM2Tasks(engine, world, platform, taskMemory);
  }
  constructor(engine, world, platform, taskMemory) {
    this.engine = engine;
    this.world = world;
    this.tasks = new Map();
    this.platform = platform;
    this.taskMemory = taskMemory;
    const p = engine.process;
    engine.registerWindows('USER32.dll', 'SetRectEmpty', {
      count: 1,
      fn: ([at]) => {
        p.zero(at, 16);
        return 1;
      },
    });
    engine.registerFeature('m2-task', this);
  }
  get view() {
    return this.platform.refs.view;
  }
  async create(record, { restoring = false, fromHost = false } = {}) {
    const task = new NativeSDKM2Task(this, record);
    this.tasks.set(record.id, task);
    this.world.graphics.tasks.set(record.id, task);
    if (!restoring) await task.construct({ fromHost });
    return task;
  }
  call(address, args = [], pointer, { fromHost = false } = {}) {
    return this.engine[fromHost || this.engine.process.asyncEnabled ? 'callFromHost' : 'call'](
      address,
      args,
      pointer,
      { task: this.taskMemory.worldID(pointer) },
    );
  }
  snapshot() {
    return {};
  }
  restore() {}
  close() {}
}
export class NativeSDKM2Task extends NativeGraphicTask {
  constructor(owner, record) {
    super(owner.world.graphics, record);
    this.owner = owner;
    this.pointer = 0;
  }
  async construct({ fromHost = false } = {}) {
    this.taskMemory = await this.owner.world.getNativeFeature('task-memory');
    const p = this.owner.engine.process,
      name = encodeCP932(this.record.name + '\0'),
      at = p.allocate(name.length);
    this.pointer = p.allocate(0x2ac, true);
    this.taskMemory.bind(this.record, this.pointer, { ready: false });
    p.write(at, name);
    try {
      await this.owner.call(
        0x4b9d20,
        [this.record.nativeID ?? this.record.id, at, this.record.frameRate, this.owner.view],
        this.pointer,
        { fromHost },
      );
      await this.taskMemory.ready(this.record);
    } finally {
      p.free(at);
    }
  }
  async message(words, context = {}) {
    if (words[1] === 3) {
      // A destruction notification releases the graph. Its scalar native
      // destructor runs only when the task graph reaches the release phase.
      this.closeGraph();
      return this.base.message(words, context);
    }
    if (words[1] < 498) {
      const canonical = [...words];
      if (canonical[1] >= 37) canonical[1] += 2;
      return super.message(canonical, context);
    }
    const p = this.owner.engine.process,
      out = context.nativeResult ?? p.allocate(4, true),
      writes = p.watchWrites(out, 4);
    try {
      // The original SDK SimplePlane has no M2 cases and forwards these
      // messages to its original BasePlane receiver. Its platform entry can
      // also be bound by the shared graphics feature, so call that exact
      // default receiver rather than reentering the graphics host bridge.
      const unhandled = await this.owner.call(
        0x4bb3d0,
        [...words, context.flags ?? 0, out],
        this.pointer,
      );
      context.nativeUnhandled = Boolean(unhandled);
      return writes.written ? p.load(out) : undefined;
    } finally {
      writes.close();
      if (context.nativeResult === undefined) p.free(out);
    }
  }
  snapshot() {
    return { pointer: this.pointer, plane: super.snapshot() };
  }
  restore(state) {
    this.pointer = state.pointer;
    this.taskMemory = this.owner.engine.features.get('task-memory');
    super.restore(state.plane);
  }
  async close({ fromHost = false } = {}) {
    if (this.closed) return;
    try {
      if (this.pointer) {
        const p = this.owner.engine.process;
        await this.owner.call(p.load(p.load(this.pointer)), [1], this.pointer, { fromHost });
      }
    } finally {
      this.owner.tasks.delete(this.record.id);
      this.taskMemory?.unbind(this.record.id);
      await super.close();
      this.closed = true;
    }
  }
}
