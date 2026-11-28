// SPDX-License-Identifier: MPL-2.0
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { nativeFilePattern } from '../src/native/file-pattern.mjs';
test('72 authored A/W searches match pinned Wine long names and explicit mount short names', async () => {
  const golden = JSON.parse(
    await readFile(new URL('./fixtures/native-file-pattern-golden.json', import.meta.url)),
  );
  assert.equal(golden.cases.length, 72);
  for (const row of golden.cases)
    assert.deepEqual(
      golden.names
        .filter((name) => nativeFilePattern(row.pattern, name, golden.aliases[name]))
        .sort(),
      row.matches,
      JSON.stringify(row),
    );
});
