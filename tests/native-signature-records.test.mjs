// SPDX-License-Identifier: MPL-2.0
import test from 'node:test';
import assert from 'node:assert/strict';
import {
  validateNativeSignature,
  nativeSignatureContract,
  nativeSignatureDifferences,
} from '../src/native/abi/signature.mjs';

const parameter = (type) => ({ name: 'value', description: 'authored value', type });
const signature = (parameters, result = { kind: 'void' }) => ({
  argumentWords: Array.isArray(parameters) ? parameters.length : null,
  parameters,
  result,
  controlCodes: [2],
  resultWritten: false,
  review: 'authored',
});
const pointer = (addressSpace, direction = 'unknown') => ({
  kind: 'pointer',
  addressSpace,
  direction,
  target: { kind: 'unknown' },
});

test('unknown, ignored and fixed zero arguments remain different contracts', () => {
  const unknown = signature(null),
    ignored = signature({ kind: 'ignored', description: 'unused arguments' }),
    empty = signature([]);
  for (const value of [unknown, ignored, empty]) validateNativeSignature(value);
  assert.deepEqual(nativeSignatureDifferences(unknown, ignored), ['parameters']);
  assert.deepEqual(nativeSignatureDifferences(unknown, empty), ['argumentWords', 'parameters']);
  assert.equal(nativeSignatureContract(unknown).argumentWords, null);
});

test('raw words, unsigned values and distinct pointer spaces do not compare equal', () => {
  const raw = signature([parameter({ kind: 'bits', bits: 32 })]);
  const numeric = signature([parameter({ kind: 'integer', bits: 32, signed: false })]);
  assert.deepEqual(nativeSignatureDifferences(raw, numeric), ['parameters']);
  assert.deepEqual(
    nativeSignatureDifferences(
      signature([parameter(pointer('vm'))]),
      signature([parameter(pointer('native'))]),
    ),
    ['parameters'],
  );
  assert.deepEqual(
    nativeSignatureDifferences(
      signature([parameter(pointer('vm', 'out'))]),
      signature([parameter(pointer('vm', 'inout'))]),
    ),
    ['parameters'],
  );
});

test('descriptions and review notes are not type differences while result writes and controls are', () => {
  const a = signature([parameter({ kind: 'float', bits: 32 })]),
    b = structuredClone(a);
  b.review = 'needs-review';
  b.parameters[0].description = 'a different explanation';
  b.result.description = 'no word result';
  assert.deepEqual(nativeSignatureDifferences(a, b), []);
  b.resultWritten = null;
  assert.deepEqual(nativeSignatureDifferences(a, b), ['resultWritten']);
  b.controlCodes = [1, 2];
  assert.deepEqual(nativeSignatureDifferences(a, b), ['controlCodes', 'resultWritten']);
});

test('conditional and uninitialized results retain their explicit availability', () => {
  const uninitialized = signature([], { kind: 'bits', bits: 32, initialization: 'uninitialized' });
  const ordinary = signature([], { kind: 'bits', bits: 32 });
  validateNativeSignature(uninitialized);
  assert.deepEqual(nativeSignatureDifferences(uninitialized, ordinary), ['result']);
  const conditional = signature([], { kind: 'boolean', availability: 'conditional' });
  validateNativeSignature(conditional);
  assert.deepEqual(nativeSignatureDifferences(conditional, signature([], { kind: 'boolean' })), [
    'result',
  ]);
});

test('malformed widths, pointer direction and declaration count fail validation', () => {
  assert.throws(
    () =>
      validateNativeSignature(signature([parameter({ kind: 'integer', bits: 64, signed: false })])),
    /parameter/,
  );
  assert.throws(
    () => validateNativeSignature(signature([parameter(pointer('vm', 'maybe'))])),
    /parameter/,
  );
  const count = signature([parameter({ kind: 'bits', bits: 32 })]);
  count.argumentWords = 0;
  assert.throws(() => validateNativeSignature(count), /explicit word count/);
});
