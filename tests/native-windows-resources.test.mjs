// SPDX-License-Identifier: MPL-2.0
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import { NativeEngineProcess } from '../src/native/engine-process.mjs';
import { NativeEngineWindows } from '../src/native/windows-services.mjs';
import { readPEVersionResource } from '../src/native/profile.mjs';
import { installNativeResourceAPIs } from '../src/native/windows-resources.mjs';
import { loadUnicorn } from '../src/ppi/backend.mjs';
import { PE32Process } from '../src/ppi/pe32.mjs';
import { resourcePE } from './fixtures/pe-resources.mjs';

const dll = 'kernel32.dll';
function resourceImports(p, kernel) {
  return (name, ...args) => p.call(kernel.resolve({ dll, name }), args);
}

test('PE resources preserve lookup language, mapped pointers and module ownership after restore', async () => {
  const unicorn = await loadUnicorn(),
    make = () => {
      const p = new PE32Process(unicorn),
        kernel = new NativeEngineWindows(p),
        bytes = resourcePE(),
        main = resourcePE();
      new DataView(main.buffer).setUint32(0x98 + 28, 0x400000, true);
      installNativeResourceAPIs(kernel, () => 0x409);
      p.loadModule(main, () => 0, 'test.exe');
      const { base } = p.loadModule(bytes, () => 0, 'test.dll');
      return { p, kernel, base, call: resourceImports(p, kernel) };
    },
    { p, kernel, base, call } = make(),
    text = (value, wide = false) => {
      const ptr = p.allocate(32);
      kernel.writeString(ptr, value, wide);
      return ptr;
    };
  let fresh;
  try {
    const name = text('日本'),
      nameW = text('日本', true),
      type = text('cuSTom'),
      typeW = text('CUSTOM', true),
      allocations = p.allocations.size,
      find = (language) => call('FindResourceExW', base, typeW, nameW, language),
      english = call('FindResourceA', base, name, type),
      japanese = find(0x411),
      read = (module, resource) => {
        const size = call('SizeofResource', module, resource),
          address = call('LockResource', call('LoadResource', module, resource));
        assert.ok(address);
        return new TextDecoder().decode(p.read(address, size));
      };
    assert.notEqual(english, japanese);
    assert.equal(find(0x409), english);
    assert.equal(read(base, english), 'English');
    assert.equal(read(base, japanese), 'Japanese');
    assert.equal(read(base, find(0x809)), 'English neutral');
    assert.equal(find(0x407), 0);
    assert.equal(kernel.lastError, 1815);
    assert.equal(read(0, call('FindResourceA', 0, 50, 10)), 'Neutral');
    assert.equal(read(0, call('FindResourceW', 0, 51, 10)), 'Portuguese');
    assert.equal(call('LoadResource', 0, english), 0, 'resource belongs to the other module');
    assert.equal(call('LockResource', english), 0, 'a directory handle is not a payload');
    assert.equal(p.allocations.size, allocations);
    const decimalName = text('#50'),
      decimalType = text('#10');
    assert.equal(
      call('FindResourceA', base, decimalName, decimalType),
      call('FindResourceA', base, 50, 10),
    );
    assert.equal(call('FindResourceA', base, 123, 10), 0);
    assert.equal(kernel.lastError, 1814);
    assert.equal(call('FindResourceA', base, 50, 666), 0);
    assert.equal(kernel.lastError, 1813);

    const address = call('LoadResource', base, japanese);
    assert.equal(call('FreeResource', address), 0);
    assert.equal(call('LockResource', address), address);
    fresh = make();
    fresh.p.restore(p.snapshot());
    fresh.kernel.restore(kernel.snapshot());
    assert.equal(fresh.call('FindResourceExW', base, typeW, nameW, 0x411), japanese);
    assert.equal(fresh.call('LoadResource', base, japanese), address);
    assert.equal(fresh.call('LockResource', address), address);
    assert.equal(
      new TextDecoder().decode(fresh.p.read(address, fresh.call('SizeofResource', base, japanese))),
      'Japanese',
    );
  } finally {
    fresh?.p.close();
    p.close();
  }
});

for (const [profile, variable, suffix] of [
  ['sdk-4.01-engine-2.6.1.74', 'CATSYSTEM2_SDK_EXE', 'A'],
  ['nekopara-vol3-engine-2.6.1.76', 'CATSYSTEM2_ENGINE_EXE', 'W'],
])
  test(
    `${profile} resolves its actual PE resource imports without copying the payload`,
    { skip: !process.env[variable] },
    async () => {
      const bytes = new Uint8Array(await readFile(process.env[variable])),
        engine = await NativeEngineProcess.open({ profile, bytes }),
        p = engine.process,
        imports = engine.module.pe.imports,
        call = (name, ...args) => {
          const iat = imports.find(
            (entry) => entry.name === name && entry.dll.toLowerCase() === dll,
          );
          assert.ok(iat, name);
          return p.call(p.load(engine.module.base + iat.address), args);
        },
        key = p.allocate(64),
        type = p.allocate(64);
      try {
        const name = 'FindResource' + suffix,
          wide = suffix === 'W',
          version = call(name, 0, 1, 16),
          pointer = call('LoadResource', 0, version),
          size = call('SizeofResource', 0, version);
        assert.ok(version && pointer && size);
        assert.equal(call('FreeResource', pointer), 0);
        assert.equal(call('LockResource', pointer), pointer);
        assert.deepEqual(p.read(pointer, size), readPEVersionResource(bytes));
        for (const [kind, entry, expectedBytes] of [
          ['key_code', 'key', 8],
          ['V_CODE', 'DATA', 16],
          ['V_CODE2', 'DATA', 16],
        ]) {
          engine.kernel.writeString(key, entry, wide);
          engine.kernel.writeString(type, kind, wide);
          const info = call(name, 0, key, type),
            address = call('LoadResource', engine.module.base, info);
          assert.equal(call('SizeofResource', 0, info), expectedBytes);
          assert.equal(call('LockResource', address), address);
          assert.equal(p.addressOf(p.view(address, expectedBytes)), address);
          assert.equal(call(name, engine.module.base, key, type), info);
        }
      } finally {
        await engine.close();
      }
    },
  );
