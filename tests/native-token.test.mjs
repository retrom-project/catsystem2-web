// SPDX-License-Identifier: MPL-2.0
import test from 'node:test';
import assert from 'node:assert/strict';
import { Binary } from '../src/binary.mjs';
import { KCSMachine } from '../src/kcs/vm.mjs';
import { nativeStandard } from '../src/native/standard.mjs';
test('grouped token queries preserve tabs, nested groups, unsigned misses and overlapping source output', () => {
  const machine = new KCSMachine({
      body: new Binary(Uint8Array.of(59)),
      codeSize: 1,
      data: new Uint8Array(4096),
      stackSize: 1024,
    }),
    call = (index, destination = 128) => nativeStandard(0x207, [destination, 0, index], machine);
  machine.writeString('a\tb (:日本語 test) (x (y z)) end', 0);
  assert.deepEqual(call(0), { control: 1, value: 1 });
  assert.equal(machine.string(128), 'a\tb');
  call(1);
  assert.equal(machine.string(128), '日本語 test');
  call(2);
  assert.equal(machine.string(128), '(x (y z))');
  machine.bytes(128, 5).fill(0xa5);
  assert.deepEqual(call(0xffffffff), { control: 1, value: 0 });
  assert.deepEqual([...machine.bytes(128, 5)], [0, 0xa5, 0xa5, 0xa5, 0xa5]);
  assert.deepEqual(call(0, 0), { control: 1, value: 0 });
  assert.equal(machine.string(0), '');
});
