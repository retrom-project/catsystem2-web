// SPDX-License-Identifier: MPL-2.0
import test from 'node:test';
import assert from 'node:assert/strict';
import { engineFixtureSet } from '../fixtures/oracle-fixtures.mjs';
import { dataWorld } from '../fixtures/data-world.mjs';
import {
  areaOracleWorld,
  authoredAreaBitmaps,
  recordAreaUploads,
  areaPixelParameters,
} from '../fixtures/area-effects-fixture.mjs';
for (const fixture of await engineFixtureSet())
  test(
    fixture.profile + ' JS area working pixels match existing original task/upload paths',
    {
      skip:
        fixture.available &&
        (fixture.profile.startsWith('sdk-') || process.env.CATSYSTEM2_EMOTE_DLL)
          ? false
          : (fixture.reason ?? 'Missing private E-mote DLL'),
    },
    async (t) => {
      for (const probe of [
        ...[26, 27, 28, 29, 30, 31].map((kind) => ({ kind })),
        { kind: 28, fadeIn: 1 },
        { kind: 31, fadeIn: 1 },
        { kind: 28, duration: 1 },
        { kind: 31, duration: 1, blendDuration: 1 },
        { kind: 27, speed: 2 },
        { kind: 28, finish: 0xc6 },
        { kind: 30, finish: 0xcb },
        { kind: 29, reinitialize: true },
        ...[27, 28, 31].map((kind) => ({
          kind,
          sourceOrigin: [1, 1],
          destinationOrigin: [2, 0],
          maskOrigin: [1, 1],
          extent: [6, 4],
        })),
      ])
        await t.test(JSON.stringify(probe), async () => {
          const oracle = await areaOracleWorld(fixture),
            world = oracle.world,
            js = await dataWorld(fixture.profile),
            ids = [],
            results = [];
          let fresh, resumed, resumeAt;
          try {
            for (const current of [world, js]) {
              const kind = probe.kind,
                handles = await authoredAreaBitmaps(current),
                words = areaPixelParameters(probe, handles),
                id = await current.objects.create({
                  kind,
                  parent: current.root,
                  name: 'Authored area',
                });
              ids.push(id);
              words.forEach((word, i) => current.main.machine.store(128 + i * 4, word));
              const call = (id, args) =>
                current === world
                  ? oracle.commands.apply(id, args, current.main.machine, current.main)
                  : current.runtime.native('main', id, args, current.main.machine, current.main);
              if (probe.speed)
                new DataView(
                  current.configuration.blocks[2].buffer,
                  current.configuration.blocks[2].byteOffset,
                  4,
                ).setUint32(0, probe.speed, true);
              results.push(recordAreaUploads(current));
              await call(0xc4, [current.nativeTaskID(id), 128]);
              await call(0xc5, [current.nativeTaskID(id)]);
            }
            for (let frame = 1; frame <= 7; frame++) {
              if (frame === 2 && probe.reinitialize) {
                await oracle.commands.apply(
                  0xc4,
                  [world.nativeTaskID(ids[0]), 128],
                  world.main.machine,
                  world.main,
                );
                await js.runtime.native(
                  'main',
                  0xc4,
                  [js.nativeTaskID(ids[1]), 128],
                  js.main.machine,
                  js.main,
                );
              }
              if (frame === 2 && probe.finish) {
                await oracle.commands.apply(
                  probe.finish,
                  [world.nativeTaskID(ids[0])],
                  world.main.machine,
                  world.main,
                );
                await js.runtime.native(
                  'main',
                  probe.finish,
                  [js.nativeTaskID(ids[1])],
                  js.main.machine,
                  js.main,
                );
              }
              await world.tick();
              await js.tick();
              if (fresh) {
                await fresh.tick();
                assert.deepEqual(resumed, results[1].slice(resumeAt), 'fresh World uploads');
                assert.deepEqual(
                  fresh.objects.objects.get(ids[1]).implementation.state,
                  js.objects.objects.get(ids[1]).implementation.state,
                  'fresh World effect state',
                );
              }
              assert.equal(results[1].length, results[0].length, 'frame ' + frame + ' uploads');
              const expected = results[0].at(-1),
                actual = results[1].at(-1);
              if (expected) {
                assert.deepEqual(actual.offset, expected.offset, 'frame ' + frame + ' destination');
                assert.deepEqual(
                  actual.region,
                  expected.region,
                  'frame ' + frame + ' source rectangle',
                );
                assert.equal(actual.width, expected.width);
                assert.equal(actual.height, expected.height);
                const different = actual.pixels.findIndex((n, i) => n !== expected.pixels[i]);
                assert.equal(
                  different,
                  -1,
                  'frame ' +
                    frame +
                    ' working pixel ' +
                    different +
                    ' JS ' +
                    actual.pixels.slice(different, different + 8) +
                    ' original ' +
                    expected.pixels.slice(different, different + 8),
                );
              }
              assert.equal(
                await js.sendEngine(ids[1], js.root, 259),
                await world.sendEngine(ids[0], world.root, 259),
                'frame ' + frame + ' activity',
              );
              if (frame === 2) {
                fresh = await dataWorld(fixture.profile, {}, { initialize: false });
                await fresh.restore(structuredClone(js.snapshot()));
                resumed = recordAreaUploads(fresh);
                resumeAt = results[1].length;
              }
            }
          } finally {
            await fresh?.close();
            await js.close();
            await world.close({ flushFiles: false });
          }
        });
    },
  );
