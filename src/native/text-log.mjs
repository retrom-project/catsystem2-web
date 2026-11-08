// SPDX-License-Identifier: MPL-2.0
// The display-log cache is an original engine object, separate from the CST
// history. Rebuilds import a temporary view of that history and discard it.
import { NativeKCSMemory } from './kcs-memory.mjs';
import { nativeReply } from '../kcs.mjs';
import { evaluateNativeExpression } from './expression.mjs';
import { installNativeEngineFiles } from './engine-files.mjs';

export const NATIVE_DISPLAY_LOG_IDS = Object.freeze([
  0x2b8, 0x2b9, 0x2ba, 0x2bb, 0x2bc, 0x311, 0x36c, 0x3d1, 0x40a,
]);
export const NATIVE_DISPLAY_LOG_ABI = Object.freeze({
  'nekopara-vol3-engine-2.6.1.76': {
    main: 0xa2dd38,
    count: 1055,
    historyCtor: 0x72d010,
    historyDtor: 0x72d030,
    historyImport: 0x72d680,
    lineCount: 0x72ea70,
    line: 0x72ec40,
    filename: 0x5d39e0,
    read: 0x5d50f0,
  },
  'sdk-4.01-engine-2.6.1.74': {
    main: 0xb3c900,
    count: 1009,
    historyCtor: 0x5dbfa0,
    historyDtor: 0x5dbfc0,
    historyImport: 0x5dc610,
    lineCount: 0x5dd8f0,
    line: 0x5ddac0,
    filename: 0x4b0830,
    read: 0x4b1ca0,
  },
});

export class NativeDisplayLogs {
  constructor(engine, world, fes) {
    Object.assign(this, { engine, world, fes, process: engine.process });
    this.abi = NATIVE_DISPLAY_LOG_ABI[engine.profile];
    if (!this.abi) throw new Error('Native display log requires a recovered engine profile');
    this.pointers = new Set();
    engine.registerFeature('display-logs', this);
  }
  pointer(handle) {
    if (!handle) return 0;
    const value = this.world.runtime.handles.get(handle, 'display-log');
    if (!this.pointers.has(value.pointer)) throw new Error('Native display log was released');
    return value.pointer;
  }
  async withHistory(history, callback, task) {
    const p = this.process,
      pointer = p.allocate(8, true),
      scene = p.allocate(8, true),
      blocks = ['seen', 'path'].map((side) => history.encode(side, true)),
      buffers = blocks.map((bytes) => {
        const at = p.allocate(Math.max(1, bytes.length), true);
        p.write(at, bytes);
        return at;
      });
    let constructed = false;
    try {
      await this.engine.call(this.abi.historyCtor, [], pointer, { task });
      constructed = true;
      await this.engine.call(
        this.abi.historyImport,
        [buffers[0], blocks[0].length, buffers[1], blocks[1].length],
        pointer,
        { task },
      );
      p.store(scene + 4, pointer);
      return await callback(scene);
    } finally {
      if (constructed) await this.engine.call(this.abi.historyDtor, [], pointer, { task });
      for (const at of [...buffers, pointer, scene]) p.free(at);
    }
  }
  async apply(id, args, machine, task) {
    if (!NATIVE_DISPLAY_LOG_IDS.includes(id) || id >= this.abi.count) return undefined;
    if ([0x2bb, 0x40a].includes(id) && args[1]) {
      const history = this.world.runtime.handles.get(args[1], 'scene-data').history;
      return this.withHistory(
        history,
        (pointer) => this.applyGuest(id, [args[0], pointer, ...args.slice(2)], machine, task),
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
    const expected = new Map([
      [0x2b8, 0],
      [0x2b9, 1],
      [0x2ba, 7],
      [0x2bb, 4],
      [0x2bc, 3],
      [0x311, 2],
      [0x36c, 1],
      [0x3d1, 8],
      [0x40a, 5],
    ]).get(id);
    if (args.length !== expected)
      throw new Error(`Display-log native 0x${id.toString(16)} requires ${expected} arguments`);
    const p = this.process,
      bridge = new NativeKCSMemory(p, machine, mapping),
      parameters = p.allocate(Math.max(4, args.length * 4), true),
      output = p.allocate(4, true),
      caller = p.allocate(128, true),
      values = [...args],
      pointer = id === 0x2b8 ? 0 : this.pointer(values[0]);
    if (id !== 0x2b8) values[0] = pointer;
    values.forEach((value, i) => p.store(parameters + i * 4, value));
    const evaluate = (source) => {
        const bank = this.world.runtime.variableBank(task, false);
        if (!bank)
          throw new Error('Native display-log script condition has no variable interpreter');
        return evaluateNativeExpression(source, bank);
      },
      context = {
        instance: { runtimeID: task.id },
        object: { nativeType: 21 },
        evaluate,
        expandBytes: (source) =>
          this.world.runtime.stringBank(task, false)?.expandBytes(source) ?? source,
      };
    try {
      // A KCS owner's variable interpreter is used by the original command
      // classification during a history rebuild, through the same boundary
      // as FES expressions. Its storage remains the World's shared bank.
      const control = await this.fes.withContext(context, () =>
        this.engine.call(
          p.load(this.abi.main + id * 4),
          [bridge.pointer, caller, parameters, output],
          undefined,
          { task: task.id },
        ),
      );
      if (id === 0x2b8) {
        const pointer = p.load(output);
        if (!pointer) return nativeReply(control, 0);
        this.pointers.add(pointer);
        return nativeReply(
          control,
          this.world.runtime.handles.add('display-log', { pointer, owner: task.id }),
        );
      }
      if (id === 0x2b9 && pointer) {
        this.pointers.delete(pointer);
        this.world.runtime.handles.release(args[0], 'display-log');
      }
      return nativeReply(control, [1, 3].includes(control) ? p.load(output) : undefined);
    } finally {
      bridge.close();
      for (const at of [parameters, output, caller]) p.free(at);
    }
  }
  async lines(handle) {
    const pointer = this.pointer(handle),
      count = await this.engine.call(this.abi.lineCount, [], pointer),
      lines = [];
    for (let index = 0; index < count; index++) {
      const source = await this.engine.call(this.abi.line, [index], pointer);
      lines.push(this.process.stringBytes(source).slice());
    }
    return lines;
  }
  snapshot() {
    return { pointers: [...this.pointers] };
  }
  restore(state) {
    this.pointers = new Set(state.pointers);
  }
  async close() {
    const p = this.process,
      parameters = p.allocate(4, true),
      output = p.allocate(4, true);
    try {
      for (const pointer of this.pointers) {
        p.store(parameters, pointer);
        await this.engine.call(p.load(this.abi.main + 0x2b9 * 4), [0, 0, parameters, output]);
      }
      this.pointers.clear();
    } finally {
      p.free(parameters);
      p.free(output);
    }
  }
}

export function installNativeDisplayLogs(world) {
  installNativeEngineFiles(world);
  world.registerNativeFeature('display-logs', async (engine) => {
    await world.getNativeFeature('engine-files');
    return new NativeDisplayLogs(engine, world, await world.getNativeFeature('fes-objects'));
  });
  for (const id of NATIVE_DISPLAY_LOG_IDS) {
    if (world.profile.startsWith('sdk-') && id >= 1009) continue;
    world.runtime.register('main', id, async (args, machine, task) =>
      (await world.getNativeFeature('display-logs')).apply(id, args, machine, task),
    );
  }
}
