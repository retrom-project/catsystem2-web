// SPDX-License-Identifier: MPL-2.0
import test from 'node:test';
import assert from 'node:assert/strict';
import {
  KCSMachine,
  formatNative,
  formatNativeAt,
  encodeCP932,
  floatBits,
  readKCS,
} from '../src/kcs.mjs';
import { NativeRuntime } from '../src/native/runtime.mjs';
import { Binary } from '../src/binary.mjs';
import { kcsProgram } from './helpers.mjs';
const machine = () =>
  new KCSMachine({
    body: new Binary(Uint8Array.of(59)),
    codeSize: 1,
    data: new Uint8Array(4096),
    stackSize: 1024,
  });
test('byte formatting retains UTF-8 and invalid CP932 through recursive strings and byte precision', () => {
  const m = machine(),
    text = new TextEncoder().encode('猫 中文 '),
    invalid = Uint8Array.of(0x81, 0x7f, 0xff);
  m.bytes(0, text.length + 14).set([...text, ...new TextEncoder().encode('%s[G512]'), 0]);
  m.bytes(512, invalid.length + 1).set([...invalid, 0]);
  assert.deepEqual(formatNativeAt(0, m), Uint8Array.from([...text, ...invalid]));
  m.writeString('%7.1s[G512]', 0);
  assert.deepEqual(formatNativeAt(0, m), Uint8Array.of(32, 32, 32, 32, 32, 32, 0x81));
  m.writeString('%s[H32]', 0);
  m.bytes(0x80000020, 4).set([...invalid, 0]);
  assert.deepEqual(formatNativeAt(0, m), invalid);
});
test('both native CRT corner cases preserve octal zero and consume uppercase F without a field', () => {
  const m = machine();
  m.writeString('a%#.0o[G512]b%+012.3F[G516]c', 0);
  m.store(512, 0);
  m.store(516, floatBits(1.25));
  assert.deepEqual(formatNativeAt(0, m), encodeCP932('a0bc'));
});
test('default Runtime formatted-copy path keeps the source bytes across VM yield and restore', async () => {
  const profile = 'nekopara-vol3-engine-2.6.1.76',
    file = kcsProgram([[37, 512], [37, 0], [43, 0x0e, 8], [43, 0x41, 0], [59]]),
    runtime = new NativeRuntime({ profile, read: async () => file }),
    program = await readKCS(file),
    task = runtime.scheduler.add(program, { name: 'authored', abi: 'main' }),
    source = new TextEncoder().encode('猫 中文');
  task.machine.bytes(0, source.length + 1).set([...source, 0]);
  await runtime.scheduler.tick();
  assert.deepEqual(task.machine.bytes(512, source.length + 1), Uint8Array.from([...source, 0]));
  const saved = runtime.snapshot(),
    fresh = new NativeRuntime({ profile, read: async () => file });
  await fresh.restore(structuredClone(saved));
  assert.deepEqual(fresh.scheduler.tasks.get(task.id).machine.bytes(512, source.length), source);
});
test('u32 selector large text index wraps every decimal digit before lookup', () => {
  const m = machine();
  m.writeString('bad', 0);
  m.writeString('ok', 4);
  assert.equal(formatNative('%s[G36028797018963972]', m), 'ok');
  assert.equal(m.string(0), 'bad');
  assert.equal(m.string(4), 'ok');
});
test('u32 selector large index reaches G4 through default byte services', () => {
  for (const profile of ['sdk-4.01-engine-2.6.1.74', 'nekopara-vol3-engine-2.6.1.76']) {
    const m = machine(),
      runtime = new NativeRuntime({
        profile,
        read: async () => {
          throw new Error('Unexpected formatter resource read');
        },
      });
    m.writeString('bad', 0);
    m.writeString('ok', 4);
    m.writeString('%s[G36028797018963972]', 128);
    assert.deepEqual(runtime.services.formatBytes(128, m), encodeCP932('ok'));
    assert.equal(m.string(0), 'bad');
    assert.equal(m.string(4), 'ok');
    assert.equal(m.string(128), '%s[G36028797018963972]');
  }
});
test('u32 selector empty text indices select zero in each bank', () => {
  const m = machine(),
    source = '%s[G]|%s[L]|%s[H]';
  m.fp = 512;
  m.writeString('g', 0);
  m.writeString('l', 512);
  m.writeString('h', 0x80000000);
  m.writeString(source, 128);
  assert.equal(formatNative(source, m), 'g|l|h');
  assert.deepEqual(formatNativeAt(128, m), encodeCP932('g|l|h'));
});
test('u32 selector text H index sets the shared bit without adding it twice', () => {
  const m = machine(),
    source = '%s[H2147483648]';
  m.writeString('bad', 0);
  m.writeString('ok', 0x80000000);
  m.writeString(source, 128);
  assert.equal(formatNative(source, m), 'ok');
  assert.deepEqual(formatNativeAt(128, m), encodeCP932('ok'));
  assert.equal(m.string(0), 'bad');
  assert.equal(m.string(0x80000000), 'ok');
});
test('u32 selector unsupported empty indices retain diagnostics across entrances', () => {
  const m = machine(),
    runtimes = ['sdk-4.01-engine-2.6.1.74', 'nekopara-vol3-engine-2.6.1.76'].map(
      (profile) =>
        new NativeRuntime({
          profile,
          read: async () => {
            throw new Error('Unexpected formatter resource read');
          },
        }),
    );
  m.writeString('untouched', 0);
  for (const source of ['%q[G]', '%q[G0]']) {
    m.writeString(source, 128);
    assert.throws(() => formatNative(source, m), /Unsupported native format conversion/);
    assert.throws(() => formatNativeAt(128, m), /Unsupported native format conversion/);
    for (const runtime of runtimes) {
      assert.throws(() => runtime.services.format(128, m), /Unsupported native format conversion/);
      assert.throws(
        () => runtime.services.formatBytes(128, m),
        /Unsupported native format conversion/,
      );
    }
  }
  m.writeString('%%q[G]', 128);
  assert.equal(formatNative('%%q[G]', m), '%q[G]');
  assert.deepEqual(formatNativeAt(128, m), encodeCP932('%q[G]'));
  for (const runtime of runtimes) {
    assert.equal(runtime.services.format(128, m), '%q[G]');
    assert.deepEqual(runtime.services.formatBytes(128, m), encodeCP932('%q[G]'));
  }
  assert.equal(m.string(0), 'untouched');
});
