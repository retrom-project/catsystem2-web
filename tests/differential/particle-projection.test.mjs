// SPDX-License-Identifier: MPL-2.0
import test from 'node:test';
import assert from 'node:assert/strict';
import { engineFixtureSet } from '../fixtures/oracle-fixtures.mjs';
import { NativeEngineProcess } from '../../src/native/engine-process.mjs';
import { NativeParticleProjection as OriginalProjection } from '../../oracle/particle-projection-original.mjs';
import { NativeParticleProjection } from '../../src/native/particle-projection.mjs';
import { nativeParticleBounds } from '../../src/native/particle-bounds.mjs';
import { nativeParticleBounds as originalBounds } from '../../oracle/particle-bounds-original.mjs';
import { floatBits } from '../../src/kcs.mjs';
import { projectionInput } from '../fixtures/particle-projection-cases.mjs';
const ordered = (n) => (n & 0x80000000 ? ~n >>> 0 : (n | 0x80000000) >>> 0);
for (const fixture of await engineFixtureSet())
  test(
    fixture.profile + ' JS particle projection and bounds match normal PC24 oracle',
    { skip: !fixture.available },
    async () => {
      const engine = await NativeEngineProcess.open({
        profile: fixture.profile,
        bytes: fixture.bytes,
      });
      try {
        engine.process.cpu.reg_write_i32(engine.process.uc.X86_REG_FPCW, 0x007f);
        engine.process.cpu.reg_write_i32(engine.process.uc.X86_REG_MXCSR, 0x1f80);
        const old = new OriginalProjection(engine),
          js = new NativeParticleProjection(),
          { particles, options, order } = projectionInput(),
          expected = await old.original(order, options),
          actual = js.geometry(particles, options);
        assert.deepEqual(
          actual.map((x) => x.index),
          expected.map((x) => x.index),
        );
        for (const [i, entry] of actual.entries())
          for (const [j, vertex] of entry.vertices.entries()) {
            const other = expected[i].vertices[j];
            for (const key of ['x', 'y', 'z', 'w']) {
              assert.ok(
                Math.abs(ordered(floatBits(vertex[key])) - ordered(floatBits(other[key]))) <= 1,
                `${i}/${j}/${key}: ${vertex[key]} vs ${other[key]}`,
              );
              if (key === 'x' || key === 'y')
                assert.equal(
                  Math.round(vertex[key]),
                  Math.round(other[key]),
                  'pixel coverage coordinate',
                );
            }
            for (const key of ['color', 'u', 'v']) assert.equal(vertex[key], other[key]);
          }
        for (const z of [-3e38, -1638.68, -43.17, 0, 130.27, 999.996, 1000, 1000.004, 2200])
          assert.deepEqual(
            nativeParticleBounds(z, 800, 600, 5000).map(floatBits),
            originalBounds(engine, z, 800, 600, 5000).map(floatBits),
          );
      } finally {
        await engine.close();
      }
    },
  );
