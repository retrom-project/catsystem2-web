// SPDX-License-Identifier: MPL-2.0
// The Plane owns kcVideo. KCS can borrow that identity through the original
// load/query packets, then use the ordinary movie controls on that object.
import { nativeReply } from '../kcs/vm.mjs';
import { NativeKCSMemory } from './kcs-memory.mjs';

const PLANE_COMMANDS = new Map([
  [0x2bd, { words: 2, control: 2, message: 43, addresses: [0x640670, 0x512d50] }],
  [0x2be, { words: 1, control: 1, message: 87, addresses: [0x640ae0, 0x5131c0] }],
]);
const MOVIE_CONTROLS = new Map(
  [
    [0x10a, 2, 1, 0x6554c0, 0x5218a0],
    [0x10b, 1, 1, 0x655600, 0x5219e0],
    [0x10d, 1, 1, 0x655260, 0x521680],
    [0x10e, 1, 2, 0x655500, 0x5218e0],
    [0x1a1, 2, 2, 0x655520, 0x521900],
    [0x314, 5, 2, 0x655590, 0x521970],
    [0x3e4, 2, 2, 0x6555e0, 0x5219c0],
    [0x3e6, 1, 1, 0x655210, 0x521630],
  ].map(([id, words, control, game, sdk]) => [id, { words, control, addresses: [game, sdk] }]),
);
const HANDLE_TYPE = 'plane-movie';

export class NativePlaneMovieCommands {
  constructor(engine, world) {
    Object.assign(this, { engine, world, process: engine.process });
    this.sdk = Number(engine.profile.startsWith('sdk-'));
    this.handles = world.runtime.handles;
    this.byPointer = new Map();
    const p = this.process,
      transport = p.trap(
        'original movie plane task transport',
        7,
        async ([sender, target, raw, w, l, flags, out]) => {
          const origin = engine.currentTaskID,
            message = raw + this.sdk * 2;
          if (
            origin == null ||
            sender !== world.nativeTaskID(origin) ||
            ![43, 87].includes(message) ||
            w ||
            flags
          )
            throw new Error('Original movie plane command sent an unexpected task envelope');
          const context = {
              payload: p,
              nativePointer: true,
              nativeResult: out,
              nativeSender: sender,
              fromHost: true,
            },
            result = await world.sendNativeEngine(target, origin, message, w, l, context);
          if (out && Number.isInteger(result)) p.store(out, result);
          return Number(context.nativeRouted);
        },
      );
    this.vtable = p.allocate(20, true);
    p.store(this.vtable + 16, transport);
    this.detach = p.beforeInstruction(
      this.sdk ? 0x5baf00 : 0x6fc9b0,
      'original kcVideo destruction of borrowed handles',
      () => {
        const pointer = p.cpu.reg_read_i32(p.uc.X86_REG_ECX) >>> 0,
          handle = this.byPointer.get(pointer);
        if (handle) {
          this.handles.release(handle, HANDLE_TYPE);
          this.byPointer.delete(pointer);
        }
      },
    );
    engine.registerFeature('plane-movie-commands', this);
  }
  borrow(pointer) {
    if (!pointer) return 0;
    if (this.process.allocations.get(pointer) !== 0x1b4)
      throw new Error('Original Plane returned an invalid kcVideo pointer');
    let handle = this.byPointer.get(pointer);
    if (!handle) {
      handle = this.handles.add(HANDLE_TYPE, pointer);
      this.byPointer.set(pointer, handle);
    }
    return handle;
  }
  apply(id, args, machine, task) {
    const spec = PLANE_COMMANDS.get(id);
    if (!spec) throw new Error('Unknown native Plane movie command');
    return this.call(spec, args, machine, task);
  }
  control(id, args, task) {
    if (id === 0x10c) throw new Error('The original Plane owns this movie lifetime');
    if (id === 0x3e4 && args[1]) throw new Error('The renderless Plane movie has no video window');
    const spec = MOVIE_CONTROLS.get(id);
    if (!spec || args.length !== spec.words)
      throw new Error(`Invalid Plane movie control 0x${id.toString(16)}`);
    const pointer = this.handles.get(args[0], HANDLE_TYPE);
    return this.call(spec, [pointer, ...args.slice(1)], null, task);
  }
  async call(spec, args, machine, task) {
    const p = this.process,
      words = Array.from(args);
    // The original load wrapper skips the formatter when target is zero.
    const count = spec.message === 43 && !(words[0] ?? machine.nativeArgument(0)) ? 1 : spec.words;
    while (words.length < count) words.push(machine.nativeArgument(words.length));
    let mapping;
    if (spec.message === 43 && words[0] && this.world.objects.machine(task.id) === machine) {
      const taskMemory = await this.world.getNativeFeature('task-memory');
      taskMemory.vmPointer(task.id);
      mapping = taskMemory.mapMachine(task.id, machine);
    }
    const bridge =
        spec.message === 43 && words[0] ? new NativeKCSMemory(p, machine, mapping) : null,
      argv = p.allocate(words.length * 4),
      out = p.allocate(4, true),
      host = spec.message ? p.allocate(8, true) : 0;
    try {
      words.forEach((word, i) => p.store(argv + i * 4, word));
      if (host) {
        p.store(host, this.vtable);
        p.store(host + 4, this.world.nativeTaskID(task.id));
      }
      const invoke = p.asyncEnabled ? 'callFromHost' : 'call',
        control = await this.engine[invoke](
          spec.addresses[this.sdk],
          [bridge?.pointer ?? 0, host, argv, out],
          undefined,
          { task: task.id },
        );
      if (control !== spec.control)
        throw new Error('Original Plane movie command changed its KCS control');
      if (control === 2) return nativeReply(2);
      const result = p.load(out);
      return nativeReply(1, spec.message === 87 ? this.borrow(result) : result);
    } finally {
      try {
        bridge?.close();
      } finally {
        if (host) p.free(host);
        p.free(out);
        p.free(argv);
      }
    }
  }
  snapshot() {
    return { vtable: this.vtable, borrowed: [...this.byPointer] };
  }
  restore(state) {
    this.vtable = state.vtable;
    this.byPointer = new Map(state.borrowed);
    for (const [pointer, handle] of this.byPointer)
      if (
        this.handles.get(handle, HANDLE_TYPE) !== pointer ||
        this.process.allocations.get(pointer) !== 0x1b4
      )
        throw new Error('Invalid borrowed Plane movie checkpoint');
  }
  close() {
    this.detach();
    this.process.free(this.vtable);
  }
}

export function installNativePlaneMovieCommands(world) {
  world.registerNativeFeature('plane-movie-commands', async (engine) => {
    await world.getNativeFeature('directshow');
    return new NativePlaneMovieCommands(engine, world);
  });
  for (const id of PLANE_COMMANDS.keys())
    world.runtime.register('main', id, async (args, machine, task) =>
      (await world.getNativeFeature('plane-movie-commands')).apply(id, args, machine, task),
    );
}
