// SPDX-License-Identifier: MPL-2.0
import assert from 'node:assert/strict';
import test from 'node:test';
import { readFile } from 'node:fs/promises';
import { mutableDataWorld } from './fixtures/mutable-data-world.mjs';
import { serializeCheckpoint, deserializeCheckpoint } from '../src/checkpoint.mjs';

const fixture = JSON.parse(
  await readFile(new URL('./fixtures/native-sdk63-xml-name-resources.json', import.meta.url)),
);
const decode = (data) => new Uint8Array(Buffer.from(data, 'base64'));

for (const coldAt of [null, 0, 1, 2, 3, 5, 6, 7, 8]) {
  test(
    'SDK63 XML/name resources feed actual Script/Scene consumers' +
      (coldAt === null ? '' : ' with cold' + coldAt),
    async () => {
      let resources = new Map(fixture.inputs.map((r) => [r.name, decode(r.data)]));
      const open = (initialize) =>
        mutableDataWorld(fixture.profile, resources, {
          startup: fixture.startup,
          initialize,
        });
      let { world, files } = await open(true),
        task;
      const cold = async () => {
        const id = task.id,
          state = await deserializeCheckpoint(await serializeCheckpoint(world.snapshot()));
        resources = new Map(files);
        await world.close({ flushFiles: false });
        ({ world, files } = await open(false));
        await world.restore(state);
        task = world.runtime.scheduler.tasks.get(id);
        assert(task);
      };
      const owners = new Map();
      try {
        task = await world.spawnScript('resource63.kcs', { initialExecute: false });
        for (let frame = 0; frame < fixture.phases.length; frame++) {
          const q = fixture.phases[frame],
            p = fixture.projections[q.kind];
          await world.objects.update(task.id, frame);
          const expected = fixture.rows[frame];
          assert.deepEqual(
            p.words.map((at) => task.machine.load(at)),
            expected.words,
          );
          assert.deepEqual(
            p.spans.map(({ at, size }) =>
              Buffer.from(task.machine.bytes(at, size)).toString('base64'),
            ),
            expected.spans,
          );
          if (q.index === 0) {
            const type = q.kind === 'xml' ? 'xml' : 'nametable',
              first = task.machine.load(64),
              second = task.machine.load(68);
            assert(first && second && first !== second);
            owners.set(q.kind, { type, first, second });
            assert(world.runtime.handles.get(first, type));
            assert(world.runtime.handles.get(second, type));
            if (q.kind === 'name') {
              assert.equal(task.machine.load(132), 0xffffffff, 'fifth-column alias is not enabled');
              assert.equal(task.machine.load(212), 0xffffffff, '32-byte primary name is skipped');
              assert.deepEqual(task.machine.bytes(1024, 32).slice(-1), new Uint8Array([0]));
              assert.equal(
                task.machine.load(1056, 1),
                0xa5,
                '31-byte name and NUL preserve canary',
              );
              assert.equal(
                task.machine.string(1600),
                'q'.repeat(31),
                'native field clamps to31 bytes',
              );
              assert.equal(task.machine.load(1632, 1), 0xa5);
            }
          }
          const owner = owners.get(q.kind);
          if (q.index === 2) {
            assert.throws(() => world.runtime.handles.get(owner.first, owner.type), /released/);
            assert(world.runtime.handles.get(owner.second, owner.type));
            const name = q.kind === 'xml' ? 'metadata.int' : 'tables.int',
              changed = fixture.changed.find((r) => r.name === name);
            files.set(name, decode(changed.data));
          }
          if (q.index === 3) {
            assert.throws(() => world.runtime.handles.get(owner.second, owner.type), /released/);
            assert.equal(
              task.machine.load(q.kind === 'xml' ? 184 : 220),
              q.kind === 'xml' ? 31 : 8,
            );
          }
          if (coldAt === frame) await cold();
        }
        assert.equal(task.machine.load(508), fixture.marker);
        for (const { type, first, second } of owners.values())
          for (const id of [first, second])
            assert.throws(() => world.runtime.handles.get(id, type), /released/);
      } finally {
        await world.close({ flushFiles: false });
      }
    },
  );
}
