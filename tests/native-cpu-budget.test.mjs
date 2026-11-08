// SPDX-License-Identifier: MPL-2.0
import test from 'node:test';
import assert from 'node:assert/strict';
import { PE32Process } from '../src/ppi/pe32.mjs';
import { loadUnicorn } from '../src/ppi/backend.mjs';
test('native faults retain guest registers and return stack before host restoration', async () => {
  const p = new PE32Process(await loadUnicorn()),
    code = p.allocate(64, true);
  p.write(code, [0xb8, 0x78, 0x56, 0x34, 0x12, 0x8b, 0x15, 0xef, 0xbe, 0xad, 0xde, 0xc3]);
  try {
    assert.throws(
      () => p.call(code, [0x11223344], 0x55667788),
      (error) => {
        assert.equal(error.nativeFault.pc, code + 5);
        assert.equal(error.nativeFault.registers.EAX, 0x12345678);
        assert.equal(error.nativeFault.registers.ECX, 0x55667788);
        assert.equal(error.nativeFault.stackAddress, error.nativeFault.registers.ESP);
        assert.equal(error.nativeFault.stack.length, 16);
        assert.deepEqual(error.nativeFault.stack.slice(0, 2), [p.sentinel, 0x11223344]);
        assert.equal(error.details, undefined);
        return true;
      },
    );
  } finally {
    p.close();
  }
});
test('exact instruction budgets preserve flags, callback effects and the next instruction PC', async () => {
  const p = new PE32Process(await loadUnicorn()),
    code = p.allocate(64, true),
    bytes = Uint8Array.of(0xb8, 0, 0, 0, 0x80, 0x83, 0xc0, 0, 0x90, 0x0f, 0x42, 0xf7, 0x90),
    visits = [],
    hook = p.cpu.hook_add(
      p.uc.HOOK_CODE,
      () => {
        visits.push(p.cpu.reg_read_i32(p.uc.X86_REG_EFLAGS) >>> 0);
        p.cpu.reg_write_i32(p.uc.X86_REG_EFLAGS, 0x203);
      },
      null,
      code + 8,
      code + 8,
    );
  try {
    for (const limit of [1, 2, 3, 4, 5, 0]) {
      visits.length = 0;
      p.write(code, bytes);
      for (const [name, value] of Object.entries({
        EAX: 0,
        ESI: 1,
        EDI: 0x12345678,
        EFLAGS: 0x246,
      }))
        p.cpu.reg_write_i32(p.uc['X86_REG_' + name], value);
      p.cpu.emu_start(code, code + bytes.length, 0, limit);
      const n = limit || 5;
      assert.equal(p.cpu.reg_read_i32(p.uc.X86_REG_EIP) >>> 0, code + [0, 5, 8, 9, 12, 13][n]);
      assert.equal(
        p.cpu.reg_read_i32(p.uc.X86_REG_EFLAGS) >>> 0,
        n === 1 ? 0x246 : n === 2 ? 0x286 : 0x203,
      );
      assert.equal(p.cpu.reg_read_i32(p.uc.X86_REG_ESI) >>> 0, n < 4 ? 1 : 0x12345678);
      assert.deepEqual(visits, n < 3 ? [] : [0x286]);
    }
  } finally {
    p.cpu.hook_del(hook);
    p.close();
  }
});

test('long x87 blocks retain their spill state through exact budget stops', async () => {
  const p = new PE32Process(await loadUnicorn()),
    data = p.allocate(64, true),
    output = p.allocate(64 * 4, true),
    code = p.allocate(4096, true),
    word = (value) => [value & 255, (value >>> 8) & 255, (value >>> 16) & 255, value >>> 24],
    instructions = [],
    view = new DataView(new ArrayBuffer(40));
  for (let i = 0; i < 8; i++) view.setFloat32(i * 4, i + 1, true);
  view.setFloat32(32, 0.5, true);
  view.setFloat32(36, 1, true);
  p.write(data, new Uint8Array(view.buffer));
  for (let i = 0; i < 64; i++)
    instructions.push(
      0xd9,
      0x05,
      ...word(data + (i % 8) * 4),
      0xd8,
      0x0d,
      ...word(data + 32),
      0xd8,
      0x05,
      ...word(data + 36),
      0xd9,
      0x1d,
      ...word(output + i * 4),
    );
  p.write(code, [...instructions, 0x90]);
  try {
    for (const count of [1, 7, 128, 255, 256]) {
      p.zero(output, 256);
      p.cpu.reg_write_i32(p.uc.X86_REG_EFLAGS, 0x246);
      // Each independent run starts with an empty x87 stack. FPCW remains
      // its real CPU default; all authored operands/results are exact.
      p.cpu.reg_write_i32(p.uc.X86_REG_FPSW, 0);
      p.cpu.reg_write_i32(p.uc.X86_REG_FPTAG, 0xffff);
      p.cpu.emu_start(code, code + instructions.length + 1, 0, count);
      assert.equal(p.cpu.reg_read_i32(p.uc.X86_REG_EIP) >>> 0, code + count * 6);
      assert.equal(p.cpu.reg_read_i32(p.uc.X86_REG_EFLAGS) >>> 0, 0x246);
      const values = new DataView(p.read(output, 256).buffer);
      for (let i = 0; i < 64; i++)
        assert.equal(
          values.getFloat32(i * 4, true),
          i < Math.floor(count / 4) ? ((i % 8) + 1) * 0.5 + 1 : 0,
        );
    }
  } finally {
    p.close();
  }
});

test('count-only budgets retain the complete CPU state observed by instruction callbacks', async () => {
  const p = new PE32Process(await loadUnicorn()),
    code = p.allocate(8192, true),
    data = p.allocate(128, true),
    word = (value) => [value & 255, (value >>> 8) & 255, (value >>> 16) & 255, value >>> 24],
    instructions = [],
    inputs = Uint8Array.from({ length: 128 }, (_, i) => (i * 23 + 17) & 255);
  let seed = 12345;
  const random = () => (seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0);
  for (let i = 0; i < 192; i++)
    switch (i % 9) {
      case 0:
        instructions.push(0xb8, ...word(random()));
        break;
      case 1:
        instructions.push(0x05, ...word(random()));
        break;
      case 2:
        instructions.push(0x11, 0xcb);
        break;
      case 3:
        instructions.push(0x31, 0xd2);
        break;
      case 4:
        instructions.push(0x89, 0xc1);
        break;
      case 5:
        instructions.push(0xc1, 0xe3, random() & 31);
        break;
      case 6:
        instructions.push(0xf3, 0x0f, 0x6f, 0x07);
        break;
      case 7:
        instructions.push(0x66, 0x0f, 0xfe, 0xc1);
        break;
      case 8:
        instructions.push(0x0f, 0x11, 0x47, 16);
        break;
    }
  p.write(code, [...instructions, 0x90]);
  p.cpu.reg_write_i32(p.uc.X86_REG_EDI, data);
  p.view(code, instructions.length + 1);
  p.cpu.reg_write_i32(p.uc.X86_REG_EFLAGS, 0x246);
  const initial = p.registers();
  try {
    for (let count = 1; count <= 192; count++) {
      const run = (observe) => {
        p.write(data, inputs);
        p.writeRegisters(initial);
        let visits = 0;
        const hook = observe
          ? p.cpu.hook_add(p.uc.HOOK_CODE, () => visits++, null, code, code + instructions.length)
          : null;
        try {
          // Changing a Unicorn hook does not invalidate existing translated
          // blocks. Recompile this authored block for each observation mode.
          p.flushBorrowedCode();
          p.cpu.emu_start(code, code + instructions.length + 1, 0, count);
          if (observe) assert.equal(visits, count);
          return { registers: p.registers(), bytes: p.read(data, inputs.length) };
        } finally {
          if (hook !== null) p.cpu.hook_del(hook);
        }
      };
      assert.deepEqual(run(false), run(true), `instruction budget ${count}`);
    }
  } finally {
    p.close();
  }
});
