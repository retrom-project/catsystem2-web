// SPDX-License-Identifier: MPL-2.0
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import { NativeEngineProcess } from '../src/native/engine-process.mjs';
import { loadUnicorn } from '../src/ppi/backend.mjs';

const api = (engine, name, ...args) =>
  engine.call(engine.resolve({ dll: 'kernel32.dll', name }), args);

test('opened current-thread handles have independent access and lifetime after restore', async () => {
  const unicorn = await loadUnicorn(),
    engine = new NativeEngineProcess(unicorn),
    call = (name, ...args) => api(engine, name, ...args);
  let fresh;
  try {
    const id = await call('GetCurrentThreadId'),
      pseudo = await call('GetCurrentThread'),
      first = await call('OpenThread', 0x4a, 0, id),
      limited = await call('OpenThread', 0, 1, id);
    assert.notEqual(first, limited);
    assert.notEqual(first, pseudo);
    assert.equal(await call('GetThreadId', pseudo), id);
    assert.equal(await call('GetThreadId', first), id);
    assert.equal(await call('GetThreadId', limited), 0);
    assert.equal(await call('GetLastError'), 5);
    assert.equal(await call('OpenThread', 0x4a, 0, id + 1), 0);
    assert.equal(await call('GetLastError'), 87);
    assert.equal(await call('CloseHandle', limited), 1);
    fresh = new NativeEngineProcess(unicorn);
    fresh.restore(engine.snapshot());
    assert.equal(await api(fresh, 'GetThreadId', first), id);
    assert.equal(await api(fresh, 'GetThreadId', limited), 0);
    assert.equal(await api(fresh, 'GetLastError'), 6);
    assert.equal(await api(fresh, 'CloseHandle', first), 1);
    assert.equal(await api(fresh, 'CloseHandle', first), 0);
    assert.equal(await api(fresh, 'GetLastError'), 6);
    assert.equal(await call('GetThreadId', first), id);
  } finally {
    await fresh?.close();
    await engine.close();
  }
  assert.equal(engine.kernel.threadHandles.handles.size, 0);
});

test(
  'the original SDK OpenThread import opens the execution thread',
  { skip: !process.env.CATSYSTEM2_SDK_EXE },
  async () => {
    const bytes = new Uint8Array(await readFile(process.env.CATSYSTEM2_SDK_EXE)),
      engine = await NativeEngineProcess.open({ profile: 'sdk-4.01-engine-2.6.1.74', bytes });
    try {
      const id = await api(engine, 'GetCurrentThreadId'),
        pointer = engine.process.load(0x98e0fc),
        thread = await engine.call(pointer, [0x4a, 0, id]);
      assert.ok(thread);
      assert.equal(await api(engine, 'GetThreadId', thread), id);
      assert.equal(await api(engine, 'CloseHandle', thread), 1);
    } finally {
      await engine.close();
    }
  },
);
