// SPDX-License-Identifier: MPL-2.0
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { floatBits } from '../src/kcs.mjs';
import { NativeEngineProcess } from '../src/native/engine-process.mjs';
import { NativeRasterKernels } from '../oracle/raster-kernel-projection.mjs';

const identity = [32768, 0, 0, 32768];

const profiles = [
  ['nekopara-vol3-engine-2.6.1.76', 'CATSYSTEM2_ENGINE_EXE'],
  ['sdk-4.01-engine-2.6.1.74', 'CATSYSTEM2_SDK_EXE'],
];
const variants = profiles.flatMap(([profile, fixture]) =>
  ['affine', 'affineBtype'].map((kind) => ({ profile, fixture, kind })),
);
for (const { profile, fixture, kind } of variants)
  test(
    profile + ' ' + kind + ' preserves original sampling cutoffs, CPU faults and restoration',
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
        blendType = kind === 'affineBtype',
        row = kernels.abi[kind],
        { affineSampler: sampler, affineMultiply: multiply } = kernels.abi,
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
        run = (sample, enabled, limit, invoke = execute) => {
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
            destinationColors,
            mode = blendType ? 1 : 0,
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
            [31, mode],
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
                const index = x + y * width,
                  alpha = destinationAlphas[index % destinationAlphas.length],
                  color = destinationColors
                    ? destinationColors[index % destinationColors.length]
                    : 0x17659c - x * 0x030701 + y * 0x010405;
                p.store(output + y * dp + x * 4, (alpha << 24) | color);
              }
          p.store(p.stackTop - 8, p.sentinel);
          p.store(p.stackTop - 4, descriptor);
          p.writeRegisters(initial);
          p.cpu.reg_write_i32(p.uc.X86_REG_ESP, p.stackTop - 8);
          p.cpu.reg_write_i32(p.uc.X86_REG_EFLAGS, 0x8d7);
          p.cpu.reg_write_i32(p.uc.X86_REG_MXCSR, mxcsr);
          return invoke(enabled, start, limit);
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
        ordinaryCases = [
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
        ],
        btypeCases = [
          { width: 1, sh: 1, body: row + 0x32b },
          {
            mode: 2,
            width: 1,
            matrix: [-32768, 0, 0, -32768],
            translate: [65536, 65536],
            sourceAlphas: [127],
            body: row + 0x479,
          },
          {
            mode: 3,
            width: 2,
            left: 1,
            position: [0.25, -0.75],
            base: [0.2, -0.9],
            matrix: [23170, -23170, 23170, 23170],
            mxcsr: 0x5f80,
            body: row + 0x4cb,
          },
          {
            mode: 4,
            destinationColors: [0x7f807f, 0x807f80, 0x808080, 0x7f7f7f],
            body: row + 0x535,
          },
          {
            mode: 5,
            destinationColors: [0xfeffff, 0xfffefe, 0xfffeff, 0xfffffe],
            body: row + 0x67a,
          },
          {
            mode: 5,
            opacity: 171,
            sp: 13,
            dp: 9,
            translate: [16384, 16384],
            sourceAlphas: [1, 31, 127, 255],
            destinationAlphas: [67],
            input: source + 1,
            output: destination + 3,
            body: row + 0x67a,
          },
          { width: 1, sourceAlphas: [0], body: row + 0x1a3 },
          { width: 1, opacity: 0, body: row + 0x741 },
          { width: 1, base: [8.75, 0], body: sampler + 0xbc },
          { width: 1, base: [0, 8.75], body: sampler + 0x14 },
          { width: 1, mode: 0 },
          { width: 1, mode: 6 },
          { width: 1, height: 0, input: 0xfee00000, output: 0xfed00000 },
          { width: 1, height: 1 },
          { width: 1, input: destination - 4 },
        ],
        cases = blendType ? btypeCases : ordinaryCases;
      try {
        for (const [index, sample] of cases.entries()) {
          const trace = originalTrace(sample),
            first = trace.indexOf(row),
            tail = trace.lastIndexOf(row + (blendType ? 0x7c2 : 0x4cc)),
            limits =
              first < 0
                ? [0, 1, trace.length - 1, trace.length, trace.length + 1]
                : [0, ...Array.from({ length: trace.length + 2 - first }, (_, i) => i + first)];
          if (sample.body) assert.ok(trace.includes(sample.body), 'original affine path ' + index);
          for (const limit of limits) {
            const original = run(sample, false, limit),
              hits = kernels.hits[kind],
              label = 'rectangle ' + index + ', budget ' + limit;
            assert.equal(original.pc, (limit && trace[limit]) || p.sentinel, label);
            assert.equal(
              original.budget.counter,
              BigInt(limit ? Math.min(limit + 1, trace.length) : 0),
              label,
            );
            assert.deepEqual(run(sample, true, limit), original, label);
            assert.equal(
              kernels.hits[kind] - hits,
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
            faultPC = readFault ? sampler + 0x91 : row + (blendType ? 0x40d : 0x465),
            faultIndex = trace.indexOf(faultPC, trace.lastIndexOf(row));
          p.cpu.mem_protect(page, 4096, readFault ? 0 : p.uc.PROT_READ);
          try {
            const beforeFault = run(sample, false, faultIndex),
              fault = run(sample, false, faultIndex + 1),
              hits = kernels.hits[kind];
            assert.equal(beforeFault.pc, faultPC);
            assert.equal(beforeFault.fault, undefined);
            assert.equal(p.load(sample.output ?? destination), blendType ? 0xff304964 : 0xff314a65);
            assert.match(fault.fault, readFault ? /READ_PROT/i : /WRITE_PROT/i);
            assert.deepEqual(run(sample, true, faultIndex), beforeFault);
            assert.deepEqual(run(sample, true, faultIndex + 1), fault);
            assert.equal(kernels.hits[kind], hits);
          } finally {
            p.cpu.mem_protect(page, 4096, p.uc.PROT_READ | p.uc.PROT_WRITE);
          }
        }
        const mulPage = multiply & ~4095;
        p.cpu.mem_protect(mulPage, 4096, p.uc.PROT_READ);
        try {
          const original = run(cases[0], false, 10000),
            hits = kernels.hits[kind];
          assert.match(original.fault, /FETCH_PROT/i);
          assert.deepEqual(run(cases[0], true, 10000), original);
          assert.equal(kernels.hits[kind], hits);
        } finally {
          p.cpu.mem_protect(mulPage, 4096, p.uc.PROT_ALL);
        }
        if (blendType) {
          const jumpTable = row + 0x7e1,
            target = p.load(jumpTable);
          p.store(jumpTable, p.load(jumpTable + 4));
          try {
            const trace = originalTrace(cases[0]),
              hits = kernels.hits[kind];
            assert.ok(trace.includes(row + 0x479));
            assert.deepEqual(run(cases[0], true, trace.length), run(cases[0], false, trace.length));
            assert.equal(kernels.hits[kind], hits);
          } finally {
            p.store(jumpTable, target);
          }
        }
        const sample = { ...cases[5], base: [0.25, 0.75] },
          entryBudget = originalTrace(sample).indexOf(row);
        for (const [register, value, limit] of [
          [blendType ? 'ESI' : 'EBX', 0xfee00000, 1],
          ['EBP', 0xfee00000, 3],
          [blendType ? 'EBX' : 'ESI', 0xfee00000, 1000],
          ['MXCSR', 0x0f80, 10000],
        ]) {
          const resume = (enabled) => {
            assert.equal(run(sample, false, entryBudget).pc, row);
            p.cpu.reg_write_i32(p.uc['X86_REG_' + register], value);
            return execute(enabled, row, limit);
          };
          const original = resume(false),
            hits = kernels.hits[kind];
          assert.deepEqual(resume(true), original, register);
          assert.equal(kernels.hits[kind], hits, register);
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
        assert.equal(restored.hits[kind], 1);

        const rectangle = {
            width: 4,
            height: 5,
            sw: 4,
            sh: 5,
            sourceAlphas: [31, 127, 255],
            destinationAlphas: [127],
            mode: blendType ? 4 : 0,
          },
          trace = originalTrace(rectangle),
          credit = trace.lastIndexOf(row) - trace.indexOf(row),
          limit = trace.length - credit,
          allowance = () => ({
            destination,
            width: rectangle.width,
            height: rectangle.height,
            pitch: rectangle.width * 4,
            pixels: rectangle.width * rectangle.height,
            credited: 0,
          }),
          invoke =
            (rasterBudget, entry = start, args = [descriptor]) =>
            (enabled, _, cap) => {
              kernels.enabled = enabled;
              p.budget = cap;
              let fault;
              try {
                p.call(entry, args, undefined, { rasterBudget });
              } catch (error) {
                fault = error.message;
              }
              assert.equal(p.rasterBudget, undefined);
              return { ...state(p), fault };
            },
          completed = run(rectangle, false, trace.length, invoke()),
          scope = allowance(),
          scoped = run(rectangle, true, limit, invoke(scope)),
          cutoff = run(rectangle, false, limit, invoke());
        assert.equal(completed.pc, p.sentinel);
        assert.equal(completed.fault, undefined);
        assert.deepEqual(scoped, { ...completed, budget: scoped.budget });
        assert.equal(scoped.budget.limit, BigInt(limit));
        assert.equal(scoped.budget.counter + BigInt(scope.credited), BigInt(trace.length));
        assert.equal(scope.credited, credit);
        assert.equal(scope.pixels, 0);
        assert.equal(cutoff.fault, 'PE32 execution instruction budget exhausted');
        for (const invalid of [
          undefined,
          scope,
          { ...allowance(), destination: destination + 4 },
          { ...allowance(), width: rectangle.width + 1 },
          { ...allowance(), height: rectangle.height + 1 },
          { ...allowance(), pitch: rectangle.width * 4 + 4 },
        ])
          assert.deepEqual(run(rectangle, true, limit, invoke(invalid)), cutoff);
        const short = trace.indexOf(row) + 24 + (blendType ? 142 : 141) * rectangle.width,
          shortScope = allowance();
        assert.deepEqual(
          run(rectangle, true, short, invoke(shortScope)),
          run(rectangle, false, short, invoke()),
        );
        assert.deepEqual(shortScope, allowance());
        const observedScope = allowance(),
          detach = p.beforeInstruction(multiply, 'observe the original affine helper', () => {});
        try {
          assert.deepEqual(run(rectangle, true, limit, invoke(observedScope)), cutoff);
          assert.deepEqual(observedScope, allowance());
        } finally {
          detach();
        }
        const editedScope = allowance(),
          multiplyOpcode = p.read(multiply + 8, 2);
        p.write(multiply + 8, [0x09, 0xc1]); // Alternate encoding of the original OR.
        try {
          assert.deepEqual(run(rectangle, true, limit, invoke(editedScope)), cutoff);
          assert.deepEqual(editedScope, allowance());
        } finally {
          p.write(multiply + 8, multiplyOpcode);
        }
        const faulting = { ...rectangle, input: 0xfed00000 },
          faultScope = allowance(),
          originalFault = run(faulting, false, limit, invoke());
        assert.match(originalFault.fault, /READ_UNMAPPED/i);
        assert.deepEqual(run(faulting, true, limit, invoke(faultScope)), originalFault);
        assert.deepEqual(faultScope, allowance());

        // The simulated rows do not give this subsequent guest loop a
        // larger raw CPU budget. Its original cutoff still stops the call.
        const loop = 0x50000000,
          code = Uint8Array.of(0x68, 0, 0, 0, 0, 0xe8, 0, 0, 0, 0, 0x83, 0xc4, 4, 0xeb, 0xfe),
          codeWords = new DataView(code.buffer);
        codeWords.setUint32(1, descriptor, true);
        codeWords.setInt32(6, start - (loop + 10), true);
        p.map(loop, 4096);
        p.write(loop, code);
        const loopScope = allowance(),
          loopCap = limit + 16,
          originalLoop = run(rectangle, false, loopCap + credit, invoke(undefined, loop, [])),
          actualLoop = run(rectangle, true, loopCap, invoke(loopScope, loop, []));
        assert.equal(actualLoop.pc, loop + 13);
        assert.equal(actualLoop.fault, 'PE32 execution instruction budget exhausted');
        assert.equal(loopScope.credited, credit);
        assert.deepEqual(actualLoop.budget, {
          active: false,
          limit: BigInt(loopCap),
          counter: BigInt(loopCap + 1),
        });
        assert.deepEqual(actualLoop, { ...originalLoop, budget: actualLoop.budget });
      } finally {
        await fresh?.close();
        await engine.close();
      }
    },
  );
