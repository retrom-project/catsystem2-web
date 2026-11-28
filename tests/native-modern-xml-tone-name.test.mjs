// SPDX-License-Identifier: MPL-2.0
import assert from 'node:assert/strict';
import test from 'node:test';
import { readFile } from 'node:fs/promises';
import { mutableDataWorld } from './fixtures/mutable-data-world.mjs';
import { serializeCheckpoint, deserializeCheckpoint } from '../src/checkpoint.mjs';

const fixture = JSON.parse(
  await readFile(new URL('./fixtures/native-modern-xml-tone-name.json', import.meta.url)),
);
const decode = (data) => new Uint8Array(Buffer.from(data, 'base64'));

for (const build of fixture.builds) {
  for (const kind of ['x', 'n']) {
    const coldPoints = kind === 'x' ? [null, 'before', 0, 1] : [null, 0, 1];
    for (const coldAt of coldPoints) {
      test(`${build.version} ${kind === 'x' ? 'XML/tone' : 'name table/pair'} resources feed parsed Script/Scene consumers${coldAt === null ? '' : ' through cold ' + coldAt}`, async () => {
        let resources = new Map(build.inputs.map((r) => [r.name, decode(r.data)]));
        const open = (initialize) =>
          mutableDataWorld(build.profile, resources, {
            startup: build.startup,
            initialize,
          });
        let { world, files } = await open(true);
        let task;
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
        try {
          task = await world.spawnScript(kind + '.kcs', { initialExecute: false });
          if (coldAt === 'before') await cold();
          let owners;
          for (let index = 0; index < fixture.phases[kind].length; index++) {
            await world.objects.update(task.id, index);
            const expected = build.rows.find((r) => r.kind === kind && r.index === index);
            assert.deepEqual(
              fixture.projections.words.map((at) => task.machine.load(at)),
              expected.words,
            );
            assert.deepEqual(
              fixture.projections.spans.map(({ at, size }) =>
                Buffer.from(task.machine.bytes(at, size)).toString('base64'),
              ),
              expected.spans,
            );
            if (index === 0) {
              owners =
                kind === 'x'
                  ? [
                      [64, 'xml'],
                      [68, 'xml'],
                      [72, 'character-names'],
                      [76, 'character-names'],
                    ]
                  : [
                      [64, 'nametable'],
                      [68, 'nametable'],
                      [88, 'name-pairs'],
                      [92, 'name-pairs'],
                    ];
              owners = owners.map(([at, type]) => [task.machine.load(at), type]);
              assert.equal(new Set(owners.map(([id]) => id)).size, 4);
              for (const [id, type] of owners) assert(world.runtime.handles.get(id, type));
              if (kind === 'n')
                assert.equal(task.machine.load(260), build.version === '74' ? 0xffffffff : 0);
            }
            if (index === 1) {
              for (const i of [0, 2]) {
                const [id, type] = owners[i];
                assert.throws(() => world.runtime.handles.get(id, type), /released/);
              }
              for (const i of [1, 3]) {
                const [id, type] = owners[i];
                assert(world.runtime.handles.get(id, type));
              }
              for (const r of build.replacedInputs) files.set(r.name, decode(r.data));
            }
            if (coldAt === index) await cold();
          }
          assert.equal(task.machine.load(508), fixture.marker[kind]);
          for (const [id, type] of owners)
            assert.throws(() => world.runtime.handles.get(id, type), /released/);
          if (kind === 'x') {
            assert.equal(task.machine.load(408), 17, 'old XML owner retained parsed value');
            assert.equal(task.machine.load(412), 31, 'new reader consumed replaced source');
            assert.deepEqual(
              [416, 420, 424].map((at) => task.machine.load(at)),
              [8, 6, 12],
            );
            assert.equal(task.machine.load(400), 20, 'actual Script expression retained variable');
          } else {
            assert.equal(task.machine.load(328), 7);
            assert.equal(task.machine.load(380), 8, 'new table consumed replaced source');
            assert.equal(task.machine.load(300), 1);
            assert.equal(
              task.machine.load(332),
              0,
              'independent pair selected another Scene block',
            );
          }
        } finally {
          await world.close({ flushFiles: false });
        }
      });
    }
  }
}
