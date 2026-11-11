// SPDX-License-Identifier: MPL-2.0
import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { describeEmoteDriver, diagnoseMountedEmoteDriver } from '../src/emote/driver-identity.mjs';
test('unverified E-mote driver metadata warns once and continues the same JS implementation', async () => {
  const bytes = new Uint8Array([22, 45, 13]),
    warnings = [],
    warn = (message) => warnings.push(message);
  const identity = await describeEmoteDriver(bytes, { name: 'new/emotedriver.dll', warn });
  assert.equal(identity.implementation, 'emote-js');
  assert.equal(identity.build, 'unknown');
  assert.ok(warnings[0].includes(identity.sha256));
  assert.match(warnings[0], /emotedriver\.dll.*build=unknown.*continuing with emote-js/);
  await describeEmoteDriver(bytes, { name: 'new/emotedriver.dll', warn });
  assert.equal(warnings.length, 1);
  const known = new Uint8Array([12, 33]),
    sha = createHash('sha256').update(known).digest('hex');
  await describeEmoteDriver(known, { verified: [sha], warn });
  assert.equal(warnings.length, 1);
});
test('optional driver inspection reads a mounted identity but never requires a DLL or loads an image', async () => {
  const reads = [],
    game = {
      names: () => ['other.dll', 'path/emotedriver.dll'],
      read: async (name) => {
        reads.push(name);
        return new Uint8Array([32, 24]);
      },
    };
  await diagnoseMountedEmoteDriver(game, { warn: () => {} });
  assert.deepEqual(reads, ['path/emotedriver.dll']);
  await diagnoseMountedEmoteDriver({
    names: () => [],
    read: () => assert.fail('No driver should be required'),
  });
});
