// SPDX-License-Identifier: MPL-2.0
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { execFile } from 'node:child_process';
import { copyFile, lstat, readFile, readdir, realpath, writeFile } from 'node:fs/promises';
import { constants } from 'node:fs';
import { isAbsolute, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { promisify } from 'node:util';

const root = fileURLToPath(new URL('..', import.meta.url));
const command = promisify(execFile);
const sha256 = (bytes) => createHash('sha256').update(bytes).digest('hex');

export function releaseTag(tag) {
  const match = /^v(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)(?:-rc\.([1-9][0-9]*))?$/.exec(
    tag,
  );
  if (
    !match ||
    match[0] !== tag ||
    match
      .slice(1)
      .filter(Boolean)
      .some((n) => !Number.isSafeInteger(Number(n)))
  )
    throw new Error('CORE_RELEASE_TAG_INVALID');
  return { tag, version: tag.slice(1), prerelease: Boolean(match[4]) };
}

export async function verifyCandidatePair(first, second, config) {
  assert.notEqual(
    await realpath(first),
    await realpath(second),
    'Independent build directories are required',
  );
  const descriptors = await Promise.all(
    [first, second].map(async (directory) =>
      JSON.parse(await readFile(join(directory, 'retrom-core-candidate.json'), 'utf8')),
    ),
  );
  const identity = descriptors[0];
  assert.deepEqual(descriptors[1], identity, 'Complete build identities must match');
  if (
    identity.kind !== 'RETROM_CORE_CANDIDATE_V1' ||
    identity.schemaVersion !== 1 ||
    identity.coreId !== 'catsystem2_web' ||
    identity.dirty !== false ||
    identity.repository !== config.forkRepository ||
    identity.adapterAbi !== config.adapterAbi ||
    !/^[0-9a-f]{40}$/.test(identity.commit) ||
    !/^[0-9a-f]{64}$/.test(identity.sourceTreeSha256)
  )
    throw new Error('CORE_RELEASE_CANDIDATE_INVALID');
  assert.deepEqual(
    identity.files.map((file) => file.filename).sort(),
    [...config.candidateAssets].sort(),
  );
  for (const file of identity.files) {
    for (const directory of [first, second]) {
      const path = join(directory, file.filename),
        info = await lstat(path);
      if (
        !info.isFile() ||
        info.isSymbolicLink() ||
        info.size !== file.sizeBytes ||
        sha256(await readFile(path)) !== file.sha256
      )
        throw new Error('CORE_RELEASE_ARCHIVE_MISMATCH');
    }
  }
  return identity;
}

async function main(args) {
  if (args.length === 2 && args[0] === '--check-tag') {
    console.log(JSON.stringify(releaseTag(args[1])));
    return;
  }
  assert.deepEqual(
    args.filter((_arg, i) => i % 2 === 0),
    ['--first', '--second', '--tag', '--output'],
  );
  assert.equal(args.length, 8);
  const [first, second, tag, output] = [args[1], args[3], args[5], args[7]];
  if (![first, second, output].every(isAbsolute))
    throw new Error('Expected absolute build directories');
  const selected = releaseTag(tag),
    config = JSON.parse(await readFile(join(root, 'retrom-fork.json')));
  const identity = await verifyCandidatePair(first, second, config);
  if (!(await lstat(output)).isDirectory() || (await readdir(output)).length)
    throw new Error('Release output must be an empty directory');
  const archive = 'catsystem2-web.tar.gz';
  const listings = await Promise.all(
    [first, second].map(
      async (directory) =>
        (
          await command(
            'tar',
            ['--numeric-owner', '--full-time', '-tvzf', join(directory, archive)],
            { env: { ...process.env, LC_ALL: 'C', TZ: 'UTC' } },
          )
        ).stdout,
    ),
  );
  assert.equal(listings[0], listings[1], 'Complete tar metadata must match');
  assert.deepEqual(
    await readFile(join(first, 'catsystem2-web-LICENSE.txt')),
    await readFile(join(root, 'LICENSE')),
  );
  for (const file of identity.files)
    await copyFile(
      join(first, file.filename),
      join(output, file.filename),
      constants.COPYFILE_EXCL,
    );
  const metadata = {
    schemaVersion: 1,
    kind: 'RETROM_CORE_RELEASE_V1',
    ...selected,
    repository: identity.repository,
    coreId: identity.coreId,
    commit: identity.commit,
    sourceTreeSha256: identity.sourceTreeSha256,
    adapterAbi: identity.adapterAbi,
    license: 'MPL-2.0',
    sourceUrl: `${identity.repository}/tree/${identity.commit}`,
    files: identity.files,
    reproducibility: {
      completeBuilds: 2,
      wholeArchiveAndLicenseIdentical: true,
      tarListingSha256: sha256(listings[0]),
    },
  };
  await writeFile(
    join(output, 'catsystem2-web-release.json'),
    JSON.stringify(metadata, null, 2) + '\n',
    { flag: 'wx' },
  );
  console.log(JSON.stringify(metadata, null, 2));
}

if (process.argv[1] && pathToFileURL(resolve(process.argv[1])).href === import.meta.url)
  await main(process.argv.slice(2));
