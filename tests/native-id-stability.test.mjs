// SPDX-License-Identifier: MPL-2.0
import test from 'node:test';
import assert from 'node:assert/strict';
import {
  alignHandlerObservations,
  compareIDObservations,
} from '../scripts/native-id-stability.mjs';

const entry = (id, name) => ({
  id,
  prefixArgReadOffsets: [],
  controlCodes: [],
  facts: { importAPIs: name ? [`example.dll!${name}`] : [] },
});
const table = (version, entries) => ({ version, sourceSha256: version, entries });

test('an inserted handler beats same-ID alignment using independent import observations', () => {
  const left = ['Read', 'Write', 'Close'].map((name, id) => entry(id, name));
  const right = ['Open', 'Read', 'Write', 'Close'].map((name, id) => entry(id, name));
  const result = alignHandlerObservations(left, right);
  assert.equal(result.sameIDIsOptimal, false);
  assert.equal(result.optimalAlignmentUnique, true);
  assert.deepEqual(result.onlyRight, [0]);
  assert.deepEqual(result.pairs, [
    { left: 0, right: 1 },
    { left: 1, right: 2 },
    { left: 2, right: 3 },
  ]);
  assert.equal(result.review, 'candidate-only');
});

test('repeated stubs preserve multiple optimal alignments rather than selecting a claimed move', () => {
  const stub = (id) => ({ ...entry(id), stub: 'noop-control2', controlCodes: [2] });
  const result = alignHandlerObservations([stub(0), stub(1)], [stub(0), stub(1), stub(2)]);
  assert.equal(result.sameIDIsOptimal, true);
  assert.equal(result.optimalAlignmentUnique, false);
  assert.equal(result.review, 'candidate-only');
});

test('equal IDs without observations retain unresolved pairs and never establish semantics', () => {
  const result = compareIDObservations(table('one', [entry(0)]), table('two', [entry(0)]));
  assert.equal(result.alignment.sameIDIsOptimal, true);
  assert.deepEqual(result.alignment.pairsWithoutSharedFeatures, [{ left: 0, right: 0 }]);
  assert.match(result.limitations.join(' '), /not proof/);
});

test('partial argument reads and incomplete control sites stay distinct from observed conflicts', () => {
  const left = [entry(0, 'Work'), entry(1, 'Other')],
    right = [entry(0, 'Work'), entry(1, 'Other')];
  left[0].prefixArgReadOffsets = [0];
  right[0].prefixArgReadOffsets = [0, 4];
  left[0].controlCodes = [1];
  right[0].controlCodes = [2];
  left[0].controlsComplete = true;
  right[0].controlsComplete = false;
  left[1].controlCodes = [1];
  right[1].controlCodes = [2];
  left[1].controlsComplete = right[1].controlsComplete = true;
  const result = compareIDObservations(table('one', left), table('two', right));
  assert.equal(result.summary.prefixArgumentReadsEqual, 1);
  assert.equal(result.summary.completeControlsComparable, 1);
  assert.equal(result.summary.completeControlConflicts, 1);
  assert.equal(result.sameID[0].completeControlConflict, false);
  assert.equal(result.sameID[1].completeControlConflict, true);
});

test('missing IDs and invalid penalties cannot silently change the alignment input', () => {
  assert.throws(() => alignHandlerObservations([entry(1)], [entry(0)]), /contiguous/);
  assert.throws(
    () => alignHandlerObservations([entry(0)], [entry(0)], { gapPenalty: 0 }),
    /positive/,
  );
});

test('existing extractor records retain partial evidence and producer limitations', () => {
  const inventory = {
    engineVersion: 'authored',
    sha256: 'authored-image',
    limitations: ['bounded producer'],
    tables: [
      {
        name: 'main',
        entries: [
          {
            id: 0,
            handler: {
              complete: true,
              pattern: ['mov eax,0x2', 'ret 0x10'],
              signature: {
                directArgumentByteOffsets: [],
                controlCodes: [2],
                controlsComplete: true,
              },
            },
          },
        ],
      },
    ],
  };
  const result = compareIDObservations(inventory, inventory);
  assert.equal(result.left.version, 'authored');
  assert.equal(result.sameID[0].leftStub, 'noop-control2');
  assert.equal(result.summary.completeControlsComparable, 1);
  assert.deepEqual(result.inputLimitations.left, ['bounded producer']);
  assert.equal(result.alignment.review, 'candidate-only');
});
