// SPDX-License-Identifier: MPL-2.0
import assert from 'node:assert/strict';
import test from 'node:test';
import { NativeEngineProcess } from '../src/native/engine-process.mjs';
import { loadUnicorn } from '../src/ppi/backend.mjs';

const call = (engine, name, argument) =>
  engine.call(engine.resolve({ dll: 'OLE32.dll', name }), [argument]);

test('COM task allocations preserve their distinct ownership, bytes and identities in a fresh process', async () => {
  const unicorn = await loadUnicorn(),
    first = new NativeEngineProcess(unicorn),
    fresh = new NativeEngineProcess(unicorn);
  try {
    const firstMemory = first.kernel.comMemory,
      freshMemory = fresh.kernel.comMemory,
      foreign = first.process.allocate(16, true),
      zero = await call(first, 'CoTaskMemAlloc', 0),
      bytes = await call(first, 'CoTaskMemAlloc', 33),
      content = Uint8Array.from({ length: 33 }, (_, i) => i * 17);
    assert.ok(zero && bytes && bytes !== zero);
    assert.equal(first.process.allocations.get(zero), 0);
    assert.equal(first.process.allocations.get(bytes), content.length);
    first.process.write(bytes, content);
    assert.equal(await call(first, 'CoTaskMemAlloc', 0xffffffff), 0);
    await call(first, 'CoTaskMemFree', 0);
    const checkpoint = first.snapshot();
    fresh.restore(checkpoint);
    assert.deepEqual(freshMemory.snapshot(), firstMemory.snapshot());
    assert.deepEqual(freshMemory.snapshot(), [zero, bytes]);
    assert.deepEqual(fresh.process.read(bytes, content.length), content);
    await call(fresh, 'CoTaskMemFree', bytes);
    await call(fresh, 'CoTaskMemFree', zero);
    assert.deepEqual(freshMemory.snapshot(), []);
    assert.equal(fresh.process.allocations.has(zero), false);
    assert.equal(fresh.process.allocations.has(bytes), false);
    assert.deepEqual(first.process.read(bytes, content.length), content);
    await assert.rejects(call(fresh, 'CoTaskMemFree', foreign), /outside COM task memory/);
    assert.equal(fresh.process.allocations.has(foreign), true);
    assert.throws(() => freshMemory.restore([bytes]), /Invalid COM task memory checkpoint/);
    assert.deepEqual(freshMemory.snapshot(), []);
  } finally {
    await fresh.close();
    await first.close();
  }
});
