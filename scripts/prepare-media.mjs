// SPDX-License-Identifier: MPL-2.0
import { createReadStream } from 'node:fs';
import { mkdir, rename, stat, writeFile } from 'node:fs/promises';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { resolve } from 'node:path';
import { nodeGame } from './node-files.mjs';
const root = fileURLToPath(new URL('..', import.meta.url)),
  game = await nodeGame(process.argv[2]),
  identity = await game.fingerprint();
const destination = resolve(root, '.local/media', identity);
await mkdir(destination, { recursive: true });
const records = [];
for (const name of game.names('wmv')) {
  const hit = game.index.get(name),
    output = resolve(destination, name.replace(/\.wmv$/i, '.mp4'));
  try {
    if ((await stat(output)).size > 0) {
      records.push({ source: name, output: output.split('/').pop(), reused: true });
      continue;
    }
  } catch (e) {
    if (e.code !== 'ENOENT') throw e;
  }
  const temporary = `${output}.partial.mp4`;
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
  const input = createReadStream(hit.file.path, {
    start: hit.offset,
    end: hit.offset + hit.size - 1,
  });
  input.pipe(child.stdin);
  child.stdin.on('error', (e) => {
    if (e.code !== 'EPIPE') console.error(e);
  });
  await new Promise((resolve, reject) => {
    child.once('error', reject);
    child.once('close', (code) =>
      code === 0 ? resolve() : reject(new Error(`FFmpeg failed for ${name}: ${code}`)),
    );
  });
  await rename(temporary, output);
  records.push({ source: name, output: output.split('/').pop(), reused: false });
  console.log(`Prepared ${name}`);
}
await writeFile(
  resolve(destination, 'provenance.json'),
  JSON.stringify(
    { sourceIdentity: identity, command: 'ffmpeg libx264 crf18 yuv420p + AAC 192k', records },
    null,
    2,
  ),
);
console.log(JSON.stringify({ destination, videos: records.length }));
