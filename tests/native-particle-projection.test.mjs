// SPDX-License-Identifier: MPL-2.0
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import { NativeEngineProcess } from '../src/native/engine-process.mjs';
import { NativeParticleProjection } from '../oracle/particle-projection-original.mjs';
import { writePTCLQuad } from '../src/ppi/abi.mjs';
import { projectionInput } from './fixtures/particle-projection-cases.mjs';

function packed(geometry) {
  const bytes = new Uint8Array(112 * geometry.length);
  for (const [i, entry] of geometry.entries()) writePTCLQuad(bytes, entry.vertices, 112 * i);
  return bytes;
}

for (const [profile, file] of [
  ['sdk-4.01-engine-2.6.1.74', process.env.CATSYSTEM2_SDK_EXE],
  ['nekopara-vol3-engine-2.6.1.76', process.env.CATSYSTEM2_ENGINE_EXE],
]) {
  test(
    profile + ' projects all quads under the calling x87 and SSE control words',
    { skip: !file },
    async () => {
      const bytes = await readFile(file),
        engine = await NativeEngineProcess.open({ profile, bytes });
      try {
        const projection = new NativeParticleProjection(engine),
          p = engine.process,
          { particles, options, order } = projectionInput();
        for (const [control, mxcsr, precision] of [
          [0x007f, 0x1f80, 24],
          [0x027f, 0x1fa0, 53],
          [0x037f, 0x1f80, 0],
          [0x047f, 0x3f80, 0],
          [0x087f, 0x5f80, 0],
          [0x0c7f, 0x7f80, 0],
        ]) {
          p.cpu.reg_write_i32(p.uc.X86_REG_FPCW, control);
          p.cpu.reg_write_i32(p.uc.X86_REG_MXCSR, mxcsr);
          assert.equal(projection.precision(), precision);
          const registers = p.registers(),
            original = await projection.original(order, options),
            actual = await projection.geometry(particles, options);
          assert.deepEqual(
            actual.map(({ index }) => index),
            original.map(({ index }) => index),
          );
          assert.deepEqual(
            packed(actual),
            packed(original),
            `control word ${control.toString(16)}`,
          );
          assert.deepEqual(p.registers(), registers);
        }
      } finally {
        await engine.close();
      }
    },
  );
}
