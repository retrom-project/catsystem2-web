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

test('named mutex handles share ownership through the native wait APIs and fresh restore', async () => {
  const unicorn = await loadUnicorn(),
    engine = new NativeEngineProcess(unicorn),
    { process: p, kernel } = engine,
    call = api(engine),
    ansi = p.allocate(64, true),
    wide = p.allocate(128, true);
  kernel.writeString(ansi, '起動 mutex');
  kernel.writeString(wide, '起動 mutex', true);
  let fresh;
  try {
    const first = await call('CreateMutexA', 0, 0, ansi),
      other = await call('CreateMutexW', 0, 1, wide);
    assert.ok(first && other && first !== other);
    assert.equal(await call('GetLastError'), 183);
    assert.equal(
      await call('ReleaseMutex', other),
      0,
      'opening an existing mutex ignores initial owner',
    );
    assert.equal(await call('GetLastError'), 288);
    assert.equal(await call('WaitForSingleObject', first, 0), 0);
    assert.equal(await call('WaitForSingleObject', other, 0), 0);
    assert.equal(await call('SetEvent', other), 0);
    assert.equal(await call('GetLastError'), 6);
    assert.equal(await call('CloseHandle', first), 1);
    fresh = new NativeEngineProcess(unicorn);
    fresh.restore(engine.snapshot());
    const replay = api(fresh);
    assert.equal(await replay('ReleaseMutex', other), 1);
    const duplicate = await replay('CreateMutexA', 0, 0, ansi);
    assert.equal(await replay('GetLastError'), 183);
    assert.equal(await replay('ReleaseMutex', duplicate), 1);
    assert.equal(await replay('ReleaseMutex', other), 0);
    assert.equal(await replay('GetLastError'), 288);
    assert.equal(await replay('CloseHandle', duplicate), 1);
    assert.equal(await replay('CloseHandle', other), 1);
    assert.ok(await replay('CreateMutexW', 0, 1, wide));
    assert.equal(
      await replay('GetLastError'),
      0,
      'the name is available after its last handle closes',
    );
  } finally {
    await fresh?.close();
    await engine.close();
  }
});

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

test('named auto-reset events share state and enforce handle access after restore', async () => {
  const unicorn = await loadUnicorn(),
    engine = new NativeEngineProcess(unicorn),
    { process: p, kernel } = engine,
    call = api(engine),
    ansi = p.allocate(64),
    wide = p.allocate(128),
    otherCase = p.allocate(128);
  kernel.writeString(ansi, 'CoreSystem2ConfigEvent');
  kernel.writeString(wide, 'CoreSystem2ConfigEvent', true);
  kernel.writeString(otherCase, 'coresystem2configevent', true);
  let fresh;
  try {
    const first = await call('CreateEventA', 0, 0, 0, ansi),
      duplicate = await call('CreateEventW', 0, 1, 1, wide);
    assert.ok(first && duplicate && first !== duplicate);
    assert.equal(await call('GetLastError'), 183);
    assert.equal(await call('WaitForSingleObject', duplicate, 0), waitTimeout);
    assert.equal(await call('CreateMutexW', 0, 0, wide), 0);
    assert.equal(await call('GetLastError'), 6);
    assert.equal(await call('OpenEventW', 0x100000, 0, otherCase), 0);
    assert.equal(await call('GetLastError'), 2);

    const wait = await call('OpenEventW', 0x100000, 0, wide),
      signal = await call('OpenEventA', 2, 0, ansi);
    assert.equal(await call('SetEvent', wait), 0);
    assert.equal(await call('GetLastError'), 5);
    assert.equal(await call('WaitForSingleObject', signal, 0), waitFailed);
    assert.equal(await call('GetLastError'), 5);
    assert.equal(await call('SetEvent', signal), 1);
    assert.equal(await call('CloseHandle', first), 1);
    assert.equal(await call('CloseHandle', duplicate), 1);

    fresh = new NativeEngineProcess(unicorn);
    fresh.restore(engine.snapshot());
    const replay = api(fresh);
    assert.equal(await replay('WaitForSingleObject', wait, 0), 0);
    assert.equal(await replay('WaitForSingleObject', wait, 0), waitTimeout);
    assert.equal(await replay('CloseHandle', signal), 1);
    assert.equal(await replay('CloseHandle', wait), 1);
    assert.equal(await replay('OpenEventW', 0x100000, 0, wide), 0);
    assert.equal(await replay('GetLastError'), 2);
    assert.equal(await call('WaitForSingleObject', wait, 0), 0);
  } finally {
    await fresh?.close();
    await engine.close();
  }
});
