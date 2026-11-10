// SPDX-License-Identifier: MPL-2.0
import { createServer } from 'node:http';
import { realpath, stat, readFile } from 'node:fs/promises';
import { createReadStream } from 'node:fs';
import { createHash } from 'node:crypto';
import { resolve, sep, extname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { transitionalRuntimeFiles } from './transitional-runtime.mjs';
import { walk, NodeFile } from './node-files.mjs';
import { sourceIdentity } from '../src/identity.mjs';
import { PPI_BACKEND_FILES } from '../src/ppi/backend-artifact.mjs';
import { NATIVE_ZLIB_FILES } from '../src/native/zlib-artifact.mjs';
import { NATIVE_FREETYPE_FILES } from '../src/native/freetype-artifact.mjs';
const args = process.argv.slice(2),
  option = (key, fallback) => (args.includes(key) ? args[args.indexOf(key) + 1] : fallback);
const root = fileURLToPath(new URL('..', import.meta.url)),
  port = Number(option('--port', '4101'));
const transitionalFiles = new Set(await transitionalRuntimeFiles(root));
const gameRoot = option('--game') ? await realpath(option('--game')) : null;
const gameFiles = gameRoot ? await walk(gameRoot) : [];
const files = new Map(gameFiles.map((f) => [f.path, f]));
const identity = gameRoot
  ? await sourceIdentity(
      new Map(gameFiles.map((f) => [f.path, new NodeFile(resolve(gameRoot, f.path), f.size)])),
    )
  : null;
const mediaRoot = identity ? resolve(root, '.local/media', identity) : null;
let mediaFiles = [];
const media = {};
try {
  if (mediaRoot) {
    const provenance = JSON.parse(await readFile(resolve(mediaRoot, 'provenance.json'), 'utf8'));
    if (provenance.sourceIdentity !== identity)
      throw new Error('Prepared movie source identity differs');
    const candidates = (await walk(mediaRoot)).filter((f) => /\.(mp4|webm)$/i.test(f.path));
    for (const record of provenance.records) {
      const file = candidates.find((f) => f.path === record.output);
      if (!file || !Array.isArray(record.sources) || !/^[0-9a-f]{64}$/.test(record.sourceSha256))
        throw new Error('Prepared movie record is incomplete; run prepare:media');
      const hash = createHash('sha256');
      for await (const bytes of createReadStream(resolve(mediaRoot, file.path))) hash.update(bytes);
      if (hash.digest('hex') !== record.outputSha256)
        throw new Error('Prepared movie output hash differs');
      mediaFiles.push(file);
      for (const source of record.sources)
        media[source] = {
          sourceIdentity: identity,
          sourceSize: record.sourceSize,
          sourceSha256: record.sourceSha256,
          outputSha256: record.outputSha256,
          mime: record.mime,
          url: `/media/${encodeURIComponent(file.path)}`,
        };
    }
  }
} catch (e) {
  if (e.code !== 'ENOENT') throw e;
}
const mime = {
  '.mjs': 'text/javascript',
  '.js': 'text/javascript',
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css',
  '.json': 'application/json',
  '.svg': 'image/svg+xml',
};
const server = createServer(async (request, response) => {
  try {
    if (!['GET', 'HEAD'].includes(request.method)) {
      response.writeHead(405);
      response.end();
      return;
    }
    const url = new URL(request.url, 'http://localhost');
    if (url.pathname === '/game.json') {
      if (!gameRoot) {
        response.writeHead(404);
        response.end();
        return;
      }
      response.writeHead(200, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' });
      response.end(
        JSON.stringify({
          identity,
          media,
          files: gameFiles.map((f) => ({
            ...f,
            url: `/game/${f.path.split('/').map(encodeURIComponent).join('/')}`,
          })),
        }),
      );
      return;
    }
    let path;
    if (url.pathname.startsWith('/vendor/')) {
      const name = url.pathname.slice(8);
      const vendor = PPI_BACKEND_FILES.includes(name)
        ? 'ppi'
        : NATIVE_ZLIB_FILES.includes(name)
          ? 'zlib'
          : NATIVE_FREETYPE_FILES.includes(name)
            ? 'freetype'
            : null;
      if (!vendor) {
        response.writeHead(404);
        response.end();
        return;
      }
      path = await realpath(resolve(root, '.local/vendor', vendor, name));
    } else if (url.pathname.startsWith('/media/')) {
      const name = decodeURIComponent(url.pathname.slice(7));
      if (!mediaFiles.some((f) => f.path === name)) {
        response.writeHead(404);
        response.end();
        return;
      }
      path = await realpath(resolve(mediaRoot, name));
      if (!path.startsWith(mediaRoot + sep)) throw new Error('Media path escaped root');
    } else if (url.pathname.startsWith('/game/')) {
      const name = decodeURIComponent(url.pathname.slice(6));
      if (!files.has(name)) {
        response.writeHead(404);
        response.end();
        return;
      }
      path = await realpath(resolve(gameRoot, name));
      if (!path.startsWith(gameRoot + sep)) throw new Error('Game path escaped root');
    } else {
      const name = url.pathname === '/' ? 'index.html' : decodeURIComponent(url.pathname.slice(1));
      if (
        !(
          name === 'index.html' ||
          name === 'third_party/fonts/noto-sans-jp/NotoSansJP.ttf' ||
          /^(src|web)\//.test(name) ||
          transitionalFiles.has(name)
        )
      ) {
        response.writeHead(404);
        response.end();
        return;
      }
      path = await realpath(resolve(root, name));
      if (!path.startsWith(root)) throw new Error('Static path escaped root');
    }
    const info = await stat(path),
      range = request.headers.range;
    const headers = {
      'Content-Type':
        extname(path) === '.mp4' ? 'video/mp4' : mime[extname(path)] || 'application/octet-stream',
      'Cache-Control': 'no-store',
      'Accept-Ranges': 'bytes',
    };
    if (range) {
      const match = /^bytes=(\d+)-(\d*)$/.exec(range);
      if (match && !match[2]) match[2] = String(info.size - 1);
      if (!match || +match[1] > +match[2] || +match[2] >= info.size) {
        response.writeHead(416, { 'Content-Range': `bytes */${info.size}` });
        response.end();
        return;
      }
      const start = +match[1],
        end = +match[2];
      response.writeHead(206, {
        ...headers,
        'Content-Length': end - start + 1,
        'Content-Range': `bytes ${start}-${end}/${info.size}`,
      });
      if (request.method === 'HEAD') response.end();
      else createReadStream(path, { start, end }).pipe(response);
    } else {
      response.writeHead(200, { ...headers, 'Content-Length': info.size });
      if (request.method === 'HEAD') response.end();
      else createReadStream(path).pipe(response);
    }
  } catch (error) {
    response.writeHead(error.code === 'ENOENT' ? 404 : 500);
    response.end(error.code === 'ENOENT' ? 'Not found' : 'Read failed');
    console.error(error);
  }
});
server.listen(port, '127.0.0.1', () =>
  console.log(
    `CatSystem2 Web: http://localhost:${port}${gameRoot ? ' (read-only game directory mounted)' : ''}`,
  ),
);
for (const signal of ['SIGTERM', 'SIGINT']) process.on(signal, () => server.close());
