// SPDX-License-Identifier: MPL-2.0
// Compare complete production-codec files without enumerating every decoded byte
// as an object property or retaining an unbounded pretty-printed failure diff.
export function checkpointDifference(current, saved) {
  if (!(current instanceof Uint8Array) || !(saved instanceof Uint8Array))
    throw new TypeError('Checkpoint observations require encoded Uint8Array files');
  if (current.byteLength !== saved.byteLength)
    return { currentLength: current.byteLength, savedLength: saved.byteLength };
  for (let offset = 0; offset < current.byteLength; offset++)
    if (current[offset] !== saved[offset])
      return { offset, currentByte: current[offset], savedByte: saved[offset] };
  return null;
}
