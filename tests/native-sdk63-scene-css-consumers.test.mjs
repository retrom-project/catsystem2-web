// SPDX-License-Identifier: MPL-2.0
import assert from 'node:assert/strict';
import test from 'node:test';
import { readFile } from 'node:fs/promises';
import { runSDK63CSSConsumer } from './fixtures/sdk63-css-consumer-world.mjs';
import { mutableDataWorld } from './fixtures/mutable-data-world.mjs';
import { serializeCheckpoint, deserializeCheckpoint } from '../src/checkpoint.mjs';

const fixture = JSON.parse(
  await readFile(new URL('./fixtures/native-sdk63-scene-css-consumers.json', import.meta.url)),
);
const scenarios = [
  { name: 'normal writer and independent reader' },
  ...fixture.cold.map((coldAt) => ({ name: 'cold ' + coldAt.join('/'), coldAt })),
  { name: 'original native CSS file into independent current reader', nativeFile: true },
];
for (const scenario of scenarios)
  test('SDK63 Scene/variables/history/CSS consumers ' + scenario.name, async () => {
    await runSDK63CSSConsumer(fixture, scenario, ({ world, task, kind, frame }) => {
      const m = task.machine,
        owner = (slot, type) => world.runtime.handles.get(m.load(slot), type);
      if (kind === 'writer' && frame === 0) {
        assert.equal(m.load(256), 17, 'normal backup/restore retains the prior variable');
        assert.equal(m.load(260), 24, 'real expression consumes variable and accumulator');
        assert.equal(m.load(304), 42, 'CST value marker is actually consumed');
        assert.equal(m.string(2048), 'source-a.ks');
        assert.equal(owner(80, 'scene-data').history.path.length, 1);
      }
      if (kind === 'writer' && frame === 1) {
        assert.equal(m.string(2240), '猫A');
        assert.equal(m.string(1600), 'snap:猫A');
      }
      if (kind === 'writer' && frame === 2) {
        assert.equal(m.load(380), 11, 'actual owned raw copy uses its returned byte length');
        assert.equal(m.load(356), 4, 'remove first duplicate exposes the later record');
        for (const [slot, type] of [
          [64, 'global-file'],
          [68, 'global-file'],
          [72, 'global-file'],
          [76, 'global-file'],
          [80, 'scene-data'],
        ])
          assert.throws(() => owner(slot, type), /released/);
      }
      if (kind === 'reader' && frame === 0) {
        assert.deepEqual([m.load(264), m.load(268)], [17, 19]);
        assert.equal(m.string(2048), '猫A');
        assert.equal(m.string(2176), '猫A');
        assert.equal(m.string(2240), '犬B');
        assert.equal(owner(80, 'scene-data').history.path.length, 1);
      }
      if (kind === 'reader' && frame === 1) {
        assert.throws(() => owner(64, 'global-file'), /released/);
        assert.equal(m.string(2496), '猫A', 'history owns its bytes after file disposal');
        assert.equal(m.string(2560), '差替本文', 'restored path reaches changed actual resource');
        assert.equal(m.string(1600), 'read:猫A');
      }
      if (kind === 'reader' && frame === 2) {
        assert.equal(m.load(332), 0, 'raw alias key with extension misses; query lookup strips it');
        assert.equal(m.load(340), 0, 'clear has an observable later query');
        assert.equal(m.load(488), 36);
        assert.throws(() => owner(80, 'scene-data'), /released/);
      }
    });
  });

for (const cold of [false, true])
  test(
    'SDK63 original CSS raw-key alias and clear' + (cold ? ' across live-owner cold' : ''),
    async () => {
      const f = fixture.alias,
        input = new Map(
          f.inputs.map(({ name, data }) => [name, new Uint8Array(Buffer.from(data, 'base64'))]),
        ),
        storage = { read: async (name) => input.get(name)?.slice() ?? null },
        open = (initialize) =>
          mutableDataWorld(fixture.profile, input, { startup: f.startup, initialize, storage });
      let { world } = await open(true),
        task;
      try {
        task = await world.spawnScript('resource63.kcs', { initialExecute: false });
        for (let frame = 0; frame < f.phases.length; frame++) {
          await world.objects.update(task.id, frame);
          assert.deepEqual(
            { frame, words: f.projections.words.map((at) => task.machine.load(at)) },
            f.rows[frame],
          );
          if (frame === 0) {
            assert.equal(
              task.machine.load(260),
              3,
              'alias reaches a real later query after source file disposal',
            );
            const scene = world.runtime.handles.get(task.machine.load(80), 'scene-data');
            assert.deepEqual(
              scene.history.seen.map((entry) => entry.value),
              [3, 3],
            );
            if (cold) {
              const id = task.id,
                snapshot = await deserializeCheckpoint(await serializeCheckpoint(world.snapshot()));
              await world.close({ flushFiles: false });
              ({ world } = await open(false));
              await world.restore(snapshot);
              task = world.runtime.scheduler.tasks.get(id);
              assert(task);
            }
          }
        }
        assert.equal(task.machine.load(264), 0);
        assert.equal(task.machine.load(508), f.marker);
        assert.throws(
          () => world.runtime.handles.get(task.machine.load(80), 'scene-data'),
          /released/,
        );
      } finally {
        await world.close({ flushFiles: false });
      }
    },
  );
