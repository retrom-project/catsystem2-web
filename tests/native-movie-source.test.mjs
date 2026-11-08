// SPDX-License-Identifier: MPL-2.0
import test from 'node:test';
import assert from 'node:assert/strict';
import { GameFiles } from '../src/files.mjs';

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
