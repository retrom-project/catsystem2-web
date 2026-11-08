// SPDX-License-Identifier: MPL-2.0
// The compiled KCDB parser and indexed flag map execute in the shared engine.
// Handles contain identity only; title/index strings and flags stay in PE RAM.
import { nativeReply } from '../kcs/vm.mjs';
import { NativeKCSMemory } from './kcs-memory.mjs';
import { installNativeEngineFiles } from './engine-files.mjs';

export const NATIVE_DATABASE_IDS = Object.freeze([0x365, 0x366, 0x367, 0x368, 0x369, 0x36d, 0x36e]);
export const NATIVE_DATABASE_LAYOUTS = Object.freeze({
  'nekopara-vol3-engine-2.6.1.76': Object.freeze({
    handlers: [0x647540, 0x647480, 0x647420, 0x6474b0, 0x6474e0, 0x647510, 0x647460],
    construct: 0x82a4c0,
    destroy: 0x82a5a0,
  }),
  'sdk-4.01-engine-2.6.1.74': Object.freeze({
    handlers: [0x52a7c0, 0x52a700, 0x52a6a0, 0x52a730, 0x52a760, 0x52a790, 0x52a6e0],
    construct: 0x874310,
    destroy: 0x8743f0,
  }),
});
export const nativeDatabaseCodec = Object.freeze({
  snapshot: (value) => ({ ...value }),
  restore: (value) => ({ ...value }),
});
const COUNTS = [4, 1, 3, 2, 2, 1, 1];

export class NativeDatabases {
  constructor(engine, world) {
    this.engine = engine;
    this.world = world;
    this.process = engine.process;
    this.layout = NATIVE_DATABASE_LAYOUTS[engine.profile];
    if (!this.layout) throw new Error('Native databases require a reviewed engine profile');
    engine.refs.databases ??= { pointers: new Set() };
    engine.registerFeature('databases', this);
  }
  get refs() {
    return this.engine.refs.databases;
  }
  pointer(handle) {
    if (!handle) return 0;
    const pointer = this.world.runtime.handles.get(handle, 'database').pointer;
    if (!this.refs.pointers.has(pointer) || this.process.allocations.get(pointer) !== 80)
      throw new Error('Native database has no live 80-byte owner');
    return pointer;
  }
  call(address, args, pointer, options) {
    return this.process.asyncEnabled
      ? this.engine.callFromHost(address, args, pointer, options)
      : this.engine.call(address, args, pointer, options);
  }
  async apply(id, args, machine, task) {
    const index = NATIVE_DATABASE_IDS.indexOf(id);
    if (index < 0) return undefined;
    const words = Array.from(args);
    if (!words.length) words.push(machine.nativeArgument(0));
    // Null owners return before the original wrappers consume further arguments.
    const needed = id === 0x365 || words[0] !== 0 ? COUNTS[index] : 1;
    while (words.length < needed) words.push(machine.nativeArgument(words.length));
    if (id !== 0x365) words[0] = this.pointer(words[0]);
    const world = this.world,
      taskMemory =
        world.objects.machine(task.id) === machine
          ? await world.getNativeFeature('task-memory')
          : null;
    if (taskMemory) taskMemory.vmPointer(task.id);
    const p = this.process,
      bridge = new NativeKCSMemory(p, machine, taskMemory?.mapMachine(task.id, machine)),
      argv = p.allocate(words.length * 4),
      out = p.allocate(4);
    try {
      words.forEach((word, i) => p.store(argv + i * 4, word));
      p.store(out, 0xcccccccc);
      const control = await this.call(
        this.layout.handlers[index],
        [bridge.pointer, 0, argv, out],
        undefined,
        { task: task.id },
      );
      if (id === 0x365) {
        const pointer = p.load(out);
        if (!pointer) return nativeReply(control, 0);
        if (p.allocations.get(pointer) !== 80)
          throw new Error('Original database constructor returned no owner');
        this.refs.pointers.add(pointer);
        return nativeReply(control, world.runtime.handles.add('database', { pointer }));
      }
      if (id === 0x366 && args[0]) {
        this.refs.pointers.delete(words[0]);
        world.runtime.handles.release(args[0], 'database');
      }
      return nativeReply(control, control === 1 ? p.load(out) : undefined);
    } finally {
      try {
        bridge.close();
      } finally {
        p.free(out);
        p.free(argv);
      }
    }
  }
  snapshot() {
    return {};
  }
  restore() {
    if (!(this.refs.pointers instanceof Set)) throw new Error('Invalid native database registry');
  }
  async close() {
    if (this.closed) return;
    const p = this.process;
    try {
      for (const pointer of this.refs.pointers) {
        await this.call(this.layout.destroy, [], pointer);
        if (!p.free(pointer)) throw new Error('Native database released an unknown owner');
        this.refs.pointers.delete(pointer);
      }
    } finally {
      this.closed = true;
    }
  }
}

export function installNativeDatabases(world) {
  installNativeEngineFiles(world);
  world.registerNativeFeature('databases', async (engine) => {
    await world.getNativeFeature('engine-files');
    return new NativeDatabases(engine, world);
  });
  for (const id of NATIVE_DATABASE_IDS)
    world.runtime.register('main', id, async (args, machine, task) =>
      (await world.getNativeFeature('databases')).apply(id, args, machine, task),
    );
}
