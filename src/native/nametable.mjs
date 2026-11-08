// SPDX-License-Identifier: MPL-2.0
// One original four-byte name-table owner, including its filename rules.
import { nativeReply } from '../kcs/vm.mjs';
import { NativeKCSMemory } from './kcs-memory.mjs';
import { installNativeEngineFiles } from './engine-files.mjs';

export const NATIVE_NAME_TABLE_CONTRACTS = Object.freeze(
  [
    [0x279, 1, 1, 0x64e3c0, 0x519910],
    [0x27a, 1, 2, 0x64e4f0, 0x519a10],
    [0x27b, 2, 1, 0x64e730, 0x519c50],
    [0x27c, 2, 1, 0x64e6c0, 0x519be0],
    [0x27d, 3, 1, 0x64e6f0, 0x519c10],
    [0x27e, 4, 1, 0x64e670, 0x519b90],
    [0x27f, 3, 1, 0x64e520, 0x519a40],
    [0x280, 4, 1, 0x64e5f0, 0x519b10],
  ].map(([id, words, control, game, sdk]) =>
    Object.freeze({ id, words, control, handlers: [game, sdk] }),
  ),
);
export const NATIVE_NAME_TABLE_IDS = Object.freeze(NATIVE_NAME_TABLE_CONTRACTS.map(({ id }) => id));
const byID = new Map(NATIVE_NAME_TABLE_CONTRACTS.map((spec) => [spec.id, spec]));
export const nativeNameTableCodec = Object.freeze({
  snapshot: (value) => ({ ...value }),
  restore: (value) => ({ ...value }),
});

export class NativeNameTables {
  constructor(engine, world) {
    Object.assign(this, { engine, world, process: engine.process });
    this.profileIndex =
      engine.profile === 'nekopara-vol3-engine-2.6.1.76'
        ? 0
        : engine.profile === 'sdk-4.01-engine-2.6.1.74'
          ? 1
          : -1;
    if (this.profileIndex < 0) throw new Error('Native name tables require a reviewed engine');
    engine.refs.nameTables ??= new Set();
    engine.registerFeature('name-tables', this);
  }
  get pointers() {
    return this.engine.refs.nameTables;
  }
  pointer(handle) {
    if (!handle) return 0;
    const pointer = this.world.runtime.handles.get(handle, 'nametable').pointer;
    if (!this.pointers.has(pointer) || this.process.allocations.get(pointer) !== 4)
      throw new Error('Native name table is absent or released');
    return pointer;
  }
  call(address, args, task) {
    return this.process.asyncEnabled
      ? this.engine.callFromHost(address, args, undefined, { task })
      : this.engine.call(address, args, undefined, { task });
  }
  async apply(id, args, machine, task) {
    const spec = byID.get(id);
    if (!spec) return undefined;
    const words = Array.from(args);
    while (!words.length) words.push(machine.nativeArgument(0));
    const count = id !== 0x279 && !words[0] ? 1 : spec.words;
    while (words.length < count) words.push(machine.nativeArgument(words.length));
    const handle = words[0];
    if (id !== 0x279) words[0] = this.pointer(words[0]);
    const memory =
      this.world.objects.machine(task.id) === machine
        ? await this.world.getNativeFeature('task-memory')
        : null;
    if (memory) memory.vmPointer(task.id);
    const p = this.process,
      bridge = new NativeKCSMemory(p, machine, memory?.mapMachine(task.id, machine)),
      argv = p.allocate(words.length * 4),
      out = p.allocate(4);
    try {
      words.forEach((word, i) => p.store(argv + i * 4, word));
      p.store(out, 0xcccccccc);
      const control = await this.call(
        spec.handlers[this.profileIndex],
        [bridge.pointer, 0, argv, out],
        task.id,
      );
      if (control !== spec.control)
        throw new Error('Native name-table control disagrees with its original wrapper');
      if (id === 0x279) {
        const pointer = p.load(out);
        if (!pointer) return nativeReply(1, 0);
        if (p.allocations.get(pointer) !== 4)
          throw new Error('Name-table constructor returned no four-byte owner');
        this.pointers.add(pointer);
        return nativeReply(1, this.world.runtime.handles.add('nametable', { pointer }));
      }
      if (id === 0x27a && handle) {
        this.pointers.delete(words[0]);
        this.world.runtime.handles.release(handle, 'nametable');
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
    if (!(this.pointers instanceof Set)) throw new Error('Invalid native name-table registry');
  }
  async close() {
    if (this.closed) return;
    const p = this.process,
      argv = p.allocate(4),
      out = p.allocate(4);
    try {
      for (const pointer of this.pointers) {
        p.store(argv, pointer);
        await this.call(byID.get(0x27a).handlers[this.profileIndex], [0, 0, argv, out]);
        this.pointers.delete(pointer);
      }
      for (const [handle, record] of this.world.runtime.handles.records)
        if (record.type === 'nametable') this.world.runtime.handles.release(handle, 'nametable');
    } finally {
      p.free(out);
      p.free(argv);
      this.closed = true;
    }
  }
}
export function installNativeNameTables(world) {
  installNativeEngineFiles(world);
  world.registerNativeFeature('name-tables', async (engine) => {
    await world.getNativeFeature('engine-files');
    await world.getNativeFeature('data-buffers');
    return new NativeNameTables(engine, world);
  });
  for (const id of NATIVE_NAME_TABLE_IDS)
    world.runtime.register('main', id, async (args, machine, task) =>
      (await world.getNativeFeature('name-tables')).apply(id, args, machine, task),
    );
}
