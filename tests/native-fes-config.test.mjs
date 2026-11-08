// SPDX-License-Identifier: MPL-2.0
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import { createHash } from 'node:crypto';
import {
  NativeFESConfiguration,
  NativeM2Configuration,
  FES_CONFIGURATION_FIELDS,
} from '../src/native/fes-config.mjs';
import { EngineHost } from '../src/host.mjs';
import { FESPlayer } from '../src/fes/player.mjs';
import { memoryGame } from './helpers.mjs';
import {
  fesConfigurationFixture,
  fesConfigurationStrings,
  fesConfigurationStateBytes,
  fesM2Models,
} from './fixtures/fes-config-fixture.mjs';

const golden = JSON.parse(
  await fs.readFile(new URL('fixtures/fes-config-golden.json', import.meta.url)),
);
for (const profile of golden.profiles)
  test(`FES all fields, aliases and events match original ${profile.profile}`, async () => {
    for (const row of profile.cases) {
      const configuration = fesConfigurationFixture(profile.profile),
        writes = [],
        events = [];
      let dirty = 0;
      const service = new NativeFESConfiguration({
        configuration,
        languages: () => 3,
        isWindow: () => 1,
        emit: (event) => {
          events.push(event);
        },
        changed: () => {
          dirty = 1;
        },
      });
      if (row.operation === 'get') {
        const value = service.get(row.name, row.ex1, row.ex2);
        if (value !== undefined)
          writes.push({ bank: typeof value === 'string' ? 'string' : 'number', index: 11, value });
      } else
        await service.set(row.name, row.value, row.ex1, row.ex2, {
          strings: fesConfigurationStrings,
        });
      const actual = {
        writes,
        events,
        dirty,
        stateSHA256: createHash('sha256')
          .update(fesConfigurationStateBytes(configuration))
          .digest('hex'),
      };
      assert.deepEqual(
        actual,
        { writes: row.writes, events: row.events, dirty: row.dirty, stateSHA256: row.stateSHA256 },
        JSON.stringify(row),
      );
    }
  });

test('FES catalogue is exact and unknown fields preserve both numeric and string banks', async () => {
  assert.equal(FES_CONFIGURATION_FIELDS.length, 52);
  const configuration = fesConfigurationFixture(golden.profiles[1].profile),
    m2 = new NativeM2Configuration({ models: ['model'], parts: ['Body'] });
  const service = new NativeFESConfiguration({
    configuration,
    languages: () => 3,
    isWindow: () => 1,
    m2,
  });
  const host = new EngineHost({ world: { fesConfiguration: service } });
  const source = `#START
getconf 1 unknown
getconf 2 font
setconf 3 font
getconf 4 font
getconf 5 wndfram
getconf 6 iswindow
m2_getconf motion 7
m2_getconf unknown 8
m2_setconf motion 0
m2_getconf motion 9
m2_setconf iner_lv 321 Body
m2_getconf iner_lv 10 Body
m2_getconf iner_lv 512 Body
exit 0
`;
  const game = memoryGame({ 'screen.fes': new TextEncoder().encode(source) });
  const player = new FESPlayer(
    game,
    {},
    host,
    { 1: 91, 2: 92, 5: 95 },
    { 1: 'keep', 3: '猫フォント' },
  );
  await player.start('screen');
  player.root.locals[8] = 98;
  await player.step();
  assert.equal(player.globals[1], 91);
  assert.equal(player.strings[1], 'keep');
  assert.equal(player.strings[2], '比較フォント');
  assert.equal(player.globals[2], 92);
  assert.equal(player.strings[4], '猫フォント');
  assert.equal(player.globals[5], 95);
  assert.equal(player.globals[6], 1);
  assert.equal(player.root.locals[7], 1);
  assert.equal(player.root.locals[8], 98);
  assert.equal(player.root.locals[9], 0);
  assert.equal(player.root.locals[10], 200);
  assert.equal(player.root.locals[512], undefined);
  assert.equal(service.getM2('iner_lv', 'absent'), 100);
  assert.equal(service.setM2('iner_lv', 18, 'absent'), true);
  assert.equal(m2.levels.has('absent'), false);
  assert.equal(new NativeFESConfiguration({ configuration }).getM2('motion'), undefined);
  assert.throws(() => new EngineHost({}).config('font'), /native world/);
});

test('M2 reset retains registered parts and loaded models through a checkpoint', () => {
  const a = new NativeM2Configuration({ models: ['left', 'right'], parts: ['Body'] });
  a.set('motion', 0);
  a.set('eff_dif', 5);
  a.set('fade', 3);
  a.set('iner_lv', -10, 'Body');
  a.set('iner_enable', 0, 'Body');
  a.set('interleave', 3);
  const b = new NativeM2Configuration();
  b.restore(a.snapshot());
  assert.deepEqual(b.snapshot(), a.snapshot());
  assert.equal(b.get('motion'), 0);
  assert.equal(b.get('eff_dif'), 1);
  assert.equal(b.get('fade'), 1);
  assert.equal(b.get('iner_lv', 'Body'), 0);
  assert.equal(b.get('iner_enable', 'Body'), 0);
  b.set('reset');
  assert.equal(b.models.size, 2);
  assert.equal(b.levels.size, 1);
  assert.equal(b.get('motion'), 1);
  assert.equal(b.get('fade'), 0);
  assert.equal(b.get('interleave'), 0);
  assert.equal(b.get('iner_lv', 'Body'), 100);
  assert.equal(b.get('iner_enable', 'Body'), 1);
});

test('FES M2 field dispatch, actual RB-tree helpers and local-bank bounds match the original PE', () => {
  const configuration = fesConfigurationFixture(golden.profiles[1].profile);
  for (const row of golden.profiles[1].m2Cases) {
    const m2 = new NativeM2Configuration({ parts: ['Body'] });
    if (row.manager !== 'empty') m2.models = new Map(structuredClone(fesM2Models));
    m2.levels.set('Body', 77);
    m2.enabled.set('Body', 9);
    m2.interleave = 6;
    const service = new NativeFESConfiguration({
      configuration,
      m2: row.manager === 'absent' ? undefined : m2,
    });
    let local = 0x5a5a5a5a;
    if (row.operation === 'get') {
      const value = service.getM2(row.name, row.part);
      if (value !== undefined && (row.index ?? 11) >>> 0 <= 511) local = value >>> 0;
    } else service.setM2(row.name, row.value, row.part);
    assert.deepEqual(
      {
        local,
        models: [...m2.models],
        level: m2.levels.get('Body'),
        enabled: m2.enabled.get('Body'),
        interleave: m2.interleave,
      },
      {
        local: row.local,
        models: row.models,
        level: row.level,
        enabled: row.enabled,
        interleave: row.interleave,
      },
      JSON.stringify(row),
    );
  }
});
