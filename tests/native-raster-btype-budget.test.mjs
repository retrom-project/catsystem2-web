// SPDX-License-Identifier: MPL-2.0
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { NativeEngineProcess } from '../src/native/engine-process.mjs';
import { NativeRasterKernels } from '../oracle/raster-kernel-projection.mjs';

const normalPixels = [
    [0x7f605040, 0xff008040],
    [0xffa13678, 0x00408007],
    [0x186e319b, 0x6541ae27],
  ],
  transparentPixels = [
    [0x00605040, 0x00723456],
    [0x001c2e3f, 0xff408007],
  ],
  thresholdPixels = (low, high) =>
    Array.from({ length: 8 }, (_, bits) => {
      let destination = 0x57000000;
      for (let c = 0; c < 3; c++) destination |= (bits & (1 << c) ? high : low) << (c * 8);
      return [0x7f605040 + bits * 0x03050b, destination];
    });

for (const [profile, fixture] of [
  ['nekopara-vol3-engine-2.6.1.76', 'CATSYSTEM2_ENGINE_EXE'],
  ['sdk-4.01-engine-2.6.1.74', 'CATSYSTEM2_SDK_EXE'],
])
  test(
    profile + ' BTYPE preserves all five original mode cutoffs, faults and restoration',
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
        row = kernels.abi.btype,
        start = row - 0x190,
        cookie = row + 0x486 + (p.load(row + 0x482) | 0),
        jumpTable = row + 0x48c,
        pixels = Uint8Array.from({ length: 0x7000 }, (_, i) => (i * 43 + (i >>> 7) + 17) & 255),
        arena = p.allocate(pixels.length),
        descriptor = arena + 64,
        source = arena + 0x1000,
        destination = arena + 0x2800,
        page = Math.ceil(arena / 4096) * 4096 + 0x4000,
        stack = p.stackTop - 512,
        stackBytes = Uint8Array.from({ length: 512 }, (_, i) => (i * 67 + 11) & 255),
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
        run = (sample, enabled, limit, invoke = execute) => {
          const {
              pattern = normalPixels,
              tail = pattern,
              width = pattern.length,
              height = 2,
              opacity = 255,
              mode = 1,
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
            dp = dw * 4 + (tight ? 0 : 12),
            sp = sw * 4 + (tight ? 0 : 16);
          p.write(arena, pixels);
          p.write(stack, stackBytes);
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
            opacity,
            Number(reverse),
          ].forEach((value, i) => p.store(descriptor + i * 4, value));
          p.store(descriptor + 28 * 4, mode);
          for (let y = 0; y < height && width; y++) {
            const d = output + (y + dy) * dp + dx * 4,
              s = input + (reverse ? sh - sy - 1 - y : sy + y) * sp + sx * 4,
              values = y === height - 1 ? tail : pattern;
            for (let x = 0; x < width; x++) {
              const [src, dst] = values[x % values.length];
              p.store(s + x * 4, src);
              p.store(d + x * 4, dst);
            }
          }
          p.store(p.stackTop - 8, p.sentinel);
          p.store(p.stackTop - 4, descriptor);
          p.writeRegisters(initial);
          p.cpu.reg_write_i32(p.uc.X86_REG_ESP, p.stackTop - 8);
          p.cpu.reg_write_i32(p.uc.X86_REG_EFLAGS, 0x8d7);
          return invoke(enabled, start, limit);
        },
        originalTrace = (sample) => {
          const trace = [],
            hook = p.cpu.hook_add(p.uc.HOOK_CODE, (_cpu, pc) => trace.push(Number(pc)), null, 1, 0);
          try {
            p.invalidateExecutable(start, jumpTable);
            p.invalidateExecutable(cookie, cookie + 32);
            const original = run(sample, false, 0);
            assert.equal(original.fault, undefined);
            assert.equal(original.pc, p.sentinel);
            assert.equal(read('EAX'), 1);
            return trace;
          } finally {
            p.cpu.hook_del(hook);
            p.invalidateExecutable(start, jumpTable);
            p.invalidateExecutable(cookie, cookie + 32);
          }
        },
        cases = [
          { mode: 1, pattern: transparentPixels, body: 0x416 },
          { mode: 1, tail: transparentPixels, body: 0x5e },
          { mode: 2, input: source + 1, output: destination + 3, reverse: true, body: 0xa9 },
          { mode: 3, opacity: 127, height: 3, body: 0xef },
          { mode: 4, pattern: thresholdPixels(127, 128), reverse: true, body: 0x14d },
          { mode: 5, pattern: thresholdPixels(254, 255), tail: transparentPixels, body: 0x274 },
          { mode: 5, pattern: [transparentPixels[1]], height: 4, body: 0x416 },
          { mode: 0 },
          { mode: 6 },
          { width: 1, height: 1 },
          { width: 0, tight: true, input: 0xfee00000, output: 0xfed00000 },
          { height: 0, input: 0xfee00000, output: 0xfed00000 },
          { width: 2, tight: true, input: destination - 4 },
        ];
      try {
        for (const [index, sample] of cases.entries()) {
          const trace = originalTrace(sample),
            first = trace.indexOf(row),
            tail = trace.lastIndexOf(row + 0x46e),
            limits =
              first < 0
                ? [0, 1, trace.length - 1, trace.length, trace.length + 1]
                : [0, ...Array.from({ length: trace.length + 2 - first }, (_, i) => i + first)];
          if (sample.body)
            assert.ok(trace.includes(row + sample.body), 'original BTYPE path ' + index);
          for (const limit of limits) {
            const original = run(sample, false, limit),
              hits = kernels.hits.btype,
              label = 'rectangle ' + index + ', budget ' + limit;
            assert.equal(original.pc, (limit && trace[limit]) || p.sentinel, label);
            assert.equal(
              original.budget.counter,
              BigInt(limit ? Math.min(limit + 1, trace.length) : 0),
              label,
            );
            assert.deepEqual(run(sample, true, limit), original, label);
            assert.equal(
              kernels.hits.btype - hits,
              Number(Boolean(sample.body) && (!limit || limit > tail)),
              label,
            );
          }
        }
        for (const readFault of [true, false]) {
          const sample = {
              width: 4,
              pattern: [[0xff000000, 0x00112233]],
              tight: true,
              [readFault ? 'input' : 'output']: page - 16,
            },
            trace = originalTrace(sample),
            faultPC = row + (readFault ? 0x20 : 0x3ac),
            faultIndex = trace.indexOf(faultPC, trace.lastIndexOf(row));
          p.cpu.mem_protect(page, 4096, readFault ? 0 : p.uc.PROT_READ);
          try {
            const beforeFault = run(sample, false, faultIndex),
              fault = run(sample, false, faultIndex + 1),
              hits = kernels.hits.btype;
            assert.equal(beforeFault.pc, faultPC);
            assert.equal(beforeFault.fault, undefined);
            const firstRow = (sample.output ?? destination) - arena;
            assert.deepEqual(
              [...new Uint32Array(beforeFault.pixels.slice(firstRow, firstRow + 16).buffer)],
              Array(4).fill(0xff000000),
            );
            assert.match(fault.fault, readFault ? /READ_PROT/i : /WRITE_PROT/i);
            assert.deepEqual(run(sample, true, faultIndex), beforeFault);
            assert.deepEqual(run(sample, true, faultIndex + 1), fault);
            assert.equal(kernels.hits.btype, hits);
          } finally {
            p.cpu.mem_protect(page, 4096, p.uc.PROT_READ | p.uc.PROT_WRITE);
          }
        }
        const originalJump = p.load(jumpTable),
          redirected = cases[1];
        p.store(jumpTable, p.load(jumpTable + 4));
        try {
          const trace = originalTrace(redirected),
            hits = kernels.hits.btype;
          assert.ok(trace.includes(row + 0xa9));
          assert.deepEqual(
            run(redirected, true, trace.length),
            run(redirected, false, trace.length),
          );
          assert.equal(kernels.hits.btype, hits);
        } finally {
          p.store(jumpTable, originalJump);
        }
        const sample = cases[5],
          entryBudget = originalTrace(sample).indexOf(row);
        for (const [register, value, limit] of [
          ['EDX', 0xfee00000, 3],
          ['EBP', 0xfee00000, 2],
          ['EDI', 0xfed00000, 1000],
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
        const original = execute(false, row, 4000);
        fresh = await NativeEngineProcess.open(options);
        const restored = new NativeRasterKernels(fresh);
        fresh.restore(saved);
        fresh.process.cpu.emu_start(row, p.sentinel, 0, 4000);
        if (fresh.process.pendingError) throw fresh.process.pendingError;
        assert.deepEqual(state(fresh.process), state(p));
        assert.equal(original.fault, undefined);
        assert.equal(restored.hits.btype, 1);

        for (const mode of [1, 2, 3, 4, 5]) {
          const pattern = mode === 4 ? thresholdPixels(127, 128) : thresholdPixels(254, 255),
            rectangle = {
              pattern,
              width: 8,
              height: 5,
              tight: true,
              mode,
              reverse: mode % 2 === 1,
            },
            trace = originalTrace(rectangle),
            credit = trace.lastIndexOf(row) - trace.indexOf(row),
            cap = trace.length - credit,
            allowance = () => ({
              destination,
              width: rectangle.width,
              height: rectangle.height,
              pitch: rectangle.width * 4,
              pixels: rectangle.width * rectangle.height,
              credited: 0,
            }),
            invoke = (rasterBudget) => (enabled, address, limit) => {
              kernels.enabled = enabled;
              p.budget = limit;
              let fault;
              try {
                p.call(address, [descriptor], undefined, { rasterBudget });
              } catch (error) {
                fault = error.message;
              }
              assert.equal(p.rasterBudget, undefined);
              return { ...state(p), fault };
            },
            scope = allowance(),
            completed = run(rectangle, false, trace.length, invoke()),
            scoped = run(rectangle, true, cap, invoke(scope)),
            cutoff = run(rectangle, false, cap, invoke());
          assert.equal(completed.pc, p.sentinel);
          assert.equal(completed.fault, undefined);
          assert.deepEqual(scoped, { ...completed, budget: scoped.budget });
          assert.equal(scoped.budget.counter + BigInt(scope.credited), BigInt(trace.length));
          assert.equal(scoped.budget.limit, BigInt(cap));
          assert.equal(scope.credited, credit);
          assert.equal(scope.pixels, 0);
          assert.equal(cutoff.fault, 'PE32 execution instruction budget exhausted');
          assert.deepEqual(run(rectangle, true, cap, invoke(scope)), cutoff);
          assert.deepEqual(
            run(rectangle, true, cap, invoke({ ...allowance(), pitch: 36 })),
            cutoff,
          );
          const short = trace.indexOf(row) + 20 + 15 * rectangle.width,
            shortScope = allowance();
          assert.deepEqual(
            run(rectangle, true, short, invoke(shortScope)),
            run(rectangle, false, short, invoke()),
          );
          assert.deepEqual(shortScope, allowance());
          if (mode === 4) {
            assert.deepEqual(
              run(rectangle, true, cap, invoke({ ...allowance(), pixels: NaN })),
              cutoff,
            );
            const observed = allowance(),
              detach = p.beforeInstruction(
                row + 0x14d,
                'observe the original overlay branch',
                () => {},
              );
            try {
              assert.deepEqual(run(rectangle, true, cap, invoke(observed)), cutoff);
              assert.deepEqual(observed, allowance());
            } finally {
              detach();
            }
            const unreadable = { ...rectangle, input: page - rectangle.width * 4 },
              faultScope = allowance();
            p.cpu.mem_protect(page, 4096, 0);
            try {
              const fault = run(unreadable, false, cap, invoke());
              assert.match(fault.fault, /READ_PROT/i);
              assert.deepEqual(run(unreadable, true, cap, invoke(faultScope)), fault);
              assert.deepEqual(faultScope, allowance());
            } finally {
              p.cpu.mem_protect(page, 4096, p.uc.PROT_READ | p.uc.PROT_WRITE);
            }
          }
        }
      } finally {
        await fresh?.close();
        await engine.close();
      }
    },
  );
