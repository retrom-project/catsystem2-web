// SPDX-License-Identifier: MPL-2.0
import test from 'node:test';
import assert from 'node:assert/strict';
import { NativeEngineProcess } from '../../src/native/engine-process.mjs';
import { nativeABI } from '../../src/native/abi/index.mjs';
import { engineFixtureSet } from '../fixtures/oracle-fixtures.mjs';
import { historyCursorFixture } from '../fixtures/history-cursor-fixture.mjs';
import { observeDataSequence } from '../fixtures/data-sequence.mjs';
const layouts = {
  'nekopara-vol3-engine-2.6.1.76': { construct: 0x72d010, import: 0x72d680, destroy: 0x72d030 },
  'sdk-4.01-engine-2.6.1.74': { construct: 0x5dbfa0, import: 0x5dc610, destroy: 0x5dbfc0 },
};
for (const fixture of await engineFixtureSet())
  test(
    `${fixture.profile} independent history cursor sequences`,
    { skip: fixture.available ? false : fixture.reason },
    async (t) => {
      const engine = await NativeEngineProcess.open({
        profile: fixture.profile,
        bytes: fixture.bytes,
      });
      try {
        for (const history of [
          [],
          [
            ['a', 3],
            ['b', 2],
          ],
          [
            ['missing', 4],
            ['日本', 3],
          ],
        ])
          await t.test(JSON.stringify(history), async () => {
            const setup = async (world, engine, values) => {
                const { scene } = historyCursorFixture();
                for (const [name, block] of history) scene.history.appendPath(name, block);
                if (!engine) {
                  values.set('source', world.runtime.handles.add('scene-data', scene));
                  return;
                }
                const p = engine.process,
                  abi = layouts[fixture.profile],
                  source = p.allocate(8, true),
                  owner = p.allocate(8, true),
                  path = scene.history.encode('path', true),
                  bytes = p.allocate(path.length, true);
                await engine.call(abi.construct, [], owner);
                p.write(bytes, path);
                await engine.call(abi.import, [0, 0, bytes, path.length], owner);
                p.store(source + 4, owner);
                values.set('source', source);
                return async () => {
                  await engine.call(abi.destroy, [], owner);
                  for (const at of [source, owner, bytes]) p.free(at);
                };
              },
              files = Object.fromEntries(historyCursorFixture().files),
              steps = [
                { id: 0x17b, args: ['source', 2], create: 'cursor', type: 'history-cursor' },
                { id: 0x180, args: ['cursor', 0, 64, 128] },
                { id: 0x17e, args: ['cursor', 0, 256, 512] },
                { id: 0x17f, args: ['cursor', 0, 768, 0] },
                { id: 0x17d, args: ['cursor', 0] },
                { id: 0x17e, args: ['cursor', 0, 256, 512] },
                { id: 0x17d, args: ['cursor', 1] },
                { id: 0x17f, args: ['cursor', 0, 768, 1] },
                { id: 0x17e, args: ['cursor', 0, 0xffffffff, 0] },
                { id: 0x17c, args: ['cursor'], release: 'cursor' },
              ];
            for (const step of steps)
              assert.ok(nativeABI(fixture.profile).tables.main.entries[step.id]);
            assert.deepEqual(
              await observeDataSequence(fixture.profile, steps, { files, setup }),
              await observeDataSequence(fixture.profile, steps, { engine, files, setup }),
            );
          });
      } finally {
        await engine.close();
      }
    },
  );
