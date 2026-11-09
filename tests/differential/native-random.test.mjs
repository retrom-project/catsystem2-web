// SPDX-License-Identifier: MPL-2.0
import test from 'node:test';
import { NativeEngineProcess } from '../../src/native/engine-process.mjs';
import { engineFixtureSet } from '../fixtures/oracle-fixtures.mjs';
import { nativeRandomCases } from '../fixtures/random-cases.mjs';
import { randomOracle } from '../fixtures/random-oracle.mjs';
import { observeNativeCase } from '../fixtures/native-differential.mjs';
import { compareNativeObservations } from '../fixtures/native-observations.mjs';
for (const fixture of await engineFixtureSet())
  test(
    `${fixture.profile} independent seeded random GCALL`,
    { skip: fixture.available ? false : fixture.reason },
    async (t) => {
      const engine = await NativeEngineProcess.open({
        profile: fixture.profile,
        bytes: fixture.bytes,
      });
      try {
        for (const input of nativeRandomCases(fixture.profile))
          await t.test(input.name, async () => {
            compareNativeObservations(
              await observeNativeCase(input),
              await observeNativeCase(input, engine, randomOracle),
              input.policy,
            );
          });
      } finally {
        await engine.close();
      }
    },
  );
