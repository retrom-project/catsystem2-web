// SPDX-License-Identifier: MPL-2.0
import test from 'node:test';
import assert from 'node:assert/strict';
import { encodeSparseBytes, decodeSparseBytes } from '../src/native/sparse-bytes.mjs';
import { checkpointBytes, serializeCheckpoint, deserializeCheckpoint } from '../src/checkpoint.mjs';

test('sparse bytes retain exact length, boundaries, partial blocks and every nonzero byte', () => {
  for (const size of [0, 1, 15, 16, 17, 33, 65539]) {
    const input = new Uint8Array(size);
    for (let at = 0; at < size; at++)
      if (at % 29 === 0 || at + 1 === size) input[at] = (at % 255) + 1;
    const encoded = encodeSparseBytes(input, { blockSize: 16 });
    assert.equal(encoded.length, size);
    assert.deepEqual(decodeSparseBytes(encoded), input);
    input.fill(0);
    assert.ok(
      !size || decodeSparseBytes(encoded).some(Boolean),
      'encoded bytes own their snapshot storage',
    );
  }
});
test('sparse view snapshots never capture bytes outside their span or retain the backing allocation', () => {
  const backing = new Uint8Array(1024 * 1024).fill(231),
    input = backing.subarray(4100, 4137);
  input.fill(0);
  input[0] = 71;
  input[36] = 143;
  const encoded = encodeSparseBytes(new DataView(backing.buffer, 4100, 37), { blockSize: 16 });
  assert.equal(encoded.length, 37);
  assert.deepEqual(
    encoded.blocks.map(({ offset, bytes }) => [offset, bytes.length, bytes.buffer.byteLength]),
    [
      [0, 16, 16],
      [32, 5, 5],
    ],
  );
  assert.deepEqual(decodeSparseBytes(encoded), input);
  assert.ok(checkpointBytes(encoded) < 1024);
});
test('sparse zero allocations survive the portable checkpoint graph without serializing unused pixels', async () => {
  const bytes = new Uint8ClampedArray(12 * 1024 * 1024);
  bytes.set([17, 31, 72, 255], 32767);
  bytes[bytes.length - 1] = 91;
  const state = encodeSparseBytes(bytes),
    restored = await deserializeCheckpoint(await serializeCheckpoint(state));
  assert.ok(checkpointBytes(state) < 100000);
  assert.deepEqual(decodeSparseBytes(restored), new Uint8Array(bytes));
});
test('sparse restore rejects duplicate, unordered, overlapping, short and out-of-bounds blocks', () => {
  const block = (offset, size = 16) => ({ offset, bytes: new Uint8Array(size) });
  for (const blocks of [
    [block(16), block(0)],
    [block(0), block(0)],
    [block(1)],
    [block(-16)],
    [block(32)],
    [block(0, 15)],
    [{ offset: 0, bytes: [1] }],
  ])
    assert.throws(
      () => decodeSparseBytes({ length: 32, blockSize: 16, blocks }),
      /Sparse byte blocks/,
    );
  assert.throws(() => decodeSparseBytes({ length: -1, blockSize: 16, blocks: [] }), /length/);
  assert.throws(() => decodeSparseBytes({ length: 1, blockSize: 0, blocks: [] }), /block size/);
  assert.throws(() => encodeSparseBytes('pixels'), /binary/);
});
