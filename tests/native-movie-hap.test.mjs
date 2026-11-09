// SPDX-License-Identifier: MPL-2.0
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import { decodeHap5, nativeHapMovie } from '../src/native/movie-hap.mjs';

const fixture = (suffix = '') =>
  readFile(new URL(`./fixtures/native-plane-movie${suffix}.hap`, import.meta.url));
const digest = (pixels) => createHash('sha256').update(pixels).digest('hex');

test('legacy Hap5 AVI raw and Snappy packets reproduce the native RGB and alpha', async () => {
  const [raw, snappy] = await Promise.all([fixture('-hap-raw'), fixture()]);
  const rgba = [raw, snappy].map((bytes, codec) => {
    const { width, height, scale, rate, startTime, duration, audio, packets } =
      nativeHapMovie(bytes);
    assert.deepEqual(
      [width, height, scale, rate, startTime, duration, audio, packets.length],
      [32, 24, 1, 4, 0n, 30000000n, false, 12],
    );
    assert.equal(packets[0][3], codec ? 0xbe : 0xae);
    return packets.map((packet) => decodeHap5(packet, width, height).rgba);
  });
  assert.deepEqual(rgba[0], rgba[1]);
  assert.equal(
    digest(rgba[0][0]),
    'cf6bd6ae731aa79b763a4c9f4da010923eca97a0a89f9a7bd51aa646155bbffb',
  );
  const pixel = (frame, x, y) => [...rgba[0][frame].slice((y * 32 + x) * 4, (y * 32 + x) * 4 + 4)];
  assert.deepEqual(
    [pixel(0, 0, 0), pixel(0, 8, 0), pixel(0, 16, 23), pixel(0, 24, 23)],
    [
      [247, 32, 16, 0],
      [247, 32, 16, 84],
      [16, 24, 247, 169],
      [16, 24, 247, 255],
    ],
  );
  assert.deepEqual(pixel(11, 8, 0), [16, 248, 32, 84]);
});

test('Hap5 BC3 palette interpolation agrees with the native VfW decoder across all color and alpha selectors', () => {
  const packet = new Uint8Array(772);
  packet.set([0, 3, 0, 0xae]);
  let state = 0x4be9136a;
  for (let at = 4; at < packet.length; at++) {
    state = (Math.imul(state, 1664525) + 1013904223) >>> 0;
    packet[at] = state >>> 24;
  }
  assert.equal(
    digest(decodeHap5(packet, 32, 24).rgba),
    '168ab9ad6265c0510791953d5eaf40102e7354a404ebfe20a65d617bc4f50da2',
  );
});

test('legacy Hap5 rejects extended headers, unknown compressors and malformed Snappy', () => {
  const decode = (...bytes) => decodeHap5(Uint8Array.from(bytes), 4, 4);
  assert.throws(() => decode(0, 0, 0, 0xae, 16, 0, 0, 0), /legacy Hap5 section length/);
  assert.throws(() => decode(1, 0, 0, 0xce, 0), /legacy Hap5 compressor/);
  assert.throws(() => decode(1, 0, 0, 0xbe, 16), /Incomplete Hap5 Snappy texture/);
  assert.throws(() => decode(3, 0, 0, 0xbe, 16, 1, 1), /Invalid Hap5 Snappy copy/);
  assert.throws(() => decode(2, 0, 0, 0xbe, 16, 0x3c), /Invalid Hap5 Snappy literal/);
});

test('Hap5 AVI indexes continuation segments and checks chunk boundaries', async () => {
  const source = await fixture(),
    { packets } = nativeHapMovie(source),
    chunk = (tag, data) => {
      const header = Buffer.alloc(8);
      header.write(tag);
      header.writeUInt32LE(data.length, 4);
      return Buffer.concat([header, data, Buffer.alloc(data.length % 2)]);
    },
    movie = chunk('LIST', Buffer.concat([Buffer.from('movi'), chunk('00dc', packets[0])])),
    continuation = chunk('RIFF', Buffer.concat([Buffer.from('AVIX'), movie])),
    longer = nativeHapMovie(Buffer.concat([source, continuation]));
  assert.equal(longer.duration, 32500000n);
  assert.equal(longer.packets.length, 13);
  assert.deepEqual(longer.packets.at(-1), packets[0]);
  assert.throws(() => nativeHapMovie(source.subarray(0, -1)), /Invalid Hap AVI chunk length/);
});
