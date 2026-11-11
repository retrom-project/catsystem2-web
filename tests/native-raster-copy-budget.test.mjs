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
    profile + ' COPY rows preserve budget cutoffs, faults and fresh CPU state',
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
        {
          copy: row,
          copyWrapper,
          memcpy,
          copyCaps,
          copyMMX,
          copyCRTFlags,
          copyCRTAlignedSIMD,
        } = kernels.abi,
        start = row - 0x76,
        pixels = Uint8Array.from({ length: 0x7000 }, (_, i) => (i * 43 + (i >>> 7) + 17) & 255),
        arena = p.allocate(pixels.length),
        descriptor = arena + 64,
        source = arena + 0x1000,
        destination = arena + 0x2800,
        caps = arena + 0x5000,
        page = Math.ceil(arena / 4096) * 4096 + 0x4000,
        stack = p.stackTop - 256,
        stackBytes = Uint8Array.from({ length: 256 }, (_, i) => (i * 67 + 11) & 255),
        initial = p.registers();
      initial.FPSW = [0, 0x30];
      initial.FPTAG = [0xff, 0x0f];
      initial.FP6 = [0, 0, 0, 0, 0, 0, 0, 0x80, 0xff, 0x3f];
      initial.FP7 = [0, 0, 0, 0, 0, 0, 0, 0xc0, 0, 0x40];
      initial.XMM0 = Array.from({ length: 16 }, (_, i) => i * 13);
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
              reverse = false,
              tight = false,
              input = source,
              output = destination,
              mode = 'crt',
              flags = 0x8d7,
            } = sample,
            dw = tight ? width : width + 3,
            dh = tight ? height : height + 2,
            sw = tight ? width : width + 4,
            sh = tight ? height : height + 2,
            dx = tight ? 0 : 1,
            dy = tight ? 0 : 1,
            sx = tight ? 0 : 2,
            sy = tight ? 0 : 1,
            dp = dw * 4 + (tight ? 0 : 12),
            sp = sw * 4 + (tight ? 0 : 16);
          p.write(arena, pixels);
          p.write(stack, stackBytes);
          p.store(copyCaps, mode === 'scalar' || mode === 'mmx' ? caps : 0);
          p.store(caps + copyMMX, Number(mode === 'mmx'));
          p.store(copyCRTFlags, mode === 'rep-byte' ? 2 : Number(mode === 'sse'));
          p.store(copyCRTAlignedSIMD, mode === 'sse-aligned' ? 2 : 1);
          [
            4,
            output,
            dw,
            dh,
            dx,
            dy,
            width,
            height,
            dp,
            0,
            4,
            input,
            sw,
            sh,
            sx,
            sy,
            width,
            height,
            sp,
            255,
            Number(reverse),
          ].forEach((value, i) => p.store(descriptor + i * 4, value));
          p.store(p.stackTop - 8, p.sentinel);
          p.store(p.stackTop - 4, descriptor);
          p.writeRegisters(initial);
          p.cpu.reg_write_i32(p.uc.X86_REG_ESP, p.stackTop - 8);
          p.cpu.reg_write_i32(p.uc.X86_REG_EFLAGS, flags);
          return execute(enabled, start, limit);
        },
        originalTrace = (sample) => {
          const trace = [],
            hook = p.cpu.hook_add(p.uc.HOOK_CODE, (_cpu, pc) => trace.push(Number(pc)), null, 1, 0);
          try {
            for (const address of [start, copyWrapper, kernels.abi.copyGetCaps, memcpy])
              p.invalidateExecutable(address, address + 0x600);
            const original = run(sample, false, 0);
            assert.equal(original.fault, undefined);
            assert.equal(original.pc, p.sentinel);
            assert.equal(read('EAX'), 1);
            return trace;
          } finally {
            p.cpu.hook_del(hook);
            for (const address of [start, copyWrapper, kernels.abi.copyGetCaps, memcpy])
              p.invalidateExecutable(address, address + 0x600);
          }
        },
        cases = [
          { width: 3, height: 2, body: memcpy + 0x30c },
          {
            width: 7,
            height: 3,
            reverse: true,
            input: destination,
            output: source,
            body: memcpy + 0x2ec,
          },
          { width: 8, height: 3, body: memcpy + 0x21e },
          { width: 31, height: 2, body: memcpy + 0x21e },
          { width: 32, height: 2, tight: true, body: memcpy + 0x48 },
          { width: 33, height: 5, output: destination + 12, body: memcpy + 0x48 },
          {
            width: 2,
            height: 3,
            mode: 'scalar',
            output: destination + 1,
            body: copyWrapper + 0x9b,
          },
          { width: 3, height: 2, mode: 'mmx', reverse: true, body: copyWrapper + 0x75 },
          { width: 4, height: 3, mode: 'mmx', body: copyWrapper + 0x4f },
          { width: 5, height: 2, mode: 'rep-byte', output: destination + 1, body: memcpy + 0x2a },
          { width: 35, height: 2, mode: 'sse', tight: true },
          { width: 32, height: 2, mode: 'sse-aligned', tight: true },
          { height: 2, output: destination + 1 },
          { width: 8, height: 2, flags: 0xcd7 },
          { height: 1 },
          { width: 0, input: 0xfee00000, output: 0xfed00000 },
          { height: 0, input: 0xfee00000, output: 0xfed00000 },
          { input: destination - 4 },
        ];
      try {
        for (const [index, sample] of cases.entries()) {
          const trace = originalTrace(sample),
            tail = trace.lastIndexOf(row + 0x22);
          if (sample.body) assert.ok(trace.includes(sample.body), 'original copy path ' + index);
          for (let limit = 0; limit <= trace.length + 1; limit++) {
            const original = run(sample, false, limit),
              hits = kernels.hits.copy,
              label = 'rectangle ' + index + ', budget ' + limit;
            assert.equal(original.pc, (limit && trace[limit]) || p.sentinel, label);
            assert.equal(
              original.budget.counter,
              BigInt(limit ? Math.min(limit + 1, trace.length) : 0),
              label,
            );
            assert.deepEqual(run(sample, true, limit), original, label);
            assert.equal(
              kernels.hits.copy - hits,
              Number(Boolean(sample.body) && (!limit || limit > tail)),
              label,
            );
          }
        }
        for (const readFault of [true, false]) {
          const sample = {
              height: 2,
              tight: true,
              [readFault ? 'input' : 'output']: page - 16,
            },
            trace = originalTrace(sample),
            faultPC = memcpy + (readFault ? 0x304 : 0x308),
            faultIndex = trace.indexOf(faultPC, trace.lastIndexOf(row));
          p.cpu.mem_protect(page, 4096, readFault ? 0 : p.uc.PROT_READ);
          try {
            const beforeFault = run(sample, false, faultIndex),
              fault = run(sample, false, faultIndex + 1),
              hits = kernels.hits.copy;
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
            assert.equal(kernels.hits.copy, hits);
          } finally {
            p.cpu.mem_protect(page, 4096, p.uc.PROT_READ | p.uc.PROT_WRITE);
          }
        }
        const codePage = memcpy & ~4095;
        p.cpu.mem_protect(codePage, 4096, p.uc.PROT_READ);
        try {
          const original = run(cases[0], false, 1000),
            hits = kernels.hits.copy;
          assert.match(original.fault, /FETCH_PROT/i);
          assert.deepEqual(run(cases[0], true, 1000), original);
          assert.equal(kernels.hits.copy, hits);
        } finally {
          p.cpu.mem_protect(codePage, 4096, p.uc.PROT_ALL);
        }
        const sample = cases[7],
          entryBudget = originalTrace(sample).indexOf(row);
        for (const [register, value, limit] of [
          ['ESI', 0xfee00000, 1],
          ['EBP', 0xfee00000, 1],
          ['ESP', 0xfee00000, 5],
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
        assert.equal(restored.hits.copy, 1);
      } finally {
        await fresh?.close();
        await engine.close();
      }
    },
  );
