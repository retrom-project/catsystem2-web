// SPDX-License-Identifier: MPL-2.0
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { engineFixtureSet } from '../fixtures/oracle-fixtures.mjs';
import { createTextureMemoryWorld } from '../fixtures/texture-clear-fixture.mjs';
import { installGraphicsOracle } from '../fixtures/graphics-oracle-world.mjs';
import { ScreenVectorGPU } from '../fixtures/screen-effects-fixture.mjs';
import { NativeGraphicsPacket } from '../../src/native/graphics-task.mjs';
import { floatBits } from '../../src/kcs.mjs';
import { kcsProgram } from '../helpers.mjs';
for (const fixture of await engineFixtureSet())
  test(
    fixture.profile + ' JS Plane queries, raw-ID aliases and trail history match the old receiver',
    {
      skip:
        !fixture.available ||
        (!fixture.profile.startsWith('sdk-') && !process.env.CATSYSTEM2_EMOTE_DLL),
    },
    async () => {
      const files = new Map([
        ['engine.exe', fixture.bytes],
        ['main.kcs', kcsProgram([[37, 1024], [43, 0xd1, 4], [59]])],
      ]);
      if (!fixture.profile.startsWith('sdk-'))
        files.set(
          'emotedriver.dll',
          new Uint8Array(await readFile(process.env.CATSYSTEM2_EMOTE_DLL)),
        );
      const worlds = [
        createTextureMemoryWorld(fixture.profile, files),
        createTextureMemoryWorld(fixture.profile, files),
      ];
      installGraphicsOracle(worlds[0]);
      const send = (world, id, message, words = [], w = 0) =>
          world.sendEngine(id, world.main.id, message, w, 0, {
            payload: new NativeGraphicsPacket(words),
          }),
        query = async (world, id, message, count = 3) => {
          const payload = new NativeGraphicsPacket();
          await world.sendEngine(
            id,
            world.main.id,
            message,
            0,
            message === 75 || message === 76 ? 16 : 0,
            { payload },
          );
          return [0, 4, 8, 16, 20, 24].slice(0, count).map((at) => payload.load(at));
        },
        ids = [],
        aliases = [];
      try {
        for (const world of worlds) {
          world.stageRenderer.gpu = new ScreenVectorGPU(16, 16);
          await world.initialize('main.kcs');
          const top = await world.objects.create({
            kind: 1,
            parent: null,
            nativeID: 0,
            name: 'Separate Top',
          });
          ids.push(
            await world.objects.create({
              kind: 2,
              parent: world.root,
              nativeID: 0x300,
              name: 'Model',
            }),
          );
          aliases.push(
            await world.objects.create({ kind: 2, parent: top, nativeID: 0x300, name: 'Alias' }),
          );
        }
        const compare = async (message, count = 3) =>
          assert.deepEqual(
            await query(worlds[1], ids[1], message, count),
            await query(worlds[0], ids[0], message, count),
            'message ' + message,
          );
        for (let i = 0; i < worlds.length; i++) {
          await send(worlds[i], ids[i], 42, [
            0,
            0,
            0,
            floatBits(6),
            floatBits(5),
            0,
            0,
            0xffc02040,
          ]);
        }
        await compare(61);
        for (let i = 0; i < worlds.length; i++) {
          await send(worlds[i], ids[i], 49, [1, 2, 300].map(floatBits));
          await send(worlds[i], ids[i], 51, [8, 9, 0].map(floatBits));
          await worlds[i].sendEngine(ids[i], worlds[i].main.id, 48, 0, 1);
        }
        for (const message of [61, 62, 75, 76]) await compare(message, message >= 75 ? 6 : 3);
        assert.deepEqual(
          await query(worlds[1], aliases[1], 61),
          await query(worlds[0], aliases[0], 61),
        );
        const tiles = [];
        for (const world of worlds) {
          const id = await world.objects.create({ kind: 2, parent: world.root });
          await send(world, id, 46, [...[1, 2, 0, 4, 3].map(floatBits), 32, 1, 0xffffffff, 2, 1]);
          tiles.push({ id, children: world.objects.children(world.objects.objects.get(id)) });
        }
        assert.equal(tiles[1].children.length, 2);
        assert.equal(tiles[0].children.length, 2);
        for (const moved of [false, true]) {
          if (moved)
            for (let i = 0; i < worlds.length; i++)
              await send(worlds[i], tiles[i].id, 51, [7, 11, 0].map(floatBits));
          for (let child = 0; child < 2; child++)
            for (const message of [61, 62, 75, 76])
              assert.deepEqual(
                await query(worlds[1], tiles[1].children[child].id, message, message >= 75 ? 6 : 3),
                await query(worlds[0], tiles[0].children[child].id, message, message >= 75 ? 6 : 3),
                'tiled child ' + child + '/' + message + '/' + moved,
              );
        }
        assert.deepEqual(
          await query(worlds[1], aliases[1], 75, 6),
          await query(worlds[0], aliases[0], 75, 6),
        );
        for (let i = 0; i < worlds.length; i++) {
          const world = worlds[i],
            id = ids[i];
          world.objects.register(0x7ffd, (record) => ({
            ...world.base(record),
            async tick() {
              const plane = world.graphics.get(id),
                before =
                  i === 0
                    ? world.nativeEngine.process.load(plane.pointer + 120)
                    : plane.state.changed;
              assert.equal(before, 0, 'BasePlane clears its response before children');
              await world.sendEngine(id, record.id, 94, 0, 7);
            },
          }));
          const observer = await world.objects.create({ kind: 0x7ffd, parent: id });
          await world.sendEngine(id, world.main.id, 94, 0, 99);
          await world.tick();
          assert.equal(await world.sendEngine(id, world.main.id, 4), 7);
          assert.equal(await world.sendEngine(id, world.main.id, 4), 0);
          await world.objects.destroy(observer);
        }
        for (let i = 0; i < worlds.length; i++)
          await send(
            worlds[i],
            ids[i],
            79,
            [3, 1, 96, ...[1, 1, 1, 0, 2, 0, 0, 0].map(floatBits), 0, -10],
            1,
          );
        const oldTask = worlds[0].graphics.get(ids[0]),
          p = worlds[0].nativeEngine.process,
          actual = worlds[1].graphics.get(ids[1]),
          compareHistory = () => {
            const pointer = p.load(oldTask.pointer + 320),
              history = actual.state.trail.history;
            for (let i = 0; i < history.length; i++)
              for (const [at, size] of [
                [0, 12],
                [12, 12],
                [28, 12],
                [44, 12],
                [60, 64],
                [124, 4],
              ])
                assert.deepEqual(
                  [...history[i].subarray(at, at + size)],
                  [...p.read(pointer + i * 128 + at, size)],
                  'history ' + i + '/' + at,
                );
          };
        compareHistory();
        for (const x of [12, 17]) {
          for (let i = 0; i < worlds.length; i++) {
            await send(worlds[i], ids[i], 51, [x, 9, 0].map(floatBits));
            await worlds[i].tick();
          }
          compareHistory();
        }
        await worlds[0].objects.destroy(ids[0]);
        await worlds[1].objects.destroy(ids[1]);
        assert.deepEqual(
          await query(worlds[1], aliases[1], 61),
          await query(worlds[0], aliases[0], 61),
        );
      } finally {
        for (const world of worlds) await world.close({ flushFiles: false });
      }
    },
  );
