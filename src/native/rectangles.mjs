// SPDX-License-Identifier: MPL-2.0
// Execute the original RECT wrappers and VM translator. USER32 rectangle
// semantics and persistent image wrappers are shared with the other tasks.
import { nativeReply } from '../kcs/vm.mjs';
import { NativeKCSMemory } from './kcs-memory.mjs';
import { nativeRectangleDefinitions } from './windows-rectangles.mjs';

export const NATIVE_RECTANGLE_CONTRACTS = Object.freeze(
  [
    [0xd6, 1, 2, 0x644e60, 0x52aa50],
    [0xd7, 2, 2, 0x644d00, 0x52a8f0],
    [0xd8, 4, 2, 0x644da0, 0x52a990],
    [0xd9, 1, 1, 0x644f40, 0x52ab30],
    [0xda, 5, 2, 0x644eb0, 0x52aaa0],
  ].map(([id, words, control, game, sdk]) =>
    Object.freeze({ id, words, control, handlers: [game, sdk] }),
  ),
);
const byID = new Map(NATIVE_RECTANGLE_CONTRACTS.map((spec) => [spec.id, spec]));

export class NativeRectangles {
  constructor(engine, world) {
    Object.assign(this, { engine, world, process: engine.process });
    for (const [name, definition] of nativeRectangleDefinitions(this.process))
      engine.registerWindows('USER32.dll', name, definition);
    engine.registerFeature('rectangles', this);
  }
  async apply(id, args, machine, task) {
    const spec = byID.get(id);
    if (!spec) return undefined;
    const words = Array.from(args);
    while (words.length < spec.words) words.push(machine.nativeArgument(words.length));
    if (id === 0xd8 && words[1])
      words[1] = await (await this.world.getNativeFeature('bitmap-memory')).wrapper(words[1]);
    const memory =
      this.world.objects.machine(task.id) === machine
        ? await this.world.getNativeFeature('task-memory')
        : null;
    if (memory) memory.vmPointer(task.id);
    const p = this.process,
      bridge = new NativeKCSMemory(p, machine, memory?.mapMachine(task.id, machine)),
      argv = p.allocate(words.length * 4),
      out = p.allocate(12);
    try {
      words.forEach((word, i) => p.store(argv + i * 4, word));
      p.write(out, new Uint8Array(12).fill(0xcc));
      const params = [bridge.pointer, 0, argv, out + 4],
        options = { task: task.id },
        handler = spec.handlers[Number(this.engine.profile.startsWith('sdk-'))],
        control = p.asyncEnabled
          ? await this.engine.callFromHost(handler, params, undefined, options)
          : await this.engine.call(handler, params, undefined, options);
      if (
        control !== spec.control ||
        p.load(out) !== 0xcccccccc ||
        p.load(out + 8) !== 0xcccccccc ||
        (control === 2 && p.load(out + 4) !== 0xcccccccc)
      )
        throw new Error('Original rectangle wrapper changed its output contract');
      return nativeReply(control, control === 1 ? p.load(out + 4) : undefined);
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

export function installNativeRectangles(world) {
  world.registerNativeFeature('rectangles', (engine) => new NativeRectangles(engine, world));
  for (const { id } of NATIVE_RECTANGLE_CONTRACTS)
    world.runtime.register('main', id, async (args, machine, task) =>
      (await world.getNativeFeature('rectangles')).apply(id, args, machine, task),
    );
}
