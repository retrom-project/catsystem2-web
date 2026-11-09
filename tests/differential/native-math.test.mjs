// SPDX-License-Identifier: MPL-2.0
import test from 'node:test';
import assert from 'node:assert/strict';
import { NativeEngineProcess } from '../../src/native/engine-process.mjs';
import { nativeABI } from '../../src/native/abi/index.mjs';
import { engineFixtureSet } from '../fixtures/oracle-fixtures.mjs';
import { nativeMathCases } from '../fixtures/differential-cases.mjs';
import { observeNativeCase } from '../fixtures/native-differential.mjs';
import { compareNativeObservations } from '../fixtures/native-observations.mjs';

for (const fixture of await engineFixtureSet()) {
  const abi = nativeABI(fixture.profile);
  test(
    `${abi.id} independent JS/native math differential`,
    { skip: fixture.available ? false : fixture.reason },
    async (t) => {
      const engine = await NativeEngineProcess.open({
        profile: fixture.profile,
        bytes: fixture.bytes,
      });
      try {
        for (const input of nativeMathCases(fixture.profile))
          await t.test(input.name, async () => {
            const js = await observeNativeCase(input),
              oracle = await observeNativeCase(input, engine);
            compareNativeObservations(js, oracle, input.policy);
            assert.equal(oracle.oracleEvidence.length, 1);
          });
        t.diagnostic(
          `Oracle ${abi.id}, SHA-256 ${fixture.sha256}, FPCW 0x007f, MXCSR 0x1f80. Plugin-altered cross-call context remains oracle evidence.`,
        );
      } finally {
        await engine.close();
      }
    },
  );
}
