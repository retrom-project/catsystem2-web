// SPDX-License-Identifier: MPL-2.0
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import { NativeEngineProcess, NativeEngineWindows } from '../src/native/engine-process.mjs';
import { loadUnicorn } from '../src/ppi/backend.mjs';
import { PE32Process } from '../src/ppi/pe32.mjs';

const dll = 'kernel32.dll',
  resolve = (kernel, name) => kernel.resolve({ dll, name });

test('virtual volume queries honor ANSI and wide capacities and independent optional outputs', async () => {
  const p = new PE32Process(await loadUnicorn()),
    kernel = new NativeEngineWindows(p),
    root = p.allocate(64, true),
    out = p.allocate(80, true),
    fs = out + 8,
    serial = out + 48,
    max = out + 52,
    flags = out + 56,
    canary = new Uint8Array(80).fill(0xa5),
    untouched = 0xa5a5a5a5;
  try {
    for (const suffix of ['A', 'W']) {
      const wide = suffix === 'W',
        width = wide ? 2 : 1,
        api = resolve(kernel, 'GetVolumeInformation' + suffix),
        call = (root, labelCapacity = 1, fsCapacity = 7) =>
          p.call(api, [root, out, labelCapacity, serial, max, flags, fs, fsCapacity]);
      for (const path of [null, 'C:\\', 'c:/', '\\\\?\\c:\\']) {
        if (path !== null) kernel.writeString(root, path, wide);
        p.write(out, canary);
        p.call(resolve(kernel, 'SetLastError'), [0x55aa]);
        assert.equal(call(path === null ? 0 : root), 1);
        assert.equal(p.string(out, wide), '');
        assert.equal(p.string(fs, wide), 'CatVFS');
        assert.equal(p.read(out + width, 1)[0], 0xa5);
        assert.equal(p.read(fs + 7 * width, 1)[0], 0xa5);
        assert.equal(p.load(serial), 0x43533200);
        assert.equal(p.load(max), 255);
        assert.equal(p.load(flags), 6);
        assert.equal(p.call(resolve(kernel, 'GetLastError'), []), 0x55aa);
      }
      for (const [path, error] of [
        ['', 3],
        ['Q:\\', 3],
        ['C:\\catsystem2-web\\', 144],
        ['windows', 123],
      ]) {
        kernel.writeString(root, path, wide);
        p.write(out, canary);
        assert.equal(call(root), 0);
        assert.equal(kernel.lastError, error);
        assert.deepEqual(p.read(out, 80), canary);
      }
      assert.equal(call(0, 0), 0);
      assert.equal(kernel.lastError, 24);
      assert.deepEqual(p.read(out, 80), canary);
      assert.equal(call(0, 1, 6), 0);
      assert.equal(kernel.lastError, 24);
      assert.deepEqual(p.read(out, 2), wide ? Uint8Array.of(0, 0) : canary.subarray(0, 2));
      assert.deepEqual(p.read(fs, 14), canary.subarray(8, 22));
      assert.equal(p.load(serial), 0x43533200);
      assert.equal(p.load(max), untouched);
      assert.equal(p.load(flags), untouched);
      assert.equal(p.call(api, [0, 0, 0, serial, 0, 0, 0, 0]), 1);
    }
  } finally {
    p.close();
  }
});

for (const [profile, variable, suffix, iat] of [
  ['sdk-4.01-engine-2.6.1.74', 'CATSYSTEM2_SDK_EXE', 'A', 0x98e23c],
  ['nekopara-vol3-engine-2.6.1.76', 'CATSYSTEM2_ENGINE_EXE', 'W', 0x8c62c8],
])
  test(
    `${profile} imports volume information for its Windows directory drive`,
    {
      skip: !process.env[variable],
    },
    async () => {
      const bytes = new Uint8Array(await readFile(process.env[variable])),
        engine = await NativeEngineProcess.open({ profile, bytes }),
        { process: p, kernel } = engine,
        wide = suffix === 'W',
        root = p.allocate(520, true),
        serial = p.allocate(4, true);
      try {
        assert.ok(p.call(resolve(kernel, 'GetWindowsDirectory' + suffix), [root, 260]));
        p.zero(root + (wide ? 6 : 3), wide ? 2 : 1);
        assert.equal(p.string(root, wide), 'C:\\');
        assert.equal(p.load(iat), resolve(kernel, 'GetVolumeInformation' + suffix));
        assert.equal(p.call(p.load(iat), [root, 0, 0, serial, 0, 0, 0, 0]), 1);
        assert.equal(p.load(serial), 0x43533200);
      } finally {
        await engine.close();
      }
    },
  );
