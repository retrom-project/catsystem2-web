// SPDX-License-Identifier: MPL-2.0
// Main183/184 persist the MOT checkpoint envelope [manager, data, capacity].
import { nativeReply } from '../kcs/vm.mjs';
import { nativeABI } from './abi/index.mjs';

export function nativeMotionPersistence(id, args, machine, services = {}) {
  if (![0x183, 0x184].includes(id)) return undefined;
  const count = id === 0x183 ? 3 : 4;
  const readFrame =
    services.profile && nativeABI(services.profile).motion?.persistenceArgumentsReadFrame;
  if (!readFrame && args.length !== count)
    throw new Error(`Native motion persistence 0x${id.toString(16)} expects ${count} arguments`);
  if (!services.handles) return undefined;
  const { handles, motion } = services,
    word = (index) => (index < args.length ? args[index] : machine.nativeArgument(index)),
    result = (word) => nativeReply(1, word);
  if (!word(0) || (id === 0x183 && !word(2))) return result(0);
  const file = handles.get(word(0), 'global-file');
  if (id === 0x183) {
    file.write(word(1), handles.get(word(2), 'motion-checkpoint').bytes);
    return result(1);
  }
  const source = file.read(word(1));
  if (source === null) return result(0);
  const owner = word(2) >>> 0;
  if (owner && !motion?.restoreRecords) return undefined;
  const frame = owner ? word(3) : 0,
    checkpoint = { owner, bytes: source.slice() },
    handle = handles.add('motion-checkpoint', checkpoint);
  if (!owner) return result(handle);
  return Promise.resolve()
    .then(() => motion.restoreRecords(checkpoint.owner, checkpoint.bytes, frame))
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
