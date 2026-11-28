// SPDX-License-Identifier: MPL-2.0
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { serializeCheckpoint, deserializeCheckpoint } from '../src/checkpoint.mjs';
import { primaryWAV } from './fixtures/modern-primary-sound-world.mjs';
import { legacyPrimaryLoopWorld } from './fixtures/legacy-primary-loop-world.mjs';
const fixture = JSON.parse(
  await readFile(new URL('./fixtures/native-sdk63-primary-loop-metadata.json', import.meta.url)),
);
function shortWAV(seed) {
  const bytes = primaryWAV(seed).subarray(0, 8044).slice();
  bytes.writeUInt32LE(bytes.length - 8, 4);
  bytes.writeUInt32LE(8000, 40);
  return bytes;
}
function input() {
  return {
    ...Object.fromEntries(
      Object.entries(fixture.files).map(([name, data]) => [name, Buffer.from(data, 'base64')]),
    ),
    'sound-loose/fx_short.wav': shortWAV(23),
    'sound-loose/fx_other.wav': shortWAV(93),
  };
}
function pcm(o, bank) {
  const buffer = o.w.audio.nativeDecoderBuffers.get(o.w.sound.key(bank)).buffer,
    bytes = Uint8Array.from(buffer.getChannelData(0), (x) => Math.round(x * 128 + 128));
  return { capacity: buffer.length, sha256: createHash('sha256').update(bytes).digest('hex') };
}
async function phase(o, index) {
  const p = fixture.phases[index];
  o.context.advance(p.advance / 1000);
  await o.w.objects.tick(p.frame);
  assert.deepEqual(
    {
      frame: p.frame,
      words: fixture.outputs.map((at) => o.task.machine.load(at)),
      marker: o.task.machine.load(508),
    },
    fixture.rows[index],
  );
  if (index === 0) {
    assert.equal(o.w.sound.device[0].sourceMode, 'static');
    assert.equal(o.w.sound.primary().controls[0].loopStart, 16n);
    assert.equal(o.w.sound.primary().controls[0].loopEnd, 4000n);
    assert.equal(o.w.sound.primary().loopPoints.size, 2);
    assert.deepEqual(pcm(o, 0), fixture.pcm.fixed);
    assert.deepEqual(pcm(o, 2), fixture.pcm.group);
  }
  if (index === 1) {
    assert.equal(o.task.machine.load(284), 40, 'query observes the completed fade before Play');
    assert.equal(o.w.sound.device[0].volume, 73, 'Play reapplies the retained base gain');
    assert.equal(o.w.sound.device[0].pan, 11);
  }
  if (index === 2) assert.deepEqual(pcm(o, 0), fixture.pcm.replacement);
}
test('SDK63 finite scalar end branches, authored loop binding and initialized filename fields reach parsed primary consumers', async () => {
  const files = input(),
    o = await legacyPrimaryLoopWorld(files);
  try {
    files['sound-loose/fx_short.wav'].fill(0);
    files['startup.xml'].fill(0);
    for (let i = 0; i < fixture.phases.length; i++) await phase(o, i);
    assert.equal(o.task.machine.load(344), 103, 'retained Settings outlive both source releases');
    assert(o.w.sound.device.every((device) => !device.loaded));
    assert.equal(o.w.audio.nativeDecoderBuffers.size, 0);
  } finally {
    await o.w.close({ flushFiles: false });
  }
  assert.equal(o.w.sound.tasks.size, 0);
  assert.equal(o.w.audio.channels.size, 0);
});
test('SDK63 four independent current cold owners retain the finite scalar/prefix/parsed-caller context', async () => {
  for (const cut of [-1, 0, 1, 2]) {
    let o = await legacyPrimaryLoopWorld(input());
    try {
      for (let i = 0; i <= cut; i++) await phase(o, i);
      const state = await deserializeCheckpoint(await serializeCheckpoint(o.w.snapshot()));
      await o.w.close({ flushFiles: false });
      o = await legacyPrimaryLoopWorld(input(), state);
      for (let i = cut + 1; i < fixture.phases.length; i++) await phase(o, i);
    } finally {
      await o.w.close({ flushFiles: false });
    }
  }
});
