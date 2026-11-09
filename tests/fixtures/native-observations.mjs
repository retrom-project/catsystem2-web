// SPDX-License-Identifier: MPL-2.0
import assert from 'node:assert/strict';
import { bitsFloat } from '../../src/kcs.mjs';

export function compareFloatWord(
  actual,
  expected,
  { ulp = 0, nan = 'exact', atol = 0, rtol = 0 } = {},
  label = 'float',
) {
  assert.ok(
    [actual, expected].every((word) => Number.isInteger(word) && word >= 0 && word <= 0xffffffff),
    `${label} unsigned word`,
  );
  assert.ok(
    Number.isSafeInteger(ulp) &&
      ulp >= 0 &&
      ['classification', 'exact'].includes(nan) &&
      Number.isFinite(atol) &&
      atol >= 0 &&
      Number.isFinite(rtol) &&
      rtol >= 0,
    `${label} tolerance policy`,
  );
  if (actual === expected) return;
  const a = bitsFloat(actual),
    b = bitsFloat(expected);
  if (Number.isNaN(a) || Number.isNaN(b)) {
    assert.ok(
      nan === 'classification' && Number.isNaN(a) && Number.isNaN(b),
      `${label} NaN policy`,
    );
    assert.equal(actual & 0x00400000, expected & 0x00400000, `${label} NaN quiet/signaling class`);
    return;
  }
  assert.ok(
    Number.isFinite(a) && Number.isFinite(b) && a !== 0 && b !== 0,
    `${label} exact zero/infinity`,
  );
  const ordered = (word) => (word & 0x80000000 ? 0xffffffff - word : word + 0x80000000);
  assert.ok(
    Math.abs(ordered(actual) - ordered(expected)) <= ulp ||
      Math.abs(a - b) <= atol + rtol * Math.max(Math.abs(a), Math.abs(b)),
    `${label} exceeds ${ulp} ULP and absolute/relative budget`,
  );
}

function compareBytes(actual, expected, ranges, label) {
  assert.equal(actual.length, expected.length, `${label} byte count`);
  assert.ok(
    actual instanceof Uint8Array && expected instanceof Uint8Array,
    `${label} byte regions`,
  );
  const left = new Uint8Array(actual),
    right = new Uint8Array(expected),
    covered = new Set();
  const a = new DataView(left.buffer, left.byteOffset, left.byteLength),
    b = new DataView(right.buffer, right.byteOffset, right.byteLength);
  for (const range of ranges) {
    assert.ok(
      Number.isSafeInteger(range.offset) &&
        range.offset >= 0 &&
        Number.isSafeInteger(range.words) &&
        range.words > 0 &&
        range.offset + range.words * 4 <= left.length,
      `${label} float range`,
    );
    for (let i = 0; i < range.words; i++) {
      const at = range.offset + i * 4;
      for (let byte = at; byte < at + 4; byte++) {
        assert.ok(!covered.has(byte), `${label} overlapping float ranges`);
        covered.add(byte);
      }
      compareFloatWord(a.getUint32(at, true), b.getUint32(at, true), range, `${label}+${at}`);
      a.setUint32(at, 0, true);
      b.setUint32(at, 0, true);
    }
  }
  assert.deepEqual(left, right, `${label} exact bytes outside float ranges`);
}

export function compareNativeObservations(actual, expected, policy = {}) {
  assert.ok(
    [actual.control, expected.control].every(
      (control) => Number.isInteger(control) && control >= 0 && control <= 5,
    ),
    'valid native control',
  );
  assert.equal(actual.control, expected.control, 'native control');
  assert.equal(actual.resultWritten, expected.resultWritten, 'native output write');
  assert.equal(
    actual.resultWritten,
    [1, 3].includes(actual.control),
    'native control/output contract',
  );
  if (actual.resultWritten) {
    if (policy.result === 'f32')
      compareFloatWord(actual.value, expected.value, policy, 'native result');
    else assert.equal(actual.value, expected.value, 'native result word');
  } else {
    assert.equal(actual.value, undefined, 'void actual output');
    assert.equal(expected.value, undefined, 'void expected output');
  }
  assert.deepEqual(
    Object.keys(actual.memory).sort(),
    Object.keys(expected.memory).sort(),
    'VM region ownership',
  );
  for (const range of policy.memory ?? [])
    assert.ok(Object.hasOwn(expected.memory, range.region), `unknown float region ${range.region}`);
  for (const [name, bytes] of Object.entries(expected.memory))
    compareBytes(
      actual.memory[name],
      bytes,
      (policy.memory ?? []).filter((range) => range.region === name),
      name,
    );
  assert.deepEqual(actual.peWrites, expected.peWrites, 'PE writes outside the VM bridge');
  assert.deepEqual(actual.handles, expected.handles, 'logical handles and resource state');
  assert.deepEqual(actual.tasks, expected.tasks, 'calling task and scheduler state');
  assert.deepEqual(actual.events, expected.events, 'ordered task events');
  assert.deepEqual(actual.nativeCalls, expected.nativeCalls, 'native dispatch trace');
}
