// SPDX-License-Identifier: MPL-2.0
import assert from 'node:assert/strict';
import test from 'node:test';
import { NativeEngineProcess } from '../oracle/engine-process.mjs';
import { loadUnicorn } from '../oracle/ppi-backend.mjs';

const api = (engine, name, ...args) =>
  engine.call(engine.resolve({ dll: 'kernel32.dll', name }), args);

test('virtual thread priorities select actual guest dispatch and survive independent cold', async () => {
  const unicorn = await loadUnicorn();
  let engine = new NativeEngineProcess(unicorn);
  const p = engine.process,
    journal = p.allocate(16, true),
    cursor = p.allocate(4, true),
    workers = [];
  try {
    for (const [tag, priority] of [
      [11, 0],
      [22, -1],
      [33, 1],
      [44, 1],
    ]) {
      const code = p.allocate(64, true),
        bytes = Buffer.from([
          0xa1,
          0,
          0,
          0,
          0, // mov eax,[cursor]
          0xc7,
          0x04,
          0x85,
          0,
          0,
          0,
          0,
          0,
          0,
          0,
          0, // mov [eax*4+journal],tag
          0x40, // inc eax
          0xa3,
          0,
          0,
          0,
          0, // mov [cursor],eax
          0x31,
          0xc0,
          0xc2,
          4,
          0,
        ]);
      bytes.writeUInt32LE(cursor, 1);
      bytes.writeUInt32LE(journal, 8);
      bytes.writeUInt32LE(tag, 12);
      bytes.writeUInt32LE(cursor, 18);
      p.write(code, bytes);
      const handle = await api(engine, 'CreateThread', 0, 0, code, 0, 4, 0);
      assert(handle);
      assert.equal(await api(engine, 'SetThreadPriority', handle, priority >>> 0), 1);
      workers.push(handle);
    }
    assert.equal(await api(engine, 'SetThreadPriority', 0xfffffffe, 2), 1);
    const snapshot = engine.snapshot();
    await engine.close();
    engine = new NativeEngineProcess(unicorn);
    engine.restore(snapshot);
    assert.equal(engine.kernel.threadHandles.mainPriority, 2);
    const resume = engine.resolve({ dll: 'kernel32.dll', name: 'ResumeThread' }),
      launch = engine.process.allocate(workers.length * 12 + 1, true),
      instructions = Buffer.alloc(workers.length * 12 + 1);
    for (const [i, handle] of workers.entries()) {
      instructions[i * 12] = 0x68;
      instructions.writeUInt32LE(handle, i * 12 + 1);
      instructions[i * 12 + 5] = 0xb8;
      instructions.writeUInt32LE(resume, i * 12 + 6);
      instructions.set([0xff, 0xd0], i * 12 + 10);
    }
    instructions[instructions.length - 1] = 0xc3;
    engine.process.write(launch, instructions);
    assert.equal(await engine.call(launch), 1);
    await engine.kernel.threadHandles.pump();
    assert.deepEqual(
      Array.from({ length: 4 }, (_, i) => engine.process.load(journal + 4 * i)),
      [33, 44, 11, 22],
    );
    for (const handle of workers) {
      assert.equal(await api(engine, 'WaitForSingleObject', handle, 0), 0);
      assert.equal(await api(engine, 'CloseHandle', handle), 1);
    }
    assert.equal(engine.kernel.threadHandles.threads.size, 0);
  } finally {
    await engine.close();
  }
});

test('virtual priority mutation preserves handle rights, invalid domains and independent aliases', async () => {
  const engine = new NativeEngineProcess(await loadUnicorn());
  try {
    const code = engine.process.allocate(4, true);
    engine.process.write(code, Uint8Array.of(0xc2, 4, 0));
    const handle = await api(engine, 'CreateThread', 0, 0, code, 0, 4, 0),
      id = await api(engine, 'GetThreadId', handle),
      query = await api(engine, 'OpenThread', 0x40, 0, id),
      setter = await api(engine, 'OpenThread', 0x400, 0, id),
      state = engine.kernel.threadHandles.threads.get(id);
    assert.equal(state.priority, 0);
    assert.equal(await api(engine, 'SetThreadPriority', query, 1), 0);
    assert.equal(await api(engine, 'GetLastError'), 5);
    assert.equal(await api(engine, 'SetThreadPriority', setter, 1), 1);
    assert.equal(state.priority, 1);
    assert.equal(await api(engine, 'SetThreadPriority', setter, 3), 0);
    assert.equal(await api(engine, 'GetLastError'), 87);
    assert.equal(state.priority, 1);
    const invalid = structuredClone(engine.snapshot());
    invalid.kernel.threadHandles.threads[0][1].priority = 3;
    assert.throws(() => engine.restore(invalid), /virtual thread checkpoint/);
    assert.equal(await api(engine, 'CloseHandle', setter), 1);
    assert.equal(await api(engine, 'SetThreadPriority', setter, 1), 0);
    assert.equal(await api(engine, 'GetLastError'), 6);
    assert.equal(state.priority, 1);
  } finally {
    await engine.close();
  }
});
