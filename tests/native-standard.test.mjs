// SPDX-License-Identifier: MPL-2.0
import test from 'node:test';
import assert from 'node:assert/strict';
import { Binary } from '../src/binary.mjs';
import { KCSMachine, floatBits, bitsFloat } from '../src/kcs/vm.mjs';
import { encodeCP932 } from '../src/kcs/strings.mjs';
import { nativeStandard, parseNativeInteger } from '../src/native/standard.mjs';

function machine() {
  return new KCSMachine({
    body: new Binary(new Uint8Array([59])),
    codeSize: 1,
    data: new Uint8Array(4096),
    stackSize: 1024,
  });
}
function put(m, address, text) {
  m.writeString(text, address);
  return address;
}
function invoke(m, id, args = [], services = {}) {
  return nativeStandard(id, args, m, services);
}
function result(m, id, args = [], services = {}) {
  const reply = invoke(m, id, args, services);
  assert.equal(reply.control, 1);
  return reply.value;
}
const literal = { format: (address, m) => m.string(address) };

test('native millisecond time truncates platform precision and wraps the original DWORD clock', () => {
  const m = machine();
  for (const [milliseconds, expected] of [
    [0, 0],
    [123.999, 123],
    [-1.5, 0xffffffff],
    [0xffffffff + 0.75, 0xffffffff],
    [0x100000000 + 5.75, 5],
  ])
    assert.deepEqual(invoke(m, 4, [], { clock: () => milliseconds }), {
      control: 1,
      value: expected,
    });
  for (const milliseconds of [NaN, Infinity, -Infinity, undefined])
    assert.throws(() => invoke(m, 4, [], { clock: () => milliseconds }), /finite platform value/);
});

test('VM allocations retain zero-sized nodes and free translated block identities through shared aliases', () => {
  const m = machine(),
    first = m.memory.length;
  assert.equal(result(m, 0x1b, [0]), 0xffffffff);
  assert.equal(m.blocks.length, 1);
  assert.equal(result(m, 0x1c, [first]), 0);
  assert.equal(result(m, 0x1b, [4]), first);
  assert.equal(result(m, 0x1c, [first]), 1);
  assert.equal(m.blocks.length, 1);
  assert.equal(m.blocks[0].length, 0);
  const owned = m.allocate(8);
  m.shared = m.blocks[1];
  assert.equal(result(m, 0x1c, [0x80000001]), 0);
  assert.equal(result(m, 0x1c, [0x80000000]), 1);
  assert.equal(m.blocks.length, 1);
  const next = m.allocate(8);
  assert.equal(next, owned);
  assert.deepEqual(invoke(m, 0xed, [next]), { control: 2 });
  assert.equal(m.blocks.length, 1);
});

test('native copy/append return a flat VM pointer and preserve two terminator bytes', () => {
  const m = machine();
  put(m, 100, '猫A');
  m.bytes(300, 30).fill(0xaa);
  assert.equal(result(m, 0x0d, [300, 100]), 300);
  assert.deepEqual([...m.bytes(300, 6)], [...encodeCP932('猫A'), 0, 0, 0xaa]);
  put(m, 200, 'B');
  assert.equal(result(m, 0x0f, [300, 200]), 300);
  assert.equal(m.string(300), '猫AB');
  assert.deepEqual([...m.bytes(304, 3)], [0, 0, 0xaa]);
  assert.deepEqual(invoke(m, 0x0e, [300, 200], { format: () => '長い文字' }), {
    control: 1,
    value: 300,
  });
  assert.equal(m.string(300), '長い文字');
});

test('raw append preserves the original forward stores when a string appends to itself', () => {
  const m = machine();
  m.bytes(64, 36).fill(33);
  put(m, 64, 'abcde');
  m.store(96, 0, 1);
  assert.equal(result(m, 0x0f, [64, 64]), 64);
  assert.equal(m.string(64), 'abcdeabcdea' + '!'.repeat(21));
  assert.deepEqual([...m.bytes(95, 4)], [33, 0, 0, 33]);
  assert.throws(() => invoke(m, 0x0d, [65, 64]), /overlaps its unread source/);
});

test('formatted comparisons see the second formatter overwrite the first scratch string', () => {
  const m = machine(),
    text = 'a'.repeat(1024);
  put(m, 64, text);
  put(m, 2048, text);
  assert.equal(result(m, 0x14, [64, 2048], literal), 97);
  assert.equal(result(m, 0x16, [64, 2048], literal), 97);
  put(m, 64, text.slice(1));
  assert.equal(result(m, 0x14, [64, 2048], literal) | 0, -97);
});

test('an explicit byte formatter preserves UTF8 and invalid CP932 without a text round trip', () => {
  const m = machine(),
    bytes = Uint8Array.from([...new TextEncoder().encode('猫'), 0x81, 0x30, 0xfa, 0x40]);
  m.bytes(300, 32).fill(0x5a);
  const services = {
    formatBytes: () => bytes,
    format: () => {
      throw new Error('Text formatter must not run');
    },
  };
  assert.equal(result(m, 0x0e, [300, 100], services), 300);
  assert.deepEqual(m.bytes(300, bytes.length + 2), Uint8Array.from([...bytes, 0, 0]));
  assert.equal(result(m, 0x12, [100], services), bytes.length);
});

test('plain and formatted comparisons retain native ordering and byte semantics', () => {
  const m = machine();
  put(m, 100, 'A');
  put(m, 200, 'B');
  assert.equal(result(m, 0x13, [100, 200]) | 0, 1);
  assert.equal(result(m, 0x14, [100, 200], literal) | 0, -1);
  put(m, 100, 'a');
  put(m, 200, 'B');
  assert.equal(result(m, 0x15, [100, 200]) | 0, 1);
  assert.equal(result(m, 0x16, [100, 200], literal) | 0, -1);
  put(m, 100, '');
  assert.equal(result(m, 0x13, [100, 200]) | 0, 66);
});

test('byte lengths, character lengths and truncation use the native CP932 ranges', () => {
  const m = machine();
  put(m, 100, 'A猫B');
  assert.equal(result(m, 0x11, [100]), 4);
  assert.equal(result(m, 0x2f, [100]), 3);
  assert.equal(result(m, 0x28, [101]), 1);
  assert.equal(result(m, 0x17, [100, 3]), 1);
  assert.equal(m.string(100), 'A');
  put(m, 100, 'A猫B');
  assert.equal(result(m, 0x18, [100, 2]), 3);
  assert.equal(m.string(100), 'A猫');
  m.bytes(200, 4).set([0xf0, 0x40, 0, 0]);
  assert.equal(result(m, 0x28, [200]), 0);
  assert.equal(result(m, 0x2f, [200]), 2);
});

test('native integer parsing accepts hexadecimal and wraps words without accepting decimals', () => {
  assert.equal(parseNativeInteger('-0xFFFFFFFF'), 1);
  assert.equal(parseNativeInteger('4294967296'), 0);
  assert.equal(parseNativeInteger('+123rest'), 123);
  assert.equal(parseNativeInteger('0x'), 0);
  assert.equal(parseNativeInteger(' 12'), null);
  assert.equal(parseNativeInteger('12.3'), null);
  const m = machine();
  put(m, 100, '-0');
  assert.equal(result(m, 0x1a, [100], literal), 0x80000000);
  put(m, 100, '12.3');
  assert.equal(result(m, 0x19, [100], literal), 0);
});

test('native list splitting, selection and joining preserve list terminators and trailing space', () => {
  const m = machine();
  put(m, 100, ' a,猫,,c ');
  put(m, 200, ', ');
  assert.deepEqual(invoke(m, 0x29, [300, 100, 200]), { control: 2 });
  assert.equal(result(m, 0x2a, [500, 300, 1]), 1);
  assert.equal(m.string(500), '猫');
  assert.deepEqual(invoke(m, 0x2c, [600, 300, 0, 0xffffffff]), { control: 2 });
  assert.equal(m.string(600), 'a 猫 c ');
  m.bytes(500, 8).fill(0xaa);
  assert.equal(result(m, 0x2a, [500, 300, 99]), 0);
  assert.deepEqual([...m.bytes(500, 3)], [0, 0, 0xaa]);
  put(m, 100, 'f(1, 2) (:あ い),x');
  invoke(m, 0x2b, [300, 100, 200]);
  for (const [index, expected] of ['f', '(1, 2)', 'あ い', 'x'].entries()) {
    result(m, 0x2a, [500, 300, index]);
    assert.equal(m.string(500), expected);
  }
});

test('token copying retains the distinct native tab escape behavior', () => {
  const m = machine();
  put(m, 100, 'one\ttwo');
  put(m, 200, '\\t');
  assert.equal(result(m, 0x26, [300, 100, 200, 100]), 3);
  assert.equal(m.string(300), 'one');
  assert.equal(result(m, 0x27, [300, 100, 200, 100], literal), 4);
  assert.equal(m.string(300), 'one\t');
  assert.equal(result(m, 0x27, [300, 100, 200, 5], literal), 3);
});

test('native replacement, percentage conversion and search return their actual contracts', () => {
  const m = machine();
  put(m, 100, '猫aa猫');
  put(m, 200, '猫');
  put(m, 250, '犬');
  assert.deepEqual(invoke(m, 0x2d, [300, 100, 200, 250]), { control: 2 });
  assert.equal(m.string(300), '犬aa犬');
  assert.equal(result(m, 0x31, [100, 200]), 0);
  put(m, 200, 'aa');
  assert.equal(result(m, 0x31, [100, 200]), 2);
  put(m, 200, 'missing');
  assert.equal(result(m, 0x31, [100, 200]), 6);
  put(m, 300, '-12%');
  invoke(m, 0x2e, [300, 80]);
  assert.equal(m.string(300), '-9');
  put(m, 300, '0x10%');
  invoke(m, 0x2e, [300, 200]);
  assert.equal(m.string(300), '32');
  put(m, 300, '1.5%');
  invoke(m, 0x2e, [300, 200]);
  assert.equal(m.string(300), '1.5%');
});

test('memory and file natives distinguish void, pointer and byte-count results', () => {
  const m = machine(),
    allocated = result(m, 0x1b, [12]);
  assert.deepEqual(invoke(m, 0x24, [allocated, 0xab, 12]), { control: 2 });
  assert.deepEqual(invoke(m, 0x23, [300, allocated, 12]), { control: 2 });
  assert.deepEqual([...m.bytes(300, 12)], Array(12).fill(0xab));
  assert.equal(result(m, 0x1c, [allocated]), 1);
  assert.equal(result(m, 0x1c, [allocated]), 0);
  let requested, closed;
  const services = {
    ...literal,
    files: {
      open: (name, mode) => {
        assert.equal(name, 'file');
        assert.equal(mode, 'rb');
        return 7;
      },
      read: (handle, size) => {
        assert.equal(handle, 7);
        requested = size;
        return Uint8Array.of(1, 2, 3);
      },
      write: (handle, bytes) => {
        assert.equal(handle, 7);
        assert.deepEqual([...bytes], [1, 2, 3]);
        return bytes.length;
      },
      close: (handle) => {
        closed = handle;
      },
    },
  };
  put(m, 100, 'file');
  put(m, 200, 'rb');
  assert.equal(result(m, 0x1d, [100, 200], services), 7);
  assert.equal(result(m, 0x1e, [300, 2, 4, 7], services), 3);
  assert.equal(requested, 8);
  assert.equal(result(m, 0x1f, [300, 1, 3, 7], services), 3);
  assert.deepEqual(invoke(m, 0x20, [7], services), { control: 2 });
  assert.equal(closed, 7);
});

test('host effects and scalar functions retain native control codes', () => {
  const m = machine(),
    messages = [];
  put(m, 100, 'line\\nnext');
  assert.deepEqual(invoke(m, 1, [100], { ...literal, log: (s) => messages.push(s) }), {
    control: 2,
  });
  assert.deepEqual(messages, ['line\\nnext']);
  let clipboard;
  invoke(m, 10, [100], {
    ...literal,
    clipboard: (s) => {
      clipboard = s;
    },
  });
  assert.equal(clipboard, 'line\r\nnext');
  assert.equal(result(m, 4, [], { clock: () => 1234 }), 1234);
  assert.equal(nativeStandard(4, [], m, {}), undefined);
  assert.deepEqual(invoke(m, 0x25, [300, 1234567, 1]), { control: 2 });
  assert.equal(m.string(300), '+1,234,567');
});

test('math uses float words and unsupported calls never become fabricated zeroes', () => {
  const m = machine();
  assert.equal(bitsFloat(result(m, 0x3d, [floatBits(2), floatBits(3)])), 8);
  assert.equal(bitsFloat(result(m, 0x3b, [floatBits(-5), floatBits(2)])), -1);
  assert.equal(result(m, 0x40, [0x80000000]), 0x80000000);
  assert.deepEqual(invoke(m, 0x41), { control: 4 });
  assert.equal(invoke(m, 0x700, []), undefined);
  assert.equal(invoke(m, 0x1d, [100, 200]), undefined);
  assert.equal(invoke(m, 0x21), undefined);
  assert.throws(() => invoke(m, 0x0d, [100]), /expects 2 arguments/);
  assert.throws(
    () => invoke(m, 0x1d, [100, 200], { ...literal, files: { open() {} } }),
    /result must/,
  );
});
