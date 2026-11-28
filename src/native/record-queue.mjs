// SPDX-License-Identifier: MPL-2.0
import { nativeABI } from './abi/index.mjs';
import { nativeReply } from '../kcs/vm.mjs';

export const NATIVE_RECORD_QUEUE_IDS = Object.freeze([0x3f2, 0x3f3, 0x3f4, 0x3f5, 0x400]);
export class NativeRecordQueue {
  constructor(recordSize) {
    this.recordSize = recordSize >>> 0;
    if (this.recordSize > 0x10000000)
      throw new RangeError('Native record queue exceeds mapped resource memory');
    this.records = [];
  }
  snapshot() {
    return { recordSize: this.recordSize, records: this.records.map((bytes) => bytes.slice()) };
  }
}
export const nativeRecordQueueCodec = Object.freeze({
  snapshot: (queue) => queue.snapshot(),
  restore: (state) => {
    const queue = new NativeRecordQueue(state.recordSize);
    queue.records = state.records.map((bytes) => {
      const record = Uint8Array.from(bytes);
      if (record.length !== queue.recordSize)
        throw new Error('Native record queue checkpoint record size mismatch');
      return record;
    });
    return queue;
  },
});
export function nativeRecordQueue(id, args, machine, services) {
  if (!NATIVE_RECORD_QUEUE_IDS.includes(id)) return undefined;
  const count = id === 0x3f4 || id === 0x3f5 ? 2 : 1;
  if (args.length !== count)
    throw new Error(`Native record queue 0x${id.toString(16)} expects ${count} arguments`);
  const { handles } = services;
  if (id === 0x3f2)
    return nativeReply(1, handles.add('record-queue', new NativeRecordQueue(args[0])));
  if (id === 0x3f3) {
    if (args[0]) handles.release(args[0], 'record-queue');
    return nativeReply(2);
  }
  // This status wrapper returns one for NULL, empty and nonempty queues.
  if (id === 0x400) {
    if (args[0]) handles.get(args[0], 'record-queue');
    return nativeReply(1, 1);
  }
  const control = id === 0x3f4 ? 2 : 1;
  if (!args[0]) return nativeReply(control, control === 1 ? 0 : undefined);
  const queue = handles.get(args[0], 'record-queue');
  let bytes;
  try {
    machine.region(args[1] >>> 0, 1);
    bytes = machine.bytes(args[1] >>> 0, queue.recordSize);
  } catch {
    return nativeReply(control, control === 1 ? 0 : undefined);
  }
  if (id === 0x3f4) {
    queue.records.push(bytes.slice());
    return nativeReply(2);
  }
  if (!queue.records.length) return nativeReply(1, 0);
  bytes.set(queue.records.shift());
  return nativeReply(1, 1);
}
export function installNativeRecordQueues(world) {
  if (!nativeABI(world.profile).capabilities.recordQueues) return;
  for (const id of NATIVE_RECORD_QUEUE_IDS)
    world.runtime.register('main', id, (args, machine) =>
      nativeRecordQueue(id, args, machine, world.runtime.services),
    );
}
