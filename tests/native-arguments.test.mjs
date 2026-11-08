// SPDX-License-Identifier: MPL-2.0
import test from 'node:test';
import assert from 'node:assert/strict';
import { NativeRuntime } from '../src/native/runtime.mjs';
import { readKCS, encodeCP932 } from '../src/kcs.mjs';
import { kcsProgram } from './helpers.mjs';
for (const profile of ['sdk-4.01-engine-2.6.1.74', 'nekopara-vol3-engine-2.6.1.76'])
  test(`${profile} expression arrays retain bank side effects, alias writes, wrapped ranges and fresh runtime contexts`, async () => {
    const program = kcsProgram([[59]]),
      runtime = new NativeRuntime({ profile, read: async () => program }),
      task = runtime.scheduler.add(await readKCS(program), { name: 'arguments.kcs', abi: 'main' }),
      m = task.machine,
      invoke = (id, args) => runtime.native('main', id, args, m, task, runtime.scheduler);
    invoke(0xd1, [64]);
    const bank = runtime.variableBank(task, false);
    bank.registerContext(task.id);
    bank.setName('alpha', 0, 77);
    m.writeString('[$2 = 19, $2 + 3, alpha]', 128);
    m.bytes(512, 20).fill(0xa5);
    assert.deepEqual(invoke(0x21b, [128, 512, 3]), { control: 1, value: 3 });
    assert.deepEqual(
      [0, 4, 8].map((at) => m.load(512 + at)),
      [19, 22, 77],
    );
    assert.equal(m.load(524), 0xa5a5a5a5);
    assert.equal(bank.get(2), 19);
    assert.equal(bank.dirty, true);
    const saved = structuredClone(runtime.snapshot()),
      fresh = new NativeRuntime({ profile, read: async () => program });
    await fresh.restore(saved);
    const ft = fresh.scheduler.tasks.get(task.id),
      fm = ft.machine,
      call = (id, args) => fresh.native('main', id, args, fm, ft, fresh.scheduler);
    fm.writeString('[2147483647-2147483647]', 128);
    assert.deepEqual(call(0x21b, [128, 512, 3]), { control: 1, value: 3 });
    assert.deepEqual(
      [0, 4, 8].map((at) => fm.load(512 + at)),
      [0x7fffffff, 0x80000000, 0x80000001],
    );
    fm.writeString('[1,2,3]', 128);
    assert.deepEqual(
      call(0x21b, [128, 128, 3]),
      { control: 1, value: 1 },
      'the first output DWORD overwrites the remaining list source',
    );
    assert.equal(fm.load(128), 1);
    fm.writeString('[alpha,$2=31]', 128);
    assert.equal(call(0x21b, [128, 512, 2]).value, 2);
    assert.deepEqual([fm.load(512), fm.load(516)], [77, 31]);
    assert.equal(bank.get(2), 19, 'fresh bank ownership is separate');
    fm.writeString('alpha  beta   ', 128);
    assert.deepEqual(
      [0, 1, 2, 3].map((index) => call(0x21c, [128, index]).value),
      [0, 7, 14, 0xffffffff],
    );
    fm.writeStringBytes(encodeCP932('猫 犬'), 128);
    assert.equal(call(0x21c, [128, 1]).value, 3);
    assert.deepEqual(call(0x21c, [0xffffffff, 0]), { control: 1, value: 0 });
    assert.deepEqual(call(0x21b, [0xffffffff, 512, 3]), { control: 1, value: 0 });
    assert.deepEqual(call(0x21b, [128, 0xffffffff, 3]), { control: 1, value: 0 });
    assert.deepEqual(call(0x21b, [128, 512, 0xffffffff]), { control: 1, value: 0 });
  });
