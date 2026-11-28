// SPDX-License-Identifier: MPL-2.0
import test from 'node:test';
import assert from 'node:assert/strict';
import { GameFiles, RangeFile } from '../src/files.mjs';

test('movie sidecars resolve exact archive resources with matching source identity and size', async () => {
  const game = new GameFiles(new Map()),
    identity = 'a'.repeat(64),
    first = { file: {}, offset: 10, size: 70 },
    second = { file: {}, offset: 20, size: 90 },
    record = (sourceSize, url) => ({
      sourceIdentity: identity,
      sourceSize,
      sourceSha256: 'b'.repeat(64),
      outputSha256: 'c'.repeat(64),
      mime: 'video/mp4',
      url,
    });
  game.identity = identity;
  game.qualifiedIndex.set('a.int/opening.wmv', first);
  game.qualifiedIndex.set('b.int/opening.wmv', second);
  game.media = {
    'a.int/opening.wmv': record(70, '/first.mp4'),
    'b.int/opening.wmv': record(90, '/second.mp4'),
  };
  const accepts = (type) => (type === 'video/mp4' ? 'probably' : '');
  assert.deepEqual(await game.movieSource('A.INT\\Opening.wmv', accepts), { url: '/first.mp4' });
  assert.deepEqual(await game.movieSource('b.int/opening.wmv', accepts), { url: '/second.mp4' });
  assert.equal(await game.movieSource('opening.wmv', accepts), null);
  assert.equal(await game.movieSource('a.int/opening.wmv', () => ''), null);
  first.size = 71;
  await assert.rejects(game.movieSource('a.int/opening.wmv', accepts), /source differs/);
  first.size = 70;
  game.media['a.int/opening.wmv'].sourceIdentity = 'd'.repeat(64);
  await assert.rejects(game.movieSource('a.int/opening.wmv', accepts), /source differs/);
});

test('movie sources stream complete loose HTTP files and isolate archive slices in revocable URLs', async () => {
  const game = new GameFiles(new Map()),
    payload = Uint8Array.of(1, 2, 3, 4),
    reads = [],
    file = {
      url: 'https://authored.example/movie.mp4',
      size: 4,
      read: async (at, size) => {
        reads.push([at, size]);
        return payload.slice(at, at + size);
      },
    };
  game.index.set('opening.mp4', { file, size: 4, offset: 0 });
  game.index.set('slice.mp4', { file, size: 2, offset: 1 });
  assert.deepEqual(await game.movieSource('opening.mp4', () => 'probably'), { url: file.url });
  assert.equal(reads.length, 0);
  const source = await game.movieSource('slice.mp4', () => 'probably');
  assert.ok(source.url.startsWith('blob:'));
  assert.deepEqual(
    new Uint8Array(await (await fetch(source.url)).arrayBuffer()),
    Uint8Array.of(2, 3),
  );
  source.release();
  await assert.rejects(fetch(source.url));
  assert.deepEqual(reads, [[1, 2]]);
});

test('host movie preparation uses the active source and returns a revocable MP4', async () => {
  let releases = 0;
  const calls = [],
    bytes = Uint8Array.of(1, 2, 3, 4),
    file = new RangeFile(bytes.length, (offset, count) => bytes.slice(offset, offset + count)),
    stream = { bytes: Uint8Array.of(9), mime: 'video/ogg', sha256: 'a'.repeat(64) },
    game = new GameFiles(
      new Map([
        ['main.kcs', file],
        ['opening.wmv', file],
        ['ending.webm', file],
      ]),
      {
        convertedMovie(path, hit, nativeStream) {
          calls.push({ path, hit, nativeStream });
          return path === 'ending.webm'
            ? null
            : {
                blob: new Blob([bytes], { type: 'video/mp4' }),
                release() {
                  releases++;
                },
              };
        },
      },
    );
  await game.open();
  const active = game.withStartup(null),
    permitsMP4 = (mime) => mime === 'video/mp4';
  const opening = await active.movieSource('Opening.WMV', permitsMP4);
  assert.strictEqual(calls[0].hit, active.lookup('opening.wmv'));
  assert.equal(calls[0].path, 'opening.wmv');
  assert.equal(calls[0].nativeStream, null);
  const response = await fetch(opening.url);
  assert.equal(response.headers.get('content-type'), 'video/mp4');
  assert.deepEqual(new Uint8Array(await response.arrayBuffer()), bytes);
  opening.release();
  opening.release();
  await assert.rejects(fetch(opening.url));
  assert.equal(releases, 1);
  assert.equal(await active.movieSource('opening.wmv', () => false), null);
  assert.equal(releases, 2);
  const native = await active.movieSource('movie.int/alias.ogv', permitsMP4, stream);
  assert.equal(calls.at(-1).hit, null);
  assert.strictEqual(calls.at(-1).nativeStream, stream);
  native.release();
  assert.equal(releases, 3);
  assert.equal(await active.movieSource('missing.wmv', permitsMP4), null);
  const fallback = await active.movieSource('ending.webm', (mime) => mime === 'video/webm');
  fallback.release();
  active.convertedMovie = () => ({ url: 'https://example.invalid/movie.mp4' });
  await assert.rejects(active.movieSource('Opening.WMV', permitsMP4), /releasable Blob/);
  active.convertedMovie = () => ({
    blob: new Blob([bytes]),
    release() {
      releases++;
    },
  });
  await assert.rejects(active.movieSource('Opening.WMV', permitsMP4), /verified MP4/);
  assert.equal(releases, 4);
});
