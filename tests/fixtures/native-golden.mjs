// SPDX-License-Identifier: MPL-2.0
import { createHash } from 'node:crypto';
export function nativeGolden(observation, policy = {}) {
  const regions = structuredClone(observation.memory);
  for (const range of policy.memory ?? [])
    regions[range.region].fill(0, range.offset, range.offset + range.words * 4);
  return {
    control: observation.control,
    resultWritten: observation.resultWritten,
    ...(observation.resultWritten ? { value: observation.value } : {}),
    memory: Object.fromEntries(
      Object.entries(regions).map(([name, bytes]) => [
        name,
        createHash('sha256').update(bytes).digest('hex'),
      ]),
    ),
  };
}
