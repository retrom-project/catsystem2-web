// SPDX-License-Identifier: MPL-2.0
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { nativeABI } from '../src/native/abi/index.mjs';
test('authored name-pair qualification remains distinct from the old static reachability survey', () => {
  const abi = nativeABI('nekopara-vol3-engine-2.6.1.76');
  assert.equal(abi.nameTable.fixedPairs, true);
  for (let id = 0x121; id <= 0x125; id++) {
    const entry = abi.tables.main.entries[id];
    assert.equal(entry.migrationReview.decision, 'js-owned-inputs');
    assert.equal(entry.migrationReview.reachability.observedCallSites, 0);
    assert.equal(entry.status, 'recovered');
  }
});
test('reviewed SDK data entries have their own evidence and observed argument counts', async () => {
  const document = await readFile(
      new URL('../docs/native-domain4-review.md', import.meta.url),
      'utf8',
    ),
    abi = nativeABI('sdk-4.01-engine-2.6.1.74'),
    entries = [...document.matchAll(/^\| ([0-9A-F]+)\s+\|/gm)].map(
      ([, id]) => abi.tables.main.entries[Number.parseInt(id, 16)],
    );
  assert.equal(entries.length, 65);
  for (const entry of entries) {
    assert.ok(entry.evidence);
    assert.ok(entry.name);
    assert.equal(entry.status, 'recovered');
    assert.deepEqual(entry.observedArgumentWords, [entry.signature.argumentWords]);
    assert.deepEqual(entry.controlCodes, entry.signature.controlCodes);
  }
});
