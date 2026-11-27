// SPDX-License-Identifier: MPL-2.0
import assert from 'node:assert/strict';
import test from 'node:test';
import { readFile } from 'node:fs/promises';
import { modernParticleMessageWorld } from './fixtures/modern-particle-message-world.mjs';
import { parseXML } from '../src/xml.mjs';
import { serializeCheckpoint, deserializeCheckpoint } from '../src/checkpoint.mjs';
const golden = JSON.parse(
    await readFile(new URL('./fixtures/sdk23-scene-cross-owner-golden.json', import.meta.url)),
  ),
  bytes = (value) => new Uint8Array(Buffer.from(value, 'base64'));
const open = (initialize) =>
  modernParticleMessageWorld(
    golden.profile,
    {
      ...Object.fromEntries(golden.inputs.archives.map((row) => [row.name, bytes(row.data)])),
      'startup.xml': bytes(golden.inputs.startup),
    },
    { initialize, startup: parseXML(new TextDecoder().decode(bytes(golden.inputs.startup))) },
  );
for (const coldAt of [null, 0, 1, 2, 3, 4])
  test(`SDK23 real child Script/raw162 -> CSS/current Scene consumer${coldAt === null ? '' : ` independent cold${coldAt}`}`, async () => {
    let world = await open(true),
      caller = await world.spawnScript('scene-g3', { initialExecute: false }),
      sourcePair,
      currentPair;
    const compare = (row) => {
      const m = caller.machine;
      assert.deepEqual(
        Array.from({ length: 10 }, (_, i) => m.load(128 + 4 * i)),
        row.outputs,
        row.label,
      );
      assert.deepEqual(m.bytes(512, 320), bytes(row.bytes), 'complete initialized consumer bytes');
      if (row.phase >= 1) {
        assert.equal(m.string(512), 'read:scene-string');
        if (row.phase <= 3) {
          const id = world.resolveTaskID(m.load(64), caller.id),
            source = world.runtime.scheduler.tasks.get(id),
            data = world.runtime.sceneData(source),
            pair = world.runtime.scenePointers(source.context.sceneData);
          assert.equal(world.runtime.sceneDataFromPointers(...pair), data);
          if (sourcePair) assert.deepEqual(pair, sourcePair);
          sourcePair = pair;
        }
        if (row.phase === 4) {
          assert(sourcePair.every((id) => !world.runtime.handles.records.has(id)));
          assert.equal(world.runtime.sceneData(caller).history.path[0].strings[0][0], '7:11');
        }
      }
      if (row.phase >= 2) {
        const pair = world.runtime.scenePointers(caller.context.sceneData);
        if (currentPair) assert.deepEqual(pair, currentPair);
        currentPair = pair;
        assert.equal(world.runtime.sceneDataFromPointers(...pair), world.runtime.sceneData(caller));
      }
    };
    try {
      await world.runtime.native('main', 209, [512], caller.machine, caller);
      for (const row of golden.rows) {
        await world.objects.update(caller.id, row.frame);
        compare(row);
        if (row.phase === coldAt) {
          const id = caller.id,
            state = await deserializeCheckpoint(await serializeCheckpoint(world.snapshot()));
          await world.close({ flushFiles: false });
          world = await open(false);
          await world.restore(state);
          caller = world.runtime.scheduler.tasks.get(id);
          compare(row);
        }
      }
    } finally {
      await world.close({ flushFiles: false });
    }
  });
