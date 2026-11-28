// SPDX-License-Identifier: MPL-2.0
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { nativeRandomCases } from './fixtures/random-cases.mjs';
import { nativeSDKStandardCases } from './fixtures/sdk-standard-cases.mjs';
import { observeNativeCase } from './fixtures/native-differential.mjs';
import { compareNativeGolden } from './fixtures/native-golden.mjs';
const random = JSON.parse(
    await readFile(new URL('./fixtures/random-golden.json', import.meta.url)),
  ),
  standard = JSON.parse(
    await readFile(new URL('./fixtures/sdk-standard-golden.json', import.meta.url)),
  );
for (const [profile, record] of Object.entries(random.profiles))
  test(profile + ' seeded random golden GCALL uses independent JS state', async () => {
    for (const input of nativeRandomCases(profile)) {
      const observation = await observeNativeCase(input);
      compareNativeGolden(observation, record.cases[input.name], input.policy, input.name);
      if (input.name.endsWith('lower endpoint')) assert.equal(observation.value, 0);
      if (input.name.endsWith('upper endpoint'))
        assert.equal(
          observation.value,
          input.operation === 'random.float' ? 0x3f800000 : 0xffffffff,
        );
    }
  });
for (const [profile, record] of Object.entries(standard.profiles))
  test(profile + ' reviewed standard golden GCALL runs without an EXE', async () => {
    for (const input of nativeSDKStandardCases(profile))
      compareNativeGolden(
        await observeNativeCase(input),
        record.cases[input.name],
        input.policy,
        input.name,
      );
  });
