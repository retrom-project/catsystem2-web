// SPDX-License-Identifier: MPL-2.0
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { NativeEngineProcess } from '../src/native/engine-process.mjs';
import { NativeM2Blocks } from '../src/native/emote-blocks.mjs';

test(
  'M2 loop acceleration matches original PE registers, flags and every output byte',
  {
    skip: !process.env.CATSYSTEM2_ENGINE_EXE,
  },
  async () => {
    const bytes = new Uint8Array(await readFile(process.env.CATSYSTEM2_ENGINE_EXE)),
      engine = await NativeEngineProcess.open({ profile: 'nekopara-vol3-engine-2.6.1.76', bytes }),
      p = engine.process,
      loops = new NativeM2Blocks(p),
      arena = p.allocate(0x10000, true),
      frame = arena + 0x100,
      owner = arena + 0x400,
      registers = ['EAX', 'EBX', 'ECX', 'EDX', 'ESI', 'EDI', 'EBP', 'ESP', 'EFLAGS'];
    let seed = 0x12345678;
    const random = () => (seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0),
      run = (enabled, start, end, setup) => {
        loops.enabled = enabled;
        setup();
        p.cpu.emu_start(start, end, 0, 1000000);
        return {
          registers: registers.map((name) => p.cpu.reg_read_i32(p.uc['X86_REG_' + name]) >>> 0),
          bytes: p.read(arena, 0x10000),
        };
      };
    try {
      for (let n = 0; n < 128; n++) {
        const data = Uint8Array.from({ length: 0x10000 }, () => random() & 255),
          width = 1 + (random() % 512),
          before = random() % width,
          alpha = n < 8 ? [0, 1, 127, 128, 255, 256, 0x80000000, 0xffffffff][n] : random(),
          source = arena + 0x1000,
          second = arena + 0x4000,
          destination = n % 3 === 0 ? source : n % 3 === 1 ? second + 4 : arena + 0x7000,
          initial = Object.fromEntries(registers.map((name) => [name, random()]));
        initial.EBP = frame;
        initial.ESP = arena + 0x800;
        initial.EDX = source;
        initial.ESI = second;
        initial.EDI = destination;
        initial.EAX = n % 2 ? random() : alpha;
        initial.EBX = (256 - alpha) >>> 0;
        initial.EFLAGS = 0x202 | (random() & 0xcd5);
        const setup = () => {
          p.write(arena, data);
          p.store(frame - 20, owner);
          p.store(frame - 8, before);
          p.store(frame - 4, alpha);
          p.store(owner + 216, width);
          for (const [name, value] of Object.entries(initial))
            p.cpu.reg_write_i32(p.uc['X86_REG_' + name], value);
        };
        assert.deepEqual(
          run(true, 0x59c720, 0x59c79d, setup),
          run(false, 0x59c720, 0x59c79d, setup),
          `crossfade ${n}`,
        );
      }
      for (let n = 0; n < 96; n++) {
        const data = Uint8Array.from({ length: 0x10000 }, () => 1 + (random() % 255)),
          start = arena + 0x1000 + (random() & 15),
          length = n < 4 ? [0, 1, 4096, 8193][n] : random() % 12288,
          initial = Object.fromEntries(registers.map((name) => [name, random()]));
        initial.ECX = start;
        initial.EFLAGS = 0x202 | (random() & 0xcd5);
        data[start - arena + length] = 0;
        const setup = () => {
          p.write(arena, data);
          for (const [name, value] of Object.entries(initial))
            p.cpu.reg_write_i32(p.uc['X86_REG_' + name], value);
        };
        assert.deepEqual(
          run(true, 0x787840, 0x787847, setup),
          run(false, 0x787840, 0x787847, setup),
          `string scan ${n}`,
        );
      }
      for (let n = 0; n < 96; n++) {
        const data = Uint8Array.from({ length: 0x10000 }, () => random() & 255),
          width = 1 + (random() % 512),
          before = random() % width,
          source = arena + 0x1000,
          destination = n % 3 === 0 ? source : n % 3 === 1 ? source + 4 : arena + 0x7000,
          alpha = random(),
          initial = Object.fromEntries(registers.map((name) => [name, random()]));
        Object.assign(initial, {
          EBP: frame,
          EDI: owner,
          ECX: source,
          EDX: destination,
          ESI: before,
          EFLAGS: 0x202 | (random() & 0xcd5),
        });
        const setup = () => {
          p.write(arena, data);
          p.store(frame - 4, alpha);
          p.store(owner + 216, width);
          for (const [name, value] of Object.entries(initial))
            p.cpu.reg_write_i32(p.uc['X86_REG_' + name], value);
        };
        assert.deepEqual(
          run(true, 0x59c888, 0x59c8ba, setup),
          run(false, 0x59c888, 0x59c8ba, setup),
          `alpha ${n}`,
        );
      }
      for (const address of [0x7877b0, 0x787a64, 0x787b97, 0x787640])
        for (let n = 0; n < 64; n++) {
          const counter = address === 0x787640 ? 'EAX' : 'ECX',
            end = address === 0x787640 ? 'ECX' : 'EAX',
            initial = Object.fromEntries(registers.map((name) => [name, random()]));
          initial.ESI = arena + 0x1000;
          initial[end] = initial.ESI + (1 + (random() % 64)) * 8;
          initial[counter] = n % 3 ? (random() % 128) - 32 : 0x7fffffff;
          initial.EDX = (random() % 128) - 32;
          initial.EFLAGS = 0x202 | (random() & 0xcd5);
          const setup = () => {
            for (const [name, value] of Object.entries(initial))
              p.cpu.reg_write_i32(p.uc['X86_REG_' + name], value);
          };
          assert.deepEqual(
            run(true, address, address + 12, setup),
            run(false, address, address + 12, setup),
            `index ${address.toString(16)} ${n}`,
          );
        }
      for (let n = 0; n < 128; n++) {
        const data = Uint8Array.from({ length: 0x10000 }, () => random() & 255),
          width = 1 + (random() % 512),
          before = random() % width,
          first = arena + 0x1000,
          second = n % 4 === 0 ? first : n % 4 === 1 ? first + 4 : arena + 0x7000,
          initial = Object.fromEntries(registers.map((name) => [name, random()]));
        for (let i = 3; i < 512 * 4; i += 4) {
          if (n % 3 !== 0) data[first - arena + i] = i % 3 ? 0 : 255;
          if (n % 3 !== 1) data[second - arena + i] = i % 5 ? 0 : 127;
        }
        Object.assign(initial, {
          EBP: frame,
          EDI: owner,
          EAX: second,
          EDX: first,
          ESI: before,
          EFLAGS: 0x202 | (random() & 0xcd5),
        });
        const setup = () => {
          p.write(arena, data);
          p.store(owner + 216, width);
          for (const [name, value] of Object.entries(initial))
            p.cpu.reg_write_i32(p.uc['X86_REG_' + name], value);
        };
        assert.deepEqual(
          run(true, 0x59c974, 0x59c9ae, setup),
          run(false, 0x59c974, 0x59c9ae, setup),
          `transparent colors ${n}`,
        );
      }
      for (const address of [0x7876a8, 0x787751])
        for (let n = 0; n < 64; n++) {
          const data = Uint8Array.from({ length: 0x10000 }, () => random() & 255),
            source = arena + 0x1000,
            size = (1 + (random() % 128)) * 8,
            destination = n % 3 === 0 ? source - 8 : n % 3 === 1 ? source + 4 : arena + 0x7000,
            initial = Object.fromEntries(registers.map((name) => [name, random()]));
          Object.assign(initial, {
            ESI: source,
            ECX: destination,
            EDX: source + size,
            EFLAGS: 0x202 | (random() & 0xcd5),
          });
          const setup = () => {
            p.write(arena, data);
            for (const [name, value] of Object.entries(initial))
              p.cpu.reg_write_i32(p.uc['X86_REG_' + name], value);
          };
          assert.deepEqual(
            run(true, address, address + 21, setup),
            run(false, address, address + 21, setup),
            `shift ${address.toString(16)} ${n}`,
          );
        }
    } finally {
      loops.close();
      await engine.close();
    }
  },
);
