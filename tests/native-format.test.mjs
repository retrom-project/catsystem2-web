// SPDX-License-Identifier: MPL-2.0
import test from 'node:test';
import assert from 'node:assert/strict';
import { KCSMachine, formatNativeAt, encodeCP932, floatBits, readKCS } from '../src/kcs.mjs';
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
