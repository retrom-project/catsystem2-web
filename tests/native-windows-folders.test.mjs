// SPDX-License-Identifier: MPL-2.0
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { NativeEngineProcess } from '../src/native/engine-process.mjs';

for (const [profile, variable, lookup, suffix] of [
  ['sdk-4.01-engine-2.6.1.74', 'CATSYSTEM2_SDK_EXE', 0x5784f0, 'A'],
  ['nekopara-vol3-engine-2.6.1.76', 'CATSYSTEM2_ENGINE_EXE', 0x6a80c0, 'W'],
])
  test(
    `${profile} original folder lookup writes paths in its mounted game drive`,
    { skip: !process.env[variable] },
    async () => {
      const bytes = new Uint8Array(await readFile(process.env[variable])),
        requested = [],
        make = () =>
          NativeEngineProcess.open({
            profile,
            bytes,
            listFiles: async () => [
              { name: 'mounted.txt', size: 1 },
              { name: '@cat/user/Profile/Documents/engine state.bin', size: 1 },
            ],
            readFile: async (name) => {
              requested.push(name);
              return name === '@cat/user/Profile/Documents/engine state.bin'
                ? Uint8Array.of(1)
                : null;
            },
          }),
        engine = await make(),
        { process: p } = engine,
        out = p.allocate(521, true),
        wide = suffix === 'W',
        path = 'C:\\catsystem2-web\\@cat\\user\\Profile',
        system = (dll, name) => engine.kernel.resolve({ dll, name: name + suffix }),
        attributes = system('KERNEL32.dll', 'GetFileAttributes'),
        folder = system('SHELL32.dll', 'SHGetFolderPath'),
        special = system('SHELL32.dll', 'SHGetSpecialFolderPath');
      let restored;
      try {
        for (const [id, name] of [
          [5, 'Documents'],
          [9, 'AppData\\Roaming'],
          [11, 'Pictures'],
        ]) {
          p.write(out + 520, Uint8Array.of(0xa7));
          assert.equal(await engine.call(lookup, [id, out, 0]), 1);
          assert.equal(p.string(out, wide), `${path}\\${name}`);
          assert.equal(await engine.call(attributes, [out]), 0x10);
          assert.equal(p.read(out + 520, 1)[0], 0xa7);
        }
        assert.equal(await engine.call(folder, [0, 0xc005, 0, 1, out]), 0);
        assert.equal(p.string(out, wide), `${path}\\Documents`);
        assert.equal(await engine.call(special, [0, out, 5, 1]), 1);
        assert.equal(await engine.call(folder, [0, 0xffff, 0, 0, out]), 0x80070057);
        assert.equal(p.string(out, wide), '');
        assert.equal(await engine.call(folder, [0, 5, 123, 0, out]), 0x80070057);
        assert.equal(p.string(out, wide), '');
        const windows = 'C:\\catsystem2-web\\@cat\\windows';
        assert.equal(await engine.call(lookup, [7, out, 0]), 1);
        assert.equal(p.string(out, wide), windows);
        for (const [api, directory] of [
          ['GetWindowsDirectory', windows],
          ['GetSystemDirectory', windows + '\\System32'],
        ]) {
          const address = system('KERNEL32.dll', api),
            canary = new Uint8Array(521).fill(0xa5),
            written = (directory.length + 1) * (wide ? 2 : 1);
          p.write(out, canary);
          assert.equal(await engine.call(address, [0, 0]), directory.length + 1);
          assert.equal(await engine.call(address, [out, directory.length]), directory.length + 1);
          assert.deepEqual(p.read(out, canary.length), canary);
          assert.equal(await engine.call(address, [out, directory.length + 1]), directory.length);
          assert.equal(p.string(out, wide), directory);
          assert.deepEqual(
            p.read(out + written, canary.length - written),
            canary.subarray(written),
          );
          assert.equal(await engine.call(attributes, [out]), 0x10);
        }

        restored = await make();
        restored.restore(engine.snapshot());
        assert.equal(await restored.call(lookup, [5, out, 0]), 1);
        const document = restored.process.string(out, wide);
        restored.kernel.writeString(out, document + '\\engine state.bin', wide);
        assert.equal(await restored.call(attributes, [out]), 0x80);
        assert.deepEqual(requested, ['@cat/user/Profile/Documents/engine state.bin']);

        const find = system('KERNEL32.dll', 'FindFirstFile'),
          next = system('KERNEL32.dll', 'FindNextFile'),
          close = restored.kernel.resolve({ dll: 'KERNEL32.dll', name: 'FindClose' }),
          data = restored.process.allocate(592, true);
        for (const [pattern, name] of [
          ['*', 'mounted.txt'],
          [document + '\\*', 'engine state.bin'],
        ]) {
          restored.kernel.writeString(out, pattern, wide);
          const handle = await restored.call(find, [out, data]);
          assert.notEqual(handle, 0xffffffff);
          assert.equal(restored.process.string(data + 44, wide), name);
          assert.equal(await restored.call(next, [handle, data]), 0);
          assert.equal(await restored.call(close, [handle]), 1);
        }
      } finally {
        await restored?.close();
        await engine.close();
      }
    },
  );
