// SPDX-License-Identifier: MPL-2.0
import test from 'node:test';
import assert from 'node:assert/strict';
import { NativePCMWindows } from '../src/native/audio-pcm.mjs';

test('native PCM windows retain difference levels until enabled stream writes and checkpoint independently', () => {
  const ring = new NativePCMWindows({ channels: 1, bitsPerSample: 16, sampleRate: 8000 }),
    pcm = new Uint8Array(8000),
    view = new DataView(pcm.buffer);
  for (let at = 0; at < pcm.length; at += 2) view.setInt16(at, at % 4 ? 100 : -100, true);
  ring.fill(0, pcm, { initial: true });
  assert.equal(ring.level(0, true), 199);
  assert.equal(ring.level(0, false), 0);
  ring.fill(0, new Uint8Array(800));
  assert.equal(ring.level(0, true), 199);
  const saved = structuredClone(ring.snapshot());
  ring.fill(0, new Uint8Array(800), { enabled: true });
  assert.equal(ring.level(0, true), 0);
  ring.restore(saved);
  assert.equal(ring.level(0, true), 199);
});

test('native multi-level queries zero-fill the requested capacity and preserve the write-index early break', () => {
  const ring = new NativePCMWindows({ channels: 1, bitsPerSample: 16, sampleRate: 8000 });
  ring.values.set(Array.from({ length: 80 }, (_, i) => i + 1));
  assert.deepEqual(ring.levels(5, 800, 2400), [2, 3, 4, 0, 0]);
  assert.deepEqual(ring.levels(5, 800 * 79, 800), [80, 0, 0, 0, 0]);
  assert.deepEqual(ring.levels(5, 800 * 80, 0), [0, 0, 0, 0, 0]);
  assert.equal(ring.levels(120, 0, 64000).length, 80);
});
