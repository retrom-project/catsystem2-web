// SPDX-License-Identifier: MPL-2.0
// Main183/184 persist the MOT checkpoint envelope [manager, data, capacity].
import { nativeReply } from '../kcs/vm.mjs';

export function nativeMotionPersistence(id, args, _machine, services = {}) {
  if (![0x183, 0x184].includes(id)) return undefined;
  const count = id === 0x183 ? 3 : 4;
  if (args.length !== count)
    throw new Error(`Native motion persistence 0x${id.toString(16)} expects ${count} arguments`);
  if (!services.handles) return undefined;
  const { handles, motion } = services,
    result = (word) => nativeReply(1, word);
  if (!args[0] || (id === 0x183 && !args[2])) return result(0);
  const file = handles.get(args[0], 'global-file');
  if (id === 0x183) {
    file.write(args[1], handles.get(args[2], 'motion-checkpoint').bytes);
    return result(1);
  }
  const source = file.read(args[1]);
  if (source === null) return result(0);
  if (args[2] && !motion?.restoreRecords) return undefined;
  const checkpoint = { owner: args[2] >>> 0, bytes: source.slice() },
    handle = handles.add('motion-checkpoint', checkpoint);
  if (!args[2]) return result(handle);
  return Promise.resolve()
    .then(() => motion.restoreRecords(args[2], checkpoint.bytes, args[3]))
    .then(
      () => result(handle),
      (error) => {
        handles.release(handle, 'motion-checkpoint');
        throw error;
      },
    );
}

export function installNativeMotionPersistence(world) {
  for (const id of [0x183, 0x184])
    world.runtime.register('main', id, (args, machine) =>
      nativeMotionPersistence(id, args, machine, world.runtime.services),
    );
}
