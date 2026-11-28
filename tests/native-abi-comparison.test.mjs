// SPDX-License-Identifier: MPL-2.0
import test from 'node:test';
import assert from 'node:assert/strict';
import { compareNativeTables } from '../scripts/compare-native-abi.mjs';

const entry = (id, fingerprint, complete = true) => ({
  id,
  handler: {
    complete,
    rawFingerprint: fingerprint,
    contextFingerprint: fingerprint,
    structuralFingerprint: fingerprint,
  },
});
const inventory = (sha256, entries) => ({
  sha256,
  tables: [{ name: 'main', count: entries.length, entries }],
});

test('a matching numeric ID alone never supplies a semantic mapping', () => {
  const result = compareNativeTables(
    inventory('new', [entry(0, 'changed')]),
    inventory('old', [entry(0, 'before')]),
  ).tables[0];
  assert.equal(result.candidateMatches, 0);
  assert.equal(result.entries[0].method, 'unmatched');
  assert.equal(result.entries[0].review, 'needs-review');
});

test('unique code can propose a moved ID while shared bodies retain all aliases', () => {
  const reference = inventory('old', [entry(0, 'one'), entry(1, 'same'), entry(2, 'same')]);
  const source = inventory('new', [entry(0, 'same'), entry(1, 'one')]);
  const result = compareNativeTables(source, reference).tables[0];
  assert.deepEqual(result.entries[0].referenceIDs, [1, 2]);
  assert.equal(result.entries[0].method, 'ambiguous');
  assert.equal(result.entries[1].relation, 'moved-id-candidate');
  assert.equal(result.candidateMatches, 1);
  assert.equal(result.unresolvedMappings, 1);
  assert.equal(result.needsReview, 2);
});

test('incomplete CFG and missing reference tables stay unresolved', () => {
  const source = inventory('new', [entry(0, 'same', false)]),
    reference = inventory('old', [entry(0, 'same')]);
  assert.equal(compareNativeTables(source, reference).tables[0].entries[0].method, 'incomplete');
  reference.tables = [];
  assert.equal(compareNativeTables(source, reference).tables[0].review, 'needs-review');
});

test('equal body bytes with different callee context remain under review', () => {
  const left = entry(0, 'same'),
    right = entry(0, 'same');
  left.handler.contextFingerprint = 'different-helper';
  const result = compareNativeTables(inventory('new', [left]), inventory('old', [right])).tables[0];
  assert.equal(result.candidateMatches, 0);
  assert.equal(result.entries[0].review, 'needs-review');
  assert.match(result.entries[0].reason, /context differs/);
});

test('whole-image identity preserves IDs and missing digests never establish identity', () => {
  const same = inventory('digest', [entry(0, 'body')]);
  assert.equal(compareNativeTables(same, same).tables[0].entries[0].method, 'same-image');
  const left = inventory(undefined, [entry(0, 'new')]),
    right = inventory(undefined, [entry(0, 'old')]);
  assert.equal(compareNativeTables(left, right).tables[0].candidateMatches, 0);
});
