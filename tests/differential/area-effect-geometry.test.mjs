// SPDX-License-Identifier: MPL-2.0
import test from 'node:test';
import assert from 'node:assert/strict';
import { engineFixtureSet } from '../fixtures/oracle-fixtures.mjs';
import { areaOracleWorld } from '../fixtures/area-effects-fixture.mjs';
import { dataWorld } from '../fixtures/data-world.mjs';
import { NativeGraphicsPacket } from '../../src/native/graphics-task.mjs';
import { rainGeometry } from '../../src/native/area-effect-geometry.mjs';
import { rawScreenVertices } from '../fixtures/screen-effects-fixture.mjs';
import { floatBits, bitsFloat } from '../../src/kcs.mjs';
const ordered = (n) => (n & 0x80000000 ? ~n >>> 0 : (n | 0x80000000) >>> 0);
function vectors(actual, expected, label) {
  assert.equal(actual.length, expected.length, label + ' length');
  actual.forEach((word, i) => {
    assert.ok(Number.isFinite(word) && Number.isFinite(expected[i]), label + ' finite ' + i);
    assert.ok(
      Math.abs(ordered(floatBits(word)) - ordered(floatBits(expected[i]))) <= 1,
      `${label} field${i} JS ${word} / original ${expected[i]}`,
    );
  });
}
for (const fixture of await engineFixtureSet())
  test(
    fixture.profile + ' JS area geometry matches original callbacks and RNG',
    {
      skip:
        !fixture.available ||
        (!fixture.profile.startsWith('sdk-') && !process.env.CATSYSTEM2_EMOTE_DLL),
    },
    async (t) => {
      for (const [kind, mode] of [
        [18, 1],
        [18, 2],
        [18, 0x80000001],
        [18, 0x80000002],
        [20, 0],
        [19, 0],
        [19, 1],
        [19, 2],
        [19, 3],
      ])
        await t.test(`kind ${kind} mode ${mode}`, async () => {
          const { world, device } = await areaOracleWorld(fixture),
            js = await dataWorld(fixture.profile);
          const records = [],
            planes = [];
          try {
            js.game.width = 65;
            js.game.height = 49;
            js.graphics.view.configure({ clientWidth: 65, clientHeight: 49 });
            for (const current of [world, js]) {
              const plane = await current.objects.create({
                kind: 2,
                parent: current.root,
                name: 'Authored plane',
              });
              await current.sendEngine(plane, current.root, 41, 0, 0, {
                payload: new NativeGraphicsPacket([
                  ...[0, 0, 0, 24, 18, 0, 0].map(floatBits),
                  0xffffffff,
                ]),
              });
              planes.push(plane);
              const id = await current.objects.create({
                kind,
                parent: current.root,
                name: 'Authored area',
              });
              records.push(current.objects.objects.get(id));
              const params =
                kind === 18
                  ? [current.nativeTaskID(plane), mode, ...[4, 8, 30].map(floatBits)]
                  : kind === 20
                    ? [current.nativeTaskID(plane), floatBits(6), 4]
                    : [
                        ...[65, mode === 1 ? 0 : 16, mode === 1 ? 31 : 49].map(floatBits),
                        300,
                        ...[mode === 1 ? 16 : 14, mode === 1 ? 3 : 7, 42].map(floatBits),
                        mode === 2 ? 0 : 6,
                        mode === 2 ? 0 : 6,
                        0xff60c4f4,
                      ];
              current.random.integer.seed(17);
              current.random.real.seed(17);
              await current.sendEngine(
                id,
                current.root,
                kind === 18 ? 263 : kind === 20 ? 267 : 266,
                0,
                0,
                { payload: new NativeGraphicsPacket(params) },
              );
              await current.sendEngine(id, current.root, 257);
            }
            assert.deepEqual(js.random.snapshot(), world.random.snapshot(), 'seed consumption');
            const p = world.nativeEngine.process,
              old = records[0].implementation,
              next = records[1].implementation;
            for (let frame = 0; frame < 4; frame++) {
              if (kind === 19 && mode === 3 && frame === 1) {
                const params = [
                  ...[37, 7, 31].map(floatBits),
                  420,
                  ...[16, 3, 42].map(floatBits),
                  8,
                  6,
                  0xff60c4f4,
                ];
                for (const [current, record] of [
                  [world, records[0]],
                  [js, records[1]],
                ])
                  await current.sendEngine(record.id, current.root, 266, 0, 0, {
                    payload: new NativeGraphicsPacket(params),
                  });
                assert.deepEqual(
                  js.random.snapshot(),
                  world.random.snapshot(),
                  'repeat init keeps RNG',
                );
              }
              if (kind === 19) {
                const source = p.load(old.pointer + 112),
                  expected = Array.from({ length: next.state.drops.length * 10 }, (_, i) =>
                    p.load(source + i * 4),
                  );
                const actual = next.state.drops.flatMap((pair) =>
                  pair.flatMap((v) => [
                    floatBits(v.x),
                    floatBits(v.y),
                    floatBits(v.z),
                    floatBits(v.w),
                    v.color,
                  ]),
                );
                assert.deepEqual(actual, expected, 'source rain at frame ' + frame);
                const platform = world.nativeEngine.features.get('graphics-platform'),
                  descriptor = platform.descriptor(world.nativeTaskID(records[0].id)),
                  model = p.load(descriptor + 8),
                  callback = p.load(model + 240);
                let submitted;
                device.onDrawRaw = (raw) => {
                  if (raw.type === 2) submitted = rawScreenVertices(raw);
                };
                await world.nativeEngine.call(callback, [old.pointer, 1]);
                if (next.state.drops.length) assert.ok(submitted, 'native line submission');
                submitted ??= [];
                const projected = rainGeometry(next.state, js.graphics.projection()).flatMap(
                  (row) => row.vertices,
                );
                vectors(
                  projected.flatMap((v) => [v.x, v.y, v.z, v.w]),
                  submitted.flatMap((v) => [v.x, v.y, v.z, v.w]),
                  'rain projection ' + frame,
                );
                assert.deepEqual(
                  projected.map((v) => v.color),
                  submitted.map((v) => v.color),
                );
              } else {
                const platform = world.nativeEngine.features.get('graphics-platform'),
                  descriptor = platform.descriptor(world.nativeTaskID(planes[0])),
                  model = p.load(descriptor + 16) || p.load(descriptor + 12),
                  callback = p.load(model + 236),
                  count = kind === 20 ? 3 : 2;
                assert.ok(callback, 'original callback installed');
                for (const triangle of kind === 20 ? [0, 1] : [0]) {
                  const input =
                      kind === 20
                        ? triangle === 0
                          ? [
                              [0, 0, 0, 1],
                              [24, 0, 0, 1],
                              [24, 18, 0, 1],
                            ]
                          : [
                              [0, 0, 0, 1],
                              [0, 18, 0, 1],
                              [24, 18, 0, 1],
                            ]
                        : [
                            [8, 2, 0.5, 1],
                            [8, 6, 0.25, 1],
                          ],
                    pointer = p.allocate(count * 16, true);
                  try {
                    input.flat().forEach((value, i) => p.store(pointer + i * 4, floatBits(value)));
                    await world.nativeEngine.call(callback, [
                      old.pointer,
                      count,
                      pointer,
                      triangle,
                    ]);
                    const expected = Array.from({ length: count * 4 }, (_, i) =>
                        bitsFloat(p.load(pointer + i * 4)),
                      ),
                      actual = next
                        .vertices(
                          input.map(([x, y, z, w]) => ({ x, y, z, w })),
                          triangle,
                        )
                        .flatMap((v) => [v.x, v.y, v.z, v.w]);
                    vectors(actual, expected, `kind${kind} frame${frame}`);
                  } finally {
                    p.free(pointer);
                  }
                }
              }
              await world.tick();
              await js.tick();
            }
            assert.deepEqual(js.random.snapshot(), world.random.snapshot(), 'final RNG');
          } finally {
            await js.close();
            await world.close({ flushFiles: false });
          }
        });
    },
  );
for (const fixture of await engineFixtureSet())
  test(
    fixture.profile +
      ' geometry controls before initialization retain their original query behavior',
    {
      skip:
        !fixture.available ||
        (!fixture.profile.startsWith('sdk-') && !process.env.CATSYSTEM2_EMOTE_DLL),
    },
    async () => {
      const { world } = await areaOracleWorld(fixture),
        js = await dataWorld(fixture.profile);
      try {
        for (const kind of [18, 19, 20]) {
          const ids = [];
          for (const current of [world, js]) {
            const id = await current.objects.create({
              kind,
              parent: current.root,
              name: 'Before init',
            });
            ids.push(id);
            await current.sendEngine(id, current.root, 257);
          }
          assert.equal(
            await js.sendEngine(ids[1], js.root, 259),
            await world.sendEngine(ids[0], world.root, 259),
            'initial start ' + kind,
          );
          await world.tick();
          await js.tick();
          for (const [i, current] of [world, js].entries()) {
            const packet =
              kind === 18
                ? [0, 1, ...[4, 8, 30].map(floatBits)]
                : kind === 20
                  ? [0, floatBits(6), 4]
                  : [
                      ...[64, 16, 48].map(floatBits),
                      300,
                      ...[14, 7, 42].map(floatBits),
                      2,
                      2,
                      0xff60c4f4,
                    ];
            await current.sendEngine(
              ids[i],
              current.root,
              kind === 18 ? 263 : kind === 19 ? 266 : 267,
              0,
              0,
              { payload: new NativeGraphicsPacket(packet) },
            );
          }
          assert.equal(
            await js.sendEngine(ids[1], js.root, 259),
            await world.sendEngine(ids[0], world.root, 259),
            'after init ' + kind,
          );
          await world.objects.release(ids[0]);
          await js.objects.release(ids[1]);
        }
      } finally {
        await js.close();
        await world.close({ flushFiles: false });
      }
    },
  );
