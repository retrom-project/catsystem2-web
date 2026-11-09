// SPDX-License-Identifier: MPL-2.0
// Original matrix inversion/copy and in-place four-component vector wrappers.
import { nativeReply } from '../src/kcs/vm.mjs';
import { NativeKCSMemory } from '../src/native/kcs-memory.mjs';

export const NATIVE_GEOMETRY_CONTRACTS = Object.freeze(
  [
    [0x15e, 1, 2, 0x643630, 0x529e90],
    [0x15f, 2, 2, 0x6435c0, 0x529e20],
    [0x160, 1, 2, 0x647310, 0x52abf0],
    [0x161, 2, 2, 0x6472a0, 0x52ab80],
    [0x162, 2, 2, 0x6473a0, 0x52ac80],
    [0x163, 1, 1, 0x6472e0, 0x52abc0],
    [0x164, 1, 1, 0x647330, 0x52ac10],
    [0x165, 2, 2, 0x647360, 0x52ac40],
    [0x166, 2, 2, 0x6473e0, 0x52acc0],
  ].map(([id, words, control, game, sdk]) =>
    Object.freeze({ id, words, control, handlers: [game, sdk] }),
  ),
);
export const NATIVE_GEOMETRY_IDS = Object.freeze(NATIVE_GEOMETRY_CONTRACTS.map(({ id }) => id));
const byID = new Map(NATIVE_GEOMETRY_CONTRACTS.map((spec) => [spec.id, spec]));

export class NativeGeometry {
  constructor(engine, world) {
    Object.assign(this, { engine, world, process: engine.process });
    this.profileIndex =
      engine.profile === 'nekopara-vol3-engine-2.6.1.76'
        ? 0
        : engine.profile === 'sdk-4.01-engine-2.6.1.74'
          ? 1
          : -1;
    if (this.profileIndex < 0) throw new Error('Native geometry requires a reviewed engine');
    engine.registerFeature('geometry', this);
  }
  async apply(id, args, machine, task) {
    const spec = byID.get(id);
    if (!spec) return undefined;
    const words = Array.from(args);
    while (words.length < spec.words) words.push(machine.nativeArgument(words.length));
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
      const address = spec.handlers[this.profileIndex],
        parameters = [bridge.pointer, 0, argv, out],
        options = { task: task.id },
        control = p.asyncEnabled
          ? await this.engine.callFromHost(address, parameters, undefined, options)
          : await this.engine.call(address, parameters, undefined, options);
      if (control !== spec.control)
        throw new Error('Native geometry control disagrees with its reviewed wrapper');
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
  restore() {}
}
