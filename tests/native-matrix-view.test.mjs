// SPDX-License-Identifier: MPL-2.0
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { NativeEngineProcess } from '../src/native/engine-process.mjs';
import { NativeMatrices } from '../oracle/matrix.mjs';
import { KCSMachine, floatBits, bitsFloat } from '../src/kcs.mjs';
import { Binary } from '../src/binary.mjs';
for (const [profile, variable] of [
  ['sdk-4.01-engine-2.6.1.74', 'CATSYSTEM2_SDK_EXE'],
  ['nekopara-vol3-engine-2.6.1.76', 'CATSYSTEM2_ENGINE_EXE'],
])
  test(
    `${profile} matrix output reacquires VM bytes after growth during native calls and readback`,
    { skip: !process.env[variable] },
    async () => {
      const engine = await NativeEngineProcess.open({
          profile,
          bytes: new Uint8Array(await readFile(process.env[variable])),
        }),
        matrices = new NativeMatrices(engine),
        wasm = new WebAssembly.Memory({ initial: 1 }),
        machine = new KCSMachine({
          body: new Binary(Uint8Array.of(59)),
          codeSize: 1,
          data: new Uint8Array(64),
          stackSize: 64,
        }),
        call = engine.call.bind(engine),
        read = engine.process.read.bind(engine.process);
      new Uint8Array(wasm.buffer).set(machine.memory);
      machine.bindMemory({ bytes: () => new Uint8Array(wasm.buffer, 0, 128) });
      let callGrowth = 0,
        readGrowth = 0;
      engine.call = async (...args) => {
        const value = await call(...args);
        wasm.grow(1);
        callGrowth++;
        return value;
      };
      engine.process.read = (...args) => {
        wasm.grow(1);
        readGrowth++;
        return read(...args);
      };
      try {
        await matrices.apply(0xcf, [0], machine);
        assert.deepEqual(
          Array.from({ length: 16 }, (_, i) => bitsFloat(machine.load(i * 4))),
          [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1],
        );
        await matrices.apply(0xcd, [0, ...[3, 4, 5].map(floatBits)], machine);
        assert.deepEqual(
          [12, 13, 14].map((i) => bitsFloat(machine.load(i * 4))),
          [3, 4, 5],
        );
        assert.equal(callGrowth, 2);
        assert.equal(readGrowth, 2);
      } finally {
        engine.process.read = read;
        await engine.close();
      }
    },
  );
