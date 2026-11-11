// SPDX-License-Identifier: MPL-2.0
import { nativeReply } from '../kcs/vm.mjs';
import { bitsFloat } from '../kcs.mjs';
import { nativeDataArgument } from './data-text.mjs';
import { NativeGraphicsPacket } from './graphics-task.mjs';

export const NATIVE_EFFECT_COMMAND_CONTRACTS = Object.freeze(
  [
    [0x208, 1, 1],
    [0x209, 8, 2],
    [0x20a, 2, 2],
    [0x20b, 10, 2],
    [0x20c, 2, 2],
    [0x20d, 4, 2],
    [0x20e, 2, 2],
    [0x20f, 4, 2],
    [0x210, 2, 2],
    [0x211, 1, 2],
    [0x212, 5, 2],
    [0x213, 2, 2],
    [0x214, 1, 2],
    [0x238, 2, 2],
    [0x355, 6, 2],
    [0x356, 1, 2],
    [0x357, 2, 2],
    [0x358, 7, 2],
    [0x359, 2, 2],
    [0x35a, 1, 2],
    [0x35b, 3, 2],
    [0x35c, 8, 2],
    [0x35d, 2, 2],
    [0x389, 5, 2],
    [0x3c7, 7, 2],
    [0x3c8, 2, 2],
    [0x3c9, 1, 2],
    [0x3ca, 1, 2],
    [0x3cb, 10, 2],
    [0x3cc, 2, 2],
  ].map(([id, words, control]) => Object.freeze({ id, words, control })),
);
const byID = new Map(NATIVE_EFFECT_COMMAND_CONTRACTS.map((spec) => [spec.id, spec])),
  starts = new Map([
    [0x20a, 379],
    [0x20c, 381],
    [0x20e, 383],
    [0x210, 385],
    [0x213, 388],
    [0x357, 518],
    [0x359, 520],
    [0x35d, 522],
    [0x3c8, 391],
    [0x3cc, 395],
  ]),
  actions = new Map([
    [0x211, 386],
    [0x214, 389],
    [0x356, 517],
    [0x3c9, 392],
    [0x3ca, 393],
  ]),
  initializers = new Map([
    [0x20b, [380, [1, 2, 3, 4, 5, 6, 7, 8, 9]]],
    [0x20d, [382, [1, 2, 3]]],
    [0x20f, [384, [2, 3, 1]]],
    [0x355, [516, [2, 3, 1, 4, 5]]],
    [0x358, [519, [2, 3, 1, 4, 5, 6]]],
    [0x35c, [521, [2, 3, 1, 4, 5, 6, 7]]],
    [0x3c7, [390, [5, 6, 1, 2, 3, 4]]],
    [0x3cb, [394, [8, 9, 1, 2, 3, 4, 5, 6, 7]]],
  ]);
export class NativeEffectCommands {
  constructor(world) {
    this.world = world;
  }
  async apply(id, args, machine, task) {
    const spec = byID.get(id);
    if (!spec) return undefined;
    const a = Array.from({ length: spec.words }, (_, i) => nativeDataArgument(args, machine, i)),
      world = this.world,
      rendering = world.screenEffects.rendering,
      send = (message, l = 0, payload) =>
        world.sendNativeEngine(a[0], task.id, message, 0, l, payload ? { payload } : {});
    if (id === 0x35a) await rendering.prepare(a[0]);
    else if (id === 0x35b) await rendering.capture(a[0], bitsFloat(a[1]), bitsFloat(a[2]));
    else if (id === 0x238) {
      await rendering.prepare(1);
      await rendering.capture(0, bitsFloat(a[0]), bitsFloat(a[1]));
    } else if (id === 0x208) {
      if (!a[0]) return nativeReply(1, 0);
      // An untouched result is the address of the wrapper's own result word.
      // Preserve that relation in the existing JS raw-buffer address space.
      const memory = world.runtime.imageDataBuffers.process,
        out = memory.allocate(4);
      memory.store(out, out);
      try {
        const value = await world.sendNativeEngine(a[0], task.id, 377, 0, 0, {
          nativeResult: out,
          resultMemory: memory,
        });
        return nativeReply(1, Number.isInteger(value) ? value : memory.load(out));
      } finally {
        memory.free(out);
      }
    } else if (a[0]) {
      if (starts.has(id)) await send(starts.get(id), a[1]);
      else if (actions.has(id)) await send(actions.get(id));
      else if (id === 0x209) {
        const packet = new NativeGraphicsPacket(new Array(22).fill(0));
        packet.bytes(0, 64).set(machine.bytes(a[1], 64));
        a.slice(2).forEach((word, i) => packet.store(64 + i * 4, word));
        await send(378, 0, packet);
      } else if (id === 0x212 || id === 0x389) {
        if (a[4])
          await send(
            387,
            0,
            new NativeGraphicsPacket([a[2], a[3], a[1], a[4], Number(id === 0x389)]),
          );
      } else {
        const [message, fields] = initializers.get(id);
        await send(message, 0, new NativeGraphicsPacket(fields.map((i) => a[i])));
      }
    }
    return nativeReply(2);
  }
}
export function installNativeEffectCommands(world) {
  const effectCommands = new NativeEffectCommands(world);
  for (const { id } of NATIVE_EFFECT_COMMAND_CONTRACTS)
    world.runtime.register('main', id, (args, machine, task) =>
      effectCommands.apply(id, args, machine, task),
    );
}
