// SPDX-License-Identifier: MPL-2.0
import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { execFile as execute } from 'node:child_process';
import { promisify } from 'node:util';
import { fileURLToPath } from 'node:url';
import { engineFixture, engineFixtureSet, oracleFixtureSet } from './fixtures/oracle-fixtures.mjs';
import { nativeTestGroups } from '../scripts/test-native.mjs';

const profile = 'sdk-4.01-engine-2.6.1.74';
test('missing private fixtures skip explicitly and strict mode fails before executing tests', async () => {
  const missing = await engineFixture(profile, { env: {} });
  assert.equal(missing.available, false);
  assert.match(missing.reason, /CATSYSTEM2_SDK_EXE/);
  assert.equal((await engineFixtureSet({ env: {} })).filter((item) => !item.available).length, 2);
  await assert.rejects(
    engineFixture(profile, { env: {}, required: true }),
    /Missing private oracle fixture/,
  );
  assert.equal((await oracleFixtureSet({ env: {} })).filter((item) => !item.available).length, 4);
  const root = fileURLToPath(new URL('..', import.meta.url));
  const env = {
    ...process.env,
    CATSYSTEM2_SDK_EXE: '',
    CATSYSTEM2_ENGINE_EXE: '',
    CATSYSTEM2_EMOTE_DLL: '',
    CATSYSTEM2_PPI_FIXTURES: '',
  };
  await assert.rejects(
    promisify(execute)(process.execPath, ['scripts/test-native.mjs', '--require-fixtures'], {
      cwd: root,
      env,
    }),
    (error) => error.code === 1 && /Missing private oracle fixture/.test(error.stderr),
  );
});

test('an explicitly supplied missing or unreviewed fixture fails instead of skipping', async (t) => {
  const root = await mkdtemp(join(tmpdir(), 'catsystem2-fixture-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  await assert.rejects(
    engineFixture(profile, { env: { CATSYSTEM2_SDK_EXE: join(root, 'missing.exe') } }),
    /ENOENT/,
  );
  const invalid = join(root, 'invalid.exe');
  await writeFile(invalid, Uint8Array.of(77, 90, 0, 0));
  await assert.rejects(
    engineFixture(profile, { env: { CATSYSTEM2_SDK_EXE: invalid } }),
    /reviewed.*SHA-256/,
  );
  await assert.rejects(
    oracleFixtureSet({ env: { CATSYSTEM2_EMOTE_DLL: invalid } }),
    /unreviewed SHA-256/,
  );
});

test('all original 107 migration targets retain ownership and current executable groups are disjoint', async () => {
  const root = fileURLToPath(new URL('..', import.meta.url)),
    inventory = await nativeTestGroups(root);
  assert.deepEqual(inventory.targets, { oracle: 33, differential: 51, js: 23 });
  assert.equal(inventory.original.length, 107);
  const files = Object.values(inventory.groups).flat();
  assert.equal(files.length, new Set(files).size);
  assert.ok(inventory.groups.js.includes('tests/native-abi.test.mjs'));
  assert.ok(inventory.groups.oracle.includes('tests/native-scalar-math.test.mjs'));
  assert.ok(inventory.groups.oracle.includes('tests/ppi-native.test.mjs'));
  assert.equal(
    inventory.original.find((item) => item.file === 'tests/native-engine-process.test.mjs')?.state,
    'current',
  );
});
