// SPDX-License-Identifier: MPL-2.0
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { NativeEngineProcess } from '../src/native/engine-process.mjs';
import { NativeRasterKernels } from '../oracle/raster-kernel-projection.mjs';

const pixelPaths = [
  [0x00605040, 0x00000002, 0x19a],
  [0x00605040, 0, 0x19f],
  [0xff605040, 0x00408007, 0x19f],
  [0x01605040, 0x00408007, 0x192],
  [0x7f605040, 0xff408007, 0x147],
  [0x7f605040, 0x31408007, 0x90],
];

for (const [profile, fixture] of [
  ['nekopara-vol3-engine-2.6.1.76', 'CATSYSTEM2_ENGINE_EXE'],
  ['sdk-4.01-engine-2.6.1.74', 'CATSYSTEM2_SDK_EXE'],
])
  test(
    profile + ' normal blend preserves original budget cutoffs, padding, faults and restoration',
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
        row = kernels.abi.normal,
        start = row - 0x190,
        cookie = row + 0x24c + (p.load(row + 0x248) | 0),
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
        run = (sample, enabled, limit) => {
          const {
              pattern = [pixelPaths[2]],
              tail = pattern,
              width = pattern.length,
              height = 2,
              opacity = 255,
              reverse = false,
              tight = false,
              left = 0,
              right = 0x005789ab,
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
          for (let y = 0; y < height && width; y++) {
            const d = output + (y + dy) * dp + dx * 4,
              s = input + (reverse ? sh - sy - 1 - y : sy + y) * sp + sx * 4,
              values = y === height - 1 ? tail : pattern;
            for (let x = 0; x < width; x++) {
              const [src, dst] = values[x % values.length];
              p.store(s + x * 4, src);
              p.store(d + x * 4, dst);
            }
            if (!tight) {
              p.store(d - 4, left);
              p.store(d + width * 4, right);
            }
          }
          p.store(p.stackTop - 8, p.sentinel);
          p.store(p.stackTop - 4, descriptor);
          p.writeRegisters(initial);
          p.cpu.reg_write_i32(p.uc.X86_REG_ESP, p.stackTop - 8);
          p.cpu.reg_write_i32(p.uc.X86_REG_EFLAGS, 0x8d7);
          return execute(enabled, start, limit);
        },
        originalTrace = (sample) => {
          const trace = [],
            hook = p.cpu.hook_add(p.uc.HOOK_CODE, (_cpu, pc) => trace.push(Number(pc)), null, 1, 0);
          try {
            p.invalidateExecutable(start, row + 0x252);
            p.invalidateExecutable(cookie, cookie + 32);
            const original = run(sample, false, 0);
            assert.equal(original.fault, undefined);
            assert.equal(original.pc, p.sentinel);
            assert.equal(read('EAX'), 1);
            return trace;
          } finally {
            p.cpu.hook_del(hook);
            p.invalidateExecutable(start, row + 0x252);
            p.invalidateExecutable(cookie, cookie + 32);
          }
        },
        cases = [
          ...pixelPaths.map((pixel, index) => ({
            pattern: [pixel],
            left: index % 2 ? 0x00000011 : 0,
            right: index % 2 ? 0 : 0x005789ab,
            reverse: Boolean(index % 2),
            body: pixel[2],
          })),
          { pattern: pixelPaths, tail: [pixelPaths[2]], height: 3, reverse: true, body: 0x90 },
          { pattern: [pixelPaths[2]], width: 2, height: 4, opacity: 127, body: 0x192 },
          { pattern: [pixelPaths[3]], opacity: 0, right: 0, body: 0x19a },
          {
            pattern: pixelPaths.slice(3),
            input: source + 1,
            output: destination + 3,
            reverse: true,
            body: 0x90,
          },
          { width: 1, height: 1 },
          { width: 0, tight: true, input: 0xfee00000, output: 0xfed00000 },
          { height: 0, input: 0xfee00000, output: 0xfed00000 },
          { width: 2, tight: true, input: destination - 4 },
        ];
      try {
        for (const [index, sample] of cases.entries()) {
          const trace = originalTrace(sample),
            first = trace.indexOf(row),
            tail = trace.lastIndexOf(row + 0x234),
            // The original alpha lookup table executes before the hook.
            // Cover each reachable cutoff from immediately before the hook.
            limits =
              first < 0
                ? [0, 1, trace.length - 1, trace.length, trace.length + 1]
                : [0, ...Array.from({ length: trace.length + 2 - first }, (_, i) => i + first)];
          if (sample.body)
            assert.ok(trace.includes(row + sample.body), 'original blend path ' + index);
          for (const limit of limits) {
            const original = run(sample, false, limit),
              hits = kernels.hits.normal,
              label = 'rectangle ' + index + ', budget ' + limit;
            assert.equal(original.pc, (limit && trace[limit]) || p.sentinel, label);
            assert.equal(
              original.budget.counter,
              BigInt(limit ? Math.min(limit + 1, trace.length) : 0),
              label,
            );
            assert.deepEqual(run(sample, true, limit), original, label);
            assert.equal(
              kernels.hits.normal - hits,
              Number(Boolean(sample.body) && (!limit || limit > tail)),
              label,
            );
          }
        }
        for (const readFault of [true, false]) {
          const sample = {
              width: 4,
              tight: true,
              [readFault ? 'input' : 'output']: page - 16,
            },
            trace = originalTrace(sample),
            faultPC = row + (readFault ? 0x50 : 0x1a5),
            faultIndex = trace.indexOf(faultPC, trace.lastIndexOf(row));
          p.cpu.mem_protect(page, 4096, readFault ? 0 : p.uc.PROT_READ);
          try {
            const beforeFault = run(sample, false, faultIndex),
              fault = run(sample, false, faultIndex + 1),
              hits = kernels.hits.normal;
            assert.equal(beforeFault.pc, faultPC);
            assert.equal(beforeFault.fault, undefined);
            const firstRow = (sample.output ?? destination) - arena;
            assert.deepEqual(
              [...new Uint32Array(beforeFault.pixels.slice(firstRow, firstRow + 16).buffer)],
              Array(4).fill(pixelPaths[2][0]),
            );
            assert.match(fault.fault, readFault ? /READ_PROT/i : /WRITE_PROT/i);
            assert.deepEqual(run(sample, true, faultIndex), beforeFault);
            assert.deepEqual(run(sample, true, faultIndex + 1), fault);
            assert.equal(kernels.hits.normal, hits);
          } finally {
            p.cpu.mem_protect(page, 4096, p.uc.PROT_READ | p.uc.PROT_WRITE);
          }
        }
        const sample = cases[6],
          entryBudget = originalTrace(sample).indexOf(row);
        for (const [register, value, limit] of [
          ['EDI', 0xfee00000, 1],
          ['EBP', 0xfee00000, 3],
          ['ESI', 0xfed00000, 1000],
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
        assert.equal(restored.hits.normal, 1);
      } finally {
        await fresh?.close();
        await engine.close();
      }
    },
  );
