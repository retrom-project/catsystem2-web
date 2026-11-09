// SPDX-License-Identifier: MPL-2.0
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { nativeScalarCases } from './fixtures/scalar-cases.mjs';
import { observeNativeCase } from './fixtures/native-differential.mjs';
import { compareNativeGolden } from './fixtures/native-golden.mjs';
import { nativeScalarMath } from '../src/native/scalar-math.mjs';
const golden = JSON.parse(
  await readFile(new URL('./fixtures/scalar-golden.json', import.meta.url)),
);
for (const [profile, record] of Object.entries(golden.profiles))
  test(`${profile} scalar GCALL golden without an EXE`, async () => {
    for (const input of nativeScalarCases(profile)) {
      const expected = record.cases[input.name];
      assert.ok(expected, input.name);
      compareNativeGolden(await observeNativeCase(input), expected, input.policy, input.name);
    }
  });
test('word unpacking reads the argument frame before ordered writes and rejects unmapped destinations', () => {
  const memory = new Uint8Array(32),
    view = new DataView(memory.buffer),
    machine = {
      nativeArgument: (i) => [0x80007fff, 1, 2][i],
      store: (address, value) => view.setUint32(address, value, true),
    };
  assert.deepEqual(nativeScalarMath('math.unpackWords', [], machine, 3), { control: 2 });
  assert.equal(view.getUint32(2, true), 0xffff8000);
  assert.throws(
    () => nativeScalarMath('math.unpackWords', [0x12345678, 4, 32], machine, 3),
    RangeError,
  );
  assert.equal(
    view.getUint32(4, true),
    0x5678,
    'first destination was written before invalid second destination',
  );
});
