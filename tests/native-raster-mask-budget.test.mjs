// SPDX-License-Identifier: MPL-2.0
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { NativeEngineProcess } from '../src/native/engine-process.mjs';
import { NativeRasterKernels } from '../oracle/raster-kernel-projection.mjs';

for (const [profile, fixture] of [
  ['nekopara-vol3-engine-2.6.1.76', 'CATSYSTEM2_ENGINE_EXE'],
  ['sdk-4.01-engine-2.6.1.74', 'CATSYSTEM2_SDK_EXE'],
])
  test(
    `${profile} MASK scanlines preserve original cutoffs, memory faults and restored execution`,
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
        row = kernels.abi.mask,
        start = row - 0x90,
        pixels = Uint8Array.from({ length: 0x7000 }, (_, i) => (i * 43 + 17) & 255),
        arena = p.allocate(pixels.length),
        descriptor = arena + 64,
        source = arena + 0x1000,
        destination = arena + 0x2800,
        page = Math.ceil(arena / 4096) * 4096 + 0x4000,
        stack = p.stackTop - 256,
        stackBytes = Uint8Array.from({ length: 256 }, (_, i) => (i * 67 + 11) & 255),
        initial = p.registers();
      let fresh;
      const read = (name, process = p) =>
          process.cpu.reg_read_i32(process.uc['X86_REG_' + name]) >>> 0,
        state = (process) => ({
          registers: process.registers(),
          pc: read('EIP', process),
          pixels: process.read(arena, pixels.length),
          stack: process.read(stack, stackBytes.length),
          budget: process.instructionBudget(),
        }),
        execute = (enabled, address, limit) => {
          kernels.enabled = enabled;
          p.pendingError = null;
          let fault;
          try {
            p.cpu.emu_start(address, p.sentinel, 0, limit);
          } catch (error) {
            fault = String(error);
          }
          if (p.pendingError) throw p.pendingError;
          return { ...state(p), fault };
        },
        run = (sample, enabled, limit) => {
          const {
              width = 4,
              height = 3,
              channel = 1,
              reverse = false,
              tight = false,
              input = source,
              output = destination,
            } = sample,
            dw = tight ? width : width + 3,
            dh = tight ? height : height + 2,
            sw = tight ? width : width + 4,
            sh = tight ? height : height + 2,
            dx = tight ? 0 : 1,
            dy = tight ? 0 : 1,
            sx = tight ? 0 : 2,
            sy = tight ? 0 : 1,
            destinationPitch = dw * 4 + (tight ? 0 : 12),
            sourcePitch = sw * 4 + (tight ? 0 : 16);
          p.write(arena, pixels);
          p.write(stack, stackBytes);
          const fields = [
            4,
            output,
            dw,
            dh,
            dx,
            dy,
            width,
            height,
            destinationPitch,
            0,
            4,
            input,
            sw,
            sh,
            sx,
            sy,
            width,
            height,
            sourcePitch,
            255,
            Number(reverse),
            0,
            0,
            channel,
          ];
          fields.forEach((value, i) => p.store(descriptor + i * 4, value));
          p.store(p.stackTop - 8, p.sentinel);
          p.store(p.stackTop - 4, descriptor);
          p.writeRegisters(initial);
          p.cpu.reg_write_i32(p.uc.X86_REG_ESP, p.stackTop - 8);
          p.cpu.reg_write_i32(p.uc.X86_REG_EFLAGS, 0x8d7);
          return execute(enabled, start, limit);
        },
        originalTrace = (sample) => {
          const trace = [],
            hook = p.cpu.hook_add(
              p.uc.HOOK_CODE,
              (_cpu, pc) => trace.push(Number(pc)),
              null,
              start,
              row + 0x5f,
            );
          try {
            p.invalidateExecutable(start, row + 0x60);
            const native = run(sample, false, 0);
            assert.equal(native.fault, undefined);
            assert.equal(native.pc, p.sentinel);
            assert.equal(read('EAX'), 1);
            return trace;
          } finally {
            p.cpu.hook_del(hook);
            p.invalidateExecutable(start, row + 0x60);
          }
        },
        cases = [
          { width: 1, height: 2, channel: 1, shortcut: true },
          { width: 3, height: 3, channel: 2, reverse: true, shortcut: true },
          { width: 4, height: 2, channel: 3, shortcut: true },
          { width: 2, height: 4, channel: 4, reverse: true, shortcut: true },
          { height: 1 },
          { width: 0, input: 0xfee00000, output: 0xfed00000 },
          { height: 0, input: 0xfee00000, output: 0xfed00000 },
          { width: 0, height: 0, input: 0xfee00000, output: 0xfed00000 },
          { input: destination - 4 },
        ];
      try {
        for (const [index, sample] of cases.entries()) {
          const trace = originalTrace(sample),
            finalRow = trace.lastIndexOf(row),
            budgets = Array.from({ length: trace.length + 2 }, (_, i) => i + 1);
          for (const limit of [...budgets, 0]) {
            const native = run(sample, false, limit),
              hits = kernels.hits.mask,
              name = `rectangle ${index}, budget ${limit}`;
            assert.equal(native.pc, (limit && trace[limit]) || p.sentinel, name);
            assert.equal(
              native.budget.counter,
              BigInt(limit ? Math.min(limit + 1, trace.length) : 0),
              name,
            );
            assert.deepEqual(run(sample, true, limit), native, name);
            assert.equal(
              kernels.hits.mask - hits,
              Number(Boolean(sample.shortcut) && (!limit || limit > finalRow)),
              name,
            );
          }
        }
        for (const readFault of [true, false]) {
          const sample = {
              width: 4,
              height: 2,
              tight: true,
              [readFault ? 'input' : 'output']: page - 16,
            },
            trace = originalTrace(sample),
            faultPC = row + (readFault ? 0x16 : 0x2a),
            faultIndex = trace.indexOf(faultPC, trace.lastIndexOf(row));
          p.cpu.mem_protect(page, 4096, readFault ? 0 : p.uc.PROT_READ);
          try {
            const beforeFault = run(sample, false, faultIndex),
              fault = run(sample, false, faultIndex + 1),
              hits = kernels.hits.mask;
            assert.equal(beforeFault.pc, faultPC);
            assert.equal(beforeFault.fault, undefined);
            const firstRow = (sample.output ?? destination) - arena;
            assert.ok(
              beforeFault.pixels
                .subarray(firstRow, firstRow + 16)
                .some((value, index) => value !== pixels[firstRow + index]),
            );
            assert.match(fault.fault, readFault ? /READ_PROT/i : /WRITE_PROT/i);
            assert.deepEqual(run(sample, true, faultIndex), beforeFault);
            assert.deepEqual(run(sample, true, faultIndex + 1), fault);
            assert.equal(kernels.hits.mask, hits);
          } finally {
            p.cpu.mem_protect(page, 4096, p.uc.PROT_READ | p.uc.PROT_WRITE);
          }
        }
        const sample = cases[1],
          entryBudget = originalTrace(sample).indexOf(row);
        for (const [register, value, limit] of [
          ['ESI', 0xfee00000, 1],
          ['EBP', 0xfee00000, 1],
          ['ECX', 0, 1000],
        ]) {
          const resume = (enabled) => {
            assert.equal(run(sample, false, entryBudget).pc, row);
            p.cpu.reg_write_i32(p.uc['X86_REG_' + register], value);
            return execute(enabled, row, limit);
          };
          assert.deepEqual(resume(true), resume(false), register);
        }
        const partial = run(sample, true, entryBudget),
          saved = engine.snapshot();
        assert.equal(partial.pc, row);
        const original = execute(false, row, 1000);
        fresh = await NativeEngineProcess.open(options);
        const restored = new NativeRasterKernels(fresh);
        fresh.restore(saved);
        fresh.process.cpu.emu_start(row, p.sentinel, 0, 1000);
        if (fresh.process.pendingError) throw fresh.process.pendingError;
        assert.deepEqual(state(fresh.process), state(p));
        assert.equal(original.fault, undefined);
        assert.equal(restored.hits.mask, 1);
      } finally {
        await fresh?.close();
        await engine.close();
      }
    },
  );
