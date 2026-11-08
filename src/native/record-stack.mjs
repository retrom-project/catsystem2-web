// SPDX-License-Identifier: MPL-2.0
// Main 35F..364: fixed-record LIFO storage, not kcBuffer or a task checkpoint.
import { nativeReply } from '../kcs/vm.mjs';

export const NATIVE_RECORD_STACK_IDS = Object.freeze([0x35f, 0x360, 0x361, 0x362, 0x363, 0x364]);
export const NATIVE_RECORD_STACK_HANDLERS = Object.freeze({
  'nekopara-vol3-engine-2.6.1.76': Object.freeze([
    0x645020, 0x645070, 0x645130, 0x6450d0, 0x6450a0, 0x644f90,
  ]),
  'sdk-4.01-engine-2.6.1.74': Object.freeze([
    0x52a2c0, 0x52a310, 0x52a3d0, 0x52a370, 0x52a340, 0x52a230,
  ]),
});
const bytesFor = (size, capacity) => {
  const bytes = Math.imul(size, capacity) >>> 0;
  if (bytes > 0x10000000)
    throw new RangeError('Native record stack exceeds mapped resource memory');
  return bytes;
};

export class NativeRecordStack {
  constructor(recordSize, increment) {
    this.recordSize = recordSize >>> 0;
    this.count = 0;
    this.increment = increment >>> 0;
    this.capacity = this.increment;
    this.data = new Uint8Array(bytesFor(this.recordSize, this.capacity));
  }
  reserve() {
    // The native wrapper compares these DWORDs as signed integers and grows
    // before translating the source VM pointer. A rejected push can grow it.
    if ((this.count | 0) < (this.capacity | 0)) return;
    const capacity = (this.capacity + this.increment) >>> 0,
      data = new Uint8Array(bytesFor(this.recordSize, capacity));
    data.set(this.data);
    this.capacity = capacity;
    this.data = data;
  }
  record(index) {
    const at = Math.imul(index, this.recordSize) >>> 0;
    if (at + this.recordSize > this.data.length)
      throw new RangeError('Native record-stack operation crosses its allocated storage');
    return this.data.subarray(at, at + this.recordSize);
  }
  push(bytes) {
    if (bytes.length !== this.recordSize) throw new RangeError('Native record-stack record size');
    this.record(this.count).set(bytes);
    this.count = (this.count + 1) >>> 0;
  }
  pop(destination) {
    if ((this.count | 0) <= 0) return false;
    this.count = (this.count - 1) >>> 0;
    destination.set(this.record(this.count));
    return true;
  }
  copy(source) {
    if (
      this.recordSize !== source.recordSize ||
      this.increment !== source.increment ||
      this.capacity !== source.capacity
    ) {
      this.recordSize = source.recordSize;
      this.increment = source.increment;
      this.capacity = source.capacity;
      this.data = new Uint8Array(bytesFor(this.recordSize, this.capacity));
    }
    // Includes every capacity byte, not only count * recordSize. Pop leaves
    // the old record bytes intact and copy preserves those unused tails.
    this.data.set(source.data);
    this.count = source.count;
  }
  snapshot() {
    return {
      recordSize: this.recordSize,
      count: this.count,
      increment: this.increment,
      capacity: this.capacity,
      data: this.data.slice(),
    };
  }
  restore(state) {
    const expected = bytesFor(state.recordSize, state.capacity),
      data = Uint8Array.from(state.data);
    if (data.length !== expected) throw new Error('Native record-stack checkpoint size mismatch');
    for (const name of ['recordSize', 'count', 'increment', 'capacity'])
      this[name] = state[name] >>> 0;
    this.data = data;
    return this;
  }
}
export const nativeRecordStackCodec = Object.freeze({
  snapshot: (stack) => stack.snapshot(),
  restore: (state) => new NativeRecordStack(0, 0).restore(state),
});

function mapped(machine, address) {
  try {
    // Address zero is a valid VM data address. Translation checks mapping
    // even for zero-byte records; only a failed translation becomes NULL.
    if (machine.region) machine.region(address, 1);
    else machine.bytes(address, 1);
    return true;
  } catch {
    return false;
  }
}

export function nativeRecordStack(id, args, machine, services = {}) {
  if (!NATIVE_RECORD_STACK_IDS.includes(id)) return undefined;
  const count = [0x360, 0x363].includes(id) ? 1 : 2;
  if (args.length !== count)
    throw new Error(`Native record stack 0x${id.toString(16)} expects ${count} arguments`);
  if (!services.handles) return undefined;
  const handles = services.handles,
    value = (word) => nativeReply(1, word),
    done = () => nativeReply(2);
  if (id === 0x35f)
    return value(handles.add('record-stack', new NativeRecordStack(args[0], args[1])));
  if (id === 0x360) {
    if (args[0]) handles.release(args[0], 'record-stack');
    return done();
  }
  if (id === 0x364) {
    if (args[0] && args[1])
      handles.get(args[0], 'record-stack').copy(handles.get(args[1], 'record-stack'));
    return done();
  }
  if (!args[0]) return value(0);
  const stack = handles.get(args[0], 'record-stack');
  if (id === 0x363) return value(stack.count);
  if (id === 0x361) stack.reserve();
  if (!mapped(machine, args[1])) return value(0);
  if (id === 0x362) {
    if ((stack.count | 0) <= 0) return value(0);
    return value(Number(stack.pop(machine.bytes(args[1], stack.recordSize))));
  }
  stack.push(machine.bytes(args[1], stack.recordSize));
  return value(1);
}
