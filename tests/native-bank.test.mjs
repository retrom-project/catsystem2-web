// SPDX-License-Identifier: MPL-2.0
import test from 'node:test';
import assert from 'node:assert/strict';
import { Binary } from '../src/binary.mjs';
import { KCSMachine, nativeReply } from '../src/kcs/vm.mjs';
import { NativeVariableBank, nativeBank } from '../src/native/bank.mjs';
import { evaluateNativeExpression as evaluate } from '../src/native/expression.mjs';

const make = () =>
  new KCSMachine({
    body: new Binary(Uint8Array.of(59)),
    codeSize: 1,
    data: new Uint8Array(2048),
    stackSize: 1024,
  });
test('native banks initialize once, preserve unsigned index bounds, and mark invalid writes dirty', () => {
  const bank = new NativeVariableBank(),
    m = make(),
    services = { variables: bank };
  assert.deepEqual(nativeBank(0xd2, [0], m, services), nativeReply(1, 0));
  nativeBank(0xd3, [0, 7], m, services);
  assert.equal(bank.dirty, false);
  nativeBank(0xd1, [5], m, services);
  nativeBank(0xd1, [99], m, services);
  assert.equal(bank.capacity, 5);
  nativeBank(0xd3, [0, -1], m, services);
  assert.deepEqual(nativeBank(0xd2, [0], m, services), nativeReply(1, 0xffffffff));
  bank.dirty = false;
  nativeBank(0xd3, [-1, 8], m, services);
  assert.equal(bank.get(-1), 0);
  assert.equal(bank.dirty, true);
  const disabled = new NativeVariableBank();
  nativeBank(0xd1, [9], m, { variables: disabled, allowVariableInitialization: false });
  assert.equal(disabled.words, null);
});

test('backup and restore copy capacity bytes, including a partial final word', () => {
  const bank = new NativeVariableBank();
  bank.initialize(5);
  bank.words.set([0x12345678, 0xabcdef01, 3, 4, 5]);
  bank.backup();
  bank.words.set([0, 0x99999999, 13, 14, 15]);
  bank.restoreBackup();
  assert.deepEqual([...bank.words], [0x12345678, 0x99999901, 13, 14, 15]);
  assert.equal(bank.dirty, false);
  const fresh = new NativeVariableBank();
  fresh.restore(bank.snapshot());
  assert.deepEqual(fresh.snapshot(), bank.snapshot());
});

test('native integer expressions preserve operand references and evaluate logical operands eagerly', () => {
  const bank = new NativeVariableBank();
  bank.initialize(16);
  const privateWords = new Uint32Array(512);
  assert.equal(evaluate('1 || $0++', bank), 1);
  assert.equal(bank.get(0), 1);
  assert.equal(evaluate('0 && $0++', bank), 0);
  assert.equal(bank.get(0), 2);
  assert.equal(evaluate('$0 + ($0 = 7)', bank), 14);
  assert.equal(evaluate('$$0 = 3', bank, { privateWords }), 3);
  assert.equal(evaluate('\\0 += 4', bank, { privateWords }), 7);
  assert.equal(privateWords[0], 7);
  bank.contextValue = 11;
  assert.equal(evaluate('@ * 2', bank), 22);
  assert.equal(
    evaluate('name[4]', bank, { lookup: (name, index) => (name === 'name' ? index + 10 : 0) }),
    14,
  );
});

test('native expression unary and postfix rules retain observed edge behavior', () => {
  const bank = new NativeVariableBank();
  bank.initialize(16);
  assert.equal(evaluate('+5', bank), 0);
  assert.equal(evaluate('+5 + 1', bank), 6);
  assert.equal(evaluate('$0++', bank), 1);
  assert.equal(evaluate('$(0)++', bank), 1);
  assert.equal(bank.get(0), 2);
  assert.equal(evaluate("'A'", bank), 0x4100);
  assert.equal(evaluate('3 / 0', bank), 0);
  assert.equal(evaluate('3 % 0', bank), 0);
  assert.throws(() => evaluate('$0 /= 0', bank), /division trap/);
  assert.throws(() => evaluate('$99', bank), /not mapped/);
  assert.throws(() => evaluate('$$0', bank), /not mapped/);
});

test('native D5 removes a trailing percentage marker and passes context through the same bank', () => {
  const m = make(),
    bank = new NativeVariableBank(),
    services = { variables: bank };
  nativeBank(0xd1, [16], m, services);
  nativeBank(0xd4, [8], m, services);
  m.writeString('@ + 2%', 0);
  assert.deepEqual(nativeBank(0xd5, [0], m, services), nativeReply(1, 10));
  assert.deepEqual(nativeBank(0xd5, [0xffffffff], m, services), nativeReply(1, 0));
  assert.equal(nativeBank(0xd1, [5], m), undefined);
  assert.equal(nativeBank(0xfff, [], m, services), undefined);
});

test('bank context registration, failed selection and removal preserve original selection rules', () => {
  const bank = new NativeVariableBank();
  assert.equal(bank.registerContext(1), false);
  bank.initialize(32);
  assert.equal(bank.privateWords, null);
  assert.equal(bank.registerContext(1), true);
  assert.equal(bank.privateWords.length, 512);
  assert.equal(bank.getPrivate(511), 0);
  bank.setPrivate(0, 17);
  assert.equal(bank.registerContext(2), true);
  bank.setPrivate(0, 29);
  assert.equal(bank.registerContext(1), false);
  assert.equal(bank.getPrivate(0), 29);
  assert.equal(bank.selectContext(1), true);
  assert.equal(bank.getPrivate(0), 17);
  assert.equal(bank.selectContext(999), false);
  assert.equal(bank.getPrivate(0), 17);
  assert.equal(bank.unregisterContext(2), true);
  assert.equal(bank.getPrivate(0), 17);
  assert.equal(bank.unregisterContext(1), true);
  assert.equal(bank.privateWords, null);
  assert.equal(bank.getPrivate(0), 0);
  assert.equal(bank.unregisterContext(1), false);
  assert.equal(bank.registerContext(1), true);
  assert.equal(bank.getPrivate(0), 0);
});

test('named and numbered private variables use one selected bank context', () => {
  const bank = new NativeVariableBank();
  bank.initialize(32);
  bank.registerContext('script:4');
  bank.setName('alpha', 0, 7);
  bank.setName('alpha', 2, 19);
  bank.setName('ALPHA', 0, 11);
  bank.setName('日本語', -1, 123);
  assert.equal(evaluate('$$0 = alpha + alpha[2]', bank), 26);
  assert.equal(evaluate('\\511 = ALPHA', bank), 11);
  assert.equal(bank.getPrivate(0), 26);
  assert.equal(bank.getPrivate(511), 11);
  assert.equal(bank.getName('日本語', 0xffffffff), 123);
  assert.equal(bank.dirty, false);
  bank.registerContext('fes:5:0');
  assert.equal(evaluate('alpha + \\0', bank), 0);
  bank.setPrivate(0, 41);
  bank.selectContext('script:4');
  assert.equal(bank.getPrivate(0), 26);
  bank.deleteName('alpha', 2);
  assert.equal(evaluate('alpha[2]', bank), 0);
  assert.equal(evaluate('$0 = $$0', bank), 26);
  assert.equal(bank.dirty, true);
});

test('context checkpoint restores every private word and name without shadow task arrays', () => {
  const bank = new NativeVariableBank();
  bank.initialize(7);
  for (const key of [0, 'script:1', 'fes:2:0']) {
    bank.registerContext(key);
    bank.privateWords.set(Uint32Array.from({ length: 512 }, (_, i) => i * 97 + 31));
    bank.setName('name', 2, 0xffffffff);
  }
  bank.selectContext('script:1');
  const fresh = new NativeVariableBank();
  fresh.restore(bank.snapshot());
  assert.deepEqual(fresh.snapshot(), bank.snapshot());
  assert.equal(fresh.privateWords, fresh.context('script:1').words);
  assert.equal(fresh.getName('name', 2), 0xffffffff);
  fresh.setPrivate(511, 5);
  assert.notEqual(fresh.getPrivate(511), bank.getPrivate(511));
  fresh.selectContext('fes:2:0');
  assert.equal(fresh.getPrivate(511), bank.getPrivate(511));
});

test('main 292/293 use bounded private storage and preserve absent-bank replies', () => {
  const bank = new NativeVariableBank(),
    services = { variables: bank },
    m = make();
  bank.initialize(32);
  assert.deepEqual(nativeBank(0x292, [0], m, services), nativeReply(1, 0));
  bank.registerContext(3);
  nativeBank(0x293, [511, 0xabcdef01], m, services);
  assert.deepEqual(nativeBank(0x292, [511], m, services), nativeReply(1, 0xabcdef01));
  nativeBank(0x293, [512, 8], m, services);
  nativeBank(0x293, [-1, 8], m, services);
  assert.deepEqual(nativeBank(0x292, [512], m, services), nativeReply(1, 0));
  assert.equal(bank.dirty, false);
  assert.deepEqual(nativeBank(0xd5, [0], m, { variables: null }), nativeReply(1, 0));
  assert.deepEqual(nativeBank(0x293, [0, 1], m, { variables: null }), nativeReply(2));
  assert.throws(() => nativeBank(0x293, [0], m, services), /expects 2 arguments/);
});

test('copying private contexts copies 512 words while retaining names and selection', () => {
  const bank = new NativeVariableBank();
  bank.initialize(1024);
  bank.registerContext('source');
  bank.setPrivate(0, 0x12345678);
  bank.setPrivate(511, 0xffffffff);
  bank.setName('own', 0, 10);
  bank.registerContext('destination');
  bank.setName('own', 0, 20);
  bank.setPrivate(1, 5);
  assert.equal(bank.copyContext('source', 'missing'), false);
  assert.equal(bank.copyContext('source', 'destination'), true);
  assert.equal(bank.selectedContext, 'destination');
  assert.equal(bank.getPrivate(0), 0x12345678);
  assert.equal(bank.getPrivate(511), 0xffffffff);
  assert.equal(bank.getPrivate(1), 0);
  assert.equal(bank.getName('own'), 20);
  assert.equal(bank.context('source').names.size, 1);
});
