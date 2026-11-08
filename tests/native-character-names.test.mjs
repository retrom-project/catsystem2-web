// SPDX-License-Identifier: MPL-2.0
import test from 'node:test';
import assert from 'node:assert/strict';
import {
  NativeCharacterNames,
  nativeCharacterNames,
  nativeCharacterNamesCodec,
} from '../src/native/character-names.mjs';
import { NativeHandles } from '../src/native/handles.mjs';
import { encodeCP932 } from '../src/kcs/strings.mjs';
import { KCSMachine } from '../src/kcs/vm.mjs';
import { Binary } from '../src/binary.mjs';

test('character names strip comments and whitespace before assigning first name and group matches', () => {
  const table = new NativeCharacterNames(
    encodeCP932(
      'unknown\r\n#Red(12,34,56)\nA l\tice//tail\n#Blue(7,8,9)\nALICE\nBob\n#Red(9,9,9)\nCarol\nfoo/* across\ncomment */bar',
    ),
  );
  assert.deepEqual(table.byName(encodeCP932('UNKNOWN')), [100, 100, 100]);
  assert.deepEqual(table.byGroup(encodeCP932('__UNKNOWN__')), [100, 100, 100]);
  assert.deepEqual(table.byName(encodeCP932('alice')), [12, 34, 56]);
  assert.deepEqual(table.byName(encodeCP932('bob')), [7, 8, 9]);
  assert.deepEqual(table.byName(encodeCP932('carol')), [12, 34, 56]);
  assert.deepEqual(table.byName(encodeCP932('foo')), [12, 34, 56]);
  assert.deepEqual(table.byName(encodeCP932('bar')), [12, 34, 56]);
  assert.equal(table.byGroup(encodeCP932('Red')), null);
});

test('partial headers preserve previous channels and original integer conversion', () => {
  const table = new NativeCharacterNames(
    encodeCP932(
      '#a(1,2,3)\none\n#b(0x20,-1,12.5)\ntwo\n#c(7,\nthree\n#empty(9,8,7)\n#not-a-header\n',
    ),
  );
  assert.deepEqual(table.byName(encodeCP932('one')), [1, 2, 3]);
  assert.deepEqual(table.byName(encodeCP932('two')), [32, 0xffffffff, 0]);
  assert.deepEqual(table.byName(encodeCP932('three')), [7, 0xffffffff, 0]);
  assert.deepEqual(table.byName(encodeCP932('#not-a-header')), [9, 8, 7]);
  assert.equal(table.byGroup(encodeCP932('#absent')), null);
  const stopped = new NativeCharacterNames(
    Uint8Array.from([...encodeCP932('one'), 0, ...encodeCP932('\ntwo')]),
  );
  assert.equal(stopped.byName(encodeCP932('two')), null);
});

test('character-name natives preserve output buffers, address zero, async files and typed handles', async () => {
  const handles = new NativeHandles();
  handles.registerType('character-names', nativeCharacterNamesCodec);
  const machine = new KCSMachine({
      body: new Binary(Uint8Array.of(59)),
      codeSize: 1,
      data: new Uint8Array(1024),
      stackSize: 128,
    }),
    services = {
      handles,
      format: (at, m) => m.string(at),
      read: async (name, category) => {
        assert.equal(name, 'names.txt');
        assert.equal(category, undefined);
        return encodeCP932('#red(1,2,3)\nAlice');
      },
    };
  machine.writeString('names.txt', 100);
  const opened = await nativeCharacterNames(0x252, [100], machine, services);
  assert.equal(opened.control, 1);
  machine.writeString('ALICE', 100);
  assert.deepEqual(nativeCharacterNames(0x255, [opened.value, 100, 0, 4, 8], machine, services), {
    control: 1,
    value: 1,
  });
  assert.deepEqual(
    [0, 4, 8].map((at) => machine.load(at)),
    [1, 2, 3],
  );
  machine.writeString('missing', 100);
  assert.deepEqual(nativeCharacterNames(0x255, [opened.value, 100, 0, 4, 8], machine, services), {
    control: 1,
    value: 0,
  });
  assert.deepEqual(
    [0, 4, 8].map((at) => machine.load(at)),
    [1, 2, 3],
  );
  const saved = handles.snapshot();
  handles.restore(saved);
  machine.writeString('#RED', 100);
  assert.equal(
    nativeCharacterNames(0x254, [opened.value, 100, 0, 4, 8], machine, services).value,
    1,
  );
  assert.deepEqual(nativeCharacterNames(0x253, [opened.value], machine, services), { control: 2 });
  assert.throws(
    () => nativeCharacterNames(0x255, [opened.value, 100, 0, 4, 8], machine, services),
    /released/,
  );
  assert.deepEqual(nativeCharacterNames(0x255, [0, 100, 0, 4, 8], machine, services), {
    control: 1,
    value: 0,
  });
});

test('existing empty name files create a valid empty table and missing files return null', async () => {
  const handles = new NativeHandles(),
    machine = { string: () => 'empty' },
    services = { handles, format: () => 'empty', read: () => new Uint8Array() };
  const opened = await nativeCharacterNames(0x252, [0], machine, services);
  assert.ok(opened.value);
  assert.equal(handles.get(opened.value, 'character-names').names.size, 0);
  services.read = () => null;
  assert.deepEqual(await nativeCharacterNames(0x252, [0], machine, services), {
    control: 1,
    value: 0,
  });
});
