// SPDX-License-Identifier: MPL-2.0
// Raw engine heap addresses are distinct from KCS virtual addresses and handles.
import { nativeReply } from '../kcs/vm.mjs';

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
  if (typeof services.dataBuffers !== 'function') return undefined;
  if (id === 0x344) {
    const bytes = services.handles.get(args[0], 'global-file').read(args[1]);
    if (bytes === null) return result(0);
    const heap = await services.dataBuffers(),
      pointer = heap.allocateData(bytes.length);
    heap.process.write(pointer, bytes);
    machine.store(args[2], bytes.length);
    return result(pointer);
  }
  const heap = await services.dataBuffers();
  if (id === 0x341) return result(heap.allocateData(args[0]));
  if (id === 0x342) {
    heap.releaseData(args[0]);
    return done();
  }
  services.handles.get(args[0], 'global-file').write(args[1], heap.process.read(args[3], args[2]));
  return result(1);
}
