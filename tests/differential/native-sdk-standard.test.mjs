// SPDX-License-Identifier: MPL-2.0
import test from 'node:test';
import { NativeEngineProcess } from '../../src/native/engine-process.mjs';
import { engineFixture } from '../fixtures/oracle-fixtures.mjs';
import { nativeSDKStandardCases, SDK_STANDARD_PROFILE } from '../fixtures/sdk-standard-cases.mjs';
import { observeNativeCase } from '../fixtures/native-differential.mjs';
import { sdkStandardOracle } from '../fixtures/sdk-standard-oracle.mjs';
import { compareNativeObservations } from '../fixtures/native-observations.mjs';
const fixture = await engineFixture(SDK_STANDARD_PROFILE);
test(
  'SDK standard semantics follow the actual SDK wrappers',
  { skip: fixture.available ? false : fixture.reason },
  async (t) => {
    const engine = await NativeEngineProcess.open({
      profile: fixture.profile,
      bytes: fixture.bytes,
    });
    try {
      for (const input of nativeSDKStandardCases(fixture.profile))
        await t.test(input.name, async () =>
          compareNativeObservations(
            await observeNativeCase(input),
            await observeNativeCase(input, engine, sdkStandardOracle),
            input.policy,
          ),
        );
    } finally {
      await engine.close();
    }
  },
);
