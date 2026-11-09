// SPDX-License-Identifier: MPL-2.0
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { NativeEngineProcess } from '../src/native/engine-process.mjs';
import { NativeRasterKernels } from '../src/native/raster-kernel.mjs';

for (const [profile, fixture] of [
  ['nekopara-vol3-engine-2.6.1.76', 'CATSYSTEM2_ENGINE_EXE'],
  ['sdk-4.01-engine-2.6.1.74', 'CATSYSTEM2_SDK_EXE'],
])
  test(
    `${profile} alpha discovery preserves original budgets, early exits, empty images and fresh continuation`,
    { skip: !process.env[fixture] },
    async () => {
      const options = {
          profile,
          bytes: new Uint8Array(await readFile(process.env[fixture])),
          heapSize: 0x200000,
        },
        engine = await NativeEngineProcess.open(options),
        p = engine.process,
        kernels = new NativeRasterKernels(engine),
        rowEntry = kernels.abi.alpha,
        comparison = rowEntry + 8,
        start = rowEntry - 0x28,
        arena = p.allocate(0x5000),
        owner = arena + 64,
        page = Math.ceil(arena / 4096) * 4096 + 0x2000,
        stack = p.stackTop - 256,
        initial = p.registers(),
        pixels = Uint8Array.from({ length: 0x5000 }, (_, i) => (i * 89 + 53) & 255),
        stackBytes = Uint8Array.from({ length: 256 }, (_, i) => (i * 37 + 11) & 255);
      let fresh;
      const read = (name, process = p) =>
          process.cpu.reg_read_i32(process.uc['X86_REG_' + name]) >>> 0,
        state = (process) => ({
          registers: process.registers(),
          pc: read('EIP', process),
          pixels: process.read(arena, pixels.length),
          stack: process.read(stack, 256),
          budget: process.instructionBudget(),
        }),
        run = (sample, enabled, limit) => {
          kernels.enabled = enabled;
          const {
              width = 5,
              height = 3,
              stride = width * 4 + 4,
              data = page - 1024,
              bpp = 4,
              cached = 0,
              transparent,
            } = sample,
            input = pixels.slice();
          if (bpp === 4 && width && height && !cached) {
            for (let y = 0; y < height; y++)
              for (let x = 0; x < width; x++) input[data - arena + y * stride + x * 4 + 3] = 255;
            if (transparent) {
              const [y, x, alpha] = transparent;
              input[data - arena + y * stride + x * 4 + 3] = alpha;
            }
          }
          p.write(arena, input);
          p.write(stack, stackBytes);
          [0, width, height, data, stride * height, stride, bpp].forEach((value, i) =>
            p.store(owner + i * 4, value),
          );
          p.store(owner + 44, cached);
          p.store(p.stackTop - 4, p.sentinel);
          p.writeRegisters(initial);
          p.cpu.reg_write_i32(p.uc.X86_REG_ECX, owner);
          p.cpu.reg_write_i32(p.uc.X86_REG_ESP, p.stackTop - 4);
          p.cpu.reg_write_i32(p.uc.X86_REG_EFLAGS, 0x8d7);
          p.pendingError = null;
          let fault;
          try {
            p.cpu.emu_start(start, p.sentinel, 0, limit);
          } catch (error) {
            fault = String(error);
          }
          if (p.pendingError) throw p.pendingError;
          return { ...state(p), fault };
        },
        nativeTrace = (sample) => {
          const trace = [],
            hook = p.cpu.hook_add(
              p.uc.HOOK_CODE,
              (_cpu, pc) => trace.push(Number(pc)),
              null,
              start,
              rowEntry + 0x4c,
            );
          try {
            p.invalidateExecutable(start, rowEntry + 0x4d);
            const full = run(sample, false, 0);
            assert.equal(full.fault, undefined);
            assert.equal(full.pc, p.sentinel);
            return trace;
          } finally {
            p.cpu.hook_del(hook);
            p.invalidateExecutable(start, rowEntry + 0x4d);
          }
        },
        opaque = {},
        cases = [
          { transparent: [0, 0, 0] },
          { transparent: [0, 4, 127] },
          { transparent: [1, 0, 254] },
          { transparent: [2, 3, 128] },
          opaque,
          { width: 1, height: 1 },
          { width: 1, height: 1, transparent: [0, 0, 254] },
          { width: 0, data: 0xfee00000 },
          { height: 0, data: 0xfee00000 },
          { width: 0, height: 0, data: 0xfee00000 },
          { cached: 1, data: 0xfee00000 },
          { cached: 2, data: 0xfee00000 },
          { bpp: 3, data: 0xfee00000 },
        ];
      try {
        for (const [index, sample] of cases.entries()) {
          const trace = nativeTrace(sample),
            compare = trace.lastIndexOf(comparison),
            cached = sample.bpp === 3 ? 0 : (sample.cached ?? (sample.transparent ? 2 : 1));
          assert.equal(p.load(owner + 44), cached);
          assert.equal(read('EAX'), Number(cached === 2));
          const budgets = Array.from({ length: trace.length + 2 }, (_, i) => i + 1);
          for (const limit of [...budgets, 0]) {
            const expected = run(sample, false, limit),
              hits = kernels.hits.alpha,
              name = `image ${index}, budget ${limit}`;
            assert.equal(expected.pc, (limit && trace[limit]) || p.sentinel, name);
            assert.equal(
              expected.budget.counter,
              BigInt(limit ? Math.min(limit + 1, trace.length) : 0),
              name,
            );
            assert.deepEqual(run(sample, true, limit), expected, name);
            assert.equal(
              kernels.hits.alpha - hits,
              Number(compare >= 0 && (!limit || limit > compare)),
              name,
            );
          }
        }
        const split = { width: 4, height: 1, data: page - 8 },
          comparisons = nativeTrace(split).flatMap((pc, index) =>
            pc === comparison ? [index] : [],
          ),
          firstProtectedPixel = comparisons[2];
        p.cpu.mem_protect(page, 4096, 0);
        try {
          const beforeFault = run(split, false, firstProtectedPixel),
            fault = run(split, false, firstProtectedPixel + 1),
            early = { ...split, transparent: [0, 1, 254] },
            earlyReference = run(early, false, 1000),
            hits = kernels.hits.alpha;
          assert.equal(beforeFault.fault, undefined);
          assert.equal(beforeFault.pc, comparison);
          assert.match(fault.fault, /READ_PROT/i);
          assert.equal(fault.pc, comparison);
          assert.equal(earlyReference.fault, undefined);
          assert.equal(read('EAX'), 1);
          assert.deepEqual(run(split, true, firstProtectedPixel), beforeFault);
          assert.deepEqual(run(split, true, firstProtectedPixel + 1), fault);
          assert.deepEqual(run(early, true, 1000), earlyReference);
          assert.equal(kernels.hits.alpha, hits);
        } finally {
          p.cpu.mem_protect(page, 4096, p.uc.PROT_READ | p.uc.PROT_WRITE);
        }
        const trace = nativeTrace(opaque),
          partial = run(opaque, true, trace.indexOf(rowEntry)),
          saved = engine.snapshot();
        assert.equal(partial.pc, rowEntry);
        kernels.enabled = false;
        p.cpu.emu_start(rowEntry, p.sentinel, 0, 1000);
        const original = state(p);
        fresh = await NativeEngineProcess.open(options);
        const restored = new NativeRasterKernels(fresh);
        fresh.restore(saved);
        fresh.process.cpu.emu_start(rowEntry, p.sentinel, 0, 1000);
        if (fresh.process.pendingError) throw fresh.process.pendingError;
        assert.deepEqual(state(fresh.process), original);
        assert.equal(restored.hits.alpha, 1);
      } finally {
        await fresh?.close();
        await engine.close();
      }
    },
  );
