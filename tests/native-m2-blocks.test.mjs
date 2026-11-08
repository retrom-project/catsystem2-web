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

test(
  'original M2 EXE shortcuts charge each traced instruction and preserve partial and restored execution',
  { skip: !process.env.CATSYSTEM2_ENGINE_EXE },
  async () => {
    const bytes = new Uint8Array(await readFile(process.env.CATSYSTEM2_ENGINE_EXE)),
      options = { profile: 'nekopara-vol3-engine-2.6.1.76', bytes, heapSize: 0x200000 },
      engine = await NativeEngineProcess.open(options),
      p = engine.process,
      loops = new NativeM2Blocks(p),
      arena = p.allocate(0x5000, true),
      frame = arena + 0x100,
      owner = arena + 0x400,
      first = arena + 0x1000,
      second = arena + 0x2000,
      destination = arena + 0x3000,
      initial = p.registers(),
      pixels = Uint8Array.from({ length: 0x5000 }, (_, i) => (i * 73 + 17) & 255);
    let fresh, freshLoops;
    const charged = [],
      consume = p.consumeInstructions.bind(p);
    p.consumeInstructions = (additional) => {
      const accepted = consume(additional);
      if (accepted) charged.push(additional);
      return accepted;
    };
    const state = (process) => ({
        registers: process.registers(),
        memory: process.read(arena, pixels.length),
        budget: process.instructionBudget(),
      }),
      pc = (registers) => new DataView(registers.EIP.buffer).getUint32(0, true),
      setup = (registers, words = [], pixelAlpha = []) => {
        p.write(arena, pixels);
        p.writeRegisters(initial);
        for (const [name, value] of Object.entries({
          EBP: frame,
          ESP: arena + 0x800,
          EFLAGS: 0x203,
          MXCSR: 0x1fa0,
          ...registers,
        }))
          p.cpu.reg_write_i32(p.uc['X86_REG_' + name], value);
        for (const [address, value] of [
          [frame - 20, owner],
          [frame - 8, 2],
          [frame - 4, 193],
          [owner + 216, 6],
          ...words,
        ])
          p.store(address, value);
        for (const [i, [a, b]] of pixelAlpha.entries()) {
          p.write(first + i * 4 + 3, [a]);
          p.write(second + i * 4 + 3, [b]);
        }
      },
      execute = (fixture, enabled, budget) => {
        loops.enabled = enabled;
        setup(fixture.registers, fixture.words, fixture.pixelAlpha);
        charged.length = 0;
        p.pendingError = null;
        let fault;
        try {
          p.cpu.emu_start(fixture.start, fixture.end, 0, budget);
        } catch (error) {
          fault = String(error);
        }
        if (p.pendingError) throw p.pendingError;
        return { ...state(p), fault };
      },
      fixture = (start, end, registers, words, pixelAlpha) => ({
        start,
        end,
        registers,
        words,
        pixelAlpha,
      }),
      scan = fixture(0x787840, 0x787847, { EAX: 0x87654321, ECX: first }, [[first, 0x00abcdef]]),
      blend = fixture(0x59c720, 0x59c79d, {
        EDX: first,
        ESI: second,
        EDI: destination,
        EAX: 239,
        EBX: 63,
      }),
      alpha = fixture(0x59c888, 0x59c8ba, { ECX: first, EDX: destination, ESI: 2, EDI: owner }),
      transparent = (pixelAlpha) =>
        fixture(
          0x59c974,
          0x59c9ae,
          { EAX: second, EBX: 0x11800000, ECX: 0x87654321, EDX: first, ESI: 2, EDI: owner },
          [[owner + 216, 2 + pixelAlpha.length]],
          pixelAlpha,
        ),
      alphaCases = [
        [0, 0],
        [0, 127],
        [255, 0],
        [255, 127],
      ],
      cases = [
        scan,
        blend,
        alpha,
        ...alphaCases.map((pair) => transparent([pair])),
        transparent(alphaCases),
      ];
    for (const start of [0x7877b0, 0x787a64, 0x787b97, 0x787640])
      for (const target of [1, 2, 9]) {
        const [counter, end] = start === 0x787640 ? ['EAX', 'ECX'] : ['ECX', 'EAX'];
        cases.push(
          fixture(start, start + 12, { [counter]: -1, [end]: first + 24, ESI: first, EDX: target }),
        );
      }
    for (const start of [0x7876a8, 0x787751])
      cases.push(fixture(start, start + 21, { ESI: first, EDX: first + 32, ECX: first - 8 }));
    try {
      for (const sample of cases) {
        // The uncounted original hook trace supplies every cutoff PC.
        const trace = [],
          hook = p.cpu.hook_add(
            p.uc.HOOK_CODE,
            (_cpu, address) => trace.push(Number(address)),
            null,
            sample.start,
            sample.end - 1,
          );
        try {
          p.invalidateExecutable(sample.start, sample.end);
          const native = execute(sample, false, 0);
          assert.equal(native.fault, undefined);
          assert.equal(pc(native.registers), sample.end);
        } finally {
          p.cpu.hook_del(hook);
          p.invalidateExecutable(sample.start, sample.end);
        }
        const budgets = Array.from({ length: trace.length + 2 }, (_, i) => i + 1);
        for (const budget of [...budgets, 0]) {
          const native = execute(sample, false, budget),
            name = `0x${sample.start.toString(16)} budget ${budget}`;
          assert.equal(pc(native.registers), (budget && trace[budget]) || sample.end, name);
          assert.equal(
            native.budget.counter,
            BigInt(budget ? Math.min(budget + 1, trace.length) : 0),
            name,
          );
          assert.deepEqual(execute(sample, true, budget), native, name);
          assert.deepEqual(
            charged,
            budget && budget < trace.length ? [] : [trace.length - 1],
            name,
          );
        }
      }
      // A live mapping protection change and a source that aliases the
      // mutable frame words must both use the original memory accesses.
      const page = destination & ~4095;
      p.cpu.mem_protect(page, 4096, p.uc.PROT_READ);
      const fault = execute(blend, false, 160);
      assert.match(fault.fault, /WRITE_PROT/i);
      assert.deepEqual(execute(blend, true, 160), fault);
      assert.deepEqual(charged, []);
      p.cpu.mem_protect(page, 4096, p.uc.PROT_READ | p.uc.PROT_WRITE);
      const alias = {
          ...blend,
          registers: { ...blend.registers, EDX: frame - 13, EAX: 0, EBX: 256 },
          words: [[frame - 4, 0]],
        },
        aliasOriginal = execute(alias, false, 160);
      assert.deepEqual(execute(alias, true, 160), aliasOriginal);
      assert.equal(pc(aliasOriginal.registers), blend.end);
      assert.ok(
        !charged.includes(Number(aliasOriginal.budget.counter) - 1),
        'the aliased entry cannot skip the whole loop',
      );

      // Stop between original stores, then continue the same partial loop
      // in a fresh process with a new budget segment.
      const partial = execute(blend, true, 43),
        saved = engine.snapshot(),
        resume = pc(partial.registers);
      assert.notEqual(resume, blend.start);
      assert.notEqual(resume, blend.end);
      loops.enabled = false;
      p.cpu.emu_start(resume, blend.end, 0, 160);
      const complete = state(p);
      fresh = await NativeEngineProcess.open(options);
      freshLoops = new NativeM2Blocks(fresh.process);
      fresh.restore(saved);
      assert.deepEqual(fresh.process.registers(), partial.registers);
      assert.deepEqual(fresh.process.read(arena, pixels.length), partial.memory);
      fresh.process.cpu.emu_start(resume, blend.end, 0, 160);
      if (fresh.process.pendingError) throw fresh.process.pendingError;
      assert.deepEqual(state(fresh.process), complete);
    } finally {
      freshLoops?.close();
      await fresh?.close();
      loops.close();
      await engine.close();
    }
  },
);
