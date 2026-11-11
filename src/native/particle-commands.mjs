// SPDX-License-Identifier: MPL-2.0
import { nativeReply, NATIVE_RESULT_SENTINEL } from '../kcs/vm.mjs';
import { encodeCP932 } from '../kcs/strings.mjs';
import { NativeGraphicsPacket } from './graphics-task.mjs';
import { nativeDataArgument, nativeDataFormat } from './data-text.mjs';
import { nativeCategoryFilename } from './resource-file.mjs';
export const NATIVE_PARTICLE_COMMANDS = Object.freeze(
  [
    [0x10f, 6, 314],
    [0x110, 1, 315],
    [0x111, 1, 316],
    [0x112, 1, 318],
    [0x113, 2, 319],
    [0x1aa, 2, 320],
    [0x1ab, 2, 321],
    [0x2b5, 6, 314],
  ].map(([id, words, message]) => Object.freeze({ id, words, message })),
);
const commands = new Map(NATIVE_PARTICLE_COMMANDS.map((entry) => [entry.id, entry]));
export class NativeParticleCommands {
  constructor(world) {
    this.world = world;
  }
  async apply(id, args, machine, task) {
    const spec = commands.get(id);
    if (!spec) return undefined;
    const a = Array.from({ length: spec.words }, (_, i) => nativeDataArgument(args, machine, i)),
      world = this.world,
      context = { flags: 0 },
      memory = world.runtime.imageDataBuffers.process;
    let l = 0;
    if (spec.message === 314) {
      // Loaders translate both names and all registers before routing, including
      // a missing target. The names occupy independent 128-byte packet fields.
      for (const index of [1, 2, 5]) machine.bytes(a[index], index === 5 ? 128 : 1);
      const packet = new NativeGraphicsPacket(new Array(0x290 / 4).fill(0));
      packet.store(0, Number(id === 0x2b5));
      for (const [index, at, category] of [
        [1, 4, id === 0x2b5 ? 'ptclpi' : 'ptcl'],
        [2, 132, 'image'],
      ]) {
        const bytes = nativeDataFormat(args, machine, world.runtime.services, index),
          name = new TextDecoder('shift_jis').decode(bytes),
          file = encodeCP932(
            (id === 0x2b5 && index === 1
              ? name
              : nativeCategoryFilename(world.game, name, category)) + '\0',
          );
        if (file.length > 128) throw new RangeError('Particle category filename exceeds 128 bytes');
        packet.bytes(at, file.length).set(file);
      }
      packet.store(260, a[3]);
      packet.store(264, a[4]);
      packet.bytes(268, 128).set(machine.bytes(a[5], 128));
      context.payload = packet;
    } else if (id === 0x113) {
      // The register control borrows the live translation only after a target
      // route is found. Unmapped payloads to missing targets remain untouched.
      l = a[1];
      context.payload = machine;
    } else if (id === 0x1aa || id === 0x1ab) l = a[1];
    const out = memory.allocate(4);
    memory.store(out, id === 0x112 ? 0 : NATIVE_RESULT_SENTINEL);
    context.nativeResult = out;
    context.resultMemory = memory;
    try {
      const value = await world.sendNativeEngine(a[0], task.id, spec.message, 0, l, context);
      if (id === 0x112) return nativeReply(1, Number.isInteger(value) ? value : memory.load(out));
      if (spec.message === 314) return nativeReply(1, 1);
      return nativeReply(2);
    } finally {
      memory.free(out);
    }
  }
}

export function installNativeParticleCommands(world) {
  const particleCommands = (world.particleCommands = new NativeParticleCommands(world));
  for (const { id } of NATIVE_PARTICLE_COMMANDS)
    world.runtime.register('main', id, (args, machine, task) =>
      particleCommands.apply(id, args, machine, task),
    );
}
