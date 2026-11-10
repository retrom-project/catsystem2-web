// SPDX-License-Identifier: MPL-2.0
// Original section/key tables retain repeated values in source order.
// Handles contain identity only; section maps and value strings stay in PE RAM.
import { nativeReply } from '../src/kcs/vm.mjs';
import { NativeKCSMemory } from '../src/native/kcs-memory.mjs';
import { installNativeEngineFiles } from '../src/native/engine-files.mjs';

export const NATIVE_SECTION_TABLE_IDS = Object.freeze([0x2ab, 0x2ac, 0x2ad]);
export const NATIVE_SECTION_TABLE_LAYOUTS = Object.freeze({
  'nekopara-vol3-engine-2.6.1.76': Object.freeze({
    handlers: [0x650e60, 0x650e30, 0x650f90],
    construct: 0x788450,
    destroy: 0x788460,
  }),
  'sdk-4.01-engine-2.6.1.74': Object.freeze({
    handlers: [0x51c340, 0x51c310, 0x51c460],
    construct: 0x620b30,
    destroy: 0x620b40,
  }),
});
export const nativeSectionTableCodec = Object.freeze({
  snapshot: (value) => ({ ...value }),
  restore: (value) => ({ ...value }),
});
const COUNTS = [1, 1, 5];

export class NativeSectionTables {
  constructor(engine, world) {
    this.engine = engine;
    this.world = world;
    this.process = engine.process;
    this.layout = NATIVE_SECTION_TABLE_LAYOUTS[engine.profile];
    if (!this.layout) throw new Error('Native section-tables require a reviewed engine profile');
    engine.refs.sectionTables ??= { pointers: new Set() };
    engine.registerFeature('section-tables', this);
  }
  get refs() {
    return this.engine.refs.sectionTables;
  }
  pointer(handle) {
    if (!handle) return 0;
    const pointer = this.world.runtime.handles.get(handle, 'section-table').pointer;
    if (!this.refs.pointers.has(pointer) || this.process.allocations.get(pointer) !== 8)
      throw new Error('Native section table has no live 8-byte owner');
    return pointer;
  }
  call(address, args, pointer, options) {
    return this.process.asyncEnabled
      ? this.engine.callFromHost(address, args, pointer, options)
      : this.engine.call(address, args, pointer, options);
  }
  async apply(id, args, machine, task) {
    const index = NATIVE_SECTION_TABLE_IDS.indexOf(id);
    if (index < 0) return undefined;
    const words = Array.from(args);
    if (!words.length) words.push(machine.nativeArgument(0));
    // Null owners return before the original wrappers consume further arguments.
    const needed = id === 0x2ab || words[0] !== 0 ? COUNTS[index] : 1;
    while (words.length < needed) words.push(machine.nativeArgument(words.length));
    if (id !== 0x2ab) words[0] = this.pointer(words[0]);
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
      if (id === 0x2ab) {
        const pointer = p.load(out);
        if (!pointer) return nativeReply(control, 0);
        if (p.allocations.get(pointer) !== 8)
          throw new Error('Original section table constructor returned no owner');
        this.refs.pointers.add(pointer);
        return nativeReply(control, world.runtime.handles.add('section-table', { pointer }));
      }
      if (id === 0x2ac && args[0]) {
        this.refs.pointers.delete(words[0]);
        world.runtime.handles.release(args[0], 'section-table');
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
    if (!(this.refs.pointers instanceof Set))
      throw new Error('Invalid native section table registry');
  }
  async close() {
    if (this.closed) return;
    const p = this.process;
    try {
      for (const pointer of this.refs.pointers) {
        await this.call(this.layout.destroy, [], pointer);
        if (!p.free(pointer)) throw new Error('Native section table released an unknown owner');
        this.refs.pointers.delete(pointer);
      }
    } finally {
      this.closed = true;
    }
  }
}

export function installNativeSectionTables(world) {
  installNativeEngineFiles(world);
  world.registerNativeFeature('section-tables', async (engine) => {
    await world.getNativeFeature('engine-files');
    return new NativeSectionTables(engine, world);
  });
  for (const id of NATIVE_SECTION_TABLE_IDS)
    world.runtime.register('main', id, async (args, machine, task) =>
      (await world.getNativeFeature('section-tables')).apply(id, args, machine, task),
    );
}
