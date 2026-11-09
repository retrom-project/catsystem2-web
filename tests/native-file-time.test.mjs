// SPDX-License-Identifier: MPL-2.0
import test from 'node:test';
import assert from 'node:assert/strict';
import { PE32Process } from '../src/ppi/pe32.mjs';
import { loadUnicorn } from '../src/ppi/backend.mjs';
import { NativeEngineWindows } from '../src/native/windows-services.mjs';
import { nativeFileTime, nativeSystemTime } from '../src/native/file-time.mjs';

test('FILETIME epoch, submillisecond truncation and signed-limit rejection retain Win32 calendar fields', () => {
  assert.equal(nativeFileTime(0), 116444736000000000n);
  assert.deepEqual(nativeSystemTime(0n), [1601, 1, 1, 1, 0, 0, 0, 0]);
  assert.deepEqual(nativeSystemTime(9999n), [1601, 1, 1, 1, 0, 0, 0, 0]);
  assert.deepEqual(nativeSystemTime(10000n), [1601, 1, 1, 1, 0, 0, 0, 1]);
  assert.deepEqual(nativeSystemTime(nativeFileTime(-1)), [1969, 12, 3, 31, 23, 59, 59, 999]);
  assert.equal(nativeSystemTime(0x8000000000000000n), null);
  assert.equal(nativeFileTime(NaN), null);
});
async function fixture(options = {}) {
  const p = new PE32Process(await loadUnicorn()),
    kernel = new NativeEngineWindows(p, options),
    call = (name, args) => p.callAsync(kernel.resolve({ dll: 'KERNEL32.dll', name }), args);
  return { p, kernel, call };
}
test('native file handles read real provider metadata and fail atomically for missing fields or released handles', async () => {
  const { p, kernel, call } = await fixture({ statFile: async () => ({ modifiedMs: 0 }) }),
    out = p.allocate(32),
    handle = 0x50000001;
  kernel.files.set(handle, {
    path: 'save/one.dat',
    bytes: Uint8Array.of(1),
    position: 0,
    writable: false,
    dirty: false,
  });
  try {
    p.write(out, new Uint8Array(32).fill(0xa5));
    assert.equal(await call('GetFileTime', [handle, 0, 0, out + 8]), 1);
    const result = p.read(out, 32),
      expected = new Uint8Array(32).fill(0xa5);
    new DataView(expected.buffer).setBigUint64(8, 116444736000000000n, true);
    assert.deepEqual(result, expected);
    p.write(out, new Uint8Array(32).fill(0xa5));
    assert.equal(await call('GetFileTime', [handle, out, out + 8, out + 16]), 0);
    assert.equal(kernel.lastError, 50);
    assert.deepEqual(p.read(out, 32), new Uint8Array(32).fill(0xa5));
    kernel.registerFiles('authored metadata', {
      stat: async (path) =>
        path === 'save/one.dat' ? { createdMs: 0, accessedMs: 1, modifiedMs: 2 } : undefined,
    });
    assert.equal(await call('GetFileTime', [handle, out, out + 8, out + 16]), 1);
    assert.deepEqual(
      [0, 8, 16].map((at) => new DataView(p.read(out + at, 8).buffer).getBigUint64(0, true)),
      [116444736000000000n, 116444736000010000n, 116444736000020000n],
    );
    assert.equal(await call('CloseHandle', [handle]), 1);
    p.write(out, new Uint8Array(32).fill(0xa5));
    assert.equal(await call('GetFileTime', [handle, 0, 0, out]), 0);
    assert.equal(kernel.lastError, 6);
    assert.deepEqual(p.read(out, 32), new Uint8Array(32).fill(0xa5));
  } finally {
    p.close();
  }
});
test('FILETIME local conversion uses the current supplied timezone and preserves 100-ns remainder and output canaries', async () => {
  let offset = 480;
  const { p, call } = await fixture({ localOffsetMinutes: () => offset }),
    input = p.allocate(8),
    local = p.allocate(8),
    back = p.allocate(8),
    system = p.allocate(20),
    time = 116444736000000123n;
  const write = (at, n) => {
      const b = new Uint8Array(8);
      new DataView(b.buffer).setBigUint64(0, n, true);
      p.write(at, b);
    },
    read = (at) => new DataView(p.read(at, 8).buffer).getBigUint64(0, true);
  try {
    write(input, time);
    p.write(system, new Uint8Array(20).fill(0xa5));
    assert.equal(await call('FileTimeToLocalFileTime', [input, local]), 1);
    assert.equal(read(local), time + 288000000000n);
    assert.equal(await call('FileTimeToSystemTime', [local, system]), 1);
    const words = new DataView(p.read(system, 20).buffer);
    assert.deepEqual(
      Array.from({ length: 8 }, (_, i) => words.getUint16(i * 2, true)),
      [1970, 1, 4, 1, 8, 0, 0, 0],
    );
    assert.deepEqual([...p.read(system + 16, 4)], [165, 165, 165, 165]);
    assert.equal(await call('LocalFileTimeToFileTime', [local, back]), 1);
    assert.equal(read(back), time);
    offset = -240;
    assert.equal(await call('FileTimeToLocalFileTime', [input, local]), 1);
    assert.equal(read(local), time - 144000000000n);
    write(input, 0x8000000000000000n);
    write(back, 123n);
    assert.equal(await call('FileTimeToSystemTime', [input, back]), 0);
    assert.equal(read(back), 123n);
  } finally {
    p.close();
  }
});
test('SYSTEMTIME conversion ignores weekday, accepts Gregorian leap day and rejects normalized invalid dates without touching output', async () => {
  const { p, call } = await fixture(),
    input = p.allocate(16),
    out = p.allocate(8),
    words = [2000, 2, 65535, 29, 12, 34, 56, 789];
  const set = () => {
    const b = new Uint8Array(16),
      v = new DataView(b.buffer);
    words.forEach((n, i) => v.setUint16(i * 2, n, true));
    p.write(input, b);
  };
  try {
    set();
    assert.equal(await call('SystemTimeToFileTime', [input, out]), 1);
    const time = new DataView(p.read(out, 8).buffer).getBigUint64(0, true);
    assert.equal(time, 125963012967890000n);
    for (const [index, value] of [
      [0, 1900],
      [1, 13],
      [3, 30],
      [4, 24],
      [7, 1000],
    ]) {
      const old = words[index];
      words[index] = value;
      set();
      p.write(out, new Uint8Array(8).fill(0xa5));
      assert.equal(await call('SystemTimeToFileTime', [input, out]), 0);
      assert.deepEqual(p.read(out, 8), new Uint8Array(8).fill(0xa5));
      words[index] = old;
    }
  } finally {
    p.close();
  }
});
