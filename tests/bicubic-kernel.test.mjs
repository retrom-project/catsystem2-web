// SPDX-License-Identifier: MPL-2.0
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { BicubicKernel } from '../src/emote/bicubic-kernel.mjs';

test('the compiled float32 kernel matches authored original-driver register and vertex golden values', async () => {
  const golden = JSON.parse(
      await readFile(new URL('./fixtures/native-bicubic-golden.json', import.meta.url), 'utf8'),
    ),
    input = golden.input,
    bytes = (words) => new Uint8Array(Uint32Array.from(words).buffer),
    kernel = new BicubicKernel(),
    parameters = {
      mxcsr: input.mxcsr,
      count: input.count,
      stack: bytes(input.stack),
      control: bytes(input.control),
      registerValues: new Float32Array(bytes(input.registers).buffer),
      one: new Float32Array(Uint32Array.of(input.one).buffer)[0],
      bytes: bytes(input.coordinates),
    },
    original = parameters.bytes.slice(),
    result = kernel.execute(parameters);
  assert.deepEqual([...new Uint32Array(result.bytes.slice().buffer)], golden.output.coordinates);
  assert.deepEqual([...new Uint32Array(result.registers.slice().buffer)], golden.output.registers);
  assert.equal(golden.output.mxcsr, input.mxcsr);
  assert.deepEqual(parameters.bytes, original);
  assert.equal(kernel.execute({ ...parameters, mxcsr: 0x1f80 }), null);
  assert.equal(kernel.execute({ ...parameters, mxcsr: 0x9fa0 }), null);
  // A late exceptional coordinate must discard the entire tentative batch.
  for (const bits of [1, 0x00800000, 0x7fc01234, 0x7f801234, 0x7f800000]) {
    const invalid = original.slice();
    new DataView(invalid.buffer).setUint32(invalid.length - 4, bits, true);
    const before = invalid.slice();
    assert.equal(kernel.execute({ ...parameters, bytes: invalid }), null);
    assert.deepEqual(invalid, before);
  }
});
