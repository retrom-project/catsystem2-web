// SPDX-License-Identifier: MPL-2.0
// Client dimensions, perspective distance and the original drawing rectangle.
import { nativeReply } from '../kcs/vm.mjs';
import { NativeKCSMemory } from './kcs-memory.mjs';

export const NATIVE_VIEW_GEOMETRY_CONTRACTS = Object.freeze([
  Object.freeze({ id: 8, words: 2, handlers: [0x650260, 0x51b8b0] }),
  Object.freeze({ id: 12, words: 1, handlers: [0x650860, 0x51be80] }),
  Object.freeze({ id: 0x313, words: 4, handlers: [0x64ff60, 0x51b5d0] }),
]);
const byID = new Map(NATIVE_VIEW_GEOMETRY_CONTRACTS.map((spec) => [spec.id, spec]));
export class NativeViewGeometry {
  constructor(engine, world) {
    Object.assign(this, { engine, world, process: engine.process });
    this.sdk = engine.profile.startsWith('sdk-');
    engine.registerFeature('view-geometry', this);
  }
  async apply(id, args, machine, task) {
    const spec = byID.get(id);
    if (!spec) return undefined;
    const words = Array.from(args);
    while (words.length < spec.words) words.push(machine.nativeArgument(words.length));
    const platform = await this.world.getNativeFeature('graphics-platform');
    await platform.ensureRenderer();
    const memory =
      this.world.objects.machine(task.id) === machine
        ? await this.world.getNativeFeature('task-memory')
        : null;
    if (memory) memory.vmPointer(task.id);
    const p = this.process,
      bridge = new NativeKCSMemory(p, machine, memory?.mapMachine(task.id, machine)),
      host = p.allocate(120, true),
      argv = p.allocate(words.length * 4),
      out = p.allocate(4);
    try {
      words.forEach((word, i) => p.store(argv + i * 4, word));
      p.store(host + 116, platform.refs.view);
      p.store(out, 0xcccccccc);
      const address = spec.handlers[Number(this.sdk)],
        parameters = [bridge.pointer, host, argv, out],
        options = { task: task.id },
        control = p.asyncEnabled
          ? await this.engine.callFromHost(address, parameters, undefined, options)
          : await this.engine.call(address, parameters, undefined, options);
      if (control !== 2) throw new Error('Native view geometry wrapper changed its control');
      return nativeReply(control);
    } finally {
      try {
        bridge.close();
      } finally {
        p.free(out);
        p.free(argv);
        p.free(host);
      }
    }
  }
  snapshot() {
    return {};
  }
  restore() {}
}
export function installNativeViewGeometry(world) {
  world.registerNativeFeature('view-geometry', (engine) => new NativeViewGeometry(engine, world));
  for (const { id } of NATIVE_VIEW_GEOMETRY_CONTRACTS)
    world.runtime.register('main', id, async (args, machine, task) =>
      (await world.getNativeFeature('view-geometry')).apply(id, args, machine, task),
    );
}
