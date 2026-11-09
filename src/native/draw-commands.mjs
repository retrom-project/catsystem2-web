// SPDX-License-Identifier: MPL-2.0
// Original retained-source draw packets and animation file/enable commands.
import { mapABIMessage } from './abi/messages.mjs';
import { nativeReply } from '../kcs/vm.mjs';
import { NativeKCSMemory } from './kcs-memory.mjs';
import { installNativeEngineFiles } from './engine-files.mjs';

export const NATIVE_DRAW_COMMAND_CONTRACTS = Object.freeze(
  [
    [0x2c3, 13, 0x644090, 0x51c740],
    [0x2c4, 13, 0x644b60, 0x51d1a0],
    [0x26e, 13, 0x644160, 0x51c810],
    [0x26f, 13, 0x644c30, 0x51d270],
    [0x270, 3, 0x644710, 0x51cda0],
    [0x271, 3, 0x644620, 0x51ccb0],
    [0x36f, 3, 0x644260, 0x51c910],
    [0x370, 4, 0x644800, 0x51ce40],
    [0x371, 3, 0x644230, 0x51c8e0],
  ].map(([id, words, game, sdk]) => Object.freeze({ id, words, handlers: [game, sdk] })),
);
const byID = new Map(NATIVE_DRAW_COMMAND_CONTRACTS.map((spec) => [spec.id, spec]));

export class NativeDrawCommands {
  constructor(engine, world) {
    Object.assign(this, { engine, world, process: engine.process });
    this.sdk = engine.profile.startsWith('sdk-');
    const p = this.process;
    this.memory = {
      load: (address) => p.load(address),
      store: (address, value) => p.store(address, value),
      bytes: (address, size) => p.read(address, size),
      string: (address, wide = false) => p.string(address, wide),
    };
    this.send = p.trap(
      'retained draw wrapper task transport',
      7,
      async ([sender, target, rawMessage, w, l, flags, out]) => {
        const origin = engine.currentTaskID,
          senderWorldID = world.resolveTaskID ? world.resolveTaskID(sender, origin) : sender,
          message = mapABIMessage(this.engine.profile, 'drawCommand', 'canonical', rawMessage);
        if (origin == null || senderWorldID == null)
          throw new Error('Native retained draw command has no calling task namespace');
        if (![280, 282, 293, 295, 311, 312, 313].includes(message))
          throw new Error('Native retained draw command sent an unreviewed message');
        const context = {
          payload: this.memory,
          nativePointer: true,
          nativeResult: out,
          fromHost: true,
          flags,
        };
        const value = await world.sendNativeEngine(target, senderWorldID, message, w, l, context);
        if (out && Number.isInteger(value)) p.store(out, value);
        if (typeof context.nativeRouted !== 'boolean')
          throw new Error('Native retained draw transport did not report its routing result');
        return Number(context.nativeRouted);
      },
    );
    this.vtable = p.allocate(32, true);
    p.store(this.vtable + 16, this.send);
    engine.registerFeature('draw-commands', this);
  }
  async apply(id, args, machine, task) {
    const spec = byID.get(id);
    if (!spec) return undefined;
    const words = Array.from(args);
    while (words.length < spec.words) words.push(machine.nativeArgument(words.length));
    if ((id === 0x26e || id === 0x26f) && words[2])
      words[2] = (await this.world.getNativeFeature('data-buffers')).pointer(words[2]);
    const platform = await this.world.getNativeFeature('graphics-platform');
    if (id === 0x270) await platform.ensureRenderer();
    const memory =
      this.world.objects.machine(task.id) === machine
        ? await this.world.getNativeFeature('task-memory')
        : null;
    if (memory) memory.vmPointer(task.id);
    const p = this.process,
      bridge = new NativeKCSMemory(p, machine, memory?.mapMachine(task.id, machine)),
      argv = p.allocate(words.length * 4),
      out = p.allocate(4),
      host = p.allocate(160, true);
    try {
      words.forEach((word, i) => p.store(argv + i * 4, word));
      p.store(out, 0xcccccccc);
      p.store(host, this.vtable);
      p.store(host + 4, this.world.nativeTaskID?.(task.id) ?? task.id);
      p.store(host + 116, platform.refs.view);
      const address = spec.handlers[Number(this.sdk)],
        parameters = [bridge.pointer, host, argv, out],
        options = { task: task.id },
        control = p.asyncEnabled
          ? await this.engine.callFromHost(address, parameters, undefined, options)
          : await this.engine.call(address, parameters, undefined, options);
      if (control !== 2) throw new Error('Native retained draw wrapper changed its control');
      return nativeReply(control);
    } finally {
      try {
        bridge.close();
      } finally {
        p.free(host);
        p.free(out);
        p.free(argv);
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

export function installNativeDrawCommands(world) {
  installNativeEngineFiles(world);
  world.registerNativeFeature('draw-commands', async (engine) => {
    await world.getNativeFeature('engine-files');
    await world.getNativeFeature('data-buffers');
    await world.getNativeFeature('retained-draw');
    await world.getNativeFeature('graphics-platform');
    return new NativeDrawCommands(engine, world);
  });
  for (const { id } of NATIVE_DRAW_COMMAND_CONTRACTS)
    world.runtime.register('main', id, async (args, machine, task) =>
      (await world.getNativeFeature('draw-commands')).apply(id, args, machine, task),
    );
}
