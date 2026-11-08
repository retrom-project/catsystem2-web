// SPDX-License-Identifier: MPL-2.0
import { createReadStream } from 'node:fs';
import { mkdir, rename, readFile, writeFile } from 'node:fs/promises';
import { spawn } from 'node:child_process';
import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { resolve } from 'node:path';
import { nodeGame } from './node-files.mjs';
const root = fileURLToPath(new URL('..', import.meta.url)),
  game = await nodeGame(process.argv[2]),
  sourceIdentity = await game.fingerprint(),
  destination = resolve(root, '.local/media', sourceIdentity),
  groups = new Map(),
  records = [];
await mkdir(destination, { recursive: true });
let previous;
try {
  previous = JSON.parse(await readFile(resolve(destination, 'provenance.json'), 'utf8'));
} catch (error) {
  if (error.code !== 'ENOENT') throw error;
}
const digest = async (stream) => {
    const hash = createHash('sha256');
    for await (const bytes of stream) hash.update(bytes);
    return hash.digest('hex');
  },
  stream = (hit) =>
    createReadStream(hit.file.path, { start: hit.offset, end: hit.offset + hit.size - 1 });
// Qualified resources keep archives with duplicate basenames independent.
for (const [name, hit] of [...game.qualifiedIndex, ...game.index]) {
  if (!/\.(wmv|avi|mpg|mpeg)$/i.test(name)) continue;
  const key = JSON.stringify([hit.file.path, hit.offset, hit.size]);
  if (!groups.has(key)) groups.set(key, { hit, sources: [] });
  groups.get(key).sources.push(name);
}
const used = new Set();
for (const { hit, sources } of groups.values()) {
  sources.sort();
  const sourceSha256 = await digest(stream(hit)),
    sourceSize = hit.size,
    stem = sources[0]
      .split('/')
      .at(-1)
      .replace(/\.[^.]+$/, ''),
    output = `${stem}${used.has(stem) ? '-' + sourceSha256.slice(0, 12) : ''}.mp4`,
    outputPath = resolve(destination, output),
    temporary = `${outputPath}.partial.mp4`;
  used.add(stem);
  const known =
    previous?.sourceIdentity === sourceIdentity &&
    previous.records.find(
      (record) => record.sourceSha256 === sourceSha256 && record.output === output,
    );
  let reused = false;
  if (known)
    try {
      reused = (await digest(createReadStream(outputPath))) === known.outputSha256;
    } catch (error) {
      if (error.code !== 'ENOENT') throw error;
    }
  if (!reused) {
    const child = spawn(
      'ffmpeg',
      [
        '-nostdin',
        '-hide_banner',
        '-loglevel',
        'error',
        '-i',
        'pipe:0',
        '-map',
        '0:v:0',
        '-map',
        '0:a?',
        '-c:v',
        'libx264',
        '-preset',
        'fast',
        '-crf',
        '18',
        '-pix_fmt',
        'yuv420p',
        '-c:a',
        'aac',
        '-b:a',
        '192k',
        '-movflags',
        '+faststart',
        '-y',
        temporary,
      ],
      { stdio: ['pipe', 'inherit', 'inherit'] },
    );
    stream(hit).pipe(child.stdin);
    child.stdin.on('error', (error) => {
      if (error.code !== 'EPIPE') console.error(error);
    });
    await new Promise((resolve, reject) => {
      child.once('error', reject);
      child.once('close', (code) =>
        code === 0 ? resolve() : reject(new Error(`FFmpeg failed for ${sources[0]}: ${code}`)),
      );
    });
    await rename(temporary, outputPath);
  }
  records.push({
    sources: [...new Set(sources)],
    sourceSize,
    sourceSha256,
    output,
    outputSha256: await digest(createReadStream(outputPath)),
    mime: 'video/mp4',
  });
  console.log(`Prepared ${sources[0]}${reused ? ' (verified cache)' : ''}`);
}
await writeFile(
  resolve(destination, 'provenance.json'),
  JSON.stringify(
    { sourceIdentity, command: 'ffmpeg libx264 crf18 yuv420p + AAC 192k', records },
    null,
    2,
  ) + '\n',
);
console.log(JSON.stringify({ destination, videos: records.length }));
