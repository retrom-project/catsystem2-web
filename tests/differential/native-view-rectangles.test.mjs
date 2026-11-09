// SPDX-License-Identifier: MPL-2.0
import test from 'node:test';
import { NativeEngineProcess } from '../../src/native/engine-process.mjs';
import { engineFixtureSet } from '../fixtures/oracle-fixtures.mjs';
import { nativeViewRectangleCases } from '../fixtures/view-rectangle-cases.mjs';
import { viewRectangleOracle } from '../fixtures/view-rectangle-oracle.mjs';
import { observeNativeCase } from '../fixtures/native-differential.mjs';
import { compareNativeObservations } from '../fixtures/native-observations.mjs';
for (const fixture of await engineFixtureSet())
  test(
    `${fixture.profile} independent rectangle/view GCALL`,
    { skip: fixture.available ? false : fixture.reason },
    async (t) => {
      const engine = await NativeEngineProcess.open({
        profile: fixture.profile,
        bytes: fixture.bytes,
      });
      try {
        for (const input of nativeViewRectangleCases(fixture.profile))
          await t.test(input.name, async () => {
            compareNativeObservations(
              await observeNativeCase(input),
              await observeNativeCase(input, engine, viewRectangleOracle),
              input.policy,
            );
          });
      } finally {
        await engine.close();
      }
    },
  );
