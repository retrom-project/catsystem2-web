// SPDX-License-Identifier: MPL-2.0
import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import assert from 'node:assert/strict';
import { compareFloatWord } from './native-observations.mjs';
const scalarCalibration = JSON.parse(
  await readFile(new URL('./scalar-backend-calibration.json', import.meta.url)),
);
const geometryCalibration = JSON.parse(
  await readFile(new URL('./geometry-backend-calibration.json', import.meta.url)),
);
export const scalarGoldenScope = scalarCalibration.scope;
export const geometryGoldenScope = geometryCalibration.scope;

// This private capture boundary never changes a runtime result. Check the raw
// backend observation first, then retain the separately observed physical word.
export function physicalScalarObservation(observation, input, executableSha256) {
  const profile = scalarCalibration.profiles[input.profile],
    calibration = profile?.cases[input.operation + '/' + input.args.join(',')];
  if (!calibration || input.table !== 'main') return observation;
  assert.equal(executableSha256, profile.executableSha256, 'scalar calibration own PE');
  assert.ok(
    calibration.aliases.some(({ table, id }) => table === input.table && id === input.id),
    'scalar calibration exact wrapper',
  );
  return physicalObservation(observation, input, calibration);
}

export function physicalGeometryObservation(observation, input, executableSha256) {
  const profile = geometryCalibration.profiles[input.profile],
    calibration = profile?.cases[input.name];
  if (!calibration) return observation;
  assert.equal(executableSha256, profile.executableSha256, 'geometry calibration own PE');
  assert.deepEqual(input, calibration.input, 'geometry calibration exact input and VM context');
  return physicalObservation(observation, input, calibration);
}

function physicalObservation(observation, input, calibration) {
  assert.deepEqual(
    nativeGolden(observation, input.policy),
    calibration.backendGolden,
    `${input.name} raw backend observation changed; inspect before recalibrating`,
  );
  const result = {
    ...observation,
    value: calibration.physicalGolden.value,
    memory: Object.fromEntries(
      Object.entries(observation.memory).map(([name, bytes]) => [name, bytes.slice()]),
    ),
  };
  for (const range of calibration.physicalGolden.floatingMemory) {
    const bytes = result.memory[range.region],
      view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
    range.words.forEach((word, i) => view.setUint32(range.offset + i * 4, word, true));
  }
  assert.deepEqual(nativeGolden(result, input.policy), calibration.physicalGolden);
  return result;
}
export function nativeGolden(observation, policy = {}) {
  const regions = structuredClone(observation.memory);
  for (const range of policy.memory ?? [])
    regions[range.region].fill(0, range.offset, range.offset + range.words * 4);
  return {
    control: observation.control,
    resultWritten: observation.resultWritten,
    ...(observation.resultWritten ? { value: observation.value } : {}),
    floatingMemory: (policy.memory ?? []).map((range) => ({
      region: range.region,
      offset: range.offset,
      words: Array.from({ length: range.words }, (_, i) => {
        const bytes = observation.memory[range.region];
        return new DataView(bytes.buffer, bytes.byteOffset, bytes.length).getUint32(
          range.offset + i * 4,
          true,
        );
      }),
    })),
    memory: Object.fromEntries(
      Object.entries(regions).map(([name, bytes]) => [
        name,
        createHash('sha256').update(bytes).digest('hex'),
      ]),
    ),
  };
}
export function compareNativeGolden(observation, expected, policy, label) {
  const actual = nativeGolden(observation, policy);
  if (policy.result === 'f32') {
    compareFloatWord(actual.value, expected.value, policy, label);
    actual.value = expected.value;
  }
  assert.equal(
    actual.floatingMemory.length,
    expected.floatingMemory.length,
    `${label} float region count`,
  );
  for (const [index, range] of actual.floatingMemory.entries()) {
    const reference = expected.floatingMemory[index];
    assert.equal(range.words.length, reference.words.length);
    for (let i = 0; i < range.words.length; i++)
      compareFloatWord(
        range.words[i],
        reference.words[i],
        policy.memory[index],
        `${label}/${range.region}+${range.offset + i * 4}`,
      );
    range.words = reference.words;
  }
  assert.deepEqual(actual, expected, label);
}
