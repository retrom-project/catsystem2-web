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

test('private grouped-token scratch preserves malformed groups and independent guest copy inputs', () => {
  const machine = new KCSMachine({
    body: new Binary(Uint8Array.of(59)),
    codeSize: 1,
    data: new Uint8Array(4096),
    stackSize: 1024,
  });
  const bytes = machine.bytes,
    copies = [];
  machine.bytes = function (address, count) {
    const target = Reflect.apply(bytes, this, [address, count]);
    if (address === 512)
      target.set = function (source, offset) {
        copies.push({
          bytes: [...source],
          byteOffset: source.byteOffset,
          bufferBytes: source.buffer.byteLength,
        });
        Reflect.apply(Uint8Array.prototype.set, this, [source, offset]);
        source.fill(0xa5);
      };
    return target;
  };
  const cases = [
    ['name(:foo bar) x', 0, 'name'],
    ['name(:foo bar) x', 1, 'foo bar'],
    ['1(x y)z', 0, '1(x y)z'],
    ['(abc', 0, '(abc'],
    ['(:abc', 0, 'ab'],
    ['a(:) b', 1, ''],
    ['a(:) b', 2, ''],
  ];
  for (const [source, index, expected] of cases) {
    machine.writeString(source, 0);
    assert.deepEqual(nativeStandard(0x207, [512, 0, index], machine), {
      control: 1,
      value: Number(Boolean(expected)),
    });
    assert.equal(machine.string(512), expected);
    if (expected) {
      const copy = copies.at(-1);
      assert.equal(copy.byteOffset, 0);
      assert.equal(
        copy.bufferBytes,
        copy.bytes.length,
        'guest copy sees an independent exact-sized input',
      );
    }
  }
  machine.writeString('(:', 0);
  machine.store(512, 0xa5, 1);
  assert.throws(() => nativeStandard(0x207, [512, 0, 0], machine), RangeError);
  assert.equal(machine.load(512, 1), 0, 'destination clear precedes a malformed-group error');
});
