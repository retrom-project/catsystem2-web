// SPDX-License-Identifier: MPL-2.0
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { serializeCheckpoint, deserializeCheckpoint } from '../src/checkpoint.mjs';
import { configuredPrimarySoundWorld, primaryWAV } from './fixtures/modern-primary-sound-world.mjs';
const fixture = JSON.parse(
  await readFile(new URL('./fixtures/native-modern-primary-sound-config.json', import.meta.url)),
);
function input(r) {
  return {
    ...Object.fromEntries(
      Object.entries(r.files).map(([name, bytes]) => [name, Buffer.from(bytes, 'base64')]),
    ),
    'sound-loose/fx_owned.wav': primaryWAV(),
    'sound-loose/fx_other.wav': primaryWAV(93),
  };
}
const projection = (r, task, frame) => ({
  frame,
  words: r.outputs.map((at) => task.machine.load(at)),
});
for (const r of fixture.versions) {
  test(`SDK${r.version} nonempty resource configuration and TAG feed actual parsed primary/group consumers`, async () => {
    const { w, context, task, source } = await configuredPrimarySoundWorld(r.version, input(r));
    try {
      source.fill(0); // The parsed owner must own its strings and records.
      for (const [i, phase] of r.phases.entries()) {
        context.advance(phase.advance / 1000);
        await w.objects.tick(phase.frame);
        assert.deepEqual(projection(r, task, phase.frame), r.rows[i]);
      }
      assert.equal(task.machine.load(644), 82);
      assert.equal(task.machine.load(648), 39, 'native effective gain enters another bank setter');
      assert.equal(task.machine.load(652), 37, 'first authored CP932 TAG entry wins');
      assert.equal(task.machine.load(656), 37, 'the TAG result changes the peer bank');
      assert.equal(
        task.machine.load(660),
        2,
        'the resource-authored actual group allocates a source',
      );
      assert.equal(task.machine.load(676), 37, 'peer replacement owns its own TAG records');
      assert.equal(task.machine.load(684), 82, 'source release does not retire configuration');
      assert.equal(task.machine.load(696), 0, 'next normal frame completes group source release');
      assert.equal(task.machine.load(768), task.machine.load(772));
      assert(task.machine.load(772) > 0, 'all finite query fields enter real Script arithmetic');
      assert(w.sound.device.every((d) => !d.loaded));
    } finally {
      await w.close({ flushFiles: false });
    }
    assert.equal(w.runtime.handles.records.size, 0);
  });
  test(`SDK${r.version} loaded and pending-release cold owners keep their configuration after a source replacement`, async () => {
    for (const cut of [0, 2]) {
      let o = await configuredPrimarySoundWorld(r.version, input(r));
      try {
        for (let i = 0; i <= cut; i++) {
          o.context.advance(r.phases[i].advance / 1000);
          await o.w.objects.tick(r.phases[i].frame);
        }
        const state = await deserializeCheckpoint(await serializeCheckpoint(o.w.snapshot()));
        await o.w.close({ flushFiles: false });
        const changed = input(r);
        for (const name of ['primary.xml', 'config-loose/primary.xml']) {
          const bytes = changed[name],
            needle = Buffer.from('<volume>82</volume>'),
            at = bytes.indexOf(needle);
          assert(at >= 0);
          changed[name] = Buffer.concat([
            bytes.subarray(0, at),
            Buffer.from('<volume>4</volume>'),
            bytes.subarray(at + needle.length),
          ]);
        }
        o = await configuredPrimarySoundWorld(r.version, changed, state);
        for (let i = cut + 1; i < r.phases.length; i++) {
          o.context.advance(r.phases[i].advance / 1000);
          await o.w.objects.tick(r.phases[i].frame);
          assert.deepEqual(projection(r, o.task, r.phases[i].frame), r.rows[i]);
        }
      } finally {
        await o.w.close({ flushFiles: false });
      }
    }
  });
}
const modern = fixture.versions.find((r) => r.version === '76'),
  allFields = fixture.versions.find((r) => r.version === '74');
test('SDK76 consumes the full same-body finite field group through its own parsed Script and owner', async () => {
  const inputs = input(modern);
  for (const name of ['source.kcs', 'scripts-loose/source.kcs'])
    inputs[name] = Buffer.from(allFields.files[name], 'base64');
  const { w, context, task } = await configuredPrimarySoundWorld('76', inputs);
  try {
    for (const [i, phase] of allFields.phases.entries()) {
      context.advance(phase.advance / 1000);
      await w.objects.tick(phase.frame);
      assert.deepEqual(projection(allFields, task, phase.frame), allFields.rows[i]);
    }
  } finally {
    await w.close({ flushFiles: false });
  }
});
