// SPDX-License-Identifier: MPL-2.0
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { PE32Process } from '../src/ppi/pe32.mjs';
import { loadUnicorn } from '../src/ppi/backend.mjs';
import { NativeEngineWindows } from '../src/native/engine-process.mjs';
import { nativeFileTime } from '../src/native/file-time.mjs';
import { SaveSlotFiles } from './fixtures/save-slots-fixture.mjs';

async function fixture(files = new SaveSlotFiles()) {
  const p = new PE32Process(await loadUnicorn()),
    kernel = new NativeEngineWindows(p, {
      ...files.options(),
      statFile: async (name) => {
        const info = await files.stat(name);
        return info ? { ...info, shortName: files.files.get(name.toLowerCase())?.shortName } : null;
      },
      listFiles: async () =>
        [...files.files].map(([name, f]) => ({ ...f, name: f.name ?? name, size: f.bytes.length })),
    }),
    call = (name, args = []) => p.callAsync(kernel.resolve({ dll: 'KERNEL32.dll', name }), args);
  return { p, kernel, files, call };
}
test('Win32 A/W find handles enumerate native DOS patterns and full metadata, preserve failed outputs, and release independently', async () => {
  const golden = JSON.parse(
      await readFile(new URL('./fixtures/native-file-pattern-golden.json', import.meta.url)),
    ),
    { p, kernel, files, call } = await fixture(),
    source = p.allocate(256),
    out = p.allocate(600);
  try {
    for (const name of golden.names) {
      await files.write(name, Uint8Array.of(1, 2, 3));
      Object.assign(files.files.get(name.toLowerCase()), { name, shortName: golden.aliases[name] });
    }
    for (const row of golden.cases) {
      const suffix = row.wide ? 'W' : 'A',
        names = [];
      kernel.writeString(source, row.pattern, row.wide);
      p.write(out, new Uint8Array(600).fill(0xa5));
      const handle = await call(`FindFirstFile${suffix}`, [source, out]);
      if (!row.matches.length) {
        assert.equal(handle, 0xffffffff);
        assert.equal(kernel.lastError, 2);
        assert.deepEqual(p.read(out, 600), new Uint8Array(600).fill(0xa5));
        continue;
      }
      assert.notEqual(handle, 0xffffffff);
      do {
        const name = p.string(out + 44, row.wide);
        names.push(name);
        assert.equal(p.load(out), 0x80);
        assert.equal(p.load(out + 28), 0);
        assert.equal(p.load(out + 32), 3);
        assert.equal(
          new DataView(p.read(out + 20, 8).buffer).getBigUint64(0, true),
          nativeFileTime(files.time),
        );
        assert.equal(p.string(out + (row.wide ? 564 : 304), row.wide), golden.aliases[name] ?? '');
        assert.deepEqual(
          p.read(out + (row.wide ? 592 : 320), row.wide ? 8 : 280),
          new Uint8Array(row.wide ? 8 : 280).fill(0xa5),
        );
      } while (await call(`FindNextFile${suffix}`, [handle, out]));
      assert.deepEqual(names.sort(), row.matches, row.pattern);
      assert.equal(kernel.lastError, 18);
      assert.equal(await call('FindClose', [handle]), 1);
      const before = p.read(out, 600);
      assert.equal(await call(`FindNextFile${suffix}`, [handle, out]), 0);
      assert.equal(kernel.lastError, 6);
      assert.deepEqual(p.read(out, 600), before);
      assert.equal(await call('FindClose', [handle]), 0);
    }
  } finally {
    p.close();
  }
});

test('file mutation honors read-only/open handles and preserves copy, move and explicit times through a fresh platform checkpoint', async () => {
  const first = await fixture(),
    { p, kernel, files, call } = first,
    source = p.allocate(256),
    target = p.allocate(256),
    out = p.allocate(64),
    times = p.allocate(24);
  let fresh;
  const name = (at, text) => {
    kernel.writeString(at, text, true);
    return at;
  };
  try {
    assert.equal(await call('CreateDirectoryW', [name(source, 'Save'), 0]), 1);
    assert.equal(await call('CreateDirectoryW', [source, 0]), 0);
    assert.equal(kernel.lastError, 183);
    assert.equal(await call('GetFileAttributesW', [source]), 0x10);
    name(source, 'Save/one.dat');
    const handle = await call('CreateFileW', [source, 0xc0000000, 0, 0, 2, 0x80, 0]);
    assert.notEqual(handle, 0xffffffff);
    p.write(out, Uint8Array.of(8, 7, 6));
    assert.equal(await call('WriteFile', [handle, out, 3, out + 8, 0]), 1);
    assert.equal(p.load(out + 8), 3);
    for (let i = 0; i < 3; i++) kernel.write64(times + i * 8, nativeFileTime(1000 + i));
    assert.equal(await call('SetFileTime', [handle, times, times + 8, times + 16]), 1);
    assert.equal(await call('DeleteFileW', [source]), 0);
    assert.equal(kernel.lastError, 32);
    assert.equal(await call('SetErrorMode', [0x8003]), 0);
    const snapshot = { process: p.snapshot(), kernel: kernel.snapshot() };
    fresh = await fixture(files);
    fresh.p.nextTrap = snapshot.process.nextTrap;
    for (const trap of snapshot.process.traps)
      if (fresh.p.traps.get(trap.address)?.name !== trap.name) {
        const entry = fresh.kernel.recoverTrap(trap);
        assert.ok(entry, trap.name);
        fresh.p.defineTrap(
          trap.address,
          trap.name,
          entry.args,
          entry.handler,
          entry.real,
          entry.resultAddress,
        );
      }
    fresh.p.restore(snapshot.process);
    fresh.kernel.restore(snapshot.kernel);
    assert.equal(await fresh.call('GetErrorMode'), 0x8003);
    assert.equal(await fresh.call('GetFileTime', [handle, out, out + 8, out + 16]), 1);
    for (let i = 0; i < 3; i++)
      assert.equal(
        new DataView(fresh.p.read(out + i * 8, 8).buffer).getBigUint64(0, true),
        nativeFileTime(1000 + i),
      );
    assert.equal(await fresh.call('CloseHandle', [handle]), 1);
    assert.deepEqual(await files.read('save/one.dat'), Uint8Array.of(8, 7, 6));
    assert.deepEqual(await files.stat('save/one.dat'), {
      createdMs: 1000,
      accessedMs: 1001,
      modifiedMs: 1002,
      attributes: 0x80,
    });
    fresh.kernel.writeString(target, 'save/copied.dat', true);
    assert.equal(await fresh.call('CopyFileW', [source, target, 1]), 1);
    assert.equal((await files.stat('save/copied.dat')).modifiedMs, 1002);
    assert.equal(await fresh.call('CopyFileW', [source, target, 1]), 0);
    assert.equal(fresh.kernel.lastError, 80);
    assert.equal(await fresh.call('SetFileAttributesW', [target, 1]), 1);
    assert.equal(await fresh.call('DeleteFileW', [target]), 0);
    assert.equal(fresh.kernel.lastError, 5);
    assert.equal(
      await fresh.call('CreateFileW', [target, 0x40000000, 0, 0, 2, 0x80, 0]),
      0xffffffff,
    );
    assert.equal(fresh.kernel.lastError, 5);
    assert.equal(await fresh.call('CopyFileW', [source, target, 0]), 0);
    assert.equal(fresh.kernel.lastError, 5);
    assert.equal(await fresh.call('SetFileAttributesW', [target, 0x80]), 1);
    assert.equal(await fresh.call('DeleteFileW', [target]), 1);
    fresh.kernel.writeString(target, 'save/moved.dat', true);
    assert.equal(await fresh.call('MoveFileW', [source, target]), 1);
    assert.equal(await files.read('save/one.dat'), null);
    assert.deepEqual(await files.stat('save/moved.dat'), {
      createdMs: 1000,
      accessedMs: 1001,
      modifiedMs: 1002,
      attributes: 0x80,
    });
    assert.equal(await fresh.call('MoveFileW', [source, target]), 0);
    assert.equal(fresh.kernel.lastError, 2);
    assert.equal(await fresh.call('GetFileAttributesW', [source]), 0xffffffff);
  } finally {
    fresh?.p.close();
    p.close();
  }
});

test('virtual drive quota comes from its provider, preserves 64-bit values and fails without inventing free space', async () => {
  const { p, kernel, call } = await fixture(),
    out = p.allocate(40),
    space = {
      availableBytes: 6 * 1024 ** 3 + 17,
      totalBytes: 16 * 1024 ** 3 + 31,
      freeBytes: 8 * 1024 ** 3 + 53,
    };
  try {
    kernel.diskSpace = async () => space;
    p.write(out, new Uint8Array(40).fill(0xa5));
    assert.equal(await call('GetDiskFreeSpaceExW', [0, out, out + 8, out + 16]), 1);
    for (const [i, n] of Object.values(space).entries())
      assert.equal(new DataView(p.read(out + i * 8, 8).buffer).getBigUint64(0, true), BigInt(n));
    assert.deepEqual(p.read(out + 24, 16), new Uint8Array(16).fill(0xa5));
    assert.equal(await call('GetDiskFreeSpaceW', [0, out, out + 4, out + 8, out + 12]), 1);
    assert.deepEqual(
      [0, 4, 8, 12].map((at) => p.load(out + at)),
      [8, 512, Math.floor(space.availableBytes / 4096), Math.floor(space.totalBytes / 4096)],
    );
    assert.equal(await call('GetLogicalDrives'), 4);
    assert.equal(await call('GetLogicalDriveStringsW', [5, out]), 4);
    assert.deepEqual([...p.read(out, 10)], [67, 0, 58, 0, 92, 0, 0, 0, 0, 0]);
    kernel.diskSpace = async () => null;
    p.write(out, new Uint8Array(40).fill(0xa5));
    assert.equal(await call('GetDiskFreeSpaceExW', [0, out, out + 8, out + 16]), 0);
    assert.equal(kernel.lastError, 50);
    assert.deepEqual(p.read(out, 40), new Uint8Array(40).fill(0xa5));
  } finally {
    p.close();
  }
});
