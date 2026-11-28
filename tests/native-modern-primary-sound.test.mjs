// SPDX-License-Identifier: MPL-2.0
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { serializeCheckpoint, deserializeCheckpoint } from '../src/checkpoint.mjs';
import { primarySoundWorld } from './fixtures/modern-primary-sound-world.mjs';
const fixture = JSON.parse(
    await readFile(new URL('./fixtures/native-modern-primary-sound.json', import.meta.url)),
  ),
  sha = (bytes) => createHash('sha256').update(bytes).digest('hex');
const projection = (r, task, frame) => ({
  frame,
  words: r.outputs.map((at) => task.machine.load(at)),
  marker: task.machine.load(508),
});
for (const r of fixture.versions) {
  test(`SDK${r.version} real primary PCM completion/repeat/pause/stop, peer rebind and parsed result consumer`, async () => {
    const { w, context, task, decoded } = await primarySoundWorld(
      r.version,
      Buffer.from(r.program, 'base64'),
    );
    try {
      for (const [i, phase] of r.phases.entries()) {
        context.advance(phase.advance / 1000);
        await w.objects.tick(phase.frame);
        assert.deepEqual(projection(r, task, phase.frame), r.rows[i]);
      }
      assert.equal(task.machine.load(296), 1, 'real first completion survives the pause');
      assert.equal(task.machine.load(300), 1, 'the second finite playback remains active');
      assert.equal(task.machine.load(320), 1, 'pause retains completed-play count');
      assert.equal(task.machine.load(332), 0, 'ordinary Play resets completed-play count');
      assert.equal(task.machine.load(352), 1);
      assert.equal(task.machine.load(372), 0, 'ordinary Stop resets it');
      assert.equal(
        task.machine.load(408),
        44,
        'the queried volume reaches the actual Script expression',
      );
      assert.deepEqual([...new Set(decoded.map(sha))].sort(), r.nativePCM);
      assert(w.sound.device.every((d) => !d.loaded));
    } finally {
      await w.close({ flushFiles: false });
    }
    assert.equal(w.objects.objects.size, 0);
    assert.equal(w.sound.tasks.size, 0);
    assert.equal(w.audio.channels.size, 0);
  });
  test(`SDK${r.version} six independent current cold boundaries retain actual source, repeat count, pause and release`, async () => {
    for (let cut = -1; cut < 5; cut++) {
      let open = await primarySoundWorld(r.version, Buffer.from(r.program, 'base64'));
      try {
        for (let i = 0; i <= cut; i++) {
          open.context.advance(r.phases[i].advance / 1000);
          await open.w.objects.tick(r.phases[i].frame);
        }
        const checkpoint = await deserializeCheckpoint(
          await serializeCheckpoint(open.w.snapshot()),
        );
        await open.w.close({ flushFiles: false });
        open = await primarySoundWorld(r.version, Buffer.from(r.program, 'base64'), checkpoint);
        for (let i = cut + 1; i < r.phases.length; i++) {
          open.context.advance(r.phases[i].advance / 1000);
          await open.w.objects.tick(r.phases[i].frame);
          assert.deepEqual(
            projection(r, open.task, r.phases[i].frame),
            r.rows[i],
            `cold after phase ${cut}`,
          );
        }
      } finally {
        await open.w.close({ flushFiles: false });
      }
    }
  });
}
