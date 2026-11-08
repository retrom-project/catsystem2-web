// SPDX-License-Identifier: MPL-2.0
// Original question/configuration, selection, KCDB and mission-table families.
// Every persistent field stays in the World's shared original-engine process.
import { nativeReply } from '../kcs/vm.mjs';
import { NativeKCSMemory } from './kcs-memory.mjs';
import { installNativeEngineFiles } from './engine-files.mjs';

export const NATIVE_CONTENT_DATABASE_FAMILIES = Object.freeze({
  question: { bytes: 620, create: 0x2e6, release: 0x2e7, destroy: [0x796b00, 0x62f020] },
  selection: { bytes: 12, create: 0x30b, release: 0x30c, destroy: [0x799010, 0x6315d0] },
  compiledTable: { bytes: 16, create: 0x317, release: 0x318, destroy: [0x79c7e0, 0x635190] },
  mission: { bytes: 20, create: 0x31b, release: 0x31c, destroy: [0x79a110, 0x632ae0] },
});
const rows = [
  [742, 'question', 0, 1, 6549248, 5374720],
  [743, 'question', 1, 2, 6549360, 5374784],
  [744, 'question', 2, 1, 6550896, 5376320],
  [745, 'question', 1, 1, 6550016, 5375440],
  [746, 'question', 3, 1, 6550400, 5375824],
  [747, 'question', 2, 1, 6550336, 5375760],
  [748, 'question', 4, 1, 6549440, 5374864],
  [749, 'question', 2, 2, 6550800, 5376224],
  [750, 'question', 2, 1, 6551136, 5376560],
  [751, 'question', 2, 1, 6554016, 5379360],
  [752, 'question', 1, 1, 6549744, 5375168],
  [753, 'question', 1, 1, 6550064, 5375488],
  [754, 'question', 2, 1, 6549536, 5374960],
  [755, 'question', 1, 1, 6550528, 5375952],
  [756, 'question', 1, 1, 6550480, 5375904],
  [757, 'question', 2, 2, 6550576, 5376000],
  [758, 'question', 3, 1, 6550656, 5376080],
  [759, 'question', 2, 1, 6550112, 5375536],
  [760, 'question', 1, 1, 6549632, 5375056],
  [761, 'question', 1, 1, 6549872, 5375296],
  [762, 'question', 1, 1, 6549920, 5375344],
  [763, 'question', 5, 2, 6550224, 5375648],
  [764, 'question', 1, 2, 6549136, 5374656],
  [765, 'question', 1, 1, 6549968, 5375392],
  [766, 'question', 2, 2, 6550752, 5376176],
  [767, 'question', 2, 1, 6553952, 5379296],
  [768, 'question', 2, 1, 6551072, 5376496],
  [769, 'question', 1, 2, 6549200, 5379248],
  [770, 'question', 1, 2, 6549200, 5379248],
  [771, 'question', 2, 1, 6550160, 5375584],
  [772, 'question', 2, 1, 6549680, 5375104],
  [773, 'question', 1, 2, 6553920, 5379216],
  [774, 'question', 2, 2, 6549408, 5374832],
  [775, 'question', 1, 1, 6550848, 5376272],
  [776, 'question', 3, 1, 6549792, 5375216],
  [777, 'question', 3, 2, 6554096, 5379440],
  [778, 'question', 1, 2, 6549168, 5374688],
  [779, 'selection', 0, 1, 6551376, 5376800],
  [780, 'selection', 1, 2, 6551488, 5376864],
  [781, 'selection', 3, 2, 6551808, 5377184],
  [782, 'selection', 2, 1, 6551632, 5377008],
  [783, 'selection', 1, 1, 6551536, 5376912],
  [784, 'selection', 2, 1, 6551584, 5376960],
  [791, 'compiledTable', 1, 1, 6568096, 5414096],
  [792, 'compiledTable', 1, 2, 6567840, 5413840],
  [793, 'compiledTable', 3, 1, 6567888, 5413888],
  [794, 'compiledTable', 4, 1, 6568000, 5414000],
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
  [829, 'selection', 2, 2, 6551776, 5377152],
  [830, 'selection', 3, 2, 6551344, 5376768],
  [831, 'selection', 2, 2, 6551280, 5376704],
  [832, 'selection', 2, 2, 6551312, 5376736],
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
  snapshot: (value) => ({ ...value }),
  restore: (value) => ({ ...value }),
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
  for (const id of NATIVE_CONTENT_DATABASE_IDS)
    world.runtime.register('main', id, async (args, machine, task) =>
      (await world.getNativeFeature('content-databases')).apply(id, args, machine, task),
    );
}
