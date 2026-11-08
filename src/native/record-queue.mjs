// SPDX-License-Identifier: MPL-2.0
// Game main3F2..3F5/400 use a deque of separately allocated fixed-size records.
// The original wrappers retain deque block growth, popped allocation lifetime
// and their always-one status query in the shared native process.
import { nativeReply } from '../kcs/vm.mjs';
import { NativeKCSMemory } from './kcs-memory.mjs';
import { NATIVE_PROFILES } from './catalog.mjs';
export const NATIVE_RECORD_QUEUE_IDS = Object.freeze([0x3f2, 0x3f3, 0x3f4, 0x3f5, 0x400]);
const PROFILE = 'nekopara-vol3-engine-2.6.1.76';
export class NativeRecordQueues {
  constructor(engine, world) {
    if (engine.profile !== PROFILE)
      throw new Error('Native record queues require the reviewed game engine');
    this.engine = engine;
    this.world = world;
    engine.registerFeature('record-queues', this);
  }
  pointer(handle) {
    if (!handle) return 0;
    const pointer = this.world.runtime.handles.get(handle, 'record-queue').pointer;
    if (this.engine.process.allocations.get(pointer) !== 24)
      throw new Error('Native record queue has no live 24-byte owner');
    return pointer;
  }
  async apply(id, args, machine, task) {
    if (!NATIVE_RECORD_QUEUE_IDS.includes(id)) return undefined;
    const count = id === 0x3f4 || id === 0x3f5 ? 2 : 1;
    if (args.length !== count)
      throw new Error(`Native record queue 0x${id.toString(16)} expects ${count} arguments`);
    const world = this.world,
      p = this.engine.process,
      words = [...args];
    if (id !== 0x3f2) words[0] = this.pointer(words[0]);
    const taskMemory =
      world.objects.machine(task.id) === machine
        ? await world.getNativeFeature('task-memory')
        : null;
    if (taskMemory) taskMemory.vmPointer(task.id);
    const bridge = new NativeKCSMemory(p, machine, taskMemory?.mapMachine(task.id, machine)),
      argv = p.allocate(words.length * 4),
      out = p.allocate(4);
    try {
      words.forEach((value, i) => p.store(argv + i * 4, value));
      p.store(out, 0xcccccccc);
      const control = await this.engine.call(
        p.load(NATIVE_PROFILES[PROFILE].tables.main.va + id * 4),
        [bridge.pointer, 0, argv, out],
        undefined,
        { task: task.id },
      );
      if (id === 0x3f2) {
        const pointer = p.load(out);
        if (p.allocations.get(pointer) !== 24)
          throw new Error('Native record queue constructor returned no owner');
        return nativeReply(control, world.runtime.handles.add('record-queue', { pointer }));
      }
      if (id === 0x3f3 && args[0]) world.runtime.handles.release(args[0], 'record-queue');
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
  restore() {}
}
export function installNativeRecordQueues(world) {
  if (world.profile !== PROFILE) return;
  world.registerNativeFeature('record-queues', (engine) => new NativeRecordQueues(engine, world));
  for (const id of NATIVE_RECORD_QUEUE_IDS)
    world.runtime.register('main', id, async (args, machine, task) =>
      (await world.getNativeFeature('record-queues')).apply(id, args, machine, task),
    );
}
