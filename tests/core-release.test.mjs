// SPDX-License-Identifier: MPL-2.0
import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { releaseTag, verifyCandidatePair } from '../scripts/prepare-core-release.mjs';
const config = JSON.parse(await readFile(new URL('../retrom-fork.json', import.meta.url)));
const sha = (bytes) => createHash('sha256').update(bytes).digest('hex');

test('original core release tags are strict stable or numbered RC versions', () => {
  assert.deepEqual(releaseTag('v0.1.0-rc.1'), {
    tag: 'v0.1.0-rc.1',
    version: '0.1.0-rc.1',
    prerelease: true,
  });
  assert.equal(releaseTag('v1.2.3').prerelease, false);
  for (const tag of [
    'latest',
    'v01.2.3',
    'v1.2.3-rc.0',
    'v1.2.3-rc.01',
    'v1.2.3-beta.1',
    'v1.2.3/other',
    'v1.2.3\n',
  ])
    assert.throws(() => releaseTag(tag), /CORE_RELEASE_TAG_INVALID/);
});

test('two builds compare complete archive bytes, including tar metadata', async (t) => {
  const directory = await mkdtemp(join(tmpdir(), 'core-release-control-'));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const payload = join(directory, 'payload'),
    first = join(directory, 'first'),
    second = join(directory, 'second');
  await Promise.all([payload, first, second].map((path) => mkdir(path)));
  await writeFile(join(payload, 'same.mjs'), 'export const authored = 1;\n');
  for (const output of [first, second]) {
    execFileSync('tar', [
      '--format=ustar',
      '--mtime=@0',
      '--owner=0',
      '--group=0',
      '--numeric-owner',
      '-czf',
      join(output, 'catsystem2-web.tar.gz'),
      '-C',
      payload,
      'same.mjs',
    ]);
    await writeFile(join(output, 'catsystem2-web-LICENSE.txt'), 'authored license control\n');
  }
  const files = [];
  for (const filename of [...config.candidateAssets].sort()) {
    const bytes = await readFile(join(first, filename));
    files.push({ filename, sizeBytes: bytes.length, sha256: sha(bytes) });
  }
  const descriptor = {
    schemaVersion: 1,
    kind: 'RETROM_CORE_CANDIDATE_V1',
    coreId: 'catsystem2_web',
    repository: config.forkRepository,
    commit: '1'.repeat(40),
    sourceTreeSha256: '2'.repeat(64),
    dirty: false,
    adapterAbi: config.adapterAbi,
    files,
  };
  for (const output of [first, second])
    await writeFile(join(output, 'retrom-core-candidate.json'), JSON.stringify(descriptor));
  assert.equal((await verifyCandidatePair(first, second, config)).commit, descriptor.commit);
  await assert.rejects(verifyCandidatePair(first, first, config), /Independent build directories/);
  // Identical JS, changed tar timestamp: whole-archive equality must reject it.
  execFileSync('tar', [
    '--format=ustar',
    '--mtime=@1',
    '--owner=0',
    '--group=0',
    '--numeric-owner',
    '-czf',
    join(second, 'catsystem2-web.tar.gz'),
    '-C',
    payload,
    'same.mjs',
  ]);
  await assert.rejects(verifyCandidatePair(first, second, config), /CORE_RELEASE_ARCHIVE_MISMATCH/);
  for (const output of [first, second])
    await writeFile(
      join(output, 'retrom-core-candidate.json'),
      JSON.stringify({ ...descriptor, dirty: true }),
    );
  await assert.rejects(
    verifyCandidatePair(first, second, config),
    /CORE_RELEASE_CANDIDATE_INVALID/,
  );
});
