// SPDX-License-Identifier: MPL-2.0
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { floatBits } from '../src/kcs.mjs';
import { NativeEngineProcess } from '../src/native/engine-process.mjs';
import { NativeRasterKernels } from '../src/native/raster-kernel.mjs';

const identity = [32768, 0, 0, 32768];

for (const [profile, fixture] of [
  ['nekopara-vol3-engine-2.6.1.76', 'CATSYSTEM2_ENGINE_EXE'],
  ['sdk-4.01-engine-2.6.1.74', 'CATSYSTEM2_SDK_EXE'],
])
  test(
    profile + ' ordinary affine preserves original sampling cutoffs, CPU faults and restoration',
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
        { affine: row, affineSampler: sampler, affineMultiply: multiply } = kernels.abi,
        start = row - 0x233,
        pixels = Uint8Array.from({ length: 0x7000 }, (_, i) => (i * 43 + (i >>> 7) + 17) & 255),
        arena = p.allocate(pixels.length),
        descriptor = arena + 64,
        source = arena + 0x1000,
        destination = arena + 0x2800,
        page = Math.ceil(arena / 4096) * 4096 + 0x4000,
        stack = p.stackTop - 640,
        stackBytes = Uint8Array.from({ length: 640 }, (_, i) => (i * 67 + 11) & 255),
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
            width = 2,
            height = 2,
            sw = 3,
            sh = 3,
            sp = sw * 4,
            dp = width * 4,
            left = 0,
            top = 0,
            matrix = identity,
            position = [0, 0],
            base = [0, 0],
            translate = [0, 0],
            correction = [0, 0],
            sourceAlphas = [255],
            destinationAlphas = [0, 85, 255],
            opacity = 255,
            input = source,
            output = destination,
            mxcsr = 0x1f80,
          } = sample;
          p.write(arena, pixels);
          p.write(stack, stackBytes);
          p.zero(descriptor, 200);
          for (const [index, value] of [
            [0, 4],
            [1, output],
            [2, width],
            [3, height],
            [4, floatBits(position[0])],
            [5, floatBits(position[1])],
            [10, dp],
            [12, 4],
            [13, input],
            [14, sw],
            [15, sh],
            [16, sp],
            [17, opacity],
            [26, floatBits(base[0])],
            [27, floatBits(base[1])],
            [32, left],
            [33, top],
            [34, width],
            [35, height],
            [36, matrix[0]],
            [37, matrix[1]],
            [39, matrix[2]],
            [40, matrix[3]],
            [42, translate[0]],
            [43, translate[1]],
            [45, correction[0]],
            [46, correction[1]],
          ])
            p.store(descriptor + index * 4, value);
          if (input < arena + pixels.length)
            for (let y = 0; y < sh; y++)
              for (let x = 0; x < sw; x++) {
                const alpha = sourceAlphas[(x + y * sw) % sourceAlphas.length],
                  color = 0x314a65 + x * 0x04050b + y * 0x070905;
                p.store(input + y * sp + x * 4, (alpha << 24) | color);
              }
          if (output < arena + pixels.length)
            for (let y = 0; y < height; y++)
              for (let x = 0; x < width; x++) {
                const alpha = destinationAlphas[(x + y * width) % destinationAlphas.length],
                  color = 0x17659c - x * 0x030701 + y * 0x010405;
                p.store(output + y * dp + x * 4, (alpha << 24) | color);
              }
          p.store(p.stackTop - 8, p.sentinel);
          p.store(p.stackTop - 4, descriptor);
          p.writeRegisters(initial);
          p.cpu.reg_write_i32(p.uc.X86_REG_ESP, p.stackTop - 8);
          p.cpu.reg_write_i32(p.uc.X86_REG_EFLAGS, 0x8d7);
          p.cpu.reg_write_i32(p.uc.X86_REG_MXCSR, mxcsr);
          return execute(enabled, start, limit);
        },
        invalidate = () =>
          p.invalidateExecutable(
            engine.module.base,
            engine.module.base + engine.module.pe.image.length,
          ),
        originalTrace = (sample) => {
          const trace = [],
            hook = p.cpu.hook_add(p.uc.HOOK_CODE, (_cpu, pc) => trace.push(Number(pc)), null, 1, 0);
          try {
            invalidate();
            const original = run(sample, false, 0);
            assert.equal(original.fault, undefined);
            assert.equal(original.pc, p.sentinel);
            assert.equal(read('EAX'), 1);
            return trace;
          } finally {
            p.cpu.hook_del(hook);
            invalidate();
          }
        },
        cases = [
          { body: row + 0x45f },
          {
            width: 3,
            height: 3,
            left: 1,
            top: 1,
            position: [0.25, -0.75],
            base: [0.2, -0.9],
            matrix: [23170, -23170, 23170, 23170],
            correction: [1234, -5678],
            mxcsr: 0x7f80,
            body: multiply + 0x19,
          },
          {
            matrix: [-32768, 0, 0, -32768],
            translate: [65536, 65536],
            sourceAlphas: [127],
            destinationAlphas: [255],
            body: row + 0x40e,
          },
          { sourceAlphas: [0], body: row + 0x19c },
          { opacity: 0, destinationAlphas: [0, 127, 255], body: row + 0x459 },
          {
            opacity: 171,
            sp: 13,
            dp: 9,
            translate: [16384, 16384],
            sourceAlphas: [1, 31, 127, 255],
            destinationAlphas: [67],
            body: row + 0x34a,
          },
          { base: [8.75, 0], body: sampler + 0xbc },
          { base: [0, 8.75], body: sampler + 0x14 },
          {
            sw: 1,
            sh: 2,
            width: 1,
            translate: [8192, 0],
            sourceAlphas: [31, 255],
            body: sampler + 0xa7,
          },
          {
            correction: [0x7fffffff, -0x80000000],
            matrix: [4194303, -32768, 32768, 4194303],
            body: multiply + 0x19,
          },
          { width: 0, input: 0xfee00000, output: 0xfed00000 },
          { height: 0, input: 0xfee00000, output: 0xfed00000 },
          { height: 1 },
          { matrix: [0x400000, 0, 0, 32768] },
          { input: destination - 4 },
        ];
      try {
        for (const [index, sample] of cases.entries()) {
          const trace = originalTrace(sample),
            first = trace.indexOf(row),
            tail = trace.lastIndexOf(row + 0x4cc),
            limits =
              first < 0
                ? [0, 1, trace.length - 1, trace.length, trace.length + 1]
                : [0, ...Array.from({ length: trace.length + 2 - first }, (_, i) => i + first)];
          if (sample.body) assert.ok(trace.includes(sample.body), 'original affine path ' + index);
          for (const limit of limits) {
            const original = run(sample, false, limit),
              hits = kernels.hits.affine,
              label = 'rectangle ' + index + ', budget ' + limit;
            assert.equal(original.pc, (limit && trace[limit]) || p.sentinel, label);
            assert.equal(
              original.budget.counter,
              BigInt(limit ? Math.min(limit + 1, trace.length) : 0),
              label,
            );
            assert.deepEqual(run(sample, true, limit), original, label);
            assert.equal(
              kernels.hits.affine - hits,
              Number(Boolean(sample.body) && (!limit || limit > tail)),
              label,
            );
          }
        }
        for (const readFault of [true, false]) {
          const sample = {
              width: 1,
              sw: 1,
              sh: 3,
              [readFault ? 'input' : 'output']: page - (readFault ? 8 : 4),
            },
            trace = originalTrace(sample),
            faultPC = readFault ? sampler + 0x91 : row + 0x465,
            faultIndex = trace.indexOf(faultPC, trace.lastIndexOf(row));
          p.cpu.mem_protect(page, 4096, readFault ? 0 : p.uc.PROT_READ);
          try {
            const beforeFault = run(sample, false, faultIndex),
              fault = run(sample, false, faultIndex + 1),
              hits = kernels.hits.affine;
            assert.equal(beforeFault.pc, faultPC);
            assert.equal(beforeFault.fault, undefined);
            assert.equal(p.load(sample.output ?? destination), 0xff314a65);
            assert.match(fault.fault, readFault ? /READ_PROT/i : /WRITE_PROT/i);
            assert.deepEqual(run(sample, true, faultIndex), beforeFault);
            assert.deepEqual(run(sample, true, faultIndex + 1), fault);
            assert.equal(kernels.hits.affine, hits);
          } finally {
            p.cpu.mem_protect(page, 4096, p.uc.PROT_READ | p.uc.PROT_WRITE);
          }
        }
        const mulPage = multiply & ~4095;
        p.cpu.mem_protect(mulPage, 4096, p.uc.PROT_READ);
        try {
          const original = run(cases[0], false, 10000),
            hits = kernels.hits.affine;
          assert.match(original.fault, /FETCH_PROT/i);
          assert.deepEqual(run(cases[0], true, 10000), original);
          assert.equal(kernels.hits.affine, hits);
        } finally {
          p.cpu.mem_protect(mulPage, 4096, p.uc.PROT_ALL);
        }
        const sample = { ...cases[5], base: [0.25, 0.75] },
          entryBudget = originalTrace(sample).indexOf(row);
        for (const [register, value, limit] of [
          ['EBX', 0xfee00000, 1],
          ['EBP', 0xfee00000, 3],
          ['ESI', 0xfee00000, 1000],
          ['MXCSR', 0x0f80, 10000],
        ]) {
          const resume = (enabled) => {
            assert.equal(run(sample, false, entryBudget).pc, row);
            p.cpu.reg_write_i32(p.uc['X86_REG_' + register], value);
            return execute(enabled, row, limit);
          };
          const original = resume(false),
            hits = kernels.hits.affine;
          assert.deepEqual(resume(true), original, register);
          assert.equal(kernels.hits.affine, hits, register);
        }
        const partial = run(sample, true, entryBudget),
          saved = engine.snapshot();
        assert.equal(partial.pc, row);
        const original = execute(false, row, 10000);
        fresh = await NativeEngineProcess.open(options);
        const restored = new NativeRasterKernels(fresh);
        fresh.restore(saved);
        fresh.process.cpu.emu_start(row, p.sentinel, 0, 10000);
        if (fresh.process.pendingError) throw fresh.process.pendingError;
        assert.deepEqual(state(fresh.process), state(p));
        assert.equal(original.fault, undefined);
        assert.equal(restored.hits.affine, 1);
      } finally {
        await fresh?.close();
        await engine.close();
      }
    },
  );
