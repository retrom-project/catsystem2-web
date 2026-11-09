// SPDX-License-Identifier: MPL-2.0
import test from 'node:test';
import { NativeEngineProcess } from '../../src/native/engine-process.mjs';
import { engineFixtureSet } from '../fixtures/oracle-fixtures.mjs';
import { nativeUTF8Cases } from '../fixtures/utf8-cases.mjs';
import { observeNativeCase } from '../fixtures/native-differential.mjs';
import { compareNativeObservations } from '../fixtures/native-observations.mjs';
for (const fixture of (await engineFixtureSet()).filter((f) => nativeUTF8Cases(f.profile).length))
  test(
    `${fixture.profile} independent UTF-8 GCALL`,
    { skip: fixture.available ? false : fixture.reason },
    async (t) => {
      const engine = await NativeEngineProcess.open({
        profile: fixture.profile,
        bytes: fixture.bytes,
      });
      try {
        for (const input of nativeUTF8Cases(fixture.profile))
          await t.test(input.name, async () => {
            compareNativeObservations(
              await observeNativeCase(input),
              await observeNativeCase(input, engine),
              input.policy,
            );
          });
      } finally {
        await engine.close();
      }
    },
  );
