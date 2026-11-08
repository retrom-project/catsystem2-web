// SPDX-License-Identifier: MPL-2.0
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { NativeEmoteDevice } from '../src/emote/native-device.mjs';
import { NativeEmoteMeshBlocks } from '../src/emote/native-mesh.mjs';

test(
  'strip packing matches the original driver including aliases, NaN payloads, CPU state and the entire scratch arena',
  { skip: !process.env.CATSYSTEM2_EMOTE_DLL },
  async () => {
    const device = await NativeEmoteDevice.open(
        new Uint8Array(await readFile(process.env.CATSYSTEM2_EMOTE_DLL)),
        { width: 32, height: 32, now: () => 0, epoch: 0 },
      ),
      p = device.process,
      loops = new NativeEmoteMeshBlocks(device),
      arena = p.allocate(0x20000, true),
      start = device.module.base + 0x58b44,
      end = device.module.base + 0x58c48;
    let seed = 0x12345678;
    const random = () => (seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0);
    try {
      for (let n = 0; n < 640; n++) {
        const bytes = new Uint8Array(0x20000),
          data = new DataView(bytes.buffer),
          set = (at, value) => data.setUint32(at, value, true),
          count = 2 + (random() % 63),
          index = random() % count,
          stack = 0x1000,
          owner = 0x4000,
          vector = 0x5000,
          u = 0x6000,
          v = 0x7000,
          colors = 0x8000,
          positionsRef = 0x9000,
          positions = 0xa000,
          destination = n % 8 === 0 ? positions + 0x100 + index * 8 : 0xc000,
          row = random() % 8,
          aOffset = 0x100 + index * 8,
          bOffset = 0x800 + index * 8,
          registers = Object.fromEntries(
            ['EAX', 'EBX', 'ECX', 'EDX', 'ESI', 'EDI', 'ESP', 'EBP'].map((name) => [
              name,
              random(),
            ]),
          ),
          xmm = Array.from({ length: 8 }, () =>
            Uint8Array.from({ length: 16 }, () => random() & 255),
          );
        for (let at = 0; at < bytes.length; at += 4) set(at, random());
        Object.assign(registers, {
          EBX: aOffset,
          ECX: arena + vector,
          EDX: row,
          ESI: index,
          EDI: bOffset,
          ESP: arena + stack,
          EFLAGS: 0x202 | (random() & 0xcd5),
          MXCSR: 0x1f80 | (random() & 63),
        });
        for (const [offset, value] of [
          [0x14, row],
          [0x1c, arena + owner],
          [0x2c, count],
          [0x30, arena + u],
          [0x34, arena + v],
          [0x38, arena + vector],
          [0x3c, 0x40 + index * 4],
          [0x40, 0x400 + index * 4],
          [0x44, arena + positionsRef],
        ])
          set(stack + offset, value);
        set(owner + 0x39c, arena + colors);
        set(positionsRef, arena + positions);
        set(vector, arena + destination);
        set(vector + 4, arena + destination);
        set(vector + 8, arena + destination + (count - index) * 48 + 48);
        const run = (enabled) => {
          loops.enabled = enabled;
          p.write(arena, bytes);
          for (const [name, value] of Object.entries(registers))
            p.cpu.reg_write_i32(p.uc['X86_REG_' + name], value);
          for (let i = 0; i < 8; i++) p.cpu.reg_write(p.uc['X86_REG_XMM' + i], xmm[i]);
          p.cpu.emu_start(start, end, 0, 1000000);
          assert.equal(p.cpu.reg_read_i32(p.uc.X86_REG_EIP) >>> 0, end);
          return { registers: p.registers(), bytes: p.read(arena, bytes.length) };
        };
        assert.deepEqual(run(true), run(false), `strip packing case ${n}`);
      }
      assert.ok(loops.hits > 400);
      assert.ok(loops.vertices > loops.hits);
    } finally {
      loops.close();
      device.close();
    }
  },
);
