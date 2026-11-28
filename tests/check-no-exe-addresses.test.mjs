// SPDX-License-Identifier: MPL-2.0
import test from 'node:test';
import assert from 'node:assert/strict';
import {
  IMAGE_RANGES,
  scanSource,
  ordinaryNumericConstants,
  scanRuntimeCapabilities,
  validateReferences,
} from '../scripts/check-no-exe-addresses.mjs';

const counts = (addresses = 0, calls = 0, references = 0) => ({ addresses, calls, references });

test('counts numeric literals only inside the verified PE images', () => {
  const source = `
    const first = 0x400000, gameLast = 0xbe4fff, sdkOnly = 0xbe5000;
    const sdkLast = 0xce3fff, below = 0x3fffff, after = 0xce4000;
    const decimal = 4194304, separator = 0x40_0001, negative = -0x400000;
    const text = '0x400000 engine.call() NativeEngineProcess';
    const pattern = /0x400000/;
    // 0x400000 engine.call() NativeEngineProcess
  `;
  assert.deepEqual(scanSource(source), counts(6));
});

test('counts the specified calls and EXE process references, including computed members', () => {
  const source = `
    import { NativeEngineProcess as Process } from './engine-process.mjs';
    export * from '../native/engine-process.mjs';
    import('./engine-process.mjs');
    NativeEngineProcess.open();
    engine.call(); this.engine.call(); world.nativeEngine['call']();
    engine.process.call(); engine?.call?.();
    process.callFromHost(); callFromHost(); engine['patch'](); other.patch();
    plugin.call(); this.call(); text.replace('patch', 'call');
  `;
  assert.deepEqual(scanSource(source), counts(0, 9, 5));
});

test('source comments cannot suppress numeric overlaps or grant capability exemptions', () => {
  assert.deepEqual(
    scanSource(
      'const flag=0x400000 /* exe-address-check: non-address - data flag */; const target=0x400001;',
    ),
    counts(2),
  );
  assert.deepEqual(
    scanSource('const flag=(x|0x400000) /* exe-address-check: non-address - data flag */;'),
    counts(1),
  );
  assert.throws(() => scanSource('const broken=;'), /Parsing error/);
});

test('fails closed if either reference fingerprint or the recorded image base changes', () => {
  const references = {
    nativeReference: { engineSha256: IMAGE_RANGES[1].sha256 },
    gameNativeReference: { preparedEngineSha256: IMAGE_RANGES[0].sha256, imageBase: '0x400000' },
  };
  assert.doesNotThrow(() => validateReferences(references));
  assert.throws(
    () => validateReferences({ ...references, nativeReference: {} }),
    /fingerprint changed/,
  );
  assert.throws(
    () =>
      validateReferences({
        ...references,
        gameNativeReference: { ...references.gameNativeReference, imageBase: '0x500000' },
      }),
    /image base changed/,
  );
});

test('ordinary constants retain raw overlap counts and only their actual typed operands classify as data', () => {
  const source = 'const TIME_UNITS = 10000000n;';
  assert.equal(scanSource(source).addresses, 1);
  assert.equal(ordinaryNumericConstants(source, 'src/native/movie-hap.mjs').length, 1);
  assert.equal(ordinaryNumericConstants(source, 'src/other.mjs').length, 0);
  assert.equal(
    ordinaryNumericConstants('const target = 10000000n;', 'src/native/movie-hap.mjs').length,
    0,
  );
  assert.equal(
    ordinaryNumericConstants(
      'class Sound { auxiliaries(){return get32(plv,0) === 0x4c5650;} }',
      'src/native/sound.mjs',
    ).length,
    1,
  );
  assert.equal(
    ordinaryNumericConstants(
      'class Sound { auxiliaries(){return get32(other,0) === 0x4c5650;} }',
      'src/native/sound.mjs',
    ).length,
    0,
  );
});

test('ordinary owner audit follows optional, computed and destructured capabilities without hiding serialized data', () => {
  for (const source of [
    'world?.nativeEngine',
    'world["nativeEngineLoading"]',
    'const {nativeEngine}=world;',
  ])
    assert.equal(
      scanRuntimeCapabilities(source, 'src/other.mjs').owners[0].serializedCheckpointGuard,
      false,
    );
  for (const source of [
    'world?.ensureNativeEngine?.();',
    'world["getNativeFeature"]();',
    'const {callFromHost}=owner;',
    'new Function("return 0");',
  ])
    assert.ok(scanRuntimeCapabilities(source, 'src/other.mjs').execution.length);
  const input = scanRuntimeCapabilities(
    'function requireCheckpointRestoreOwner(state){return state?.nativeEngine;}',
    'src/native/original-adapter.mjs',
  );
  assert.equal(input.owners.length, 1);
  assert.equal(input.owners[0].serializedCheckpointGuard, true);
  assert.equal(scanRuntimeCapabilities('owner.process', 'src/other.mjs').memory[0].owned, false);
  assert.equal(
    scanRuntimeCapabilities('this.process', 'src/native/data-buffer.mjs').memory[0].owned,
    true,
  );
});
