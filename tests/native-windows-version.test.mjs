// SPDX-License-Identifier: MPL-2.0
import test from 'node:test';
import assert from 'node:assert/strict';
import { encodeCP932 } from '../src/kcs/strings.mjs';
import { NativeEngineWindows } from '../src/native/windows-services.mjs';
import { installNativeVersionAPIs } from '../src/native/windows-version.mjs';
import { loadUnicorn } from '../src/ppi/backend.mjs';
import { PE32Process } from '../src/ppi/pe32.mjs';
import { u32 } from './helpers.mjs';

const word = (n) => [n & 255, n >>> 8],
  wide = (s) => [...s].flatMap((c) => word(c.charCodeAt(0))).concat(0, 0);
function versionBlock(key, data = [], children = [], text = false) {
  const row = [
    0,
    0,
    ...word(text ? data.length / 2 : data.length),
    ...word(Number(text)),
    ...wide(key),
  ];
  const align = () => {
    while (row.length % 4) row.push(0);
  };
  align();
  row.push(...data);
  for (const child of children) {
    align();
    row.push(...child);
  }
  [row[0], row[1]] = word(row.length);
  return row;
}

test('version queries borrow binary and Unicode values and use the same buffer for ANSI text', async () => {
  const value = '日本語 2.6.1.74',
    resource = Uint8Array.from(
      versionBlock(
        'VS_VERSION_INFO',
        [0xfeef04bd, 0x10000, 0x20006, 0x1004a, ...Array(9).fill(0)].flatMap(u32),
        [
          versionBlock(
            'StringFileInfo',
            [],
            [versionBlock('041104b0', [], [versionBlock('FileVersion', wide(value), [], true)])],
          ),
          versionBlock('VarFileInfo', [], [versionBlock('Translation', [0x11, 4, 0xb0, 4])]),
        ],
      ),
    ),
    p = new PE32Process(await loadUnicorn()),
    kernel = new NativeEngineWindows(p, { readFile: async () => null }),
    name = p.allocate(80, true),
    key = p.allocate(160, true),
    out = p.allocate(12, true),
    path = 'C:\\catsystem2-web\\test.exe',
    query = (api, args) => p.callAsync(kernel.resolve({ dll: 'VERSION.dll', name: api }), args);
  installNativeVersionAPIs(kernel, 'test.exe', resource);
  try {
    const size = resource.length * 2 + 4,
      block = p.allocate(size + 16);
    p.write(block, new Uint8Array(size + 16).fill(0xa5));
    p.store(out, 0x12345678);
    kernel.writeString(name, path, true);
    assert.equal(await query('GetFileVersionInfoSizeW', [name, out]), size);
    assert.equal(p.load(out), 0);
    assert.equal(await query('GetFileVersionInfoW', [name, 0xdeadbeef, 13, block]), 1);
    assert.deepEqual(
      p.read(block, 16),
      Uint8Array.from([...resource.subarray(0, 13), 0xa5, 0xa5, 0xa5]),
    );
    assert.equal(await query('GetFileVersionInfoW', [name, 0, size, block]), 1);
    assert.deepEqual(p.read(block, resource.length), resource);
    assert.equal(p.load(block + resource.length), 0x58324546);

    assert.equal(await query('VerQueryValueW', [block, 0, out, out + 4]), 1);
    assert.equal(p.load(out), block + 40);
    assert.equal(p.load(out + 4), 52);
    assert.equal(p.load(p.load(out)), 0xfeef04bd);
    kernel.writeString(key, '\\VarFileInfo\\Translation', true);
    assert.equal(await query('VerQueryValueW', [block, key, out, out + 4]), 1);
    assert.equal(p.load(out + 4), 4);
    assert.equal(p.load(p.load(out)), 0x04b00411);
    const subBlock = '\\STRINGFILEINFO\\041104B0\\fileversion';
    kernel.writeString(key, subBlock, true);
    assert.equal(await query('VerQueryValueW', [block, key, out, out + 4]), 1);
    const text = p.load(out);
    assert.equal(p.string(text, true), value);
    assert.equal(p.load(out + 4), value.length + 1);
    kernel.writeString(key, subBlock);
    assert.equal(await query('VerQueryValueA', [block, key, out, out + 4]), 1);
    assert.equal(p.load(out), text + resource.length + 4);
    assert.deepEqual(p.read(p.load(out), p.load(out + 4)), encodeCP932(value + '\0'));
    assert.deepEqual(p.read(block + size, 16), new Uint8Array(16).fill(0xa5));

    kernel.writeString(key, '\\StringFileInfo\\041104b0\\Missing');
    p.store(out, 0x9abcdef0);
    assert.equal(await query('VerQueryValueA', [block, key, out, out + 4]), 0);
    assert.equal(kernel.lastError, 1813);
    assert.equal(p.load(out), 0x9abcdef0);
    assert.equal(p.load(out + 4), 0);
    kernel.writeString(name, 'absent.exe');
    assert.equal(await query('GetFileVersionInfoSizeA', [name, out]), 0);
    assert.equal(kernel.lastError, 2);
    assert.equal(p.load(out), 0);
  } finally {
    p.close();
  }
});
