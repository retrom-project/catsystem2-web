// SPDX-License-Identifier: MPL-2.0
import test from 'node:test';
import assert from 'node:assert/strict';
import { nativeDeflate, nativeInflate } from '../src/native/zlib.mjs';
test('pinned zlib executes JavaScript without a WebAssembly or EXE runtime', async () => {
  const previous = globalThis.WebAssembly;
  try {
    globalThis.WebAssembly = undefined;
    const source = new TextEncoder().encode('CatSystem2 '.repeat(17)),
      encoded = await nativeDeflate(source, new Uint8Array(512));
    assert.ok(encoded.result > 0);
    const decoded = await nativeInflate(
      encoded.bytes.subarray(0, encoded.result),
      new Uint8Array(source.length),
    );
    assert.equal(decoded.result, source.length);
    assert.deepEqual(decoded.bytes, source);
  } finally {
    globalThis.WebAssembly = previous;
  }
});
