// SPDX-License-Identifier: MPL-2.0
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { observeNativeCase } from './fixtures/native-differential.mjs';
import { compareNativeGolden } from './fixtures/native-golden.mjs';
import { nativeUTF8Cases } from './fixtures/utf8-cases.mjs';
import { nativeUnicodeOutputCases } from './fixtures/unicode-output-cases.mjs';
import { observeUnicodeOutput } from './fixtures/unicode-output-observer.mjs';
const utf8 = JSON.parse(await readFile(new URL('./fixtures/utf8-golden.json', import.meta.url))),
  unicode = JSON.parse(
    await readFile(new URL('./fixtures/unicode-output-golden.json', import.meta.url)),
  );
test('UTF-8 golden GCALL has no EXE dependency', async () => {
  for (const [profile, record] of Object.entries(utf8.profiles))
    for (const input of nativeUTF8Cases(profile))
      compareNativeGolden(
        await observeNativeCase(input),
        record.cases[input.name],
        input.policy,
        input.name,
      );
});
test('Unicode output golden GCALL preserves original service text and failures without an EXE', async () => {
  for (const input of nativeUnicodeOutputCases()) {
    const observation = await observeUnicodeOutput(input),
      record = unicode.cases[input.name];
    compareNativeGolden(observation, record.native, {}, input.name);
    assert.deepEqual(observation.effects, record.effects, input.name);
  }
});
