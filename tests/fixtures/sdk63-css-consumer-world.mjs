// SPDX-License-Identifier: MPL-2.0
import assert from 'node:assert/strict';
import { mutableDataWorld } from './mutable-data-world.mjs';
import { serializeCheckpoint, deserializeCheckpoint } from '../../src/checkpoint.mjs';

const bytes = (data) => new Uint8Array(Buffer.from(data, 'base64'));
export async function runSDK63CSSConsumer(
  fixture,
  { coldAt = null, nativeFile = false } = {},
  check,
) {
  const saved = new Map(),
    storage = {
      read: async (name) => saved.get(name)?.slice() ?? null,
      write: async (name, data) => {
        saved.set(name, data.slice());
        return true;
      },
    };
  let world;
  try {
    for (const kind of ['writer', 'reader']) {
      const files = new Map(fixture.inputs[kind].map(({ name, data }) => [name, bytes(data)])),
        open = (initialize) =>
          mutableDataWorld(fixture.profile, files, {
            startup: fixture.startup,
            initialize,
            storage,
          });
      if (kind === 'reader' && nativeFile)
        saved.set(fixture.outputFile, bytes(fixture.nativeSavedFile.data));
      ({ world } = await open(true));
      let task = await world.spawnScript(kind === 'writer' ? 'resource63.kcs' : 'reader63.kcs', {
        initialExecute: false,
      });
      const cold = async () => {
        const id = task.id,
          checkpoint = await deserializeCheckpoint(await serializeCheckpoint(world.snapshot()));
        await world.close({ flushFiles: false });
        ({ world } = await open(false));
        await world.restore(checkpoint);
        task = world.runtime.scheduler.tasks.get(id);
        assert(task);
      };
      if (coldAt?.[0] === kind && coldAt[1] === -1) await cold();
      for (let frame = 0; frame < fixture.phases[kind].length; frame++) {
        await world.objects.update(task.id, frame);
        const projection = fixture.projections[kind],
          actual = {
            kind,
            frame,
            words: projection.words.map((at) => task.machine.load(at)),
            spans: projection.spans.map(({ at, size }) =>
              Buffer.from(task.machine.bytes(at, size)).toString('base64'),
            ),
          },
          expected = fixture.rows.find((row) => row.kind === kind && row.frame === frame);
        assert.deepEqual(actual, expected, fixture.phases[kind][frame].label);
        await check({ world, task, kind, frame, saved });
        if (coldAt?.[0] === kind && coldAt[1] === frame) await cold();
      }
      assert.equal(task.machine.load(508), fixture.marker, 'actual result-dependent VM branch');
      await world.close({ flushFiles: false });
      assert.equal(
        world.runtime.handles.records.size,
        0,
        'normal World retirement frees every owner',
      );
      world = null;
      if (kind === 'writer') assert(saved.get(fixture.outputFile)?.length > 16);
    }
  } finally {
    await world?.close({ flushFiles: false });
  }
}
