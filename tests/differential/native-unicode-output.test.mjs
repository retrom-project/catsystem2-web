// SPDX-License-Identifier: MPL-2.0
import test from 'node:test';
import assert from 'node:assert/strict';
import { NativeEngineProcess } from '../../src/native/engine-process.mjs';
import { engineFixture } from '../fixtures/oracle-fixtures.mjs';
import {
  nativeUnicodeOutputCases,
  UNICODE_OUTPUT_PROFILE,
} from '../fixtures/unicode-output-cases.mjs';
import { observeUnicodeOutput } from '../fixtures/unicode-output-observer.mjs';
import { unicodeOutputOracle } from '../fixtures/unicode-output-oracle.mjs';
import { compareNativeObservations } from '../fixtures/native-observations.mjs';
const fixture = await engineFixture(UNICODE_OUTPUT_PROFILE);
test(
  'independent Unicode output GCALL and external service effects',
  { skip: fixture.available ? false : fixture.reason },
  async (t) => {
    for (const input of nativeUnicodeOutputCases())
      await t.test(input.name, async () => {
        const engine = await NativeEngineProcess.open({
          profile: fixture.profile,
          bytes: fixture.bytes,
        });
        try {
          const js = await observeUnicodeOutput(input),
            oracle = await observeUnicodeOutput(input, unicodeOutputOracle(engine, input.id));
          compareNativeObservations(js, oracle);
          assert.deepEqual(js.effects, oracle.effects);
        } finally {
          await engine.close();
        }
      });
  },
);
