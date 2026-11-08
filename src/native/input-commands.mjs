// SPDX-License-Identifier: MPL-2.0
// Original input-owner query, bitmap mask and wheel-cancel KCS envelopes.
import { nativeReply } from '../kcs/vm.mjs';

export const NATIVE_INPUT_COMMAND_CONTRACTS = Object.freeze(
  [
    [0x6b, 1, 1, 0x649010, 0x5157e0],
    [0x18a, 2, 2, 0x649070, 0x515840],
    [0x3a9, 0, 2, 0x656ab0, 0x521c20],
  ].map(([id, words, control, game, sdk]) =>
    Object.freeze({ id, words, control, handlers: [game, sdk] }),
  ),
);
const byID = new Map(NATIVE_INPUT_COMMAND_CONTRACTS.map((spec) => [spec.id, spec]));

export class NativeInputCommands {
  constructor(engine, world) {
    Object.assign(this, { engine, world, process: engine.process });
    this.sdk = engine.profile.startsWith('sdk-');
    const p = this.process;
    this.memory = {
      load: (at) => p.load(at),
      store: (at, word) => p.store(at, word),
      bytes: (at, size) => p.read(at, size),
      write: (at, bytes) => p.write(at, bytes),
    };
    this.transport = p.trap(
      'KCS input-command task transport',
      7,
      async ([sender, target, raw, w, l, flags, out]) => {
        const message = this.sdk && raw >= 37 ? raw + 2 : raw,
          origin = engine.currentTaskID,
          senderWorldID = world.resolveTaskID(sender, origin);
        if (senderWorldID == null)
          throw new Error('Native input command sender is outside its Top');
        if (![this.sdk ? 32 : 34, 97, 133, 157].includes(message))
          throw new Error('Native input command emitted an unreviewed task message');
        const context = {
            payload: this.memory,
            nativePointer: true,
            nativeResult: out,
            fromHost: true,
            nativeSenderWorldID: senderWorldID,
            flags,
          },
          value = await world.sendNativeEngine(target, senderWorldID, message, w, l, context);
        if (out && Number.isInteger(value)) p.store(out, value);
        if (typeof context.nativeRouted !== 'boolean')
          throw new Error('Native input command transport has no routing result');
        return Number(context.nativeRouted);
      },
    );
    this.vtable = p.allocate(32, true);
    p.store(this.vtable + 16, this.transport);
    engine.registerFeature('input-commands', this);
  }
  async apply(id, args, machine, task) {
    const spec = byID.get(id);
    if (!spec) return undefined;
    const words = Array.from(args);
    while (words.length < spec.words) words.push(machine.nativeArgument(words.length));
    if (id === 0x18a && words[1])
      words[1] = await (await this.world.getNativeFeature('bitmap-memory')).wrapper(words[1]);
    const p = this.process,
      argv = p.allocate(words.length * 4),
      out = p.allocate(12),
      host = p.allocate(120, true);
    try {
      words.forEach((word, i) => p.store(argv + i * 4, word));
      p.write(out, new Uint8Array(12).fill(0xcc));
      p.store(host, this.vtable);
      p.store(host + 4, this.world.nativeTaskID(task.id));
      const parameters = [0, host, argv, out + 4],
        options = { task: task.id },
        control = p.asyncEnabled
          ? await this.engine.callFromHost(
              spec.handlers[Number(this.sdk)],
              parameters,
              undefined,
              options,
            )
          : await this.engine.call(spec.handlers[Number(this.sdk)], parameters, undefined, options);
      if (control !== spec.control || p.load(out) !== 0xcccccccc || p.load(out + 8) !== 0xcccccccc)
        throw new Error('Native input command changed its reviewed output contract');
      return nativeReply(control, control === 1 ? p.load(out + 4) : undefined);
    } finally {
      p.free(host);
      p.free(out);
      p.free(argv);
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
export function installNativeInputCommands(world) {
  world.registerNativeFeature('input-commands', (engine) => new NativeInputCommands(engine, world));
  for (const { id } of NATIVE_INPUT_COMMAND_CONTRACTS)
    world.runtime.register('main', id, async (args, machine, task) =>
      (await world.getNativeFeature('input-commands')).apply(id, args, machine, task),
    );
}
