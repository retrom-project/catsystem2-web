// SPDX-License-Identifier: MPL-2.0
// Public mathematical inputs, not another original whole-message calibration.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
const reference = JSON.parse(
  await readFile(new URL('./fixtures/effekseer/camera-reference.json', import.meta.url)),
);
const floats = (bits) => new Float32Array(Uint32Array.from(bits).buffer);
import { identity44, lookAtRH, perspectiveFovRH } from '../src/effekseer/camera.mjs';
test('relocatedLookAt matches sealedmethod bits and its unchanged fourthcolumn contract', () => {
  for (const c of reference.cases) {
    const out = floats(c.initialOutBits);
    lookAtRH(floats(c.eyeBits), floats(c.atBits), floats(c.upBits), out);
    assert.deepEqual(new Uint32Array(out.buffer), Uint32Array.from(c.expectedBits));
  }
  const c = reference.cases.find((c) => c.id === 'lookAt-z-axis');
  const output = identity44();
  output[3] = 3;
  output[7] = 7;
  output[11] = 11;
  const expected = floats(c.expectedBits);
  // The native z-axis method supplies all written values. The complete source
  // leaves3/7/11 untouched, so these authored values have an independent owner.
  expected[3] = 3;
  expected[7] = 7;
  expected[11] = 11;
  lookAtRH([0, 0, 10], [0, 0, 0], [0, 1, 0], output);
  assert.deepEqual(new Uint32Array(output.buffer), new Uint32Array(expected.buffer));
});
test('Perspective uses authored1.57f/aspect/depth and rejects unverified nonfinite domain', () => {
  const f = Math.fround,
    fov = f(1.57),
    aspect = f(4 / 3),
    actual = perspectiveFovRH(fov, aspect, 1, 50);
  const y = f(1 / f(Math.tan(f(fov * 0.5))));
  assert.deepEqual(Array.from(actual), [
    f(y / aspect),
    0,
    0,
    0,
    0,
    y,
    0,
    0,
    0,
    0,
    f(50 / -49),
    -1,
    0,
    0,
    f(50 / -49),
    0,
  ]);
  for (const value of [0, -1, NaN, Infinity])
    assert.throws(() => perspectiveFovRH(fov, value, 1, 50));
});
