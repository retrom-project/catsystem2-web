// SPDX-License-Identifier: MPL-2.0
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { serializeCheckpoint, deserializeCheckpoint } from '../src/checkpoint.mjs';
import { configuredPrimarySoundWorld, primaryWAV } from './fixtures/modern-primary-sound-world.mjs';
const fixture = JSON.parse(
    await readFile(new URL('./fixtures/native-primary-loop-metadata.json', import.meta.url)),
  ),
  sha = (bytes) => createHash('sha256').update(bytes).digest('hex');
function shortWAV(seed = 23) {
  const bytes = primaryWAV(seed).subarray(0, 8044).slice();
  bytes.writeUInt32LE(bytes.length - 8, 4);
  bytes.writeUInt32LE(8000, 40);
  return bytes;
}
function input(r) {
  return {
    ...Object.fromEntries(
      Object.entries(r.files).map(([name, bytes]) => [name, Buffer.from(bytes, 'base64')]),
    ),
    'sound-loose/fx_short.wav': shortWAV(),
    'sound-loose/fx_other.wav': shortWAV(93),
  };
}
function projection(o, r, frame) {
  const task = o.w.sound.primary();
  return {
    frame,
    words: r.outputs.map((at) => o.task.machine.load(at)),
    marker: o.task.machine.load(508),
    banks: [0, 1, 2].flatMap((bank) => {
      const device = o.w.sound.device[bank];
      if (!device.loaded) return [];
      const buffer =
          o.w.audio.nativeDecoderBuffers.get(o.w.sound.key(bank))?.buffer ??
          o.w.audio.buffers.get(device.file.toLowerCase()),
        pcm = Uint8Array.from(buffer.getChannelData(0), (x) => Math.round(x * 128 + 128));
      assert.equal(device.sourceMode, 'static', 'short type1 uses the actual static conversion');
      return [
        {
          bank,
          capacity: buffer.length,
          loopStart: String(task.controls[bank].loopStart),
          loopEnd: String(task.controls[bank].loopEnd),
          sha256: sha(pcm),
        },
      ];
    }),
  };
}
async function phase(o, r, index) {
  const p = r.phases[index];
  o.context.advance(p.advance / 1000);
  await o.w.objects.tick(p.frame);
  assert.deepEqual(projection(o, r, p.frame), r.rows[index]);
}
for (const r of fixture.versions) {
  test(`SDK${r.version} nonzero decoder prefix and real loop-table binding reach parsed two-owner consumers`, async () => {
    const files = input(r),
      o = await configuredPrimarySoundWorld(r.version, files);
    try {
      o.source.fill(0);
      files['sound-loose/fx_short.wav'].fill(0);
      for (let i = 0; i < r.phases.length; i++) await phase(o, r, i);
      assert.equal(o.task.machine.load(288), 8000, 'decoder metadata excludes added silence');
      assert.equal(o.task.machine.load(300), 73, 'owned legacy master gain reaches a real bank');
      assert(o.w.sound.device.every((d) => !d.loaded));
      assert.equal(o.w.audio.nativeDecoderBuffers.size, 0);
    } finally {
      await o.w.close({ flushFiles: false });
    }
    assert.equal(o.w.audio.channels.size, 0);
    assert.equal(o.w.sound.tasks.size, 0);
  });
  test(`SDK${r.version} four independent current cold boundaries retain prefix, source replacement and release`, async () => {
    for (const cut of [-1, 0, 1, 3]) {
      let o = await configuredPrimarySoundWorld(r.version, input(r));
      try {
        for (let i = 0; i <= cut; i++) await phase(o, r, i);
        const state = await deserializeCheckpoint(await serializeCheckpoint(o.w.snapshot()));
        await o.w.close({ flushFiles: false });
        o = await configuredPrimarySoundWorld(r.version, input(r), state);
        for (let i = cut + 1; i < r.phases.length; i++) await phase(o, r, i);
      } finally {
        await o.w.close({ flushFiles: false });
      }
    }
  });
  test(`SDK${r.version} initialized Settings filename metadata feeds loaded gain and parsed arithmetic`, async () => {
    const metadata = fixture.metadata,
      o = await configuredPrimarySoundWorld(
        r.version,
        input({ ...metadata, files: metadata.filesByVersion[r.version] }),
      );
    try {
      o.source.fill(0);
      await o.w.objects.tick(100);
      assert.deepEqual(
        metadata.outputs.map((at) => o.task.machine.load(at)),
        metadata.row.words,
      );
      assert.equal(o.task.machine.load(276), 184);
      assert(o.w.sound.device.every((d) => !d.loaded));
    } finally {
      await o.w.close({ flushFiles: false });
    }
  });
}
