// SPDX-License-Identifier: MPL-2.0
import test from 'node:test';
import assert from 'node:assert/strict';
import { Binary } from '../src/binary.mjs';
import { KCSMachine, floatBits, bitsFloat } from '../src/kcs/vm.mjs';
import { encodeCP932 } from '../src/kcs/strings.mjs';
import { nativeStandard, parseNativeInteger } from '../src/native/standard.mjs';
import { dataWorld } from './fixtures/data-world.mjs';

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

test('original numeric text accepts D exponents and writes one NUL for percentages', () => {
  const m = machine();
  for (const [text, expected] of [
    ['-1.25D2tail', -125],
    ['+Infinity', 0],
    ['　12', 0],
  ]) {
    put(m, 100, text);
    assert.equal(result(m, 0x1a, [100], literal), floatBits(expected));
  }
  put(m, 100, '-12%');
  assert.deepEqual(invoke(m, 0x2e, [100, 80]), { control: 2 });
  assert.deepEqual([...m.bytes(100, 5)], [45, 57, 0, 37, 0]);
  assert.deepEqual(invoke(m, 0x2e, [0x7fffffff, 80]), { control: 2 });
});

test('2.6.1.23 narrow dictionary keeps the first exact key and returns its miss word', async (t) => {
  const world = await dataWorld('grisaia-jp-engine-2.6.1.23');
  t.after(() => world.close({ flushFiles: false }));
  const { main } = world,
    m = main.machine,
    call = (id, args) => world.runtime.native('main', id, args, m, main),
    { value: handle } = await call(515, []);
  m.writeString('猫%s', 256);
  m.writeString('犬', 288);
  assert.deepEqual(await call(517, [handle, 256, 0x80000001]), { control: 2 });
  assert.deepEqual(await call(517, [handle, 256, 5]), { control: 2 });
  assert.deepEqual(await call(518, [handle, 256]), { control: 1, value: 0x80000001 });
  assert.deepEqual(await call(518, [handle, 288]), { control: 1, value: 0xffffffff });
  assert.deepEqual(await call(518, [0, 256]), { control: 1, value: 0xffffffff });
  assert.deepEqual(await call(516, [handle]), { control: 2 });
  assert.throws(() => world.runtime.handles.get(handle, 'dictionary'), /released/);
  m.writeString('motion (2 + 3) 149913%', 256);
  assert.deepEqual(await call(519, [512, 256, 1]), { control: 1, value: 1 });
  assert.equal(m.string(512), '(2 + 3)');
});

test('63 command arguments retain original list, arithmetic and string-bank semantics', async () => {
  const world = await dataWorld('rebellions-jp-engine-2.6.1.63');
  try {
    const { main } = world,
      m = main.machine,
      call = (id, args) => world.runtime.native('main', id, args, m, main);
    m.writeString('motion (2 + 3) 149913%', 256);
    assert.deepEqual(await call(519, [512, 256, 1]), { control: 1, value: 1 });
    assert.equal(m.string(512), '(2 + 3)');
    assert.deepEqual(await call(540, [256, 1]), { control: 1, value: 7 });
    assert.deepEqual(await call(540, [256, 12]), { control: 1, value: 0xffffffff });
    assert.deepEqual(await call(519, [512, 256, 2]), { control: 1, value: 1 });
    assert.deepEqual(await call(46, [512, 123]), { control: 2 });
    assert.equal(m.string(512), '184392');
    assert.deepEqual(await call(319, [floatBits(3000000000)]), { control: 1, value: 3000000000 });
    assert.deepEqual(await call(319, [floatBits(NaN)]), { control: 1, value: 0 });
    m.writeString('motion (:text value)', 256);
    assert.deepEqual(await call(519, [512, 256, 1]), { control: 1, value: 1 });
    assert.equal(m.string(512), '(:text value)');
    m.bytes(256, 8).set([65, 0, 66, 0, 0, 0xa5, 0xa5, 0xa5]);
    assert.deepEqual(await call(42, [257, 256, 1]), { control: 1, value: 0 });
    assert.deepEqual([...m.bytes(256, 6)], [65, 66, 0, 0, 0, 0xa5]);
    m.writeString('ABCD', 256);
    m.writeString(',', 512);
    assert.deepEqual(await call(38, [257, 256, 512, 5]), { control: 1, value: 3 });
    assert.deepEqual([...m.bytes(256, 6)], [65, 65, 65, 65, 0, 0]);
    await call(209, [16]);
    assert.deepEqual(await call(212, [7]), { control: 2 });
    assert.equal(world.runtime.variableBank(main, false).contextValue, 7);
    m.writeString('(2+3)%', 512);
    assert.deepEqual(await call(213, [512]), { control: 1, value: 5 });
    m.writeString('猫', 256);
    assert.deepEqual(await call(276, [3, 256]), { control: 2 });
    m.writeString('A$str3 B$str4', 512);
    assert.deepEqual(await call(278, [512]), { control: 2 });
    assert.deepEqual([...m.bytes(512, 7)], [65, ...m.bytes(256, 2), 32, 66, 0, 0]);
  } finally {
    await world.close({ flushFiles: false });
  }
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

test('native replacement searches after the initial clear and appends from live overlapping bytes', () => {
  const m = machine();
  put(m, 200, 'absent');
  put(m, 250, 'new');
  put(m, 100, 'ABCDE');
  assert.deepEqual(invoke(m, 45, [100, 100, 200, 250]), { control: 2 });
  assert.deepEqual([...m.bytes(100, 6)], [0, 0, 67, 68, 69, 0]);
  put(m, 100, 'ABCDE');
  assert.deepEqual(invoke(m, 45, [102, 100, 200, 250]), { control: 2 });
  assert.deepEqual([...m.bytes(100, 6)], [65, 66, 65, 66, 65, 0]);
});

test('63 raw comparisons use their native byte signs and operand order', async (t) => {
  const world = await dataWorld('rebellions-jp-engine-2.6.1.63');
  t.after(() => world.close());
  const { main, runtime } = world,
    m = main.machine,
    compare = (id = 21) => runtime.native('main', id, [128, 144], m, main);
  put(m, 128, 'SceneA');
  put(m, 144, 'sCeNea');
  assert.deepEqual(compare(), { control: 1, value: 0 });
  put(m, 144, 'SceneC');
  assert.deepEqual(compare(), { control: 1, value: 2 });
  m.writeStringBytes(Uint8Array.of(0x81), 128);
  m.writeStringBytes(Uint8Array.of(0xff), 144);
  assert.deepEqual(compare(), { control: 1, value: 126 });
  m.writeStringBytes(Uint8Array.of(1), 128);
  assert.deepEqual(compare(19), { control: 1, value: 0xfffffffe });
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
