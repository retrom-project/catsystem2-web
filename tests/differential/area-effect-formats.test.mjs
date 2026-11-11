// SPDX-License-Identifier: MPL-2.0
import test from 'node:test';
import assert from 'node:assert/strict';
import { engineFixtureSet } from '../fixtures/oracle-fixtures.mjs';
import {
  areaOracleWorld,
  authoredAreaBitmaps,
  recordAreaUploads,
  areaPixelParameters,
} from '../fixtures/area-effects-fixture.mjs';
import { dataWorld } from '../fixtures/data-world.mjs';
for (const fixture of await engineFixtureSet())
  test(
    fixture.profile + ' CPU area RGB24 activation and bounded-storage policy',
    {
      skip:
        !fixture.available ||
        (!fixture.profile.startsWith('sdk-') && !process.env.CATSYSTEM2_EMOTE_DLL),
    },
    async (t) => {
      const { world, commands } = await areaOracleWorld(fixture),
        js = await dataWorld(fixture.profile),
        outputs = [recordAreaUploads(world), recordAreaUploads(js)];
      try {
        for (const kind of [26, 27, 28, 29, 30, 31])
          for (const formats of [
            [3, 3, 3],
            [4, 4, 3],
            [3, 4, 4],
          ])
            await t.test(JSON.stringify({ kind, formats }), async () => {
              const ids = [];
              try {
                for (const [i, current] of [world, js].entries()) {
                  outputs[i].length = 0;
                  const handles = await authoredAreaBitmaps(current);
                  handles.forEach((h, j) => {
                    current.graphics.images.get(h).state.bpp = formats[j];
                  });
                  const words = areaPixelParameters({ kind }, handles),
                    id = await current.objects.create({
                      kind,
                      parent: current.root,
                      name: 'RGB24',
                    });
                  ids.push(id);
                  words.forEach((n, i) => current.main.machine.store(128 + i * 4, n));
                  const call = (native, args) =>
                    current === world
                      ? commands.apply(native, args, current.main.machine, current.main)
                      : current.runtime.native(
                          'main',
                          native,
                          args,
                          current.main.machine,
                          current.main,
                        );
                  if (current === js && [26, 29, 30].includes(kind)) {
                    await assert.rejects(
                      call(0xc4, [current.nativeTaskID(id), 128]),
                      /DWORD scanlines exceed RGB24/,
                    );
                    continue;
                  }
                  await call(0xc4, [current.nativeTaskID(id), 128]);
                  await call(0xc5, [current.nativeTaskID(id)]);
                }
                // Raw Wipe1/2/3 step all inputs by four bytes. RGB24 scanlines
                // can read beyond the final allocation. Retain activation evidence
                // without executing those undefined reads in this fixture.
                if ([26, 29, 30].includes(kind)) {
                  assert.equal(await world.sendEngine(ids[0], world.root, 259), 1);
                  return;
                }
                assert.equal(
                  await js.sendEngine(ids[1], js.root, 259),
                  await world.sendEngine(ids[0], world.root, 259),
                  'activation',
                );
                for (let frame = 0; frame < 7; frame++) {
                  await world.tick();
                  await js.tick();
                  assert.deepEqual(
                    structuredClone(outputs[1]),
                    structuredClone(outputs[0]),
                    'physical upload pixels at ' + frame,
                  );
                }
              } finally {
                if (ids[0]) await world.objects.release(ids[0]);
                if (ids[1]) await js.objects.release(ids[1]);
              }
            });
      } finally {
        await js.close();
        await world.close({ flushFiles: false });
      }
    },
  );
