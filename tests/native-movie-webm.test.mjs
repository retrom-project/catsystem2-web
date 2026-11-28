// SPDX-License-Identifier: MPL-2.0
import assert from 'node:assert/strict';
import test from 'node:test';
import { readFile } from 'node:fs/promises';
import { nativeWebMTracks } from '../src/native/movie-webm.mjs';

test('the WebM splitter identifies the authored VP8 and Vorbis tracks by their encoded headers', async () => {
  const movie = await readFile(new URL('./fixtures/native-plane-movie-vp8.webm', import.meta.url));
  assert.deepEqual(nativeWebMTracks(movie), {
    tracks: [
      { type: 1, codec: 'V_VP8', index: 1 },
      { type: 2, codec: 'A_VORBIS', index: 2 },
    ],
  });
  assert.match(nativeWebMTracks(movie.subarray(0, 32)).error, /Invalid EBML/);
  const opus = await readFile(new URL('./fixtures/native-plane-movie.webm', import.meta.url));
  assert.deepEqual(nativeWebMTracks(opus), {
    tracks: [{ type: 1, codec: 'V_VP9', index: 1 }],
  });
});

test('the splitter accepts a video-only track in an unknown-size segment and bounds each element', () => {
  const fixture = Uint8Array.of(
    // Header, doc type "webm".
    0x1a,
    0x45,
    0xdf,
    0xa3,
    0x87,
    0x42,
    0x82,
    0x84,
    0x77,
    0x65,
    0x62,
    0x6d,
    // Unknown-size segment, Info and Tracks.
    0x18,
    0x53,
    0x80,
    0x67,
    0xff,
    0x15,
    0x49,
    0xa9,
    0x66,
    0x80,
    0x16,
    0x54,
    0xae,
    0x6b,
    0x8f,
    // Track 5, type video, codec V_VP9.
    0xae,
    0x8d,
    0xd7,
    0x81,
    5,
    0x83,
    0x81,
    1,
    0x86,
    0x85,
    0x56,
    0x5f,
    0x56,
    0x50,
    0x39,
  );
  assert.deepEqual(nativeWebMTracks(fixture), {
    tracks: [{ type: 1, codec: 'V_VP9', index: 5 }],
  });
  const truncated = fixture.slice(0, -1);
  assert.match(nativeWebMTracks(truncated).error, /Invalid EBML element size/);
  const unknownTrackSize = fixture.slice();
  unknownTrackSize[28] = 0xff;
  assert.match(nativeWebMTracks(unknownTrackSize).error, /Invalid EBML element size/);
});
