// SPDX-License-Identifier: MPL-2.0
import test from 'node:test';
import assert from 'node:assert/strict';
import { PE32Process } from '../src/ppi/pe32.mjs';
import { loadUnicorn } from '../src/ppi/backend.mjs';

const word = (value) => [value & 255, (value >>> 8) & 255, (value >>> 16) & 255, value >>> 24];
const store = (view, value) =>
  new DataView(view.buffer, view.byteOffset, view.byteLength).setUint32(0, value, true);
const load = (view) =>
  new DataView(view.buffer, view.byteOffset, view.byteLength).getUint32(0, true);

test('PE strings stop at the terminator before an unmapped page and preserve unaligned wide units', async () => {
  const p = new PE32Process(await loadUnicorn()),
    page = 0x33000000,
    boundary = page + 4096;
  try {
    p.map(page, 4096);
    const ansi = new Uint8Array(73).fill(0x61);
    ansi.set([0x81, 0x40, 0], ansi.length - 3);
    p.write(boundary - ansi.length, ansi);
    assert.deepEqual(p.stringBytes(boundary - ansi.length, false, true), ansi);
    assert.deepEqual(p.stringBytes(boundary - ansi.length), ansi.slice(0, -1));

    p.write(boundary - 3, Uint8Array.of(0, 0xd8, 0));
    assert.throws(() => p.stringBytes(boundary - 3, true), /PE32 memory read failed/);
    p.map(boundary, 4096);
    assert.deepEqual(p.stringBytes(boundary - 3, true, true), Uint8Array.of(0, 0xd8, 0, 0));
    assert.equal(p.string(boundary - 3, true), '\ud800');
    assert.equal(p.stringBytes(boundary - 1, true).buffer.byteLength, 0);
  } finally {
    p.close();
  }
});

test('late instruction boundaries observe already translated code and detach cleanly', async () => {
  const p = new PE32Process(await loadUnicorn()),
    code = 0x5000;
  let detach,
    hits = 0;
  try {
    p.write(code, [0xb8, 1, 0, 0, 0, 0x83, 0xc0, 2, 0xc3]);
    assert.equal(p.call(code), 3);
    detach = p.beforeInstruction(code + 5, 'authored late instruction boundary', () => {
      hits++;
      assert.equal(p.cpu.reg_read_i32(p.uc.X86_REG_EAX), 1);
      p.cpu.reg_write_i32(p.uc.X86_REG_EAX, 7);
    });
    assert.equal(p.call(code), 9);
    assert.equal(p.call(code), 9);
    assert.equal(hits, 2);
    detach();
    detach = null;
    assert.equal(p.call(code), 3);
    assert.equal(hits, 2);
  } finally {
    detach?.();
    p.close();
  }
});

test('future instruction boundaries wait for their mapping to become executable', async () => {
  const p = new PE32Process(await loadUnicorn()),
    code = 0x12345000;
  let hits = 0,
    detach;
  try {
    detach = p.beforeInstruction(code, 'authored deferred instruction boundary', () => hits++);
    p.map(code, 4096, 'authored deferred code', p.uc.PROT_READ | p.uc.PROT_WRITE);
    p.write(code, [0xb8, 19, 0, 0, 0, 0xc3]);
    p.cpu.mem_protect(code, 4096, p.uc.PROT_READ | p.uc.PROT_EXEC);
    assert.equal(p.call(code), 19);
    assert.equal(hits, 1);
    detach();
    detach = null;
    assert.equal(p.call(code), 19);
    assert.equal(hits, 1);
  } finally {
    detach?.();
    p.close();
  }
});

test('borrowed RAM aliases retain the guest address and reacquire their buffer after WASM grows', async () => {
  const p = new PE32Process(await loadUnicorn(), { executableHeap: false }),
    data = p.allocate(16, true),
    code = 0x5000;
  let large = 0;
  try {
    const retained = p.view(data, 16);
    store(retained, 7);
    assert.equal(p.load(data), 7);
    p.write(code, [0xff, 0x05, ...word(data), 0xa1, ...word(data), 0xc3]);
    assert.equal(p.call(code), 8);
    assert.equal(load(retained), 8);
    const oldSize = p.uc.HEAPU8.byteLength;
    large = p.uc._malloc(oldSize);
    assert.ok(large);
    assert.ok(p.uc.HEAPU8.byteLength > oldSize);
    assert.equal(retained.byteLength, 0);
    const current = p.view(data, 16);
    assert.equal(load(current), 8);
    store(current, 11);
    assert.equal(p.call(code), 12);
    assert.equal(load(p.view(data, 16)), 12);
    assert.equal(p.view(0xffffffff, 0).length, 0);
    assert.throws(() => p.view(0x12340000, 4), /RAM view failed/);
    assert.throws(() => p.view(0xffffffff, 2), /valid guest range/);
    assert.throws(() => p.view(p.heapLimit - 4, 8), /RAM view failed/);
  } finally {
    if (large) p.uc._free(large);
    p.close();
  }
});

test('exposed executable views invalidate cached code before calls and asynchronous resumes', async () => {
  const p = new PE32Process(await loadUnicorn()),
    code = p.allocate(64, true),
    outer = p.allocate(64, true);
  try {
    p.write(code, [0xb8, 1, 0, 0, 0, 0xc3]);
    assert.equal(p.call(code), 1);
    const retained = p.view(code + 1, 1);
    retained[0] = 2;
    assert.equal(p.call(code), 2);
    // Executing a borrowed code range must not split or replace its RAM.
    retained[0] = 5;
    assert.equal(p.call(code), 5);
    const callback = p.trap('authored RAM code update', 0, async () => {
      await Promise.resolve();
      p.view(code + 1, 1)[0] = 3;
      assert.equal(await p.callFromHost(code), 3);
      p.view(code + 1, 1)[0] = 4;
    });
    p.write(outer, [0xe8, ...word(callback - outer - 5), 0xe9, ...word(code - outer - 10)]);
    assert.equal(await p.callAsync(outer), 4);
  } finally {
    p.close();
  }
});

test('nested native and JS callbacks observe one RAM backing without a boundary copy', async () => {
  const p = new PE32Process(await loadUnicorn(), { executableHeap: false }),
    data = p.allocate(16, true),
    outer = 0x5000,
    inner = 0x5100;
  try {
    const callback = p.trap('authored shared RAM callback', 0, async () => {
      assert.equal(load(p.view(data, 16)), 7);
      store(p.view(data, 16), 9);
      assert.equal(await p.callFromHost(inner), 11);
      assert.equal(load(p.view(data, 16)), 11);
      store(p.view(data, 16), 13);
    });
    p.write(inner, [0x83, 0x05, ...word(data), 2, 0xa1, ...word(data), 0xc3]);
    p.write(outer, [
      0xc7,
      0x05,
      ...word(data),
      ...word(7),
      0xe8,
      ...word(callback - outer - 15),
      0xa1,
      ...word(data),
      0xc3,
    ]);
    assert.equal(await p.callAsync(outer), 13);
    assert.equal(p.load(data), 13);
  } finally {
    p.close();
  }
});

test('fresh checkpoints rebind guest RAM without retaining another process host pointer', async () => {
  const unicorn = await loadUnicorn(),
    first = new PE32Process(unicorn, { executableHeap: false }),
    second = new PE32Process(unicorn, { executableHeap: false }),
    data = first.allocate(16, true);
  try {
    store(first.view(data, 16), 42);
    second.restore(first.snapshot());
    assert.equal(load(second.view(data, 16)), 42);
    store(second.view(data, 16), 99);
    assert.equal(first.load(data), 42);
    assert.equal(second.load(data), 99);
  } finally {
    second.close();
    first.close();
  }
});

test('permission splits preserve a contiguous physical backing for borrowed VM ranges', async () => {
  const p = new PE32Process(await loadUnicorn(), { executableHeap: false }),
    address = 0x50000000;
  try {
    p.map(address, 12288, 'virtual', p.uc.PROT_READ | p.uc.PROT_WRITE);
    const before = p.view(address, 12288);
    before[0] = 7;
    before[4096] = 11;
    before[8192] = 13;
    p.cpu.mem_protect(address + 4096, 4096, p.uc.PROT_READ);
    const after = p.view(address, 12288);
    assert.equal(after.byteOffset, before.byteOffset);
    assert.deepEqual([after[0], after[4096], after[8192]], [7, 11, 13]);
    after[8192] = 42;
    assert.equal(p.read(address + 8192, 1)[0], 42);
    p.cpu.mem_protect(address + 4096, 4096, p.uc.PROT_READ | p.uc.PROT_WRITE);
    const same = p.view(address, 12288);
    assert.equal(same.byteOffset, before.byteOffset);
    p.unmap(address);
    assert.throws(() => p.view(address, 4), /RAM view failed/);
    p.map(address, 12288, 'virtual', p.uc.PROT_READ | p.uc.PROT_WRITE);
    assert.equal(
      p.view(address, 12288).some((value) => value),
      false,
    );
  } finally {
    p.close();
  }
});

test('borrowed invalidation follows current executable permissions across split mappings', async () => {
  const p = new PE32Process(await loadUnicorn(), { executableHeap: false }),
    base = 0x50000000,
    code = base + 4096,
    calls = [],
    ccall = p.uc.ccall;
  p.uc.ccall = function (name, result, types, args, ...rest) {
    if (name === 'uc_mem_invalidate') calls.push([Number(args[1]), Number(args[2])]);
    return ccall.call(this, name, result, types, args, ...rest);
  };
  try {
    p.map(base, 12288, 'split borrowed pages', p.uc.PROT_READ | p.uc.PROT_WRITE);
    const bytes = p.view(base, 12288);
    p.write(code, [0xb8, 7, 0, 0, 0, 0xc3]);
    p.cpu.mem_protect(code, 4096, p.uc.PROT_ALL);
    assert.equal(p.call(code), 7);
    assert.deepEqual(calls.splice(0), [[code, 4096]]);

    bytes[4097] = 11;
    assert.equal(p.call(code), 11);
    assert.deepEqual(calls.splice(0), [[code, 4096]]);

    p.cpu.mem_protect(code, 4096, p.uc.PROT_READ | p.uc.PROT_WRITE);
    p.write(0x5000, [0xb8, 42, 0, 0, 0, 0xc3]);
    assert.equal(p.call(0x5000), 42);
    assert.deepEqual(calls.splice(0), []);

    bytes[4097] = 13;
    p.cpu.mem_protect(code, 4096, p.uc.PROT_ALL);
    assert.equal(p.call(code), 13);
    assert.deepEqual(calls.splice(0), [[code, 4096]]);
    p.unmap(base);
    assert.equal(p.call(0x5000), 42);
    assert.deepEqual(calls.splice(0), []);
  } finally {
    p.uc.ccall = ccall;
    p.close();
  }
});
