// SPDX-License-Identifier: MPL-2.0
import test from 'node:test';
import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';
import {
  validatePluginSource,
  validatePluginDistribution,
  checkPluginBoundary,
} from '../scripts/check-plugin-boundary.mjs';
test('plugins reject restored DLL execution paths and unreviewed consumers', () => {
  for (const source of [
    "import old from '../../oracle/ppi-native-original.mjs';",
    "import old from '../ppi/backend.mjs';",
    'process.call(address);',
    "engine['callFromHost'](address);",
    'const {loadModule}=process;',
    'world.ensureNativeEngine();',
    "world.getNativeFeature('renderer');",
  ])
    assert.throws(() => validatePluginSource(source, 'src/native/emote.mjs'), /Plugin|plugin/);
  validatePluginSource('host.service(slot, value);', 'src/ppi/host.mjs');
  assert.throws(
    () => validatePluginDistribution(['oracle/ppi-runtime-original.mjs']),
    /Distribution/,
  );
  assert.throws(() => validatePluginDistribution(['src/ppi/native.mjs']), /Distribution/);
  validatePluginDistribution(['oracle/transitional-exe.mjs', 'src/ppi/js-runtime.mjs']);
});
test('completed plugin implementation and deployment boundary agree', () =>
  checkPluginBoundary(fileURLToPath(new URL('..', import.meta.url))));

test('the retained engine mapper accepts an EXE without altering its header and rejects DLL loading', async () => {
  const [{ PE32Process }, { loadUnicorn }, { nativeParticleFixture }] = await Promise.all([
    import('../oracle/ppi-pe32.mjs'),
    import('../oracle/ppi-backend.mjs'),
    import('./fixtures/ppi-native-fixture.mjs'),
  ]);
  const p = new PE32Process(await loadUnicorn()),
    bytes = nativeParticleFixture(),
    header = new DataView(bytes.buffer);
  try {
    assert.throws(() => p.loadExecutable(bytes, () => 0), /requires an EXE/);
    const offset = header.getUint32(60, true) + 22;
    header.setUint16(offset, header.getUint16(offset, true) & ~0x2000, true);
    const original = bytes.slice(),
      module = p.loadExecutable(bytes, () => 0, 'authored.exe');
    assert.deepEqual(bytes, original);
    assert.equal(
      new DataView(module.pe.image.buffer).getUint16(offset, true),
      header.getUint16(offset, true),
    );
  } finally {
    p.close();
  }
});
