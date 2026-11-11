// SPDX-License-Identifier: MPL-2.0
// Existing authored DLL oracle; no private game EXE or new instruction probes.
import test from 'node:test';
import assert from 'node:assert/strict';
import { NativePPIRuntime } from '../../src/ppi/native.mjs';
import { loadUnicorn } from '../../src/ppi/backend.mjs';
import { JSPluginRuntime } from '../../src/ppi/js-runtime.mjs';
import { PPIRegistry, ppiIdentity } from '../../src/ppi/plugin-identity.mjs';
import { recordPPIFrames } from '../../oracle/plugin-frames.mjs';
import { nativeParticleFixture } from '../fixtures/ppi-native-fixture.mjs';
import { authoredPPI } from '../fixtures/ppi-js-fixture.mjs';

test('JS PPI transport matches existing authored DLL frames, RNG and module statics exactly', async () => {
  const bytes = nativeParticleFixture(),
    identity = await ppiIdentity(bytes, 'authored.ppi'),
    registry = new PPIRegistry({
      implementations: { authored: authoredPPI },
      verified: [{ name: identity.name, sha256: identity.sha256, version: identity.version }],
    }),
    js = new JSPluginRuntime({ registry }),
    native = await NativePPIRuntime.open({ unicornFactory: loadUnicorn, now: () => 0, epoch: 0 }),
    options = {
      name: 'authored.ppi',
      count: 4,
      width: 64,
      height: 32,
      screenWidth: 320,
      screenHeight: 240,
    },
    pairs = [];
  let fresh;
  try {
    for (let n = 0; n < 2; n++)
      pairs.push([await native.create(bytes, options), await js.create(bytes, options)]);
    for (const [a, b] of pairs)
      assert.deepEqual(
        recordPPIFrames(b, [0, 1, 7], { stop: false }),
        recordPPIFrames(a, [0, 1, 7], { stop: false }),
      );
    fresh = await JSPluginRuntime.fromSnapshot(js.snapshot(), { registry });
    for (const [a, b] of pairs) {
      assert.deepEqual(recordPPIFrames(b, [9, 17]), recordPPIFrames(a, [9, 17]));
      recordPPIFrames(fresh.instances.get(b.id), [9, 17]);
    }
    assert.deepEqual(fresh.snapshot(), js.snapshot());
  } finally {
    fresh?.close();
    js.close();
    native.close();
  }
});
