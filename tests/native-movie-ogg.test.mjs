// SPDX-License-Identifier: MPL-2.0
import assert from 'node:assert/strict';
import test from 'node:test';
import { readFile } from 'node:fs/promises';
import { GameFiles } from '../src/files.mjs';
import { OGG_INPUT_TYPE, nativeOggTracks, oggPacketType } from '../src/native/movie-ogg.mjs';

const fixture = () => readFile(new URL('./fixtures/native-plane-movie.ogv', import.meta.url));

test('Ogg BOS headers preserve Theora and Vorbis packet bytes and reference media types', async () => {
  const bytes = await fixture(),
    { tracks } = nativeOggTracks(bytes);
  assert.deepEqual(
    tracks.map(({ type, codec, index }) => ({ type, codec, index })),
    [
      { type: 1, codec: 'theora', index: 2580911609 },
      { type: 2, codec: 'vorbis', index: 2092013126 },
    ],
  );
  assert.equal(OGG_INPUT_TYPE.words.length, 18);
  assert.deepEqual(
    OGG_INPUT_TYPE.words.slice(4, 8),
    [0xdd142c1e, 0x43810c1e, 0x2d0b4ea2, 0x8a09b680],
  );
  for (const [track, start, end] of [
    [tracks[0], 28, 70],
    [tracks[1], 98, 128],
  ]) {
    const media = oggPacketType(track);
    assert.equal(media.words.length, 18);
    assert.deepEqual(
      media.words.slice(0, 8),
      [
        0x60891713, 0x4767c24f, 0xa06cc9b6, 0xfc38335b, 0xe436eb8e, 0x11ce524f, 0x2000539f,
        0x70a70baf,
      ],
    );
    assert.deepEqual(media.words.slice(11, 17), [
      0x95388704,
      0x42a9162c,
      0x57c34981,
      0xf9aa127c,
      0,
      end - start,
    ]);
    assert.deepEqual(media.format, Uint8Array.from(bytes.subarray(start, end)));
  }
});

test('Ogg pin discovery checks the source capture pattern, lacing bounds and page checksum', async () => {
  const source = await fixture(),
    bytes = Uint8Array.from(source);
  assert.deepEqual(nativeOggTracks(Uint8Array.of(79, 103, 103)), {
    error: 'Missing Ogg capture pattern',
    status: 0x80040265,
  });
  assert.match(nativeOggTracks(bytes.subarray(0, 69)).error, /Truncated Ogg page/);
  bytes[31] ^= 1;
  assert.match(nativeOggTracks(bytes).error, /Invalid Ogg page checksum/);
});

test('an Ogg Opus BOS still exposes the unsupported packet rather than dropping its pin', async () => {
  const bytes = await fixture(),
    // The authored clip with its audio encoded as Opus produced this BOS page.
    opus = Buffer.from(
      'T2dnUwACAAAAAAAAAAAXUQo8AAAAAKYRAIsBE09wdXNIZWFkAQE4AYC7AAAAAAA=',
      'base64',
    ),
    { tracks } = nativeOggTracks(Buffer.concat([bytes.subarray(0, 70), opus])),
    track = tracks[1];
  assert.equal(track.codec, 'unknown');
  assert.equal(track.type, 0);
  assert.equal(track.index, 1007309079);
  assert.equal(oggPacketType(track).words[16], 19);
  assert.equal(new TextDecoder().decode(track.identifier.subarray(0, 8)), 'OpusHead');
});

test('the original Ogg track MIME controls direct decode while a matching conversion remains usable', async () => {
  const game = new GameFiles(new Map()),
    bytes = await fixture(),
    identity = 'a'.repeat(64),
    sha256 = 'b'.repeat(64),
    mime = 'video/ogg; codecs="theora, vorbis"',
    checks = [],
    chromium = (type) => {
      checks.push(type);
      return type === 'video/mp4' ? 'probably' : '';
    },
    stream = { bytes, sha256, mime };
  game.identity = identity;
  assert.equal(await game.movieSource('movie.int/example.ogv', chromium, stream), null);
  game.media = {
    'movie/example.ogv': {
      sourceIdentity: identity,
      sourceSize: bytes.length,
      sourceSha256: sha256,
      mime: 'video/mp4',
      url: '/prepared/example.mp4',
    },
  };
  assert.deepEqual(await game.movieSource('movie.int/example.ogv', chromium, stream), {
    url: '/prepared/example.mp4',
  });
  assert.deepEqual(checks, [mime, 'video/mp4']);
});
