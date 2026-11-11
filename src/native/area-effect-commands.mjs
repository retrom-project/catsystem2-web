// SPDX-License-Identifier: MPL-2.0
// Area packets retain VM bit patterns and resolve tasks in their caller's Top.
import { mapABIMessage } from './abi/messages.mjs';
import { nativeReply } from '../kcs/vm.mjs';
import { NativeGraphicsPacket } from './graphics-task.mjs';
import { nativeDataArgument } from './data-text.mjs';
export const NATIVE_AREA_EFFECT_COMMANDS = Object.freeze(
  [
    [0xc4, 2, 2],
    [0xc5, 1, 2],
    [0xc6, 1, 2],
    [0xc7, 2, 2],
    [0xc8, 1, 1],
    [0xc9, 3, 2],
    [0xca, 2, 2],
    [0xcb, 1, 2],
  ].map(([id, words, control]) => Object.freeze({ id, words, control })),
);
const byID = new Map(NATIVE_AREA_EFFECT_COMMANDS.map((spec) => [spec.id, spec])),
  initializerMessages = [265, 263, 266, 267, 268, 269, 270, 271, 272, 274, 275, 276, 274, 277, 278],
  initializers = new Map(initializerMessages.map((message, i) => [17 + i, message])),
  liveUpdates = new Map([
    [18, 264],
    [25, 273],
  ]);
export class NativeAreaEffectCommands {
  constructor(world) {
    this.world = world;
  }
  async apply(id, args, machine, task) {
    const spec = byID.get(id);
    if (!spec) return undefined;
    const a = Array.from({ length: spec.words }, (_, i) => nativeDataArgument(args, machine, i)),
      world = this.world,
      send = (message, l = 0, payload, context = {}) =>
        world.sendNativeEngine(a[0], task.id, message, 0, l, {
          flags: 0,
          ...(payload ? { payload } : {}),
          ...context,
        });
    if (id === 0xc7) {
      const packet = new NativeGraphicsPacket();
      packet.bytes(0, 64).set(machine.bytes(a[1], 64));
      const record = world.objects.objects.get(world.resolveTaskID(a[0], task.id)),
        raw = mapABIMessage(world.profile, 'area', 'raw', 262),
        message =
          record && !world.areaEffects?.tasks.has(record.id)
            ? mapABIMessage(world.profile, 'base', 'canonical', raw)
            : 262;
      // SDK raw257 reaches Base as259 on a foreign receiver. Area receivers
      // retain their canonical matrix operation262.
      await send(message, 0, packet);
      return nativeReply(2);
    }
    if (id === 0xc5 || id === 0xc6 || id === 0xcb) {
      await send(id === 0xc5 ? 257 : id === 0xc6 ? 258 : 261);
      return nativeReply(2);
    }
    const memory = world.runtime.imageDataBuffers.process,
      out = memory.allocate(4),
      caller = id === 0xc4 ? out : world.engineMessages.callerAddress(task.id);
    memory.store(out, caller);
    try {
      const value = await send(id === 0xc8 ? 259 : 13, 0, undefined, {
          nativeResult: out,
          resultMemory: memory,
        }),
        kind = Number.isInteger(value) ? value : memory.load(out);
      if (id === 0xc8) return nativeReply(1, kind);
      if (id === 0xc9 && a[1]) return nativeReply(2);
      const message =
        id === 0xc4
          ? initializers.get(kind)
          : id === 0xc9
            ? liveUpdates.get(kind)
            : [26, 27].includes(kind)
              ? 260
              : undefined;
      if (message === undefined) return nativeReply(2);
      const address = id === 0xc9 ? a[2] : a[1];
      // Initializers borrow translated VM storage. Unlike C7, they do not
      // make a private matrix copy, including receivers with empty branches.
      if (address === 0xffffffff) await send(message, 0, undefined, { nativeNullPayload: true });
      else {
        machine.bytes(address, 1);
        await send(message, address, machine);
      }
      return nativeReply(2);
    } finally {
      memory.free(out);
    }
  }
}
export function installNativeAreaEffectCommands(world) {
  const areaCommands = new NativeAreaEffectCommands(world);
  for (const { id } of NATIVE_AREA_EFFECT_COMMANDS)
    world.runtime.register('main', id, (args, machine, task) =>
      areaCommands.apply(id, args, machine, task),
    );
}
