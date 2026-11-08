// SPDX-License-Identifier: MPL-2.0
import { NativeHandles } from '../../src/native/handles.mjs';
import { nativeRecordStack, nativeRecordStackCodec } from '../../src/native/record-stack.mjs';

export const recordStackSpecifications = [0, 1, 3, 4, 7, 16, 40].flatMap((size) =>
  [0, 1, 2, 8].map((increment) => ({ size, increment })),
);
export function recordStackOperations({ size, increment }) {
  const operations = [
    [0x35f, 'A', size, increment],
    [0x35f, 'B', size + 1, increment + 1],
    [0x363, 'A'],
    [0x362, 'A', 0],
    [0x361, 'A', 0xffffffff],
  ];
  if (increment || !size)
    for (let i = 0; i < 2 * increment + 3; i++) operations.push([0x361, 'A', i % 2 ? 0 : 64]);
  operations.push(
    [0x362, 'A', 128],
    [0x362, 'A', 0xffffffff],
    [0x364, 'B', 'A'],
    [0x363, 'B'],
    [0x364, 'A', 'A'],
    [0x364, 0, 'A'],
    [0x364, 'A', 0],
    [0x363, 0],
    [0x361, 0, 0],
    [0x362, 0, 0],
    [0x360, 0],
    ['count', 'A', 0xffffffff],
    [0x363, 'A'],
    [0x362, 'A', 128],
    [0x364, 'B', 'A'],
    [0x363, 'B'],
    [0x360, 'A'],
    [0x360, 'B'],
  );
  return operations;
}
export function recordStackFixture() {
  const handles = new NativeHandles(),
    memory = new Uint8Array(256),
    labels = new Map();
  handles.registerType('record-stack', nativeRecordStackCodec);
  const machine = {
    bytes(address, size) {
      if (address < 0 || address + size > memory.length)
        throw new RangeError('Unmapped authored VM memory');
      return memory.subarray(address, address + size);
    },
  };
  return { handles, memory, labels, machine, step: 0 };
}
export function recordStackModelState(fixture) {
  return {
    memory: [...fixture.memory],
    stacks: [...fixture.handles.records]
      .filter(([, record]) => record.type === 'record-stack')
      .map(([handle, { value }]) => [
        handle,
        {
          recordSize: value.recordSize,
          count: value.count,
          increment: value.increment,
          capacity: value.capacity,
          data: [...value.data],
        },
      ]),
  };
}
export function stepRecordStackModel(fixture, operation) {
  const [id, label, ...values] = operation,
    resolve = (value) => (typeof value === 'string' ? fixture.labels.get(value) : value);
  if (id === 'count') {
    fixture.handles.get(resolve(label), 'record-stack').count = values[0];
    return { setup: true, handle: resolve(label), count: values[0] };
  }
  fixture.step++;
  // Deterministic authored VM bytes are supplied before every call, including
  // pop calls, so untouched destinations and surrounding canaries are checked.
  fixture.memory.set(
    Uint8Array.from({ length: 256 }, (_, i) => (fixture.step * 31 + i * 53) & 255),
  );
  const inputMemory = fixture.memory.slice();
  const args = id === 0x35f ? values : [resolve(label), ...values.map(resolve)],
    before =
      id === 0x361 && args[0] ? fixture.handles.get(args[0], 'record-stack').snapshot() : null,
    reply = nativeRecordStack(id, args, fixture.machine, { handles: fixture.handles }),
    primes = [];
  if (id === 0x35f) fixture.labels.set(label, reply.value);
  if (id === 0x35f || before) {
    const handle = id === 0x35f ? reply.value : args[0],
      stack = fixture.handles.get(handle, 'record-stack'),
      start = before?.data.length ?? 0,
      pushedStart = before ? Math.imul(before.count, stack.recordSize) >>> 0 : 0,
      pushedEnd = pushedStart + stack.recordSize;
    // Heap initialization is unspecified. Prime only newly allocated bytes
    // which this operation did not initialize, then compare/preserve the full
    // capacity on subsequent real operations, including popped record tails.
    for (let at = start; at < stack.data.length; at++)
      if (!(before && reply.value && at >= pushedStart && at < pushedEnd)) {
        const value = (at * 17 + fixture.step * 29) & 255;
        stack.data[at] = value;
        primes.push({ handle, at, value });
      }
  }
  return { id, args, reply, primes, inputMemory, state: recordStackModelState(fixture) };
}
