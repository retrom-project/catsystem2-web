// SPDX-License-Identifier: MPL-2.0
// Complete KCS screen-effect wrappers use the original packet layouts and view.
import { mapABIMessage } from './abi/messages.mjs';
import { nativeReply } from '../kcs/vm.mjs';
import { NativeKCSMemory } from './kcs-memory.mjs';

export const NATIVE_EFFECT_COMMAND_CONTRACTS = Object.freeze(
  [
    [0x208, 1, 1, 0x642fc0, 0x527a50],
    [0x209, 8, 2, 0x642af0, 0x527580],
    [0x20a, 2, 2, 0x642bc0, 0x527650],
    [0x20b, 10, 2, 0x643010, 0x527aa0],
    [0x20c, 2, 2, 0x643080, 0x527b10],
    [0x20d, 4, 2, 0x6431d0, 0x527c60],
    [0x20e, 2, 2, 0x643240, 0x527cd0],
    [0x20f, 4, 2, 0x642e40, 0x5278d0],
    [0x210, 2, 2, 0x642eb0, 0x527940],
    [0x211, 1, 2, 0x642e00, 0x527890],
    [0x212, 5, 2, 0x643510, 0x527fa0],
    [0x213, 2, 2, 0x643580, 0x528010],
    [0x214, 1, 2, 0x6434d0, 0x527f60],
    [0x238, 2, 2, 0x642dd0, 0x527860],
    [0x355, 6, 2, 0x6433a0, 0x527e30],
    [0x356, 1, 2, 0x643360, 0x527df0],
    [0x357, 2, 2, 0x643420, 0x527eb0],
    [0x358, 7, 2, 0x642ef0, 0x527980],
    [0x359, 2, 2, 0x642f80, 0x527a10],
    [0x35a, 1, 2, 0x642db0, 0x527840],
    [0x35b, 3, 2, 0x642d70, 0x527800],
    [0x35c, 8, 2, 0x643280, 0x527d10],
    [0x35d, 2, 2, 0x643320, 0x527db0],
    [0x389, 5, 2, 0x643460, 0x527ef0],
    [0x3c7, 7, 2, 0x643100, 0x527b90],
    [0x3c8, 2, 2, 0x643190, 0x527c20],
    [0x3c9, 1, 2, 0x6430c0, 0x527b50],
    [0x3ca, 1, 2, 0x642c40, 0x5276d0],
    [0x3cb, 10, 2, 0x642c80, 0x527710],
    [0x3cc, 2, 2, 0x642d30, 0x5277c0],
  ].map(([id, words, control, game, sdk]) =>
    Object.freeze({ id, words, control, handlers: [game, sdk] }),
  ),
);
const byID = new Map(NATIVE_EFFECT_COMMAND_CONTRACTS.map((spec) => [spec.id, spec]));
export class NativeEffectCommands {
  constructor(engine, world) {
    Object.assign(this, { engine, world, process: engine.process });
    this.sdk = engine.profile.startsWith('sdk-');
    const p = this.process;
    this.memory = {
      load: (at) => p.load(at),
      store: (at, word) => p.store(at, word),
      bytes: (at, size) => p.read(at, size),
      string: (at, wide = false) => p.string(at, wide),
    };
    this.send = p.trap(
      'screen-effect wrapper task transport',
      7,
      async ([sender, target, raw, w, l, flags, out]) => {
        const origin = engine.currentTaskID,
          senderWorldID = world.resolveTaskID ? world.resolveTaskID(sender, origin) : sender,
          message = mapABIMessage(this.engine.profile, 'effectCommand', 'canonical', raw);
        if (origin == null || senderWorldID == null)
          throw new Error('Native effect command has no calling task namespace');
        if (!((message >= 377 && message <= 395) || (message >= 516 && message <= 523)))
          throw new Error('Native effect command sent an unreviewed task message');
        const context = {
            payload: this.memory,
            nativePointer: true,
            nativeResult: out,
            fromHost: true,
            flags,
          },
          value = await world.sendNativeEngine(target, senderWorldID, message, w, l, context);
        if (out && Number.isInteger(value)) p.store(out, value);
        if (typeof context.nativeRouted !== 'boolean')
          throw new Error('Native effect transport did not report its routing result');
        return Number(context.nativeRouted);
      },
    );
    this.vtable = p.allocate(32, true);
    p.store(this.vtable + 16, this.send);
    engine.registerFeature('effect-commands', this);
  }
  async apply(id, args, machine, task) {
    const spec = byID.get(id);
    if (!spec) return undefined;
    const words = Array.from(args);
    while (words.length < spec.words) words.push(machine.nativeArgument(words.length));
    const platform = await this.world.getNativeFeature('graphics-platform');
    if (id === 0x238 || id === 0x35a || id === 0x35b) await platform.ensureRenderer();
    if ((id === 0x212 || id === 0x389) && words[0] && words[4])
      words[4] = await (await this.world.getNativeFeature('bitmap-memory')).wrapper(words[4]);
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
      words.forEach((word, i) => p.store(argv + 4 * i, word));
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
      if (control !== spec.control)
        throw new Error('Native effect wrapper changed its reviewed control');
      return nativeReply(control, control === 1 ? p.load(out) : undefined);
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
export function installNativeEffectCommands(world) {
  world.registerNativeFeature('effect-commands', async (engine) => {
    await world.getNativeFeature('screen-effects');
    return new NativeEffectCommands(engine, world);
  });
  for (const { id } of NATIVE_EFFECT_COMMAND_CONTRACTS)
    world.runtime.register('main', id, async (args, machine, task) =>
      (await world.getNativeFeature('effect-commands')).apply(id, args, machine, task),
    );
}
