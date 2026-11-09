// SPDX-License-Identifier: MPL-2.0
import assert from 'node:assert/strict';
import test from 'node:test';
import { NativeEngineProcess } from '../src/native/engine-process.mjs';
import { loadUnicorn } from '../src/ppi/backend.mjs';

const waitFailed = 0xffffffff,
  waitTimeout = 0x102;
const api =
  (engine) =>
  (name, ...args) =>
    engine.call(engine.resolve({ dll: 'KERNEL32.dll', name }), args);

test('native unnamed Win32 event waits preserve auto-reset, manual-reset and handle order', async () => {
  const unicorn = await loadUnicorn(),
    engine = new NativeEngineProcess(unicorn),
    { process: p, kernel } = engine,
    call = api(engine),
    handles = p.allocate(8, true),
    auto = await call('CreateEventA', 0, 0, 1, 0),
    manual = await call('CreateEventW', 0, 1, 0, 0);
  p.store(handles, auto);
  p.store(handles + 4, manual);
  let fresh;
  try {
    assert.equal(await call('WaitForMultipleObjects', 2, handles, 1, 0), waitTimeout);
    assert.equal(await call('SetEvent', manual), 1);
    assert.equal(await call('WaitForMultipleObjects', 2, handles, 1, 0), 0);
    assert.equal(await call('WaitForMultipleObjects', 2, handles, 0, 0), 1);
    assert.equal(await call('WaitForSingleObject', auto, 0), waitTimeout);
    assert.equal(await call('WaitForSingleObjectEx', manual, 0, 0), 0);
    await call('SetEvent', auto);
    assert.equal(await call('WaitForMultipleObjects', 2, handles, 0, 0), 0);
    assert.equal(await call('WaitForSingleObject', auto, 0), waitTimeout);
    assert.equal(await call('ResetEvent', manual), 1);
    assert.equal(await call('WaitForSingleObject', manual, 2), waitTimeout);
    const pending = call('WaitForSingleObject', auto, 0xffffffff);
    await new Promise((resolve) => setImmediate(resolve));
    assert.equal(kernel.events.waiters.size, 1);
    assert.throws(() => engine.snapshot(), /queued native engine calls/);
    assert.equal(kernel.events.signal(auto, true), 1);
    assert.equal(await pending, 0);
    assert.equal(await call('WaitForSingleObject', auto, 0), waitTimeout);
    await call('SetEvent', manual);
    fresh = new NativeEngineProcess(unicorn);
    fresh.restore(engine.snapshot());
    const replay = api(fresh);
    assert.equal(await replay('WaitForSingleObject', manual, 0), 0);
    assert.equal(await replay('CloseHandle', manual), 1);
    assert.equal(await replay('WaitForSingleObject', manual, 0), waitFailed);
    assert.equal(await replay('GetLastError'), 6);
    assert.equal(await call('WaitForSingleObject', manual, 0), 0);
    assert.ok((await replay('CreateEventW', 0, 0, 0, 0)) > manual);
    p.store(handles + 4, auto);
    assert.equal(await call('WaitForMultipleObjects', 2, handles, 0, 0), waitFailed);
    assert.equal(await call('GetLastError'), 87);
    assert.equal(await call('CloseHandle', auto), 1);
    assert.equal(await call('SetEvent', auto), 0);
    assert.equal(await call('GetLastError'), 6);
    assert.equal(await call('CloseHandle', auto), 0);
    assert.equal(await call('CloseHandle', manual), 1);
    assert.equal(kernel.events.events.size, 0);
  } finally {
    await fresh?.close();
    await engine.close();
  }
});
