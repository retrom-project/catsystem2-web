// SPDX-License-Identifier: MPL-2.0
// Mission oracle paths during the staged content-data migration.
// Question, selection and compiled-table handles own JS models.
import { NativeQuestionTable, installNativeQuestionTables } from './question-table.mjs';
import { NativeSelectionTable, installNativeSelectionTables } from './selection-table.mjs';
import { NativeCompiledTable, installNativeCompiledTables } from './compiled-table.mjs';
import { nativeReply } from '../kcs/vm.mjs';
import { NativeKCSMemory } from './kcs-memory.mjs';
import { installNativeEngineFiles } from './engine-files.mjs';

export const NATIVE_CONTENT_DATABASE_FAMILIES = Object.freeze({
  mission: { bytes: 20, create: 0x31b, release: 0x31c, destroy: [0x79a110, 0x632ae0] },
});
const rows = [
  [795, 'mission', 1, 1, 6553056, 5378432],
  [796, 'mission', 1, 2, 6552048, 5377424],
  [797, 'mission', 2, 2, 6553856, 5379152],
  [798, 'mission', 1, 1, 6552608, 5377984],
  [799, 'mission', 2, 2, 6553824, 5379120],
  [800, 'mission', 1, 1, 6552272, 5377648],
  [801, 'mission', 2, 2, 6551984, 5377360],
  [802, 'mission', 5, 2, 6552144, 5377520],
  [803, 'mission', 4, 2, 6552944, 5378320],
  [804, 'mission', 3, 1, 6552320, 5377696],
  [805, 'mission', 3, 1, 6552656, 5378032],
  [806, 'mission', 4, 1, 6552704, 5378080],
  [807, 'mission', 3, 2, 6552880, 5378256],
  [808, 'mission', 2, 2, 6553536, 5378832],
  [809, 'mission', 2, 2, 6553600, 5378896],
  [810, 'mission', 3, 2, 6553888, 5379184],
  [811, 'mission', 3, 2, 6552848, 5378224],
  [812, 'mission', 3, 2, 6552816, 5378192],
  [813, 'mission', 2, 2, 6552784, 5378160],
  [814, 'mission', 8, 2, 6552384, 5377760],
  [815, 'mission', 1, 2, 6551920, 5377296],
  [816, 'mission', 3, 2, 6553392, 5378688],
  [817, 'mission', 3, 1, 6553776, 5379072],
  [818, 'mission', 2, 1, 6553728, 5379024],
  [819, 'mission', 2, 1, 6553680, 5378976],
  [820, 'mission', 4, 1, 6552528, 5377904],
  [821, 'mission', 1, 2, 6551952, 5377328],
  [822, 'mission', 1, 2, 6552016, 5377392],
  [823, 'mission', 2, 1, 6553632, 5378928],
  [824, 'mission', 3, 1, 6553344, 5378640],
  [825, 'mission', 4, 1, 6552224, 5377600],
  [826, 'mission', 2, 1, 6552096, 5377472],
  [827, 'mission', 1, 2, 6552912, 5378288],
  [828, 'mission', 1, 2, 6553568, 5378864],
];
export const NATIVE_CONTENT_DATABASE_CONTRACTS = Object.freeze(
  rows.map(([id, family, words, control, game, sdk]) =>
    Object.freeze({ id, family, words, control, handlers: [game, sdk] }),
  ),
);
export const NATIVE_CONTENT_DATABASE_IDS = Object.freeze(
  NATIVE_CONTENT_DATABASE_CONTRACTS.map((x) => x.id),
);
const byID = new Map(NATIVE_CONTENT_DATABASE_CONTRACTS.map((x) => [x.id, x]));
export const nativeContentDatabaseCodec = Object.freeze({
  snapshot: (value) =>
    value.data ? { family: value.family, state: value.data.snapshot() } : { ...value },
  restore: (value) =>
    value.state
      ? {
          family: value.family,
          data: new {
            question: NativeQuestionTable,
            selection: NativeSelectionTable,
            compiledTable: NativeCompiledTable,
          }[value.family]().restore(value.state),
        }
      : { ...value },
});
export class NativeContentDatabases {
  constructor(engine, world) {
    this.engine = engine;
    this.world = world;
    this.process = engine.process;
    this.profileIndex =
      engine.profile === 'nekopara-vol3-engine-2.6.1.76'
        ? 0
        : engine.profile === 'sdk-4.01-engine-2.6.1.74'
          ? 1
          : -1;
    if (this.profileIndex < 0)
      throw new Error('Native content databases require a reviewed engine');
    engine.refs.contentDatabases ??= { pointers: new Map() };
    engine.registerFeature('content-databases', this);
  }
  get refs() {
    return this.engine.refs.contentDatabases;
  }
  pointer(handle, family) {
    if (!handle) return 0;
    const value = this.world.runtime.handles.get(handle, 'content-database');
    if (family && value.family !== family)
      throw new Error('Native content database has a different object family');
    if (
      this.refs.pointers.get(value.pointer) !== value.family ||
      this.process.allocations.get(value.pointer) !==
        NATIVE_CONTENT_DATABASE_FAMILIES[value.family]?.bytes
    )
      throw new Error('Native content database owner is not live');
    return value.pointer;
  }
  call(address, args, pointer, options) {
    return this.process.asyncEnabled
      ? this.engine.callFromHost(address, args, pointer, options)
      : this.engine.call(address, args, pointer, options);
  }
  async apply(id, args, machine, task) {
    const spec = byID.get(id);
    if (!spec) return undefined;
    const definition = NATIVE_CONTENT_DATABASE_FAMILIES[spec.family],
      create = id === definition.create,
      release = id === definition.release;
    const words = Array.from(args);
    while (words.length < spec.words) words.push(machine.nativeArgument(words.length));
    if (!create) words[0] = this.pointer(words[0], spec.family);
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
        spec.handlers[this.profileIndex],
        [bridge.pointer, 0, argv, out],
        undefined,
        { task: task.id },
      );
      if (control !== spec.control)
        throw new Error(
          'Original content database control code disagrees with its reviewed contract',
        );
      if (create) {
        const pointer = p.load(out);
        if (!pointer) return nativeReply(control, 0);
        if (p.allocations.get(pointer) !== definition.bytes)
          throw new Error('Original content database constructor returned no owner');
        this.refs.pointers.set(pointer, spec.family);
        return nativeReply(
          control,
          world.runtime.handles.add('content-database', { pointer, family: spec.family }),
        );
      }
      if (release && args[0]) {
        this.refs.pointers.delete(words[0]);
        world.runtime.handles.release(args[0], 'content-database');
      }
      return nativeReply(control, control === 1 || control === 3 ? p.load(out) : undefined);
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
    if (!(this.refs.pointers instanceof Map))
      throw new Error('Invalid native content database registry');
  }
  async close() {
    if (this.closed) return;
    this.closed = true;
    const errors = [],
      p = this.process;
    for (const [pointer, family] of this.refs.pointers)
      try {
        await this.call(
          NATIVE_CONTENT_DATABASE_FAMILIES[family].destroy[this.profileIndex],
          [],
          pointer,
        );
        if (!p.free(pointer)) throw new Error('Native content database released an unknown owner');
        this.refs.pointers.delete(pointer);
      } catch (error) {
        errors.push(error);
      }
    if (errors.length) throw new AggregateError(errors, 'Native content database cleanup failed');
  }
}
export function installNativeContentDatabases(world) {
  installNativeEngineFiles(world);
  world.registerNativeFeature('content-databases', async (engine) => {
    await world.getNativeFeature('engine-files');
    return new NativeContentDatabases(engine, world);
  });
  installNativeQuestionTables(world);
  installNativeSelectionTables(world);
  installNativeCompiledTables(world);
  for (const id of NATIVE_CONTENT_DATABASE_IDS)
    world.runtime.register('main', id, async (args, machine, task) =>
      (await world.getNativeFeature('content-databases')).apply(id, args, machine, task),
    );
}
