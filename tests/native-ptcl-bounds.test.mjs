// SPDX-License-Identifier: MPL-2.0
import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import test from 'node:test';
import { floatBits, readKCS } from '../src/kcs.mjs';
import { NativeDataBuffers } from '../oracle/data-buffer.mjs';
import { NativeEngineFiles } from '../src/native/engine-files.mjs';
import { NativeEngineProcess } from '../src/native/engine-process.mjs';
import { nativeParticleBounds } from '../src/native/particle-bounds.mjs';
import { NativeRandomMemory } from '../src/native/random-memory.mjs';
import { ParticleRandom } from '../src/ppi/random.mjs';
import { ParticleScriptInstance } from '../src/ppi/script.mjs';
import { originalPTCLTask, particleFields } from './fixtures/original-ptcl-task.mjs';
import { memoryGame } from './helpers.mjs';

const sdkRoot = process.env.CATSYSTEM2_SDK_EXE && dirname(process.env.CATSYSTEM2_SDK_EXE),
  programs = [
    { program: 'ptcl/snow.kcs', version: 0x20000, count: 100 },
    { program: 'ptcl/wind.kcs', version: 0x10000, count: 32 },
  ];

for (const [profile, path] of [
  ['sdk-4.01-engine-2.6.1.74', process.env.CATSYSTEM2_SDK_EXE],
  ['nekopara-vol3-engine-2.6.1.76', process.env.CATSYSTEM2_ENGINE_EXE],
]) {
  test(
    `${profile} PTCL 1 and 2 match original screen bounds and complete VM frames`,
    {
      skip:
        !path ||
        !sdkRoot ||
        !programs.every(({ program }) => existsSync(resolve(sdkRoot, program))),
    },
    async () => {
      const spec = {
          priority: 5000,
          registers: [-2500, 500, 5, 10, 1, 5, 20, 40, 5, 2, 300, 300],
          externalDraw: true,
        },
        game = memoryGame(
          Object.fromEntries(
            await Promise.all(
              programs.map(async ({ program }) => [
                program,
                await readFile(resolve(sdkRoot, program)),
              ]),
            ),
          ),
        ),
        bytes = await readFile(path),
        engine = await NativeEngineProcess.open({
          profile,
          bytes,
          readFile: (name) => game.read(name),
        }),
        p = engine.process,
        nativeRandom = new ParticleRandom(),
        randomMemory = new NativeRandomMemory(engine, nativeRandom),
        buffers = new NativeDataBuffers(engine);
      try {
        randomMemory.initialize({ fromClock: false });
        new NativeEngineFiles(engine, { game, getNativeFeature: () => buffers });
        const view = p.allocate(0x120, true),
          manager = p.allocate(0x220, true),
          graphs = p.allocate(8, true),
          head = p.allocate(24, true);
        // The native receiver searches an empty graph map before using the external draw path.
        p.store(manager, graphs);
        p.store(graphs, head);
        for (const offset of [0, 4, 8]) p.store(head + offset, head);
        p.store(head + 12, 0x0101); // Black sentinel with the nil flag set
        p.store(view + 4, 1);
        p.store(view + 8, manager);
        p.store(view + 24, 800);
        p.store(view + 28, 600);
        for (const { program, version, count } of programs) {
          nativeRandom.integer.seed(4357);
          nativeRandom.real.seed(4357);
          const random = new ParticleRandom(4357),
            script = await readKCS(await game.require(program)),
            original = await originalPTCLTask(engine, view, { ...spec, program, count });
          try {
            assert.equal(script.scriptVersion, version);
            const screenWidth = 800,
              screenHeight = 600,
              width = 21,
              height = 22;
            // The external renderer supplies these inputs in place of a
            // loaded texture and attached GraphManager model.
            for (const [offset, value] of [
              [816, width],
              [820, height],
              [824, spec.priority],
              [828, 59000],
            ])
              p.store(original.task + offset, floatBits(value));
            const model = new ParticleScriptInstance(script, {
              ...spec,
              count,
              screenWidth,
              screenHeight,
              width,
              height,
              random,
              screenBounds: (...args) => nativeParticleBounds(engine, ...args),
            });
            const slot = p.load(p.load(original.vm + 56) + 38 * 4),
              args = p.allocate(20, true),
              outputs = p.load(original.vm + 20),
              initialData = p.read(outputs, script.data.length);
            try {
              for (let i = 1; i < 5; i++) p.store(args + i * 4, i * 4);
              for (const [cw, mxcsr] of [
                [0x007f, 0x1f80],
                [0x027f, 0x1f80],
                [0x037f, 0x1f80],
                [0x047f, 0x3f80],
                [0x087f, 0x5f80],
                [0x0c7f, 0x7f80],
              ]) {
                p.cpu.reg_write_i32(p.uc.X86_REG_FPCW, cw);
                p.cpu.reg_write_i32(p.uc.X86_REG_MXCSR, mxcsr);
                for (const z of [
                  -3e38, -1638.68, -43.17, 0, 130.27, 999.996, 1000, 1000.004, 2200,
                ]) {
                  p.store(args, floatBits(z));
                  const saved = p.registers();
                  const actual = nativeParticleBounds(engine, z, 800, 600, spec.priority).map(
                    floatBits,
                  );
                  assert.deepEqual(p.registers(), saved);
                  assert.equal(p.call(slot, [original.vm, original.task, args, 0]), 2);
                  assert.deepEqual(
                    actual,
                    [4, 8, 12, 16].map((offset) => p.load(outputs + offset)),
                  );
                  p.writeRegisters(saved);
                }
              }
            } finally {
              p.free(args);
              p.write(outputs, initialData);
            }
            p.cpu.reg_write_i32(p.uc.X86_REG_FPCW, 0x007f);
            p.cpu.reg_write_i32(p.uc.X86_REG_MXCSR, 0x1f80);
            await original.send(315);
            for (const frame of [1, 2, 3, 16, 61, 62]) {
              await original.step(frame);
              model.update(frame - 1);
              for (const [key, offset, stride] of particleFields) {
                const data = model[key];
                assert.deepEqual(
                  new Uint8Array(data.buffer, data.byteOffset, data.byteLength),
                  original.field(offset, stride),
                  program + ' ' + key + ' frame ' + frame,
                );
              }
              assert.deepEqual(model.machine.data, original.data(model.machine.data.length));
              assert.deepEqual(random.snapshot(), nativeRandom.snapshot());
            }
          } finally {
            await original.close();
          }
        }
      } finally {
        await engine.close();
      }
    },
  );
}
