// SPDX-License-Identifier: MPL-2.0
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { nativeInflate, nativeDeflate } from '../src/native/zlib.mjs';
import { authoredDeflateBytes } from './fixtures/deflate-fixture.mjs';
const golden = JSON.parse(
  await readFile(new URL('./fixtures/native-zlib-golden.json', import.meta.url), 'utf8'),
);
test('zlib 1.2.3 matches both original engine wrappers including partial and invalid streams', async () => {
  for (const row of golden.cases) {
    const input = new Uint8Array(Buffer.from(row.input, 'base64')),
      initial = new Uint8Array(row.capacity).fill(row.fill),
      actual = await nativeInflate(input, initial);
    assert.equal(actual.result, row.result, row.name);
    assert.deepEqual(actual.bytes, new Uint8Array(Buffer.from(row.output, 'base64')), row.name);
  }
});
test('level-9 deflate bytes and whole-block capacity behavior match 144 goldens from both original engines', async () => {
  const golden = JSON.parse(
    await readFile(new URL('./fixtures/native-deflate-golden.json', import.meta.url)),
  );
  for (const row of golden.cases) {
    const source = authoredDeflateBytes(row.length, row.pattern),
      actual = await nativeDeflate(source, new Uint8Array(row.capacity).fill(row.fill));
    assert.equal(actual.result, row.result, JSON.stringify(row));
    assert.equal(
      createHash('sha256').update(actual.bytes).digest('hex'),
      row.sha256,
      JSON.stringify(row),
    );
  }
});
