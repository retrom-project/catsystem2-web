// SPDX-License-Identifier: MPL-2.0
import { createHash } from 'node:crypto';
import { execFile } from 'node:child_process';
import { constants } from 'node:fs';
import {
  copyFile,
  lstat,
  mkdtemp,
  readFile,
  readdir,
  readlink,
  rm,
  writeFile,
} from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { isAbsolute, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';

const root = fileURLToPath(new URL('..', import.meta.url));
const command = promisify(execFile);
const sha256 = (bytes) => createHash('sha256').update(bytes).digest('hex');
const names = ['catsystem2-web-LICENSE.txt', 'catsystem2-web.tar.gz'];

async function git(...args) {
  return (await command('git', args, { cwd: root })).stdout;
}

async function sourceIdentity() {
  const [branch, commit, status, files, stages] = await Promise.all([
    git('symbolic-ref', '--quiet', '--short', 'HEAD'),
    git('rev-parse', 'HEAD'),
    git('status', '--porcelain'),
    git('ls-files', '--cached', '--others', '--exclude-standard', '-z'),
    git('ls-files', '--stage', '-z'),
  ]);
  const modes = new Map(
    stages
      .split('\0')
      .filter(Boolean)
      .map((line) => {
        const tab = line.indexOf('\t');
        return [line.slice(tab + 1), line.split(' ', 1)[0]];
      }),
  );
  const paths = files
    .split('\0')
    .filter(Boolean)
    .sort((a, b) => Buffer.from(a).compare(Buffer.from(b)));
  const records = [];
  for (const path of paths) {
    const name = join(root, path);
    const info = await lstat(name).catch((error) => {
      if (error.code !== 'ENOENT') throw error;
    });
    if (!info) continue;
    const mode = info.isSymbolicLink()
      ? '120000'
      : (modes.get(path) ?? (info.mode & 0o100 ? '100755' : '100644'));
    const bytes = mode === '120000' ? Buffer.from(await readlink(name)) : await readFile(name);
    records.push({ mode, path, sha256: sha256(bytes) });
  }
  return {
    branch: branch.trim(),
    commit: commit.trim(),
    dirty: Boolean(status.trim()),
    sourceTreeSha256: sha256(JSON.stringify(records)),
  };
}

async function archiveDistribution(dist, working) {
  const manifest = JSON.parse(await readFile(join(dist, 'build.json'), 'utf8'));
  const paths = ['build.json', ...manifest.files.map(({ path }) => path)].sort();
  const list = join(working, 'files');
  const archive = join(working, 'catsystem2-web.tar');
  await writeFile(list, paths.join('\0') + '\0');
  await command('tar', [
    '--format=ustar',
    '--mtime=@0',
    '--owner=0',
    '--group=0',
    '--numeric-owner',
    '--mode=0644',
    '--no-recursion',
    '-C',
    dist,
    '-cf',
    archive,
    '--null',
    '-T',
    list,
  ]);
  await command('gzip', ['-n', '-9', archive]);
  return manifest.format;
}

const [destination] = process.argv.slice(2);
if (process.argv.length !== 3 || !destination || !isAbsolute(destination))
  throw new Error('Expected one absolute empty candidate output directory');
if (!(await lstat(destination)).isDirectory() || (await readdir(destination)).length)
  throw new Error('Candidate output directory must be empty');

const temporary = await mkdtemp(join(tmpdir(), 'catsystem2-web-candidate-'));
try {
  const source = await sourceIdentity();
  const dist = join(temporary, 'dist');
  const build = await command(process.execPath, [
    join(root, 'scripts/build.mjs'),
    '--output',
    dist,
  ]);
  process.stdout.write(build.stdout);
  const adapterAbi = await archiveDistribution(dist, temporary);
  await copyFile(join(dist, 'LICENSE'), join(temporary, names[0]));
  const files = [];
  for (const filename of names) {
    const bytes = await readFile(join(temporary, filename));
    files.push({ filename, sizeBytes: bytes.length, sha256: sha256(bytes) });
  }
  if (JSON.stringify(await sourceIdentity()) !== JSON.stringify(source))
    throw new Error('Source changed during the candidate build');
  for (const { filename } of files)
    await copyFile(join(temporary, filename), join(destination, filename), constants.COPYFILE_EXCL);
  const descriptor = {
    schemaVersion: 1,
    kind: 'RETROM_CORE_CANDIDATE_V1',
    coreId: 'catsystem2_web',
    repository: 'https://github.com/retrom-project/catsystem2-web',
    ...source,
    adapterAbi,
    files,
  };
  await writeFile(
    join(destination, 'retrom-core-candidate.json'),
    JSON.stringify(descriptor, null, 2) + '\n',
    { flag: 'wx' },
  );
  console.log(`Built ${names[1]} in ${destination}`);
} finally {
  await rm(temporary, { recursive: true, force: true });
}
