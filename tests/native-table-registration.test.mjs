// SPDX-License-Identifier: MPL-2.0
import test from 'node:test';
import assert from 'node:assert/strict';
import { NATIVE_SEMANTICS } from '../src/native/abi/semantics.mjs';
import { resolveNativeTables } from '../src/native/abi/tables.mjs';

// Authored complete registrations exercise the pure resolver without installing
// an engine or borrowing the old per-engine expanded tables.
function registration() {
  const auxiliary = (status) => ({
    count: 1,
    slots: { [status]: [0] },
    evidence: [{ ids: [0], value: 'authored resolver case' }],
  });
  return {
    main: {
      count: 7,
      slots: { unknown: [0, 3, 4, 5], reserved: [1], 'constant-zero': [2], recovered: [6] },
      signatures: [{ ids: [6], fields: { resultWritten: true } }],
      observedArgumentWords: [{ ids: [0, 1, 2, 3, 4, 5, 6], value: [] }],
      evidence: [{ ids: [6], value: 'authored resolver case' }],
    },
    generic: auxiliary('recovered'),
    'particle-v1': auxiliary('declared'),
    'particle-v2': auxiliary('declared'),
  };
}

test('only explicit semantic bindings resolve; unknown and both stub kinds stay distinct', () => {
  const table = resolveNativeTables(registration()).main;
  assert.equal(table.entries[6].name, 'word.identity');
  assert.equal(table.entries[6].signature.argumentWords, 1);
  assert.equal(table.entries[6].signature.resultWritten, true);
  assert.equal(table.entries[1].name, 'reserved.noop');
  assert.deepEqual(table.entries[1].controlCodes, [2]);
  assert.equal(table.entries[2].name, 'reserved.zero');
  assert.deepEqual(table.entries[2].controlCodes, [1]);
  assert.equal(table.entries[4].name, null);
  assert.equal(table.entries[4].parameters, null);
  assert.deepEqual(table.entries[4].controlCodes, []);
  assert.equal(NATIVE_SEMANTICS.main[4].name, 'clock.milliseconds');
});

test('registration rejects uncovered, overlapping, duplicate and out-of-range slots', () => {
  const uncovered = registration();
  uncovered.main.slots.recovered = [5];
  assert.throws(() => resolveNativeTables(uncovered), /Overlapping native registration/);
  const gap = registration();
  gap.main.slots.unknown.pop();
  assert.throws(() => resolveNativeTables(gap), /Uncovered native registration/);
  const outside = registration();
  outside.main.slots.unknown.push(7);
  assert.throws(() => resolveNativeTables(outside), /Invalid native registration IDs/);
  const duplicate = registration();
  duplicate.main.slots.unknown.push(5);
  assert.throws(() => resolveNativeTables(duplicate), /Invalid native registration IDs/);
});

test('missing semantics and malformed table/status records cannot acquire meanings', () => {
  const missing = registration();
  missing.main = {
    count: 83,
    slots: { unknown: Array.from({ length: 82 }, (_, id) => id), recovered: [82] },
  };
  assert.throws(() => resolveNativeTables(missing), /Unreviewed native semantic main\/82/);
  const status = registration();
  status.main.slots.enabled = [0];
  assert.throws(() => resolveNativeTables(status), /Invalid native slot status/);
  const table = registration();
  delete table.generic;
  assert.throws(() => resolveNativeTables(table), /Incomplete native table registration/);
  const extra = registration();
  extra.other = extra.generic;
  assert.throws(() => resolveNativeTables(extra), /Incomplete native table registration/);
});

test('differences cannot overwrite semantic identity, overlap or lose observation coverage', () => {
  const signatures = registration();
  signatures.main.signatures[0].fields.name = 'invented';
  assert.throws(() => resolveNativeTables(signatures), /Invalid native signature differences/);
  const repeated = registration();
  repeated.main.signatures.push(structuredClone(repeated.main.signatures[0]));
  assert.throws(() => resolveNativeTables(repeated), /Overlapping native signatures/);
  const observations = registration();
  observations.main.observedArgumentWords[0].ids.pop();
  assert.throws(() => resolveNativeTables(observations), /Incomplete native argument observations/);
  const evidence = registration();
  delete evidence.main.evidence;
  assert.throws(() => resolveNativeTables(evidence), /Missing native semantic evidence/);
});

test('explicit signature differences support four/five and six/seven word counts', () => {
  const tables = registration();
  tables.main = {
    count: 857,
    slots: {
      unknown: Array.from({ length: 857 }, (_, id) => id).filter(
        (id) => ![0x181, 0x358].includes(id),
      ),
      recovered: [0x181, 0x358],
    },
    signatures: [
      {
        ids: [0x181],
        fields: {
          argumentWords: 4,
          parameters: structuredClone(
            NATIVE_SEMANTICS.main[0x181].signature.parameters.slice(0, 4),
          ),
        },
      },
      {
        ids: [0x358],
        fields: {
          argumentWords: 6,
          parameters: structuredClone(
            NATIVE_SEMANTICS.main[0x358].signature.parameters.slice(0, 6),
          ),
        },
      },
    ],
    evidence: [
      {
        ids: [0x181, 0x358],
        value:
          'authored representation case; not an engine registration or original behavior comparison',
      },
    ],
  };
  const resolved = resolveNativeTables(tables);
  assert.equal(resolved.main.entries[0x181].signature.argumentWords, 4);
  assert.equal(resolved.main.entries[0x358].signature.argumentWords, 6);
  assert.equal(NATIVE_SEMANTICS.main[0x181].signature.argumentWords, 5);
  assert.equal(NATIVE_SEMANTICS.main[0x358].signature.argumentWords, 7);
});

test('resolution owns input differences and keeps mirrors independent of signatures', () => {
  const tables = registration();
  tables.main.signatures[0].fields.parameters = structuredClone(
    NATIVE_SEMANTICS.main[6].signature.parameters,
  );
  const resolved = resolveNativeTables(tables).main.entries[6];
  assert.notEqual(resolved.parameters, resolved.signature.parameters);
  assert.deepEqual(resolved.parameters, resolved.signature.parameters);
  tables.main.signatures[0].fields.parameters[0].description = 'caller mutation';
  assert.equal(resolved.signature.parameters[0].description, 'word value');
  resolved.parameters[0].type.kind = 'unknown';
  assert.equal(resolved.signature.parameters[0].type.kind, 'bits');
  assert.ok(Object.isFrozen(NATIVE_SEMANTICS.main[6].signature.parameters[0].type));
  assert.throws(() => {
    NATIVE_SEMANTICS.main[6].name = 'changed';
  }, TypeError);
});
