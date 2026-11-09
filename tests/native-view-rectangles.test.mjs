// SPDX-License-Identifier: MPL-2.0
import test from 'node:test';
import { readFile } from 'node:fs/promises';
import { nativeViewRectangleCases } from './fixtures/view-rectangle-cases.mjs';
import { observeNativeCase } from './fixtures/native-differential.mjs';
import { compareNativeGolden } from './fixtures/native-golden.mjs';
const golden = JSON.parse(
  await readFile(new URL('./fixtures/view-rectangle-golden.json', import.meta.url)),
);
for (const [profile, record] of Object.entries(golden.profiles))
  test(profile + ' rectangle/view golden GCALL without an EXE', async () => {
    for (const input of nativeViewRectangleCases(profile))
      compareNativeGolden(
        await observeNativeCase(input),
        record.cases[input.name],
        input.policy,
        input.name,
      );
  });
