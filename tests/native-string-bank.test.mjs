// SPDX-License-Identifier: MPL-2.0
import test from 'node:test';
import assert from 'node:assert/strict';
import { Binary } from '../src/binary.mjs';
import { KCSMachine, nativeReply } from '../src/kcs/vm.mjs';
import { NativeStringBank, nativeStringBank } from '../src/native/string-bank.mjs';

test('native string storage shares live text views and preserves raw CP932 bytes', () => {
  const bank = new NativeStringBank();
  bank.set(0xffffffff, '猫');
  assert.equal(bank.get(-1), '猫');
  bank.setBytes(8, Uint8Array.of(0xff, 0x81, 0x40, 0, 65));
  assert.deepEqual(bank.getBytes(8), Uint8Array.of(0xff, 0x81, 0x40));
  assert.equal(bank.dirty, true);
  const restored = new NativeStringBank();
  restored.restore(bank.snapshot());
  assert.deepEqual(restored.snapshot(), bank.snapshot());
});

test('string expansion scans exact tokens once with signed integer prefixes and native missing-value behavior', () => {
  const bank = new NativeStringBank();
  bank.set(1, '猫');
  bank.set(16, '$str1');
  bank.set(-1, 'end');
  assert.equal(bank.expand('a$str1/b$str99c'), 'a猫/bc');
  assert.equal(bank.expand('$str+1/$str-0x1'), '猫/end');
  assert.equal(bank.expand('$str0x10'), '$str1');
  assert.equal(bank.expand('$str4294967297'), '猫');
  assert.equal(bank.expand('$STR1 $str1.2 $str 1'), '$STR1 $str1.2 $str 1');
});

test('native get reports existence including empty strings, clears missing buffers, and expand writes two zeroes', () => {
  const bank = new NativeStringBank(),
    m = new KCSMachine({
      body: new Binary(Uint8Array.of(59)),
      codeSize: 1,
      data: new Uint8Array(512),
      stackSize: 512,
    });
  const services = { strings: bank };
  m.writeString('猫', 0);
  assert.deepEqual(nativeStringBank(0x114, [1, 0], m, services), nativeReply(2));
  m.bytes(100, 20).fill(0xaa);
  assert.deepEqual(nativeStringBank(0x115, [1, 100], m, services), nativeReply(1, 1));
  assert.equal(m.string(100), '猫');
  assert.equal(m.load(103, 1), 0xaa);
  assert.deepEqual(nativeStringBank(0x115, [2, 100], m, services), nativeReply(1, 0));
  assert.equal(m.load(100, 1), 0);
  assert.equal(m.load(101, 1), 0x4c);
  bank.set(2, '');
  assert.deepEqual(nativeStringBank(0x115, [2, 100], m, services), nativeReply(1, 1));
  m.bytes(200, 50).fill(0xaa);
  m.writeString('$str1$str2', 200);
  nativeStringBank(0x116, [200], m, services);
  assert.equal(m.string(200), '猫');
  assert.equal(m.load(202, 2), 0);
  assert.equal(nativeStringBank(0x114, [0, 0], m), undefined);
});
