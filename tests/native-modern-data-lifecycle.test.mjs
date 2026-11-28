// SPDX-License-Identifier: MPL-2.0
import assert from 'node:assert/strict';
import test from 'node:test';
import { readFile } from 'node:fs/promises';
import { modernParticleMessageWorld } from './fixtures/modern-particle-message-world.mjs';
import { parseXML } from '../src/xml.mjs';
import { serializeCheckpoint, deserializeCheckpoint } from '../src/checkpoint.mjs';
const golden = JSON.parse(
  await readFile(new URL('./fixtures/native-modern-data-lifecycle.json', import.meta.url)),
);
const bytes = (s) => new Uint8Array(Buffer.from(s, 'base64'));
for (const build of golden.builds) {
  const checkpoints =
    build.key === 'G2-74'
      ? [null, 'writer0', 'writer1', 'reader0']
      : build.key === 'G2BRIDGE-76'
        ? [null, 'writer0', 'reader0']
        : [null, 'writer0'];
  for (const coldAt of checkpoints)
    test(`${build.key} parsed independent data consumers${coldAt === null ? '' : ` cold at ${coldAt}`}`, async () => {
      const saved = new Map(),
        storage = {
          read: async (n) => saved.get(n)?.slice() ?? null,
          write: async (n, b) => (saved.set(n, b.slice()), true),
        };
      const open = (initialize) =>
        modernParticleMessageWorld(
          build.profile,
          Object.fromEntries(build.inputs.map((r) => [r.name, bytes(r.data)])),
          { initialize, startup: parseXML(build.startup), storage },
        );
      let world = await open(true);
      try {
        for (const kind of ['writer', 'reader']) {
          let task = await world.spawnScript(kind + '.kcs', { initialExecute: false });
          for (let index = 0; index < build.steps[kind]; index++) {
            await world.objects.update(task.id, index);
            if (build.key === 'G2-74' && kind === 'writer' && index === 0) {
              const a = world.runtime.handles.get(task.machine.load(84), 'record-stack');
              const b = world.runtime.handles.get(task.machine.load(88), 'record-stack');
              assert.equal(a.count, 1);
              assert.equal(b.count, 1);
              assert.equal(b.recordSize, 8);
              assert.equal(b.capacity, 2);
              assert.deepEqual(a.data, b.data, 'copy keeps the fully initialized inactive record');
            }
            if (kind + index === coldAt) {
              const id = task.id,
                state = await deserializeCheckpoint(await serializeCheckpoint(world.snapshot()));
              await world.close({ flushFiles: false });
              world = await open(false);
              await world.restore(state);
              task = world.runtime.scheduler.tasks.get(id);
            }
          }
          const p = build.projections[kind],
            expected = build.rows.find((r) => r.kind === kind);
          assert.deepEqual(
            p.outputs.map((at) => task.machine.load(at)),
            expected.words,
            expected.label,
          );
          assert.deepEqual(
            p.spans.map(({ at, size }) =>
              Buffer.from(task.machine.bytes(at, size)).toString('base64'),
            ),
            expected.spans,
            'real speaker/record outputs and initialized caller canaries',
          );
          assert.equal(
            task.machine.load(344),
            build.marker,
            'actual data query controls the Script branch',
          );
        }
        assert(saved.get(build.fileName)?.length > 16);
        assert.equal(world.nativeEngine, undefined);
      } finally {
        await world.close({ flushFiles: false });
      }
    });
}

for (const build of golden.builds)
  test(`${build.key} original CSS alone reaches fresh reader branches and real output bytes`, async () => {
    const saved = new Map([[build.fileName, bytes(build.nativeFile)]]);
    const world = await modernParticleMessageWorld(
      build.profile,
      Object.fromEntries(build.inputs.map((r) => [r.name, bytes(r.data)])),
      {
        startup: parseXML(build.startup),
        storage: {
          read: async (n) => saved.get(n)?.slice() ?? null,
          write: async (n, b) => (saved.set(n, b.slice()), true),
        },
      },
    );
    try {
      const task = await world.spawnScript('reader.kcs', { initialExecute: false });
      for (let i = 0; i < build.steps.reader; i++) await world.objects.update(task.id, i);
      const expected = build.rows.find((r) => r.kind === 'reader'),
        p = build.projections.reader;
      assert.deepEqual(
        p.outputs.map((at) => task.machine.load(at)),
        expected.words,
      );
      assert.deepEqual(
        p.spans.map(({ at, size }) => Buffer.from(task.machine.bytes(at, size)).toString('base64')),
        expected.spans,
      );
      assert.equal(task.machine.load(344), build.marker);
      assert.deepEqual(saved.get(build.fileName), bytes(build.nativeFile));
    } finally {
      await world.close({ flushFiles: false });
    }
  });
