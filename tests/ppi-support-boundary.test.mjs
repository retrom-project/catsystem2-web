// SPDX-License-Identifier: MPL-2.0
import test from 'node:test';
import assert from 'node:assert/strict';
import { PPIRegistry } from '../src/ppi/plugin-identity.mjs';
import { PPI_IMPLEMENTATIONS } from '../src/ppi/plugins/index.mjs';
import { nativeParticleFixture } from './fixtures/ppi-native-fixture.mjs';
const legacy = {
  name: 'sample_rain',
  path: 'ptclpi/sample_rain.ppi',
  version: 0x10000,
  sha256: '90266315c608b53e081fc2fa33a799178e245f621b9d49f56ee502b5bb3bb758',
};
test('reviewed sample_rain 1.0 fails explicitly instead of aliasing the rain 2.1 algorithm', () => {
  const registry = new PPIRegistry({ implementations: PPI_IMPLEMENTATIONS });
  assert.throws(
    () => registry.select(legacy),
    (error) => {
      assert.equal(error.code, 'CATSYSTEM2_PPI_UNSUPPORTED');
      assert.match(error.message, /sample_rain\.ppi PPI=1\.0/);
      assert.ok(error.message.includes(legacy.sha256));
      return true;
    },
  );
});
test('the support boundary is implementation name, so an unverified rain version still warns and continues', async () => {
  const registry = new PPIRegistry({ implementations: PPI_IMPLEMENTATIONS }),
    warnings = [];
  const result = await registry.resolve(
    nativeParticleFixture({ version: 0x10000 }),
    'rain.ppi',
    (message) => warnings.push(message),
  );
  assert.equal(result.implementation, PPI_IMPLEMENTATIONS.rain);
  assert.equal(warnings.length, 1);
  assert.match(warnings[0], /PPI=1\.0.*continuing with rain-js/);
});
test('deferred names and OpenJTalk/TTS have no implementation or silent substitute', () => {
  const registry = new PPIRegistry({ implementations: PPI_IMPLEMENTATIONS });
  for (const name of [
    'matrix_rain',
    'matrix_snow',
    'sakura',
    'sample',
    'spark',
    'OpenJTalk.dll',
    'tts',
  ]) {
    assert.throws(
      () => registry.select({ ...legacy, name, path: name, version: null }),
      (error) => {
        assert.equal(error.code, 'CATSYSTEM2_PPI_UNSUPPORTED');
        assert.match(error.message, /no JavaScript implementation/);
        assert.ok(error.message.includes(name));
        return true;
      },
    );
  }
});
