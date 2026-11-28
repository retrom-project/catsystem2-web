// SPDX-License-Identifier: MPL-2.0
// JS-owned raw data addresses are distinct from KCS virtual addresses and handles.
import { nativeReply } from '../kcs/vm.mjs';
import { nativeABI } from './abi/index.mjs';
import { NativeBufferAllocationError } from './buffer-memory.mjs';

export const NATIVE_HEAP_DATA_IDS = Object.freeze([0x341, 0x342, 0x343, 0x344]);
export async function nativeHeapData(id, args, machine, services) {
  const count = [1, 1, 4, 3][id - 0x341];
  if (count === undefined) return undefined;
  if (args.length !== count)
    throw new Error(`Native raw heap 0x${id.toString(16)} expects ${count} arguments`);
  const result = (value) => nativeReply(1, value),
    done = () => nativeReply(2);
  if (id === 0x342 && !args[0]) return done();
  if (id === 0x343 && (!args[0] || !args[3])) return result(0);
  if (id === 0x344 && !args[0]) return result(0);
  if (typeof services.imageDataBuffers !== 'function') return undefined;
  const allocate = (heap, size) => {
    try {
      return heap.allocateData(size);
    } catch (error) {
      if (
        error instanceof NativeBufferAllocationError &&
        services.profile &&
        nativeABI(services.profile).database?.rawHeapAllocationFailureReturnsZero
      )
        return 0;
      throw error;
    }
  };
  if (id === 0x344) {
    const bytes = services.handles.get(args[0], 'global-file').read(args[1]);
    if (bytes === null) {
      if (
        !args[1] &&
        services.profile &&
        nativeABI(services.profile).globalFile.hostDataRequiresExplicitZeroRecord
      )
        throw new Error('Unreviewed lookup of unwritten CSS record zero');
      return result(0);
    }
    const heap = await services.imageDataBuffers(),
      pointer = allocate(heap, bytes.length);
    if (!pointer) return result(0);
    try {
      heap.process.write(pointer, bytes);
      machine.store(args[2], bytes.length);
      return result(pointer);
    } catch (error) {
      heap.releaseData(pointer);
      throw error;
    }
  }
  const heap = await services.imageDataBuffers();
  if (id === 0x341) return result(allocate(heap, args[0]));
  if (id === 0x342) {
    heap.releaseData(args[0]);
    return done();
  }
  const file = services.handles.get(args[0], 'global-file');
  file.write(args[1], heap.process.readHostData(args[3], args[2], id));
  return result(1);
}
