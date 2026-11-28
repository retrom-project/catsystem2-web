// SPDX-License-Identifier: MPL-2.0
// Only the authored formatter result's exact byte span is private scratch.
import assert from 'node:assert/strict';
export const sdkStandardOracle = {
  prepare(engine, fixture) {
    const expected = fixture.oracle.formattedBytes;
    if (!expected) return {};
    const bytes = Uint8Array.from([...expected, 0]),
      address = 0xc94678;
    return {
      projectedRanges: [{ address, bytes: bytes.length }],
      afterCall() {
        assert.deepEqual(
          engine.process.read(address, bytes.length),
          bytes,
          'SDK original formatter output matches the authored expected bytes',
        );
      },
    };
  },
};
