// SPDX-License-Identifier: MPL-2.0
import test from 'node:test';
import assert from 'node:assert/strict';
import { nativeABI } from '../src/native/abi/index.mjs';
import { dataWorld } from './fixtures/data-world.mjs';
test('reviewed name-pair entries remain explicit script-visible unsupported diagnostics', async () => {
  const profile = 'nekopara-vol3-engine-2.6.1.76',
    world = await dataWorld(profile);
  try {
    for (let id = 0x121; id <= 0x125; id++) {
      const entry = nativeABI(profile).tables.main.entries[id],
        args = Array(entry.signature.argumentWords).fill(0);
      assert.equal(entry.migrationReview.decision, 'retain-unsupported');
      assert.equal(entry.migrationReview.reachability.observedCallSites, 0);
      assert.throws(
        () => world.runtime.native('main', id, args, world.main.machine, world.main),
        (error) =>
          error.name === 'UnsupportedKCSNative' &&
          error.details.id === id &&
          error.details.profile === profile &&
          error.details.task === world.main.id &&
          error.details.pc === world.main.machine.pc &&
          error.details.args.length === args.length,
      );
    }
  } finally {
    await world.close();
  }
});
test('reviewed SDK data entries have their own evidence and observed argument counts', () => {
  const entries = nativeABI('sdk-4.01-engine-2.6.1.74').tables.main.entries.filter((entry) =>
    entry.evidence?.includes('docs/native-domain4-review.md'),
  );
  assert.equal(entries.length, 65);
  for (const entry of entries) {
    assert.ok(entry.name);
    assert.equal(entry.status, 'recovered');
    assert.deepEqual(entry.observedArgumentWords, [entry.signature.argumentWords]);
    assert.deepEqual(entry.controlCodes, entry.signature.controlCodes);
  }
});
