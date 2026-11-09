// SPDX-License-Identifier: MPL-2.0
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import { NativeEngineProcess } from '../src/native/engine-process.mjs';
import { loadUnicorn } from '../src/ppi/backend.mjs';

const api = (engine, name, ...args) =>
  engine.call(engine.resolve({ dll: 'kernel32.dll', name }), args);

function program(engine) {
  const bytes = [];
  const word = (value) => [value & 255, (value >>> 8) & 255, (value >>> 16) & 255, value >>> 24];
  return {
    call(name, ...args) {
      for (const value of args.reverse()) bytes.push(0x68, ...word(value));
      bytes.push(0xb8, ...word(engine.resolve({ dll: 'KERNEL32.dll', name })), 0xff, 0xd0);
    },
    store(pointer) {
      bytes.push(0xa3, ...word(pointer));
    },
    finish(worker) {
      bytes.push(...(worker ? [0xc2, 4, 0] : [0xc3]));
      const pointer = engine.process.allocate(bytes.length, true);
      engine.process.write(pointer, bytes);
      return pointer;
    },
  };
}

test(
  'Win32 thread handles wait on a parked x86 thread across a fresh process',
  { timeout: 15000 },
  async () => {
    const unicorn = await loadUnicorn(),
      engine = new NativeEngineProcess(unicorn),
      p = engine.process,
      call = (name, ...args) => api(engine, name, ...args),
      out = p.allocate(32, true),
      handles = p.allocate(8, true),
      lock = p.allocate(24, true);
    let fresh;
    try {
      const manual = await call('CreateEventW', 0, 1, 0, 0),
        automatic = await call('CreateEventW', 0, 0, 0, 0),
        index = await call('TlsAlloc');
      p.store(handles, manual);
      p.store(handles + 4, automatic);
      await call('TlsSetValue', index, 11);
      await call('InitializeCriticalSection', lock);
      await call('EnterCriticalSection', lock);

      const code = program(engine);
      code.call('GetCurrentThreadId');
      code.store(out + 4);
      code.call('TlsGetValue', index);
      code.store(out + 8);
      code.call('TlsSetValue', index, 22);
      code.call('SetLastError', 0x325);
      code.call('EnterCriticalSection', lock);
      code.call('LeaveCriticalSection', lock);
      code.call('WaitForMultipleObjects', 2, handles, 1, 0xffffffff);
      code.store(out + 12);
      code.call('GetLastError');
      code.store(out + 16);
      code.call('TlsGetValue', index);
      code.store(out + 20);
      code.call('ExitThread', 0x789);
      code.store(out + 24);
      const entry = code.finish(true),
        handle = await call('CreateThread', 0, 0, entry, 0, 4, out),
        id = p.load(out),
        worker = engine.kernel.threadHandles.threads.get(id);
      assert.notEqual(id, 1);
      assert.ok(handle);
      assert.equal(await call('GetThreadId', handle), id);
      assert.equal(p.load(out + 4), 0);
      assert.equal(await call('WaitForSingleObject', handle, 0), 0x102);
      assert.equal(await call('GetExitCodeThread', handle, out + 28), 1);
      assert.equal(p.load(out + 28), 259);
      assert.equal(await call('ResumeThread', handle), 1);
      assert.equal(worker.wait.kind, 'lock');
      assert.equal(p.load(out + 4), id);
      assert.equal(p.load(out + 8), 0);
      assert.equal(await call('TlsGetValue', index), 11);
      assert.equal(await call('SetEvent', manual), 1);
      await call('LeaveCriticalSection', lock);
      assert.equal(worker.wait.kind, 'objects');

      fresh = new NativeEngineProcess(unicorn);
      fresh.restore(engine.snapshot());
      const restored = (name, ...args) => api(fresh, name, ...args);
      const alternate = await restored('OpenThread', 0x100040, 0, id);
      assert.ok(alternate);
      assert.equal(await restored('CloseHandle', handle), 1);
      assert.equal(await restored('SetEvent', automatic), 1);
      assert.equal(await restored('WaitForSingleObject', alternate, 0), 0);
      assert.equal(await restored('GetExitCodeThread', alternate, out + 28), 1);
      assert.deepEqual(
        [12, 16, 20, 24, 28].map((offset) => fresh.process.load(out + offset)),
        [0, 0x325, 22, 0, 0x789],
      );
      assert.equal(await restored('WaitForSingleObject', automatic, 0), 0x102);
      assert.equal(await restored('WaitForSingleObject', manual, 0), 0);
      assert.equal(await restored('TlsGetValue', index), 11);
      assert.equal(await restored('CloseHandle', alternate), 1);
      assert.equal(fresh.kernel.threadHandles.threads.has(id), false);
      assert.equal(fresh.kernel.virtual.has(worker.context.teb), false);
      assert.equal(engine.kernel.virtual.has(worker.context.teb), true);
    } finally {
      await fresh?.close();
      await engine.close();
    }
  },
);

test(
  'a native parent wait runs the new x86 thread and wakes for its exit',
  { timeout: 15000 },
  async () => {
    const engine = new NativeEngineProcess(await loadUnicorn()),
      p = engine.process,
      out = p.allocate(8, true);
    try {
      const mutex = await api(engine, 'CreateMutexW', 0, 0, 0),
        worker = program(engine),
        parent = program(engine);
      worker.call('WaitForSingleObject', mutex, 0xffffffff);
      worker.call('Sleep', 3);
      worker.call('ExitThread', 42);
      const entry = worker.finish(true),
        wait = engine.resolve({ dll: 'KERNEL32.dll', name: 'WaitForSingleObject' });
      // The thread handle from CreateThread is the first WaitForSingleObject argument.
      parent.call('CreateThread', 0, 0, entry, 0, 0, out);
      parent.store(out + 4);
      const launch = parent.finish(false),
        main = p.allocate(32, true);
      p.write(
        main,
        [0xb8, 0, 0, 0, 0, 0xff, 0xd0, 0x6a, 0xff, 0x50, 0xb8, 0, 0, 0, 0, 0xff, 0xd0, 0xc3],
      );
      p.store(main + 1, launch);
      p.store(main + 11, wait);
      assert.equal(await engine.call(main), 0);
      assert.equal(await api(engine, 'WaitForSingleObject', mutex, 0), 0x80);
      assert.equal(await api(engine, 'ReleaseMutex', mutex), 1);
      assert.equal(await api(engine, 'GetExitCodeThread', p.load(out + 4), out), 1);
      assert.equal(p.load(out), 42);
    } finally {
      await engine.close();
    }
  },
);

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
