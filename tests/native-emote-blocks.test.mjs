// SPDX-License-Identifier: MPL-2.0
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { NativeEmoteDevice } from '../oracle/m2-device-original.mjs';
import { NativeEmoteBlocks } from '../oracle/m2-driver-blocks-original.mjs';

test(
  'the bicubic shortcut matches the original driver loop including every XMM lane, MXCSR and memory byte',
  { skip: !process.env.CATSYSTEM2_EMOTE_DLL },
  async () => {
    const device = await NativeEmoteDevice.open(
        new Uint8Array(await readFile(process.env.CATSYSTEM2_EMOTE_DLL)),
        { width: 32, height: 32, now: () => 0, epoch: 0 },
      ),
      p = device.process,
      loops = new NativeEmoteBlocks(device),
      uc = p.uc,
      cpu = p.cpu,
      arena = p.allocate(0x8000, true),
      start = device.module.base + 0x3f2f0,
      end = device.module.base + 0x3f46f;
    let seed = 1234;
    const random = () => (seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0),
      value = () => Math.fround(((random() % 2001) - 1000) / 100);
    try {
      for (let n = 0; n < 1152; n++) {
        const count = 1 + (random() % 32),
          index = random() % count,
          bytes = new Uint8Array(0x8000),
          data = new DataView(bytes.buffer),
          gpr = Object.fromEntries(
            ['EAX', 'EBX', 'ECX', 'EDX', 'ESI', 'EDI', 'ESP', 'EBP', 'EFLAGS', 'MXCSR'].map(
              (name) => [name, random()],
            ),
          );
        for (let at = 0; at < bytes.length; at += 4)
          data.setFloat32(at, Math.fround(value() * 2 ** (-32 * (n % 5))), true);
        Object.assign(gpr, {
          ESP: arena + 0x100,
          EBP: arena + 0x300,
          EDI: arena + 0x800,
          ESI: arena + 0xc00,
          EDX: arena + 0x1000,
          ECX: index,
          MXCSR: 0x1f80 | (random() & 63),
          EFLAGS: 0x202 | (random() & 0xcd5),
        });
        data.setUint32(0xc00, gpr.EDX, true);
        data.setUint32(0xc04, gpr.EDX + count * 8, true);
        for (const [i, v] of [1, 3, 3, 1].entries()) data.setFloat32(0x130 + i * 4, v, true);
        const xmm = Array.from(
          { length: 8 },
          () => new Uint8Array(Float32Array.from({ length: 4 }, value).buffer),
        );
        xmm[2] = new Uint8Array(Float32Array.of(1, 0, 0, 0).buffer);
        xmm[7] = new Uint8Array(Float32Array.of(1, 3, 3, 1).buffer);
        if (n >= 1024) {
          // Both rounding directions, DAZ/FTZ, exceptional operands and
          // controller/input aliases must retain original CPU execution.
          if (n % 4 === 0) gpr.MXCSR |= [0x2000, 0x4000, 0x6000, 0x8040][n % 16 >>> 2];
          if (n % 4 === 1)
            data.setUint32(
              0x1000 + index * 8,
              [0x7fc01234, 0x7f801234, 0x7f800000, 0xff800000][n % 16 >>> 2],
              true,
            );
          if (n % 4 === 2) {
            gpr.EDX = arena + 0x140;
            data.setUint32(0xc04, gpr.EDX + count * 8, true);
          }
          if (n % 4 === 3) data.setFloat32(0x844, 2 ** 120, true);
        }
        const run = (enabled) => {
          loops.enabled = enabled;
          p.write(arena, bytes);
          for (const [name, v] of Object.entries(gpr)) cpu.reg_write_i32(uc['X86_REG_' + name], v);
          for (let i = 0; i < 8; i++) cpu.reg_write(uc['X86_REG_XMM' + i], xmm[i]);
          cpu.emu_start(start, end, 0, 1000000);
          return { registers: p.registers(), bytes: p.read(arena, 0x8000) };
        };
        assert.deepEqual(run(true), run(false), `bicubic case ${n}`);
      }
      assert.ok(loops.hits >= 1024);
      assert.ok(loops.kernel.hits > 0);
      const saved = p.snapshot();
      p.restore(saved);
      assert.deepEqual(p.snapshot(), saved);
      cpu.reg_write_i32(uc.X86_REG_ESI, 0x12345000);
      assert.equal(loops.execute(), false);
      cpu.reg_write_i32(uc.X86_REG_ESI, arena + 0xc00);
      cpu.reg_write_i32(uc.X86_REG_ESP, arena + 0x108);
      assert.equal(loops.execute(), false);
    } finally {
      loops.close();
      device.close();
    }
  },
);
