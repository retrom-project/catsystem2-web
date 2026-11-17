// SPDX-License-Identifier: MPL-2.0
import { originalOwner, originalFeature } from './original-adapter.mjs';
import { NativeGraphicsPacket } from './graphics-task.mjs';
import { nativeReply } from '../kcs/vm.mjs';
export const NATIVE_TILE_PLANE_COMMAND = Object.freeze({
  id: 0x1b1,
  words: 5,
  control: 2,
  message: 46,
});
async function ordinaryTilePlaneCommand(world, args, machine, task) {
  const word = (index) => args[index] ?? machine.nativeArgument(index),
    target = word(0);
  if (!target) return nativeReply(2);
  const payload = new NativeGraphicsPacket(
    [0, 0, 0, word(1), word(2), undefined, undefined, undefined, word(3), word(4)],
    { unwritten: [5, 6, 7] },
  );
  await world.sendNativeEngine(target, task.id, 46, 0, 0, { payload, flags: 0 });
  return nativeReply(2);
}

export function installNativeTilePlaneCommand(world) {
  world.runtime.register('main', NATIVE_TILE_PLANE_COMMAND.id, (args, machine, task) =>
    originalOwner(world)
      ? originalFeature(world, 'tile-plane-command', 'apply', args, machine, task)
      : ordinaryTilePlaneCommand(world, args, machine, task),
  );
}
