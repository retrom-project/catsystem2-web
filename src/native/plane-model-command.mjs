// SPDX-License-Identifier: MPL-2.0
// Original file-model commands retain their VM formatter, category path and
// shared filename scratch. The Plane receiver owns the loaded model.
import { nativeReply } from '../kcs/vm.mjs';
import { NativeKCSMemory } from './kcs-memory.mjs';

const commands = new Map([
  [0x51, { words: 2, message: 69, addresses: [0x640ce0, 0x5133c0] }],
  [0x15a, { words: 3, message: 71, addresses: [0x640c40, 0x513320] }],
]);

export class NativePlaneModelCommands {
  constructor(engine, world) {
    Object.assign(this, { engine, world, process: engine.process });
    this.sdk = Number(engine.profile.startsWith('sdk-'));
    const p = this.process,
      transport = p.trap(
        'original plane file-model task transport',
        7,
        async ([sender, target, raw, w, l, flags, out]) => {
          const origin = engine.currentTaskID,
            message = raw + 2 * this.sdk;
          if (
            origin == null ||
            sender !== world.nativeTaskID(origin) ||
            !target ||
            ![69, 71].includes(message) ||
            flags
          )
            throw new Error('Original Plane model command sent an unexpected packet');
          const context = {
              payload: p,
              nativePointer: true,
              nativeResult: out,
              nativeSender: sender,
              fromHost: true,
              flags,
            },
            reply = await world.sendNativeEngine(target, origin, message, w, l, context);
          if (out && Number.isInteger(reply)) p.store(out, reply);
          return Number(context.nativeRouted);
        },
      );
    this.vtable = p.allocate(20, true);
    p.store(this.vtable + 16, transport);
    engine.registerFeature('plane-model-commands', this);
  }
  async apply(id, args, machine, task) {
    const spec = commands.get(id),
      target = args[0] ?? machine.nativeArgument(0),
      p = this.process,
      argv = p.allocate(target ? spec.words * 4 : 4);
    let bridge, host;
    try {
      p.store(argv, target);
      if (target) {
        const memory =
          this.world.objects.machine(task.id) === machine
            ? await this.world.getNativeFeature('task-memory')
            : null;
        memory?.vmPointer(task.id);
        bridge = new NativeKCSMemory(p, machine, memory?.mapMachine(task.id, machine));
        host = p.allocate(8);
        p.store(host, this.vtable);
        p.store(host + 4, this.world.nativeTaskID(task.id));
        for (let i = 1; i < spec.words; i++)
          p.store(argv + 4 * i, args[i] ?? machine.nativeArgument(i));
      }
      const options = { task: task.id },
        parameters = [bridge?.pointer ?? 0, host ?? 0, argv, 0],
        control = await this.engine[p.asyncEnabled ? 'callFromHost' : 'call'](
          spec.addresses[this.sdk],
          parameters,
          undefined,
          options,
        );
      if (control !== 2) throw new Error('Original Plane model command changed its control');
      return nativeReply(control);
    } finally {
      try {
        bridge?.close();
      } finally {
        if (host) p.free(host);
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

export function installNativePlaneModelCommands(world) {
  world.registerNativeFeature('plane-model-commands', async (engine) => {
    await world.getNativeFeature('engine-files');
    return new NativePlaneModelCommands(engine, world);
  });
  for (const id of commands.keys())
    world.runtime.register('main', id, async (args, machine, task) =>
      (await world.getNativeFeature('plane-model-commands')).apply(id, args, machine, task),
    );
}
