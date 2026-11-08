// SPDX-License-Identifier: MPL-2.0
import test from 'node:test';
import assert from 'node:assert/strict';
import { NativeRuntime } from '../src/native/runtime.mjs';
import { readKCS, encodeCP932 } from '../src/kcs.mjs';
import { kcsProgram } from './helpers.mjs';

for (const profile of ['sdk-4.01-engine-2.6.1.74', 'nekopara-vol3-engine-2.6.1.76'])
  test(`${profile} all four map interfaces share raw byte keys and survive fresh runtime restoration`, async () => {
    const program = kcsProgram([[59]]),
      runtime = new NativeRuntime({ profile, read: async () => program }),
      task = runtime.scheduler.add(await readKCS(program), { name: 'maps.kcs', abi: 'main' }),
      m = task.machine,
      call = (id, args = []) => runtime.native('main', id, args, m, task, runtime.scheduler),
      put = (at, key) => m.writeStringBytes(typeof key === 'string' ? encodeCP932(key) : key, at),
      handles = [];
    put(64, 'z');
    put(96, 'A');
    put(128, 'a');
    put(160, Uint8Array.of(0xff, 0xfe));
    put(256, '%s[G160]');
    for (const ctor of [0x203, 0x2a3, 0x375, 0x37e]) {
      const handle = call(ctor).value;
      handles.push(handle);
      call(0x205, [handle, 64, 1]);
      call(0x205, [handle, 64, 2]);
      assert.equal(call(0x2a7, [handle, 64, 99]).value, 1);
      call(0x2a5, [handle, 64, 7]);
      call(0x380, [handle, 96, 7]);
      call(0x377, [handle, 128, 7]);
      call(0x2a5, [handle, 256, 0xffffffff]);
      assert.equal(call(0x206, [handle, 160]).value, 0xffffffff);
      assert.equal(call(0x2a8, [handle, 7, 320]).value, 1);
      assert.equal(m.string(320), 'A');
      call(0x2a6, [handle, 96]);
      assert.equal(call(0x2a8, [handle, 7, 320]).value, 1);
      assert.equal(m.string(320), 'a');
      assert.equal(call(0x2a8, [handle, 123456, 320]).value, 0);
      assert.equal(m.string(320), 'a', 'a miss preserves output');
    }
    const saved = structuredClone(runtime.snapshot()),
      fresh = new NativeRuntime({ profile, read: async () => program });
    await fresh.restore(saved);
    const after = fresh.scheduler.tasks.get(task.id),
      invoke = (id, args) => fresh.native('main', id, args, after.machine, after, fresh.scheduler);
    for (const [i, handle] of handles.entries()) {
      assert.equal(invoke(0x2a7, [handle, 256, 17]).value, 0xffffffff);
      assert.equal(invoke(0x2a8, [handle, 0xffffffff, 320]).value, 1);
      assert.deepEqual(after.machine.bytes(320, 3), Uint8Array.of(0xff, 0xfe, 0));
      assert.equal(invoke([0x204, 0x2a4, 0x376, 0x37f][i], [handle]).control, 2);
      assert.throws(() => invoke(0x2a7, [handle, 64, 99]), /released/);
      assert.equal(call(0x2a7, [handle, 64, 99]).value, 7, 'fresh state has separate ownership');
    }
    assert.deepEqual(invoke(0x2a7, [0, 0xffffffff, 0x87654321]), { control: 1, value: 0x87654321 });
    assert.deepEqual(invoke(0x2a8, [0, 7, 0xffffffff]), { control: 1, value: 0 });
  });
