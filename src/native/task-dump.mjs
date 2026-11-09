// SPDX-License-Identifier: MPL-2.0
// The SDK writes its original task dump through the shared task graph and IFile.
import { nativeReply, NATIVE_RESULT_SENTINEL } from '../kcs/vm.mjs';
import { NATIVE_ENGINE_MESSAGE_LAYOUTS } from './engine-message.mjs';
import { NativeKCSMemory } from './kcs-memory.mjs';

export const NATIVE_TASK_DUMP = Object.freeze({
  id: 0xd0,
  game: Object.freeze({ address: 0x643a30, message: 36 }),
  sdk: Object.freeze({ address: 0x52a1a0, message: 34 }),
});

export class NativeTaskDump {
  constructor(engine, world) {
    Object.assign(this, { engine, world, process: engine.process });
    this.sdk = engine.profile.startsWith('sdk-');
    this.spec = this.sdk ? NATIVE_TASK_DUMP.sdk : NATIVE_TASK_DUMP.game;
    this.layout = NATIVE_ENGINE_MESSAGE_LAYOUTS[engine.profile];
    const p = this.process,
      send = p.trap('KCS task dump transport', 7, (args) => this.dispatch(args, true));
    this.vtable = p.allocate(20, true);
    p.store(this.vtable + 16, send);
    if (this.sdk) {
      const query = p.trap('SDK task dump size and data transport', 7, (args) =>
        this.dispatch(args, false),
      );
      // Only the two sends inside the original SDK Top writer cross the
      // canonical graph boundary. Its allocator, path formatting and IFile
      // calls keep their original behavior.
      for (const site of [0x4bacc9, 0x4bad25]) {
        if (p.read(site, 1)[0] !== 0xe8 || (site + 5 + p.load(site + 1)) >>> 0 !== this.layout.send)
          throw new Error('Original SDK task dump send call changed');
        p.store(site + 1, query - site - 5);
      }
    }
    engine.registerFeature('task-dump', this);
  }
  async dispatch(args, wrapper) {
    const [sender, target, message, w, l, flags, out] = args,
      p = this.process,
      origin = this.engine.currentTaskID;
    if (
      origin == null ||
      target ||
      flags ||
      (wrapper ? message !== this.spec.message : w || (message !== 15 && message !== 16))
    )
      throw new Error('Unexpected original task dump envelope');
    const context = {
      payload: p,
      nativePointer: true,
      nativeSender: sender,
      flags,
      fromHost: true,
    };
    if (wrapper && this.sdk)
      context.writeNativeTaskDump = async (record) => {
        const memory = await this.world.getNativeFeature('task-memory'),
          top = await memory.pointer(record.id),
          result = await this.engine.callFromHost(
            this.layout.root,
            [sender, message, w, l, flags, out],
            top,
            { task: record.id },
          );
        if (result !== 0) throw new Error('Original SDK Top did not handle its task dump');
      };
    const result = await this.world.sendNativeEngine(target, origin, message, w, l, context);
    if (out && Number.isInteger(result)) p.store(out, result);
    if (typeof context.nativeRouted !== 'boolean')
      throw new Error('Native task dump transport did not report its route');
    return Number(context.nativeRouted);
  }
  async apply(args, machine, task) {
    const source = args[0] ?? machine.nativeArgument(0),
      memory =
        this.world.objects.machine(task.id) === machine
          ? await this.world.getNativeFeature('task-memory')
          : null;
    if (memory) memory.vmPointer(task.id);
    const p = this.process,
      bridge = new NativeKCSMemory(p, machine, memory?.mapMachine(task.id, machine));
    let scratch;
    try {
      scratch = p.allocate(16);
      const host = scratch,
        argv = scratch + 8,
        out = scratch + 12;
      p.store(host, this.vtable);
      p.store(host + 4, this.world.nativeTaskID(task.id));
      p.store(argv, source);
      p.store(out, NATIVE_RESULT_SENTINEL);
      const parameters = [bridge.pointer, host, argv, out],
        options = { task: task.id },
        control = p.asyncEnabled
          ? await this.engine.callFromHost(this.spec.address, parameters, undefined, options)
          : await this.engine.call(this.spec.address, parameters, undefined, options),
        value = p.load(out);
      if (control !== 1 || value !== 0) throw new Error('Unexpected original KCS task dump result');
      return nativeReply(control, value);
    } finally {
      try {
        bridge.close();
      } finally {
        if (scratch) p.free(scratch);
      }
    }
  }
  snapshot() {
    return { vtable: this.vtable };
  }
  restore(state) {
    this.vtable = state.vtable;
  }
  close() {
    this.process.free(this.vtable);
  }
}

export function installNativeTaskDump(world) {
  world.registerNativeFeature('task-dump', (engine) => new NativeTaskDump(engine, world));
  world.runtime.register('main', NATIVE_TASK_DUMP.id, async (args, machine, task) =>
    (await world.getNativeFeature('task-dump')).apply(args, machine, task),
  );
}
