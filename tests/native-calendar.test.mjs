// SPDX-License-Identifier: MPL-2.0
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { nativeStandard } from '../src/native/standard.mjs';
test('main312 retains original weekday, signed remainder, DWORD wrap and SSE2 indefinite conversion results', async () => {
  const fixture = JSON.parse(
    await readFile(new URL('./fixtures/native-calendar-golden.json', import.meta.url)),
  );
  assert.ok(fixture.cases.length > 100);
  for (const { args, result } of fixture.cases)
    assert.deepEqual(
      nativeStandard(0x312, args),
      { control: 1, value: result },
      JSON.stringify(args),
    );
  assert.throws(() => nativeStandard(0x312, [2024, 1]), /year, month and day/);
});
