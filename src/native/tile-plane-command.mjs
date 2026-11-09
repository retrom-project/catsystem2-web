// SPDX-License-Identifier: MPL-2.0
// Execute the original tiled SimplePlane KCS packet producer.
import { nativeReply } from '../kcs/vm.mjs';

export const NATIVE_TILE_PLANE_COMMAND = Object.freeze({
  id: 0x1b1,
  words: 5,
  control: 2,
  message: 46,
  game: Object.freeze({ address: 0x6405e0, rawMessage: 46 }),
  sdk: Object.freeze({ address: 0x512cc0, rawMessage: 44 }),
});

export class NativeTilePlaneCommand {
  constructor(engine, world) {
    Object.assign(this, { engine, world, process: engine.process });
    const spec = NATIVE_TILE_PLANE_COMMAND,
      layout = engine.profile.startsWith('sdk-') ? spec.sdk : spec.game,
      p = this.process,
      transport = p.trap(
        'KCS tiled plane task transport',
        7,
        async ([sender, target, raw, w, l, flags, out]) => {
          const origin = engine.currentTaskID;
          if (origin == null || !target || raw !== layout.rawMessage || w || flags)
            throw new Error('Native tiled plane command sent an unexpected task envelope');
          const context = {
              payload: p,
              nativePointer: true,
              nativeResult: out,
              nativeSender: sender,
              fromHost: true,
              flags,
            },
            value = await world.sendNativeEngine(target, origin, spec.message, w, l, context);
          if (out && Number.isInteger(value)) p.store(out, value);
          if (typeof context.nativeRouted !== 'boolean')
            throw new Error('Native tiled plane transport did not report its routing result');
          return Number(context.nativeRouted);
        },
      );
    this.address = layout.address;
    this.vtable = p.allocate(20, true);
    p.store(this.vtable + 16, transport);
    engine.registerFeature('tile-plane-command', this);
  }
  async apply(args, machine, task) {
    const spec = NATIVE_TILE_PLANE_COMMAND,
      target = args[0] ?? machine.nativeArgument(0),
      words = [target],
      p = this.process;
    // The zero-target branch never reads the remaining arguments or the host.
    if (target) {
      for (let i = 1; i < spec.words; i++) words.push(args[i] ?? machine.nativeArgument(i));
    }
    const argv = p.allocate(words.length * 4);
    let host = 0;
    try {
      words.forEach((word, i) => p.store(argv + i * 4, word));
      if (target) {
        host = p.allocate(8);
        p.store(host, this.vtable);
        p.store(host + 4, this.world.nativeTaskID(task.id));
      }
      // The original wrapper leaves three words of the stack packet untouched.
      // The receiver sees that same guest address for the duration of the call.
      const parameters = [0, host, argv, 0],
        options = { task: task.id },
        control = p.asyncEnabled
          ? await this.engine.callFromHost(this.address, parameters, undefined, options)
          : await this.engine.call(this.address, parameters, undefined, options);
      if (control !== spec.control)
        throw new Error('Native tiled plane command changed its reviewed control');
      return nativeReply(control);
    } finally {
      if (host) p.free(host);
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

export function installNativeTilePlaneCommand(world) {
  world.registerNativeFeature(
    'tile-plane-command',
    (engine) => new NativeTilePlaneCommand(engine, world),
  );
  world.runtime.register('main', NATIVE_TILE_PLANE_COMMAND.id, async (args, machine, task) =>
    (await world.getNativeFeature('tile-plane-command')).apply(args, machine, task),
  );
}
