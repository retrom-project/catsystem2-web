// SPDX-License-Identifier: MPL-2.0
import assert from 'node:assert/strict';
import test from 'node:test';
import { NativeEngineProcess } from '../src/native/engine-process.mjs';
import { loadUnicorn } from '../src/ppi/backend.mjs';

const api = (engine, name, ...args) =>
  engine.process.call(engine.resolve({ dll: 'kernel32.dll', name }), args);

test('Win32 dynamic TLS and direct x86 TEB access share the same restored storage', async () => {
  const unicorn = await loadUnicorn(),
    engine = new NativeEngineProcess(unicorn),
    p = engine.process,
    readInline = p.allocate(16),
    writeInline = p.allocate(24),
    readExpansion = p.allocate(24),
    loadIndex = [0x8b, 0x4c, 0x24, 0x04];
  // Read and write the same FS-relative slots used by the original SDK V8.
  p.write(readInline, Uint8Array.of(...loadIndex, 0x64, 0x8b, 0x04, 0x8d, 0x10, 0x0e, 0, 0, 0xc3));
  p.write(
    writeInline,
    Uint8Array.of(
      ...loadIndex,
      0x8b,
      0x54,
      0x24,
      8,
      0x64,
      0x89,
      0x14,
      0x8d,
      0x10,
      0x0e,
      0,
      0,
      0xc3,
    ),
  );
  p.write(
    readExpansion,
    Uint8Array.of(
      ...loadIndex,
      0x64,
      0xa1,
      0x94,
      0x0f,
      0,
      0,
      0x8b,
      0x84,
      0x88,
      0,
      0xff,
      0xff,
      0xff,
      0xc3,
    ),
  );
  let fresh;
  try {
    const call = (name, ...args) => api(engine, name, ...args);
    for (const index of [63, 200]) {
      call('SetLastError', 0x55aa);
      assert.equal(call('TlsGetValue', index), 0);
      assert.equal(call('GetLastError'), 0);
      call('SetLastError', 0x55aa);
      assert.equal(call('TlsSetValue', index, 0x10203040), 1);
      assert.equal(call('GetLastError'), 0x55aa);
      assert.equal(p.call(index < 64 ? readInline : readExpansion, [index]), 0x10203040);
      assert.equal(call('TlsFree', index), 0);
      assert.equal(call('GetLastError'), 87);
    }
    for (const name of ['TlsGetValue', 'TlsSetValue', 'TlsFree']) {
      assert.equal(call(name, 1088, 0x87654321), 0);
      assert.equal(call('GetLastError'), 87);
    }
    for (let index = 0; index <= 70; index++) assert.equal(call('TlsAlloc'), index);
    assert.equal(p.call(readInline, [63]), 0, 'allocating a free slot clears its raw value');
    assert.equal(call('TlsSetValue', 0, 0x0badcafe), 1);
    assert.equal(call('TlsSetValue', 70, 0x12345678), 1);
    assert.equal(p.call(readInline, [0]), 0x0badcafe);
    assert.equal(p.call(readExpansion, [70]), 0x12345678);
    p.call(writeInline, [0, 0x54321000]);
    assert.equal(call('TlsGetValue', 0), 0x54321000);
    assert.equal(call('TlsFree', 1), 1);

    fresh = new NativeEngineProcess(unicorn);
    fresh.restore(engine.snapshot());
    assert.equal(api(fresh, 'TlsAlloc'), 1);
    assert.equal(api(fresh, 'TlsGetValue', 0), 0x54321000);
    assert.equal(fresh.process.call(readExpansion, [70]), 0x12345678);
    assert.equal(api(fresh, 'TlsGetValue', 200), 0x10203040);
    assert.equal(api(fresh, 'TlsFree', 70), 1);
    assert.equal(fresh.process.call(readExpansion, [70]), 0);
    assert.equal(p.call(readExpansion, [70]), 0x12345678);
  } finally {
    await fresh?.close();
    await engine.close();
  }
});
