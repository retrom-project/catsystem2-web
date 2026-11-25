// SPDX-License-Identifier: MPL-2.0
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import {
  modernGeometryVM,
  modernMainGeometryVM,
  modernMainYawPitchRollVM,
} from './fixtures/modern-geometry.mjs';
import { unmappedModernScalar } from './fixtures/modern-scalar.mjs';

const golden = JSON.parse(
  await readFile(new URL('./fixtures/modern-interpreter-geometry-golden.json', import.meta.url)),
);
for (const [profile, record] of Object.entries(golden.profiles)) {
  test(`${profile} initialized Generic geometry and independent cold continuation`, async () => {
    for (const input of record.cases)
      assert.deepEqual(
        await modernGeometryVM(profile, input),
        await modernGeometryVM(profile, input, true),
        `${input.id}/${input.mode}`,
      );
    await unmappedModernScalar(profile, 'generic', 18);
  });
  test(`${profile} own identical Main geometry wrappers retain raw words and cold World`, async () => {
    for (const input of record.cases.filter(
      (input) =>
        input.mainId !== null && ['data', 'NaN', 'mapped', 'short', 'tail'].includes(input.mode),
    ))
      assert.deepEqual(
        await modernMainGeometryVM(profile, input, false, input.mode === 'data'),
        await modernMainGeometryVM(profile, input, true, input.mode === 'data'),
        `${input.mainId}/${input.mode}`,
      );
    await unmappedModernScalar(profile, 'main', 204);
    for (const input of record.mainYawPitchRoll)
      for (const mode of ['exact', 'mapped', 'short', 'tail'])
        await modernMainYawPitchRollVM(profile, input, mode);
  });
}
