// SPDX-License-Identifier: MPL-2.0
import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, readFile, rm, writeFile, symlink } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { promisify } from 'node:util';
import { execFile as execute } from 'node:child_process';
import { IMAGE_RANGES, check, scanRuntime } from '../scripts/check-no-exe-addresses.mjs';
const execFile = promisify(execute);

test('relocation proves a fixed source address multiset and rejects unlisted increases', async (t) => {
  const root = await mkdtemp(join(tmpdir(), 'catsystem2-relocation-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  for (const directory of ['src', 'scripts', 'oracle']) await mkdir(join(root, directory));
  const put = (file, text) => writeFile(join(root, file), text);
  const baseline = {
    version: 1,
    files: {
      'src/scalar.mjs': { addresses: 2, calls: 1, references: 0 },
    },
  };
  const baselineText = JSON.stringify(baseline);
  await put('scripts/exe-dependency-baseline.json', baselineText);
  await put(
    'references.json',
    JSON.stringify({
      nativeReference: { engineSha256: IMAGE_RANGES[1].sha256 },
      gameNativeReference: { preparedEngineSha256: IMAGE_RANGES[0].sha256, imageBase: '0x400000' },
    }),
  );
  await put('src/scalar.mjs', 'const a = [0x400001, 0x400001]; engine.call(a[0]);');
  const git = async (...args) => (await execFile('git', args, { cwd: root })).stdout.trim();
  await git('init', '--quiet');
  await git('add', '.');
  await git(
    '-c',
    'user.name=Relocation test',
    '-c',
    'user.email=relocation@example.invalid',
    'commit',
    '--quiet',
    '-m',
    'base',
  );
  const plan = {
    version: 1,
    base: await git('rev-parse', 'HEAD'),
    sources: ['src/scalar.mjs'],
    targets: ['oracle/scalar.mjs'],
  };
  await put('scripts/transitional-runtime.json', JSON.stringify({ files: plan.targets }));
  await put('src/scalar.mjs', 'export const scalar = host => host.invokeNative("math.sin");');
  const valid = 'const a = [0x400001, 0x400001]; engine.call(a[0]);';
  await put('oracle/scalar.mjs', valid);
  await assert.rejects(check(root), /dependencies increased/);
  await assert.rejects(check(root, { update: true }), /dependencies increased/);
  await assert.rejects(
    check(root, { relocate: { ...plan, base: '0'.repeat(40) } }),
    /current HEAD/,
  );
  await assert.rejects(
    check(root, { relocate: { ...plan, targets: ['scripts/scalar.mjs'] } }),
    /Invalid.*plan/,
  );
  await assert.rejects(
    check(root, { relocate: { ...plan, targets: ['oracle/../escape.mjs'] } }),
    /Invalid.*plan/,
  );
  await assert.rejects(
    check(root, { relocate: { ...plan, sources: ['src/missing.mjs'] } }),
    /sources must exist/,
  );
  await put('oracle/scalar.mjs', 'const a = [0x400001, 0x400002]; engine.call(a[0]);');
  await assert.rejects(check(root, { relocate: plan }), /introduces address/);
  await put('oracle/scalar.mjs', 'const a = [0x400001, 0x400001]; engine.patch(a[0]);');
  await assert.rejects(check(root, { relocate: plan }), /introduces call kind/);
  await put('oracle/scalar.mjs', valid);
  await put('src/unlisted.mjs', 'const a = 0x400001;');
  await assert.rejects(check(root, { relocate: plan }), /outside relocation/);
  await rm(join(root, 'src/unlisted.mjs'));
  await put('scripts/exe-dependency-baseline.json', JSON.stringify({ version: 1, files: {} }));
  await assert.rejects(check(root, { relocate: plan }), /committed baseline unchanged/);
  await put('scripts/exe-dependency-baseline.json', baselineText);
  assert.equal(
    await readFile(join(root, 'scripts/exe-dependency-baseline.json'), 'utf8'),
    baselineText,
  );
  await check(root, { relocate: plan });
  assert.deepEqual(
    JSON.parse(await readFile(join(root, 'scripts/exe-dependency-baseline.json'), 'utf8')).files,
    await scanRuntime(root),
  );
  await check(root);
});

test('transitional runtime includes reject a symlinked parent directory', async (t) => {
  const root = await mkdtemp(join(tmpdir(), 'catsystem2-includes-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  for (const directory of ['src', 'scripts', 'actual']) await mkdir(join(root, directory));
  await writeFile(join(root, 'actual/file.mjs'), 'engine.call(0x400001);');
  await symlink(join(root, 'actual'), join(root, 'oracle'), 'dir');
  await writeFile(
    join(root, 'scripts/transitional-runtime.json'),
    JSON.stringify({ files: ['oracle/file.mjs'] }),
  );
  await assert.rejects(scanRuntime(root), /Symlink/);
});
