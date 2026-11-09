// SPDX-License-Identifier: MPL-2.0
import test from 'node:test';
import assert from 'node:assert/strict';
import { NativeEngineProcess } from '../../src/native/engine-process.mjs';
import { engineFixtureSet } from '../fixtures/oracle-fixtures.mjs';
import { nativeScalarCases } from '../fixtures/scalar-cases.mjs';
import { observeNativeCase } from '../fixtures/native-differential.mjs';
import { compareNativeObservations } from '../fixtures/native-observations.mjs';
for (const fixture of await engineFixtureSet())
  test(
    `${fixture.profile} all scalar operations JS/original GCALL`,
    { skip: fixture.available ? false : fixture.reason },
    async (t) => {
      const engine = await NativeEngineProcess.open({
        profile: fixture.profile,
        bytes: fixture.bytes,
      });
      try {
        for (const input of nativeScalarCases(fixture.profile))
          await t.test(input.name, async () => {
            compareNativeObservations(
              await observeNativeCase(input),
              await observeNativeCase(input, engine),
              input.policy,
            );
          });
        for (const [low, high] of [
          [64, 0x7fffffff],
          [0x7fffffff, 64],
        ])
          await t.test(`unpack invalid-address evidence ${low}/${high}`, async () => {
            const input = {
              profile: fixture.profile,
              table: 'main',
              id: 0x36b,
              args: [0x8000ffff, low, high],
              initial: {},
            };
            let js;
            await assert.rejects(observeNativeCase(input), (error) => {
              js = error;
              return true;
            });
            const previousNull = engine.process.load(0);
            let oracle;
            try {
              oracle = await observeNativeCase(input, engine);
              assert.equal(
                engine.process.load(0),
                low === 64 ? 0xffff8000 : 0xffffffff,
                'the oracle sandbox has a writable null page unlike a protected process',
              );
            } finally {
              engine.process.store(0, previousNull);
            }
            assert.ok(js.nativeMemory);
            assert.equal(oracle.control, 2);
            assert.equal(js.nativeMemory.memory[64], low === 64 ? 255 : 0);
            // An invalid first write terminates JS before the valid second write.
            if (low === 64) assert.deepEqual(js.nativeMemory, oracle.memory);
          });
      } finally {
        await engine.close();
      }
    },
  );
