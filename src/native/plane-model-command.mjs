// SPDX-License-Identifier: MPL-2.0
// JS wrappers publish canonical Plane packets, preserving scalar bit patterns.
import { nativeReply } from '../kcs/vm.mjs';
import { encodeCP932 } from '../kcs/strings.mjs';
import { NativeGraphicsPacket } from './graphics-task.mjs';
import { nativeDataArgument, nativeDataFormat } from './data-text.mjs';
import { nativeCategoryFilename } from './resource-file.mjs';
const modelCommands = new Map([
  [0x51, 2],
  [0x15a, 3],
  [0x18e, 12],
  [0x18f, 7],
]);
export class NativePlaneModelCommands {
  constructor(world) {
    this.world = world;
    this.filename = '';
  }
  async apply(id, args, machine, task) {
    const world = this.world,
      target = nativeDataArgument(args, machine, 0);
    if (!target && id !== 0x18f) return nativeReply(2);
    const a = Array.from({ length: modelCommands.get(id) }, (_, i) =>
      nativeDataArgument(args, machine, i),
    );
    let message,
      w = 0,
      packet;
    if (id === 0x51 || id === 0x15a) {
      const name = nativeDataFormat(args, machine, world.runtime.services, 1);
      if (name)
        this.filename = nativeCategoryFilename(
          world.game,
          new TextDecoder('shift_jis').decode(name),
          id === 0x51 ? 'kx2' : 'kx3',
        );
      const bytes = encodeCP932(this.filename + '\0');
      packet = new NativeGraphicsPacket(new Array(Math.ceil(bytes.length / 4)).fill(0));
      packet.bytes(0, bytes.length).set(bytes);
      message = id === 0x51 ? 69 : 71;
      w = id === 0x15a ? a[2] : 0;
    } else if (id === 0x18e) {
      message = 79;
      w = Number(Boolean(a[1]));
      if (w)
        packet = new NativeGraphicsPacket([
          a[1],
          a[2],
          a[6],
          a[7],
          a[8],
          a[9],
          0,
          a[3],
          a[4],
          a[5],
          0,
          a[10],
          a[11],
        ]);
    } else {
      message = 80;
      packet = new NativeGraphicsPacket(new Array(32).fill(0));
      for (const [index, at, size] of [
        [1, 12, 12],
        [2, 28, 12],
        [3, 44, 12],
        [4, 60, 64],
      ])
        packet.bytes(at, size).set(machine.bytes(a[index], size));
      packet.store(124, a[5]);
      packet.store(8, a[6]);
    }
    await world.sendNativeEngine(target, task.id, message, w, 0, {
      flags: 0,
      ...(packet ? { payload: packet } : {}),
    });
    return nativeReply(2);
  }
  snapshot() {
    return { filename: this.filename };
  }
  restore(state) {
    this.filename = state.filename;
  }
}
export function installNativePlaneModelCommands(world) {
  const planeModelCommands = (world.planeModelCommands = new NativePlaneModelCommands(world));
  for (const id of modelCommands.keys())
    world.runtime.register('main', id, (args, machine, task) =>
      planeModelCommands.apply(id, args, machine, task),
    );
}
