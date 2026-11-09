// SPDX-License-Identifier: MPL-2.0
import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  IMAGE_RANGES,
  check,
  compareBaseline,
  scanRuntime,
  scanSource,
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

test('a reviewed non-address directive applies to exactly one adjacent literal', () => {
  assert.deepEqual(
    scanSource(
      'const flag = 0x400000 /* exe-address-check: non-address - D3D feature flag */; const address = 0x400001;',
    ),
    counts(1),
  );
  assert.deepEqual(
    scanSource('const flag = (x | 0x400000) /* exe-address-check: non-address - D3D flag */;'),
    counts(),
  );
  for (const source of [
    'const a = 0x400000; next(); /* exe-address-check: non-address - D3D feature flag */',
    'const a = 0x400000 /* exe-address-check: non-address - x */;',
    'const a = 3 /* exe-address-check: non-address - D3D feature flag */;',
    '// exe-address-check: non-address - ignore whole file\nconst a = 0x400000;',
  ])
    assert.throws(() => scanSource(source), /non-address directive must immediately follow/);
  assert.throws(() => scanSource('const broken = ;'), /Parsing error/);
});

test('compares each category in each file and treats new or deleted files as zero', () => {
  const result = compareBaseline(
    { 'src/old.mjs': counts(2, 1, 2), 'src/deleted.mjs': counts(1) },
    { 'src/old.mjs': counts(1, 2, 2), 'src/new.mjs': counts(0, 0, 1) },
  );
  assert.deepEqual(result.increases, [
    'src/new.mjs: references 0 -> 1',
    'src/old.mjs: calls 1 -> 2',
  ]);
  assert.deepEqual(result.decreases, [
    'src/deleted.mjs: addresses 1 -> 0',
    'src/old.mjs: addresses 2 -> 1',
  ]);
});

test('scans all runtime directories and only updates the baseline after reductions', async (t) => {
  const root = await mkdtemp(join(tmpdir(), 'catsystem2-exe-check-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  await mkdir(join(root, 'src/.hidden'), { recursive: true });
  await mkdir(join(root, 'tests'), { recursive: true });
  await mkdir(join(root, 'scripts'), { recursive: true });
  await writeFile(join(root, 'src/existing.mjs'), 'const a = 0x400001; engine.call(a);');
  await writeFile(join(root, 'src/.hidden/clean.js'), 'const count = 3;');
  await writeFile(join(root, 'tests/fixture.mjs'), 'engine.call(0x400001);');
  const references = {
    nativeReference: { engineSha256: IMAGE_RANGES[1].sha256 },
    gameNativeReference: { preparedEngineSha256: IMAGE_RANGES[0].sha256, imageBase: '0x400000' },
  };
  await writeFile(join(root, 'references.json'), JSON.stringify(references));
  const baselinePath = join(root, 'scripts/exe-dependency-baseline.json');
  const baseline = { version: 1, files: { 'src/existing.mjs': counts(2, 1) } };
  await writeFile(baselinePath, JSON.stringify(baseline));
  assert.deepEqual(await scanRuntime(root), { 'src/existing.mjs': counts(1, 1) });
  await check(root);
  assert.deepEqual(JSON.parse(await readFile(baselinePath, 'utf8')), baseline);

  await writeFile(join(root, 'src/.hidden/new.mjs'), 'engine.call(1);');
  await assert.rejects(check(root, { update: true }), /src\/\.hidden\/new\.mjs: calls 0 -> 1/);
  assert.deepEqual(JSON.parse(await readFile(baselinePath, 'utf8')), baseline);
  await rm(join(root, 'src/.hidden/new.mjs'));
  await check(root, { update: true });
  assert.deepEqual(JSON.parse(await readFile(baselinePath, 'utf8')).files, {
    'src/existing.mjs': counts(1, 1),
  });
  await writeFile(
    join(root, 'src/existing.mjs'),
    'const a = 0x400001, b = 0x400002; engine.call(a);',
  );
  await assert.rejects(check(root), /addresses 1 -> 2/);
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
