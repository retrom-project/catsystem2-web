// SPDX-License-Identifier: MPL-2.0
import test from 'node:test';
import assert from 'node:assert/strict';
import { dataWorld } from '../fixtures/data-world.mjs';
import { textLogFixture } from '../fixtures/text-log-fixture.mjs';
import { engineFixtureSet } from '../fixtures/oracle-fixtures.mjs';
import { encodeDisplayLog } from '../../src/native/text-log.mjs';

for (const fixture of await engineFixtureSet())
  test(
    fixture.profile +
      ' JS display log tables, byte wrapping, CSS encoding and pruning equal original sequences',
    { skip: fixture.available ? false : fixture.reason },
    async () => {
      const world = await dataWorld(fixture.profile),
        oracle = await textLogFixture(fixture),
        m = world.main.machine,
        om = oracle.machine,
        task = world.main;
      om.memory.set(m.memory);
      const run = async (id, args) => {
        const a = await world.runtime.native('main', id, args[0], m, task),
          b = await oracle.logs.apply(id, args[1], om, task);
        if (id === 0x2b8) return [a.value, b.value];
        assert.deepEqual(a, b, id.toString(16));
        assert.deepEqual(m.memory, om.memory, 'VM');
      };
      try {
        for (const options of [
          {},
          { col: 12, prof: 4, escape: 0, nameFirst: '[', nameLast: ']', space: 1 },
          { col: 16, prof: 4, nameline: 0, nameindent: 2, crNext: 1 },
        ]) {
          Object.assign(world.configuration.fields.log, options);
          Object.assign(oracle.world.configuration.fields.log, options);
          oracle.engine.configurationMemory.push();
          const hs = await run(0x2b8, [[], []]);
          let block = 0;
          for (const [name, text, paragraph] of [
            ['Speaker', 'Alpha.', 0],
            ['Very long authored speaker name', 'X', 0],
            ['Speaker', 'Alpha.', 0],
            ['名', '猫と日本語の台詞。次の行', 1],
            ['', 'a\\nB\\@C\\r\\nD', 1],
            ['', '[base/reading] end', 1],
            ['', '（猫）「名前」！！！！', 0],
            ['', '', 0],
            ['Only', '', 0],
            ['', 'tail', 0],
          ]) {
            m.writeString('Scene', 128);
            om.writeString('Scene', 128);
            m.writeString(name, 256);
            om.writeString(name, 256);
            m.writeString(text, 512);
            om.writeString(text, 512);
            const args = [128, block++, 256, 512, block % 2, paragraph, block + 3];
            await run(
              0x3d1,
              hs.map((h) => [h, ...args]),
            );
            assert.deepEqual(
              encodeDisplayLog(world.displayLogs.get(hs[0])),
              await oracle.bytes(hs[1]),
              JSON.stringify(options) + ' ' + name + '/' + text,
            );
          }
          for (const limit of [3, 1, 0, -1]) {
            await run(
              0x311,
              hs.map((h) => [h, limit]),
            );
            assert.deepEqual(
              encodeDisplayLog(world.displayLogs.get(hs[0])),
              await oracle.bytes(hs[1]),
              'limit ' + limit,
            );
          }
          await run(
            0x36c,
            hs.map((h) => [h]),
          );
          assert.deepEqual(
            encodeDisplayLog(world.displayLogs.get(hs[0])),
            await oracle.bytes(hs[1]),
            'clear retains counters',
          );
          await run(
            0x2b9,
            hs.map((h) => [h]),
          );
        }
        assert.equal(world.nativeEngine, undefined);
      } finally {
        await world.close();
        await oracle.engine.close();
      }
    },
  );

import { NativeSceneData } from '../../src/native/scene-data.mjs';
import { NativeVariableBank } from '../../src/native/bank.mjs';
import { NativeStringBank } from '../../src/native/string-bank.mjs';
import { encodeCP932 } from '../../src/kcs/strings.mjs';
import { u32, translation } from '../helpers.mjs';
function scene(blocks) {
  const strings = [],
    offsets = [],
    table = [];
  for (const block of blocks) {
    table.push(block.length, offsets.length);
    for (const [type, text] of block) {
      offsets.push(strings.length);
      strings.push(1, type, ...encodeCP932(text), 0);
    }
  }
  const index = table.length * 4,
    body = Uint8Array.from([
      ...[
        index + offsets.length * 4 + strings.length,
        blocks.length,
        index,
        index + offsets.length * 4,
        ...table,
        ...offsets,
      ].flatMap(u32),
      ...strings,
    ]);
  return Uint8Array.from([
    ...new TextEncoder().encode('CatScene'),
    ...u32(0),
    ...u32(body.length),
    ...body,
  ]);
}
for (const fixture of await engineFixtureSet())
  test(
    fixture.profile + ' JS history rebuild uses current strings and exact raw/UTF8 log bytes',
    { skip: fixture.available ? false : fixture.reason },
    async () => {
      const files = {
        'story.cst': scene([
          [
            [0x21, '名前＠Speaker'],
            [0x20, '猫 $str7。'],
            [2, ''],
          ],
          [
            [0x30, 'vo sound.wav'],
            [0x30, 'par 1'],
            [0x21, '次'],
            [0x20, 'Second $str7.'],
            [3, ''],
          ],
        ]),
        'sound.wav': new Uint8Array(),
        'story.cstl': translation(
          ['ja', 'en'],
          [
            { ja: ['ja-name', 'ja-message'], en: ['en-name', 'en-message'] },
            { ja: ['ja2', 'ja-message2'], en: ['en2', 'en-message2'] },
          ],
        ),
      };
      const world = await dataWorld(fixture.profile, files),
        originalLookups = {
          variableBank: world.runtime.variableBank,
          stringBank: world.runtime.stringBank,
        },
        oracle = await textLogFixture(fixture),
        m = world.main.machine,
        om = oracle.machine,
        task = world.main,
        bank = new NativeStringBank(),
        data = new NativeSceneData();
      world.game.readCategory = (name, category) =>
        Promise.resolve(
          files[category === 'scene' && !name.includes('.') ? name + '.cst' : name] ?? null,
        );
      oracle.world.game.readCategory = world.game.readCategory;
      world.runtime.stringBank = oracle.world.runtime.stringBank = () => bank;
      const variables = new NativeVariableBank();
      variables.initialize(64);
      world.runtime.variableBank = oracle.world.runtime.variableBank = () => variables;
      data.history.appendPath('story', 2);
      const sceneHandles = [
          world.runtime.handles.add('scene-data', data),
          oracle.world.runtime.handles.add('scene-data', data),
        ],
        handles = [
          (await world.runtime.native('main', 0x2b8, [], m, task)).value,
          (await oracle.logs.apply(0x2b8, [], om, task)).value,
        ];
      try {
        for (const value of ['CURRENT', 'CHANGED'])
          for (const id of fixture.profile.startsWith('sdk-') ? [0x2bb] : [0x2bb, 0x40a]) {
            bank.set(7, value);
            for (const machine of [m, om]) {
              machine.writeString('vo', 128);
              machine.writeString('par', 192);
              machine.writeString('en', 256);
            }
            const args = [
              handles.map((h, i) => [h, sceneHandles[i], 128, 192, ...(id === 0x40a ? [256] : [])]),
            ];
            await world.runtime.native('main', id, args[0][0], m, task);
            await oracle.logs.apply(id, args[0][1], om, task);
            assert.deepEqual(
              encodeDisplayLog(world.displayLogs.get(handles[0])),
              await oracle.bytes(handles[1]),
              id.toString(16) + ' ' + value,
            );
          }
        if (!fixture.profile.startsWith('sdk-')) {
          for (const names of [
            ['en', 'ja'],
            ['en', null],
            [null, 'ja'],
            [null, null],
          ]) {
            const p = oracle.process,
              langs = names.map((name) => {
                if (name === null) return 0;
                const at = p.allocate(name.length + 1, true);
                p.write(at, encodeCP932(name + '\0'));
                return at;
              });
            try {
              await world.displayLogs.remake(world.displayLogs.get(handles[0]), ...names);
              await oracle.engine.call(0x72fc50, langs, oracle.logs.pointer(handles[1]));
              const deque = p.load(oracle.logs.pointer(handles[1]) + 20),
                map = p.load(deque + 4),
                mask = p.load(deque + 8) - 1,
                start = p.load(deque + 12),
                rows = world.displayLogs.get(handles[0]).rows;
              for (let i = 0; i < rows.length; i++) {
                const raw = p.load(map + 4 * ((start + i) & mask)),
                  string = (at) => p.read(p.load(at + 20) < 16 ? at : p.load(at), p.load(at + 16));
                assert.deepEqual(rows[i].first, string(raw + 4), 'remake main ' + names + '/' + i);
                assert.deepEqual(
                  rows[i].second,
                  string(raw + 28),
                  'remake secondary ' + names + '/' + i,
                );
              }
            } finally {
              for (const at of langs) if (at) p.free(at);
            }
          }
        }
        assert.equal(world.nativeEngine, undefined);
      } finally {
        if (typeof originalLookups !== 'undefined') Object.assign(world.runtime, originalLookups);
        await world.close();
        await oracle.engine.close();
      }
    },
  );
