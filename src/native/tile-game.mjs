// SPDX-License-Identifier: MPL-2.0
// Main 1D6..201 is the engine's built-in tile-rules context. Its model is a
// process global shared by all 32-byte contexts, not a per-script JS copy.
import { nativeReply } from '../kcs/vm.mjs';
import { NativeKCSMemory } from './kcs-memory.mjs';
import { NATIVE_EXE_PROFILES } from './catalog.mjs';

export const NATIVE_TILE_GAME_IDS = Object.freeze(
  Array.from({ length: 44 }, (_, index) => 0x1d6 + index),
);
export const NATIVE_TILE_GAME_LAYOUTS = Object.freeze({
  'nekopara-vol3-engine-2.6.1.76': Object.freeze({
    initialize: 0x5b9480,
    destroy: 0x5b9680,
    model: 0xbc3ff0,
  }),
  'sdk-4.01-engine-2.6.1.74': Object.freeze({
    initialize: 0x488870,
    destroy: 0x488a70,
    model: 0xcc3360,
  }),
});
const counts = Object.freeze([
  0, 1, 9, 1, 2, 1, 1, 3, 3, 3, 2, 1, 5, 3, 1, 2, 3, 4, 2, 4, 4, 3, 1, 2, 7, 2, 5, 2, 3, 1, 1, 1, 2,
  2, 1, 4, 2, 2, 1, 3, 4, 2, 2, 2,
]);
const controls = Object.freeze([
  1, 2, 2, 1, 2, 1, 1, 1, 1, 1, 1, 1, 2, 2, 1, 1, 1, 1, 2, 2, 1, 1, 1, 1, 2, 1, 2, 1, 1, 1, 1, 2, 1,
  1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1,
]);
export const NATIVE_TILE_GAME_ABI = Object.freeze(
  NATIVE_TILE_GAME_IDS.map((id, index) =>
    Object.freeze({ id, argumentWords: counts[index], control: controls[index] }),
  ),
);
export const nativeTileGameCodec = Object.freeze({
  snapshot: (value) => ({ ...value }),
  restore: (value) => ({ ...value }),
});

export class NativeTileGame {
  constructor(engine, world) {
    this.engine = engine;
    this.world = world;
    this.layout = NATIVE_TILE_GAME_LAYOUTS[engine.profile];
    if (!this.layout) throw new Error('Native tile rules require a reviewed engine profile');
    engine.registerFeature('tile-game', this);
  }
  get refs() {
    return (this.engine.refs.tileGame ??= { initialized: false, contexts: new Set() });
  }
  initialize() {
    if (this.closed) throw new Error('Native tile rules are closed');
    if (this.refs.initialized) return Promise.resolve();
    return (this.initializing ??= this.engine.call(this.layout.initialize).then(
      () => {
        this.refs.initialized = true;
        this.initializing = null;
      },
      (error) => {
        this.initializing = null;
        throw error;
      },
    ));
  }
  pointer(handle) {
    if (!handle) return 0;
    const pointer = this.world.runtime.handles.get(handle, 'tile-game').pointer;
    if (!this.refs.contexts.has(pointer) || this.engine.process.allocations.get(pointer) !== 32)
      throw new Error('Native tile-rules handle has no live context');
    return pointer;
  }
  async apply(id, args, machine, task) {
    const abi = NATIVE_TILE_GAME_ABI[id - 0x1d6];
    if (!abi || abi.id !== id) return undefined;
    if (args.length !== abi.argumentWords)
      throw new Error(
        `Native tile rules 0x${id.toString(16)} expects ${abi.argumentWords} arguments`,
      );
    await this.initialize();
    const world = this.world,
      p = this.engine.process,
      words = [...args];
    if (id !== 0x1d6) words[0] = this.pointer(words[0]);
    const taskMemory =
      world.objects.machine(task.id) === machine
        ? await world.getNativeFeature('task-memory')
        : null;
    if (taskMemory) taskMemory.vmPointer(task.id);
    const bridge = new NativeKCSMemory(p, machine, taskMemory?.mapMachine(task.id, machine)),
      argv = p.allocate(words.length * 4),
      out = p.allocate(4);
    try {
      words.forEach((value, index) => p.store(argv + index * 4, value));
      p.store(out, 0xcccccccc);
      const control = await this.engine.call(
        p.load(NATIVE_EXE_PROFILES[this.engine.profile].tables.main.va + id * 4),
        [bridge.pointer, 0, argv, out],
        undefined,
        { task: task.id },
      );
      if (control !== abi.control)
        throw new Error('Native tile-rules control disagrees with its ABI');
      if (id === 0x1d6) {
        const pointer = p.load(out);
        if (!pointer) return nativeReply(control, 0);
        if (p.allocations.get(pointer) !== 32 || p.load(pointer) !== this.layout.model)
          throw new Error('Native tile-rules constructor returned no context');
        this.refs.contexts.add(pointer);
        return nativeReply(control, world.runtime.handles.add('tile-game', { pointer }));
      }
      if (id === 0x1d7 && args[0]) {
        this.refs.contexts.delete(words[0]);
        world.runtime.handles.release(args[0], 'tile-game');
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
    this.initializing = null;
    if (typeof this.refs.initialized !== 'boolean' || !(this.refs.contexts instanceof Set))
      throw new Error('Native tile-rules checkpoint registry is invalid');
  }
  async close() {
    if (this.closed) return;
    const p = this.engine.process;
    for (const pointer of this.refs.contexts) {
      // The wrapper's release path only reads argv[0]; no VM is required.
      const argv = p.allocate(4);
      try {
        p.store(argv, pointer);
        await this.engine.call(
          p.load(NATIVE_EXE_PROFILES[this.engine.profile].tables.main.va + 0x1d7 * 4),
          [0, 0, argv, 0],
        );
        this.refs.contexts.delete(pointer);
      } finally {
        p.free(argv);
      }
    }
    if (this.refs.initialized) {
      await this.engine.call(this.layout.destroy);
      this.refs.initialized = false;
    }
    this.closed = true;
  }
}
export function installNativeTileGame(world) {
  world.registerNativeFeature('tile-game', (engine) => new NativeTileGame(engine, world));
  for (const id of NATIVE_TILE_GAME_IDS)
    world.runtime.register('main', id, async (args, machine, task) =>
      (await world.getNativeFeature('tile-game')).apply(id, args, machine, task),
    );
}
