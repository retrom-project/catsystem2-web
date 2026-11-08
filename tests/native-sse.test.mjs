// SPDX-License-Identifier: MPL-2.0
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { PE32Process } from '../src/ppi/pe32.mjs';
import { loadUnicorn } from '../src/ppi/backend.mjs';

const word = (value) => [value & 255, (value >>> 8) & 255, (value >>> 16) & 255, value >>> 24],
  operations = [
    [0xf3, 0x0f, 0x58, 0xc1],
    [0xf3, 0x0f, 0x5c, 0xc1],
    [0xf3, 0x0f, 0x59, 0xc1],
    [0xf3, 0x0f, 0x5e, 0xc1],
    [0xf3, 0x0f, 0x51, 0xc0],
    [0xf3, 0x0f, 0x2d, 0xc0],
    [0xf3, 0x0f, 0x2c, 0xc0],
  ];
function instructions(operation, data) {
  return Uint8Array.from([
    0x0f,
    0xae,
    0x15,
    ...word(data),
    0xf3,
    0x0f,
    0x10,
    0x05,
    ...word(data + 4),
    0xf3,
    0x0f,
    0x10,
    0x0d,
    ...word(data + 8),
    ...operations[operation],
    ...(operation < 5 ? [0xf3, 0x0f, 0x11, 0x05, ...word(data + 12)] : [0xa3, ...word(data + 12)]),
    0x0f,
    0xae,
    0x1d,
    ...word(data + 16),
    0xc3,
  ]);
}

test('masked SSE values and MXCSR match hardware for rounding, DAZ, FTZ and sticky flags', async () => {
  const golden = JSON.parse(
      await readFile(new URL('./fixtures/native-sse-golden.json', import.meta.url), 'utf8'),
    ),
    p = new PE32Process(await loadUnicorn()),
    data = p.allocate(32, true),
    codes = operations.map((_, i) => {
      const code = p.allocate(64);
      p.write(code, instructions(i, data));
      return code;
    });
  try {
    for (const [op, a, b, mxcsr, expected, expectedFlags] of golden.cases) {
      p.store(data, mxcsr);
      p.store(data + 4, a);
      p.store(data + 8, b);
      p.call(codes[op]);
      assert.deepEqual(
        [p.load(data + 12), p.load(data + 16), p.cpu.reg_read_i32(p.uc.X86_REG_MXCSR) >>> 0],
        [expected, expectedFlags, expectedFlags],
        `${golden.operations[op]} ${[a, b, mxcsr].map((value) => value.toString(16)).join(' ')}`,
      );
    }
    assert.equal(golden.cases.length, 7392);
  } finally {
    p.close();
  }
});

test('SSE sticky flags survive FXSAVE, FXRSTOR and a fresh CPU checkpoint', async () => {
  const unicorn = await loadUnicorn(),
    p = new PE32Process(unicorn),
    copy = new PE32Process(unicorn),
    data = p.allocate(32, true),
    code = p.allocate(64),
    stateArea = p.allocate(512, true),
    save = p.allocate(16),
    restore = p.allocate(16);
  try {
    p.write(code, instructions(3, data));
    p.write(save, [0x0f, 0xae, 0x05, ...word(stateArea), 0xc3]);
    p.write(restore, [0x0f, 0xae, 0x0d, ...word(stateArea), 0xc3]);
    p.store(data, 0x1f80);
    p.store(data + 4, 0x3f800000);
    p.store(data + 8, 0x40400000);
    p.call(code);
    assert.equal(p.load(data + 16), 0x1fa0);
    p.call(save);
    assert.equal(p.load(stateArea + 24), 0x1fa0);
    p.cpu.reg_write_i32(p.uc.X86_REG_MXCSR, 0x1f80);
    p.call(restore);
    assert.equal(p.cpu.reg_read_i32(p.uc.X86_REG_MXCSR) >>> 0, 0x1fa0);
    copy.restore(p.snapshot());
    assert.equal(copy.cpu.reg_read_i32(copy.uc.X86_REG_MXCSR) >>> 0, 0x1fa0);
  } finally {
    copy.close();
    p.close();
  }
});

test('host code writes and checkpoint restoration invalidate translated instructions', async () => {
  const p = new PE32Process(await loadUnicorn()),
    code = p.allocate(16);
  try {
    p.write(code, [0xb8, 1, 0, 0, 0, 0xc3]);
    assert.equal(p.call(code), 1);
    p.write(code, [0xb8, 2, 0, 0, 0, 0xc3]);
    assert.equal(p.call(code), 2);
    const state = p.snapshot();
    p.cpu.mem_write(code, [0xb8, 3, 0, 0, 0, 0xc3]);
    assert.equal(p.call(code), 3);
    p.restore(state);
    assert.equal(p.call(code), 2);
  } finally {
    p.close();
  }
});
