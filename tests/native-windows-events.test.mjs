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

test('unnamed semaphores count successful waits and restore independently of events', async () => {
  const unicorn = await loadUnicorn(),
    engine = new NativeEngineProcess(unicorn),
    { process: p, kernel } = engine,
    call = api(engine),
    previous = p.allocate(4),
    handles = p.allocate(8);
  let fresh;
  try {
    for (const name of ['CreateSemaphoreA', 'CreateSemaphoreW']) {
      for (const [initial, max] of [
        [0, 0],
        [0xffffffff, 1],
        [2, 1],
      ]) {
        assert.equal(await call(name, 0, initial, max, 0), 0);
        assert.equal(await call('GetLastError'), 87);
      }
    }
    const semaphore = await call('CreateSemaphoreA', 0, 1, 3, 0),
      event = await call('CreateEventW', 0, 0, 0, 0);
    p.store(handles, semaphore);
    p.store(handles + 4, event);
    assert.equal(await call('WaitForMultipleObjects', 2, handles, 1, 0), waitTimeout);
    assert.equal(await call('SetEvent', event), 1);
    assert.equal(await call('WaitForMultipleObjects', 2, handles, 1, 0), 0);
    assert.equal(await call('WaitForSingleObject', event, 0), waitTimeout);
    assert.equal(await call('WaitForSingleObject', semaphore, 0), waitTimeout);
    const pending = call('WaitForSingleObject', semaphore, 0xffffffff);
    await new Promise((resolve) => setImmediate(resolve));
    assert.equal(kernel.events.waiters.size, 1);
    assert.equal(kernel.events.release(semaphore, 2, previous), 1);
    assert.equal(await pending, 0);
    assert.equal(p.load(previous), 0);
    assert.equal(await call('ReleaseSemaphore', semaphore, 1, previous), 1);
    assert.equal(p.load(previous), 1);
    p.store(previous, 0xaaaaaaaa);
    for (const [handle, count, error] of [
      [semaphore, 2, 298],
      [semaphore, 0, 87],
      [event, 1, 6],
    ]) {
      assert.equal(await call('ReleaseSemaphore', handle, count, previous), 0);
      assert.equal(await call('GetLastError'), error);
      assert.equal(p.load(previous), 0xaaaaaaaa);
    }
    assert.equal(await call('SetEvent', semaphore), 0);
    assert.equal(await call('GetLastError'), 6);
    fresh = new NativeEngineProcess(unicorn);
    fresh.restore(engine.snapshot());
    const replay = api(fresh);
    assert.equal(await replay('WaitForMultipleObjects', 2, handles, 0, 0), 0);
    assert.equal(await replay('WaitForSingleObjectEx', semaphore, 0, 0), 0);
    assert.equal(await replay('WaitForSingleObject', semaphore, 0), waitTimeout);
    assert.equal(await replay('CloseHandle', semaphore), 1);
    assert.equal(await replay('ReleaseSemaphore', semaphore, 1, previous), 0);
    assert.equal(await replay('GetLastError'), 6);
    assert.equal(await call('ReleaseSemaphore', semaphore, 1, previous), 1);
    assert.equal(p.load(previous), 2);
  } finally {
    await fresh?.close();
    await engine.close();
  }
});
