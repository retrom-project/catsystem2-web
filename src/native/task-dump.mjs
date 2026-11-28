// SPDX-License-Identifier: MPL-2.0
import { originalOwner, originalFeature } from './original-adapter.mjs';
// The SDK writes its original task dump through the shared task graph and IFile.
import { nativeABI } from './abi/index.mjs';
import { nativeReply } from '../kcs/vm.mjs';
import { formatNativeAt } from '../kcs.mjs';
import { nativeDataString } from './data-text.mjs';

export const NATIVE_TASK_DUMP = Object.freeze({ id: 0xd0 });

export function installNativeTaskDump(world) {
  world.runtime.register('main', NATIVE_TASK_DUMP.id, async (args, machine, task) => {
    if (originalOwner(world))
      return originalFeature(world, 'task-dump', 'apply', args, machine, task);
    const abi = nativeABI(world.profile);
    const formatted = nativeDataString(
        formatNativeAt(args[0] ?? machine.nativeArgument(0), machine),
      ),
      data = new Uint8Array(formatted.length + 1),
      header = machine.script?.header;
    data.set(formatted);
    let version = 0;
    if (header !== undefined) {
      if (!(header instanceof Uint8Array) || header.length < 12)
        throw new Error('Task dump requires the actual KCS source header');
      const view = new DataView(header.buffer, header.byteOffset, header.byteLength);
      version = ((view.getUint16(8, true) << 16) | view.getUint16(10, true)) >>> 0;
    }
    await world.sendNativeEngine(0, task.id, abi.messages.taskDumpWrapper, version, 0, {
      flags: 0,
      payload: {
        bytes(address, count) {
          if (
            !Number.isSafeInteger(address) ||
            !Number.isSafeInteger(count) ||
            address < 0 ||
            count < 0 ||
            address + count > data.length
          )
            throw new RangeError('Task dump filename payload exceeds its owned bytes');
          return data.subarray(address, address + count);
        },
      },
    });
    // The Game Root handles this message without a file or output write. Both
    // original wrappers ignore transport status and push the same zero word.
    return nativeReply(1, 0);
  });
}
