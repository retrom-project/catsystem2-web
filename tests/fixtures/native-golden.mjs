// SPDX-License-Identifier: MPL-2.0
import { createHash } from 'node:crypto';
import assert from 'node:assert/strict';
import { compareFloatWord } from './native-observations.mjs';
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
