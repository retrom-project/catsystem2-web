// SPDX-License-Identifier: MPL-2.0
import test from 'node:test';
import { NativeEngineProcess } from '../../src/native/engine-process.mjs';
import { engineFixtureSet } from '../fixtures/oracle-fixtures.mjs';
import { nativeGeometryCases } from '../fixtures/geometry-cases.mjs';
import { calculationOracle } from '../fixtures/calculation-oracle.mjs';
import { observeNativeCase } from '../fixtures/native-differential.mjs';
import { compareNativeObservations } from '../fixtures/native-observations.mjs';
for (const fixture of await engineFixtureSet())
  test(
    `${fixture.profile} independent matrix/vector GCALL`,
    { skip: fixture.available ? false : fixture.reason },
    async (t) => {
      const engine = await NativeEngineProcess.open({
        profile: fixture.profile,
        bytes: fixture.bytes,
      });
      try {
        for (const input of nativeGeometryCases(fixture.profile))
          await t.test(input.name, async () => {
            compareNativeObservations(
              await observeNativeCase(input),
              await observeNativeCase(input, engine, calculationOracle),
              input.policy,
            );
          });
      } finally {
        await engine.close();
      }
    },
  );
