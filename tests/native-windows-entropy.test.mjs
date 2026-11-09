// SPDX-License-Identifier: MPL-2.0
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import { NativeEngineProcess } from '../src/native/engine-process.mjs';
import { installNativeEntropy } from '../src/native/windows-entropy.mjs';
import { loadUnicorn } from '../src/ppi/backend.mjs';

test('the dynamic Windows entropy export fills exactly the caller bytes across chunks', async () => {
  const engine = new NativeEngineProcess(await loadUnicorn()),
    { process: p, kernel } = engine,
    name = p.allocate(64),
    symbol = p.allocate(32),
    out = p.allocate(65543, true),
    sizes = [];
  try {
    installNativeEntropy(kernel, (chunk) => {
      sizes.push(chunk.length);
      chunk.fill(16 + sizes.length);
    });
    kernel.writeString(name, 'ADVAPI32.DLL', true);
    kernel.writeString(symbol, 'SystemFunction036');
    const api = (name) => engine.resolve({ dll: 'KERNEL32.dll', name }),
      handle = p.call(api('LoadLibraryExW'), [name, 0, 0x800]),
      address = p.call(api('GetProcAddress'), [handle, symbol]);
    assert.ok(handle && address);
    assert.equal(p.call(address, [0, 4]), 0);
    assert.equal(p.call(address, [0, 0]), 1);
    assert.equal(p.call(address, [out + 1, 65541]), 1);
    assert.deepEqual(sizes, [65536, 5]);
    assert.deepEqual(p.read(out, 2), Uint8Array.of(0, 17));
    assert.deepEqual(p.read(out + 65536, 7), Uint8Array.of(17, 18, 18, 18, 18, 18, 0));
    assert.equal(p.call(api('FreeLibrary'), [handle]), 1);
  } finally {
    await engine.close();
  }
});

test(
  'the original SDK CRT rand_s resolves and reuses the Windows entropy export after restore',
  { skip: !process.env.CATSYSTEM2_SDK_EXE },
  async () => {
    const profile = 'sdk-4.01-engine-2.6.1.74',
      bytes = new Uint8Array(await readFile(process.env.CATSYSTEM2_SDK_EXE)),
      open = () => NativeEngineProcess.open({ profile, bytes }),
      engine = await open(),
      out = engine.process.allocate(12),
      calls = (instance) => instance.kernel.calls.get('advapi32.dll!SystemFunction036'),
      draw = (instance) => {
        const p = instance.process;
        p.write(out, new Uint8Array(12).fill(0x4d));
        const watch = p.watchWrites(out + 4, 4);
        try {
          assert.equal(p.call(0x64a7ef, [out + 4]), 0);
          assert.equal(watch.written, true);
          assert.equal(p.load(out), 0x4d4d4d4d);
          assert.equal(p.load(out + 8), 0x4d4d4d4d);
        } finally {
          watch.close();
        }
      };
    let fresh;
    try {
      draw(engine);
      assert.equal(calls(engine), 1);
      const saved = engine.snapshot();
      fresh = await open();
      fresh.restore(saved);
      const loadCount = fresh.kernel.calls.get('kernel32.dll!LoadLibraryExW'),
        previousCalls = calls(fresh) ?? 0;
      draw(fresh);
      assert.equal(fresh.kernel.calls.get('kernel32.dll!LoadLibraryExW'), loadCount);
      assert.equal(calls(fresh), previousCalls + 1);
    } finally {
      await fresh?.close();
      await engine.close();
    }
  },
);
