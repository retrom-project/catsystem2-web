// SPDX-License-Identifier: MPL-2.0
// Original task command envelopes route even target zero; resolution belongs
// to the caller's Top namespace.
import { nativeReply, formatNativeAt } from '../kcs.mjs';

export const NATIVE_TASK_COMMAND_IDS = Object.freeze([0x28b, 0x28d, 0x28e, 0x28f, 0x2b6]);

class Packet {
  constructor(size) {
    this.data = new Uint8Array(size);
    this.view = new DataView(this.data.buffer);
  }
  load(address) {
    return this.view.getUint32(address, true);
  }
  store(address, word) {
    this.view.setUint32(address, word, true);
  }
  bytes(address, size) {
    if (address < 0 || address + size > this.data.length)
      throw new RangeError('Native task command packet bounds');
    return this.data.subarray(address, address + size);
  }
}

export async function nativeTaskCommand(id, args, machine, task, world) {
  if (!NATIVE_TASK_COMMAND_IDS.includes(id)) return undefined;
  const count = id === 0x28b ? 1 : id === 0x28e ? 3 : 2;
  if (args.length !== count)
    throw new Error(`Native task command 0x${id.toString(16)} expects ${count} arguments`);
  const send = (message, w = 0, l = 0, payload = undefined) =>
    world.sendNativeEngine(args[0], task.id, message, w, l, {
      ...(payload ? { payload } : {}),
      flags: 0,
    });
  if (id === 0x28b) await send(24, 0, 0xffffffff);
  else if (id === 0x28d) await send(84, 0, args[1]);
  else if (id === 0x2b6) await send(29, 0, args[1]);
  else {
    const packet = new Packet(id === 0x28e ? 512 : 256),
      format = world.runtime?.services.formatBytes ?? formatNativeAt;
    // The original formatter always returns one for a valid source, including
    // the empty string. A bad source faults before a message can be sent.
    for (let index = 1; index < args.length; index++) {
      const bytes = format(args[index], machine);
      if (bytes.length >= 256)
        throw new RangeError('Native task command string exceeds its original 256-byte scratch');
      packet.bytes((index - 1) * 256, bytes.length).set(bytes);
    }
    await send(id === 0x28e ? 85 : 86, 0, id === 0x28e ? 256 : 0, packet);
  }
  return nativeReply(2);
}

export function installNativeTaskCommands(world) {
  for (const id of NATIVE_TASK_COMMAND_IDS)
    world.runtime.register('main', id, (args, machine, task) =>
      nativeTaskCommand(id, args, machine, task, world),
    );
}
