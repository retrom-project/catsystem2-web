// SPDX-License-Identifier: MPL-2.0
import { nativeReply } from '../kcs/vm.mjs';
import { nativeDataArgument, nativeDataFormat } from './data-text.mjs';
import { NativeGraphicsPacket } from './graphics-task.mjs';
export const NATIVE_DRAW_COMMAND_CONTRACTS = Object.freeze(
  [
    [0x2c3, 13],
    [0x2c4, 13],
    [0x26e, 13],
    [0x26f, 13],
    [0x270, 3],
    [0x271, 3],
    [0x36f, 3],
    [0x370, 4],
    [0x371, 3],
  ].map(([id, words]) => Object.freeze({ id, words, control: 2 })),
);
export class NativeDrawCommands {
  constructor(world) {
    this.world = world;
  }
  async apply(id, args, machine, task) {
    if (!NATIVE_DRAW_COMMAND_CONTRACTS.some((spec) => spec.id === id)) return undefined;
    const a = (i) => nativeDataArgument(args, machine, i),
      send = (message, l = 0, context = {}) =>
        this.world.sendNativeEngine(a(0), task.id, message, a(1), l, context);
    if ([0x2c3, 0x2c4, 0x26e, 0x26f].includes(id)) {
      const fields = new Array(15).fill(0);
      fields[id === 0x26e || id === 0x26f ? 1 : 2] = a(2);
      for (let i = 3; i < 10; i++) fields[i + 1] = a(i);
      fields[11] = Math.min(255, a(10) >>> 0);
      fields[12] = a(11);
      fields[13] = a(12);
      await send(id === 0x2c4 || id === 0x26f ? 282 : 280, 0, {
        payload: new NativeGraphicsPacket(fields),
      });
    } else if (id === 0x270) {
      const bytes = nativeDataFormat(args, machine, this.world.runtime.services, 2),
        name = bytes ? new TextDecoder('shift_jis').decode(bytes) : '',
        path = await this.world.imageFiles.locate(name);
      if (path) await send(293, 0, { payload: { string: () => path } });
    } else if (id === 0x370) {
      await send(312, 0, { payload: new NativeGraphicsPacket([a(2), a(3)]) });
    } else await send(id === 0x271 ? 295 : id === 0x36f ? 311 : 313, a(2));
    return nativeReply(2);
  }
  snapshot() {
    return {};
  }
  restore() {}
}
export function installNativeDrawCommands(world) {
  const drawCommands = new NativeDrawCommands(world);
  world.registerNativeFeature('draw-commands', (engine) => {
    engine.registerFeature('draw-commands', drawCommands);
    return drawCommands;
  });
  for (const { id } of NATIVE_DRAW_COMMAND_CONTRACTS)
    world.runtime.register('main', id, (args, machine, task) =>
      drawCommands.apply(id, args, machine, task),
    );
}
