// SPDX-License-Identifier: MPL-2.0
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { NativeEngineProcess } from '../src/native/engine-process.mjs';
import { NativeRasterKernels } from '../oracle/raster-kernel-projection.mjs';
import { floatBits } from '../src/kcs.mjs';

for (const [profile, variable, normal, mask, copy, btype] of [
  [
    'nekopara-vol3-engine-2.6.1.76',
    'CATSYSTEM2_ENGINE_EXE',
    0x689920,
    0x6891f0,
    0x6872e0,
    0x68a210,
  ],
  ['sdk-4.01-engine-2.6.1.74', 'CATSYSTEM2_SDK_EXE', 0x55fa00, 0x561b40, 0x55def0, 0x5602f0],
])
  test(
    `${profile} CPU raster acceleration preserves all registers and complete image/stack bytes`,
    { skip: !process.env[variable] },
    async () => {
      const engine = await NativeEngineProcess.open({
          profile,
          bytes: new Uint8Array(await readFile(process.env[variable])),
        }),
        p = engine.process,
        kernels = new NativeRasterKernels(engine),
        arena = p.allocate(65536, true),
        descriptor = arena + 16,
        source = arena + 16384,
        destination = arena + 32768,
        stack = p.stackTop - 2048,
        initial = p.registers();
      let seed = 0x17c239ae;
      const random = () => (seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0);
      const run = async (enabled, functionAddress, bytes, stackBytes, setup) => {
        kernels.enabled = enabled;
        p.write(arena, bytes);
        p.write(stack, stackBytes);
        p.writeRegisters(initial);
        setup();
        const result = await p.callAsync(functionAddress, [descriptor]);
        return {
          result,
          registers: p.registers(),
          image: p.read(arena, 65536),
          stack: p.read(stack, 2048),
        };
      };
      try {
        for (let n = 0; n < 1280; n++) {
          const width = 1 + (random() % 20),
            height = 1 + (random() % 12),
            dw = width + (random() % 5),
            dh = height + (random() % 4),
            sw = width + (random() % 5),
            sh = height + (random() % 4),
            dx = random() % (dw - width + 1),
            dy = random() % (dh - height + 1),
            sx = random() % (sw - width + 1),
            sy = random() % (sh - height + 1),
            strideD = dw * 4 + (random() % 4) * 4,
            strideS = sw * 4 + (random() % 4) * 4,
            bytes = Uint8Array.from({ length: 65536 }, () => random() >>> 24),
            stackBytes = Uint8Array.from({ length: 2048 }, () => random() >>> 24),
            alphas = [0, 1, 2, 127, 128, 254, 255],
            opacity = [0, 1, 127, 128, 254, 255, 256, 65535][Math.floor(n / 4) % 8];
          for (let y = 0; y < sh; y++)
            for (let x = 0; x < sw; x++)
              bytes[source - arena + y * strideS + x * 4 + 3] =
                n % 5 === 0 ? 255 : alphas[random() % alphas.length];
          if (n % 3 === 0) bytes.fill(0, destination - arena, destination - arena + strideD * dh);
          for (let y = 0; y < dh; y++)
            for (let x = 0; x < dw; x++)
              if (n % 3)
                bytes[destination - arena + y * strideD + x * 4 + 3] =
                  alphas[random() % alphas.length];
          if (n % 7 === 0)
            for (let x = 0; x < sw; x++) bytes[source - arena + (sh - 1) * strideS + x * 4 + 3] = 0;
          const setup = () => {
            p.zero(descriptor, 128);
            [
              4,
              destination,
              dw,
              dh,
              dx,
              dy,
              width,
              height,
              strideD,
              0,
              4,
              source,
              sw,
              sh,
              sx,
              sy,
              width,
              height,
              strideS,
              opacity,
              (n >>> 2) & 1,
            ].forEach((value, i) => p.store(descriptor + i * 4, value));
            p.store(descriptor + 23 * 4, (Math.floor(n / 4) % 4) + 1);
            p.store(descriptor + 28 * 4, 1 + (Math.floor(n / 4) % 5));
          };
          const address = [normal, mask, copy, btype][n % 4],
            original = await run(false, address, bytes, stackBytes, setup),
            rasterBudget = p.instructionBudget(),
            accelerated = await run(true, address, bytes, stackBytes, setup);
          assert.deepEqual(p.instructionBudget(), rasterBudget, `raster ${n} budget`);
          for (const key of ['image', 'stack']) {
            const index = original[key].findIndex((value, i) => value !== accelerated[key][i]);
            assert.equal(
              index,
              -1,
              `${n} ${key} differs at ${index}: ${original[key][index]}/${accelerated[key][index]}`,
            );
          }
          assert.deepEqual(accelerated.registers, original.registers, `${n} full CPU state`);
          assert.equal(accelerated.result, original.result);
        }
        assert.ok(kernels.hits.normal > 100, 'The accelerated scanline block actually executed');
        assert.ok(kernels.hits.mask > 100, 'The accelerated mask block actually executed');
        assert.ok(kernels.hits.copy > 100, 'The accelerated copy block actually executed');
        assert.ok(kernels.hits.btype > 100, 'The accelerated BTYPE block actually executed');
        for (let n = 0; n < 640; n++) {
          const dw = 4 + (random() % 12),
            dh = 3 + (random() % 10),
            sw = 2 + (random() % 12),
            sh = 2 + (random() % 10),
            strideD = dw * 4 + (n % 4) * 4,
            strideS = sw * 4 + (n % 3) * 4,
            bytes = Uint8Array.from({ length: 65536 }, () => random() >>> 24),
            stackBytes = Uint8Array.from({ length: 2048 }, () => random() >>> 24),
            matrix = [
              [32768, 0, 0, 32768],
              [23170, -23170, 23170, 23170],
              [-32768, 0, 0, -32768],
              [16384, -8192, 8192, 49152],
            ][n % 4];
          for (let y = 0; y < sh; y++)
            for (let x = 0; x < sw; x++)
              bytes[source - arena + y * strideS + x * 4 + 3] = [0, 1, 127, 128, 254, 255][
                random() % 6
              ];
          if (n % 3 === 0) bytes.fill(0, destination - arena, destination - arena + strideD * dh);
          const setup = () => {
              p.zero(descriptor, 200);
              for (const [index, value] of [
                [0, 4],
                [1, destination],
                [2, dw],
                [3, dh],
                [4, floatBits((n % 7) - 3 + (n % 8) / 8)],
                [5, floatBits((n % 5) - 2 + (n % 4) / 4)],
                [10, strideD],
                [12, 4],
                [13, source],
                [14, sw],
                [15, sh],
                [16, strideS],
                [17, [0, 1, 127, 128, 254, 255, 256, 65535][n % 8]],
                [26, floatBits((n % 5) - 2 + (n % 4) / 4)],
                [27, floatBits((n % 3) - 1 + (n % 8) / 8)],
                [32, n % 2],
                [33, (n >>> 1) % 2],
                [34, dw],
                [35, dh],
                [36, matrix[0]],
                [37, matrix[1]],
                [39, matrix[2]],
                [40, matrix[3]],
                [42, ((n % 5) - 2) * 32768],
                [43, ((n % 7) - 3) * 32768],
                [45, (n % 3) * 8192],
                [46, -(n % 4) * 4096],
                [31, 1 + (Math.floor(n / 2) % 5)],
              ])
                p.store(descriptor + index * 4, value);
            },
            address = kernels.abi[n & 1 ? 'affineBtype' : 'affine'] - 0x233,
            original = await run(false, address, bytes, stackBytes, setup),
            affineBudget = p.instructionBudget(),
            accelerated = await run(true, address, bytes, stackBytes, setup);
          assert.deepEqual(p.instructionBudget(), affineBudget, `affine ${n} budget`);
          for (const key of ['image', 'stack']) {
            const index = original[key].findIndex((value, i) => value !== accelerated[key][i]);
            assert.equal(
              index,
              -1,
              `affine ${n} ${key} ${index}: ${original[key][index]}/${accelerated[key][index]} ` +
                (key === 'stack'
                  ? JSON.stringify(
                      Array.from({ length: 512 }, (_, i) => i * 4)
                        .filter((at) =>
                          original.stack
                            .slice(at, at + 4)
                            .some((v, j) => v !== accelerated.stack[at + j]),
                        )
                        .map((at) => [
                          at - 2048,
                          new DataView(original.stack.buffer).getUint32(at, true),
                          new DataView(accelerated.stack.buffer).getUint32(at, true),
                        ]),
                    )
                  : ''),
            );
          }
          assert.deepEqual(accelerated.registers, original.registers, `affine ${n} CPU`);
        }
        assert.ok(kernels.hits.affine > 100);
        assert.ok(kernels.hits.affineBtype > 100);
        for (const kind of ['stosByte', 'stosWord'])
          for (let n = 0; n < 128; n++) {
            const width = kind === 'stosByte' ? 1 : 4,
              count = n < 5 ? [0, 1, 2, 255, 512][n] : random() % 1024,
              start = arena + 4096 + (n % 4),
              backwards = !!(n & 4),
              bytes = Uint8Array.from({ length: 65536 }, () => random() >>> 24),
              runInstruction = (enabled) => {
                kernels.enabled = enabled;
                p.write(arena, bytes);
                p.writeRegisters(initial);
                for (const [name, value] of Object.entries({
                  EAX: Math.imul(n, 0x79f8241),
                  ECX: count,
                  EDI: start + (backwards ? Math.max(0, count - 1) * width : 0),
                  EFLAGS: 0x202 | (backwards ? 0x400 : 0) | (n & 1 ? 0x8d5 : 0),
                }))
                  p.cpu.reg_write_i32(p.uc['X86_REG_' + name], value);
                p.cpu.emu_start(kernels.abi[kind], kernels.abi[kind] + 2, 0, 100000);
                return {
                  registers: p.registers(),
                  bytes: p.read(arena, 65536),
                  budget: p.instructionBudget(),
                };
              };
            assert.deepEqual(
              runInstruction(true),
              runInstruction(false),
              `${kind} ${n} original REP state`,
            );
          }
        assert.ok(kernels.hits.stosByte > 100);
        assert.ok(kernels.hits.stosWord > 100);
        for (let n = 0; n < 320; n++) {
          const count = n ? random() % 8192 : 0,
            from = source + (n % 4),
            to = n % 3 === 0 ? from + 4 : n % 3 === 1 ? from - 4 : destination + (n % 4),
            bytes = Uint8Array.from({ length: 65536 }, () => random() >>> 24),
            stackBytes = Uint8Array.from({ length: 2048 }, () => random() >>> 24),
            runCopy = async (enabled) => {
              kernels.enabled = enabled;
              p.write(arena, bytes);
              p.write(stack, stackBytes);
              p.writeRegisters(initial);
              const result = await p.callAsync(kernels.abi.memcpy, [to, from, count]);
              return {
                result,
                registers: p.registers(),
                bytes: p.read(arena, 65536),
                stack: p.read(stack, 2048),
                budget: p.instructionBudget(),
              };
            };
          assert.deepEqual(await runCopy(true), await runCopy(false), `CRT copy ${n}`);
        }
        for (let n = 0; n < 128; n++) {
          const width = 1 + (random() % 40),
            height = 1 + (random() % 16),
            stride = width * 4 + (n % 4) * 4,
            bytes = Uint8Array.from({ length: 65536 }, () => random() >>> 24),
            stackBytes = Uint8Array.from({ length: 2048 }, () => random() >>> 24);
          for (let y = 0; y < height; y++)
            for (let x = 0; x < width; x++) bytes[source - arena + y * stride + x * 4 + 3] = 255;
          if (n % 3) {
            const x = random() % width,
              y = random() % height;
            bytes[source - arena + y * stride + x * 4 + 3] = n % 255;
          }
          const runAlpha = async (enabled) => {
            kernels.enabled = enabled;
            p.write(arena, bytes);
            p.write(stack, stackBytes);
            p.writeRegisters(initial);
            p.zero(descriptor, 92);
            [0, width, height, source, stride * height, stride, 4].forEach((value, i) =>
              p.store(descriptor + i * 4, value),
            );
            let result;
            try {
              result = await p.callAsync(kernels.abi.alpha - 0x28, [], descriptor);
            } catch (error) {
              throw new Error(`alpha trial ${n} enabled ${enabled}: ${error}`);
            }
            return {
              result,
              registers: p.registers(),
              image: p.read(arena, 65536),
              stack: p.read(stack, 2048),
              budget: p.instructionBudget(),
            };
          };
          assert.deepEqual(await runAlpha(true), await runAlpha(false), `alpha scan ${n}`);
        }
        assert.ok(kernels.hits.movs > 100);
        assert.ok(kernels.hits.alpha > 100);
      } finally {
        await engine.close();
      }
    },
  );
