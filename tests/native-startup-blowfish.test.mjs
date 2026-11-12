// SPDX-License-Identifier: MPL-2.0
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { StartupBlowfish } from '../src/native/startup-blowfish.mjs';

const fixture = JSON.parse(
    await readFile(new URL('./fixtures/startup-blowfish/vectors.json', import.meta.url)),
  ),
  bytes = (hex) => Uint8Array.from(Buffer.from(hex, 'hex')),
  authored = (name) => fixture.authored.find((row) => row.name === name);

for (const group of ['published', 'authored'])
  for (const item of fixture[group])
    test(`startup Blowfish ${group} independent answer: ${item.name}`, () => {
      const cipher = new StartupBlowfish(bytes(item.keyHex)),
        source = bytes(item.cipherLEHex),
        before = new Uint8Array(source),
        plain = bytes(item.plainLEHex),
        output = new Uint8Array(source.length + 3).fill(0xa5);
      assert.equal(cipher.decryptInto(source, output), source.length);
      assert.deepEqual(output.subarray(0, source.length), plain);
      assert.deepEqual(output.subarray(source.length), Uint8Array.from([0xa5, 0xa5, 0xa5]));
      assert.deepEqual(source, before);
      const resource = cipher.decryptResource(source);
      assert.equal(Object.getPrototypeOf(resource), Uint8Array.prototype);
      assert.equal(resource.length, source.length + 8);
      assert.deepEqual(resource.subarray(0, source.length), plain);
      assert.deepEqual(resource.subarray(source.length), new Uint8Array(8));
      assert.notEqual(resource.buffer, source.buffer);
    });

test('startup Blowfish effective keys remain raw bytes, including zero and bytes after NUL', () => {
  const full = authored('nul-key-full'),
    prefix = authored('nul-key-prefix');
  assert.notEqual(full.cipherLEHex, prefix.cipherLEHex);
  const result = new StartupBlowfish(bytes(full.keyHex)).decryptResource(bytes(full.cipherLEHex));
  assert.deepEqual(result.subarray(0, 8), bytes(full.plainLEHex));
  assert.deepEqual(
    new StartupBlowfish(new Uint8Array(8)).decryptResource(bytes('4597f94e78dd9861')),
    new Uint8Array(16),
  );
});

test('startup Blowfish diagnoses empty effective key and rejects unproved key sizes/types', () => {
  assert.throws(() => new StartupBlowfish(new Uint8Array(0)), /empty.*undefined/);
  for (const size of [512, 1024])
    assert.throws(() => new StartupBlowfish(new Uint8Array(size)), RangeError);
  for (const key of [null, [], 'open_cs2', new ArrayBuffer(8), new Uint8ClampedArray(8)])
    assert.throws(() => new StartupBlowfish(key), TypeError);
});

test('startup Blowfish uses all72 initial key bytes and never consumes the longer suffix', () => {
  const item = authored('key-72'),
    long = bytes(authored('key-511').keyHex);
  long.fill(0x5c, 72);
  assert.equal(item.cipherLEHex, authored('key-73').cipherLEHex);
  assert.equal(item.cipherLEHex, authored('key-511').cipherLEHex);
  assert.notEqual(item.cipherLEHex, authored('key-71').cipherLEHex);
  assert.deepEqual(
    new StartupBlowfish(long).decryptResource(bytes(item.cipherLEHex)).subarray(0, 32),
    bytes(item.plainLEHex),
  );
});

test('startup Blowfish owns each Buffer key schedule and returns independent resource storage', () => {
  const item = authored('default-public-key'),
    key = Buffer.from(item.keyHex, 'hex'),
    cipher = new StartupBlowfish(key);
  key.fill(0);
  const first = cipher.decryptResource(Buffer.from(item.cipherLEHex, 'hex'));
  assert.deepEqual(first.subarray(0, 16), bytes(item.plainLEHex));
  first.fill(0xff);
  assert.deepEqual(
    cipher.decryptResource(bytes(item.cipherLEHex)).subarray(0, 16),
    bytes(item.plainLEHex),
  );
  assert.deepEqual(
    new StartupBlowfish(bytes(item.keyHex))
      .decryptResource(bytes(item.cipherLEHex))
      .subarray(0, 16),
    bytes(item.plainLEHex),
  );
});

test('startup Blowfish returns0 without writes for empty/misaligned blocks; resource output remains all zero', () => {
  const cipher = new StartupBlowfish(bytes('6f70656e5f637332'));
  for (const size of [0, 1, 7, 9, 15, 17]) {
    const source = new Uint8Array(size).fill(0x5a),
      target = new Uint8Array(size + 8).fill(0xa5);
    assert.equal(cipher.decryptInto(source, target), 0);
    assert.deepEqual(target, new Uint8Array(size + 8).fill(0xa5));
    assert.deepEqual(cipher.decryptResource(source), new Uint8Array(size + 8));
  }
  assert.equal(cipher.decryptInto(new Uint8Array(1), new Uint8Array(0)), 0);
});

test('startup Blowfish decrypts exact in-place Buffer views without changing neighboring bytes', () => {
  const item = authored('key-57'),
    source = Buffer.from(item.cipherLEHex, 'hex'),
    backing = Buffer.alloc(source.length + 8, 0xa5);
  source.copy(backing, 3);
  const view = backing.subarray(3, 3 + source.length),
    cipher = new StartupBlowfish(bytes(item.keyHex));
  assert.equal(cipher.decryptInto(view, view), source.length);
  assert.deepEqual(new Uint8Array(view), bytes(item.plainLEHex));
  assert.deepEqual(backing.subarray(0, 3), Buffer.alloc(3, 0xa5));
  assert.deepEqual(backing.subarray(3 + source.length), Buffer.alloc(5, 0xa5));
});

test('startup Blowfish rejects only unproved partial overlap and unsafe destination capacity before writing', () => {
  const cipher = new StartupBlowfish(bytes('6f70656e5f637332')),
    backing = new Uint8Array(24).fill(0x5a),
    before = new Uint8Array(backing);
  for (const [source, target] of [
    [backing.subarray(0, 16), backing.subarray(4, 20)],
    [backing.subarray(4, 20), backing.subarray(0, 16)],
  ])
    assert.throws(() => cipher.decryptInto(source, target), /Partial.*overlap/);
  assert.deepEqual(backing, before);
  const target = new Uint8Array(7).fill(0xa5);
  assert.throws(() => cipher.decryptInto(new Uint8Array(8), target), RangeError);
  assert.deepEqual(target, new Uint8Array(7).fill(0xa5));
});

test('startup Blowfish byte contracts do not coerce text, arrays or clamped buffers', () => {
  const cipher = new StartupBlowfish(bytes('6f70656e5f637332'));
  for (const value of [null, [], '12345678', new ArrayBuffer(8), new Uint8ClampedArray(8)]) {
    assert.throws(() => cipher.decryptResource(value), TypeError);
    assert.throws(() => cipher.decryptInto(value, new Uint8Array(8)), TypeError);
    assert.throws(() => cipher.decryptInto(new Uint8Array(8), value), TypeError);
  }
});
