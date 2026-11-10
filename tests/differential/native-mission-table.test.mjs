// SPDX-License-Identifier: MPL-2.0
import test from 'node:test';
import assert from 'node:assert/strict';
import { NativeEngineProcess } from '../../src/native/engine-process.mjs';
import { encodeCP932 } from '../../src/kcs/strings.mjs';
import { engineFixtureSet } from '../fixtures/oracle-fixtures.mjs';
import {
  contentFiles,
  contentDatabase,
  MISSION_ROWS,
  MISSION_CONDITION_ROWS,
  MISSION_COLUMNS,
} from '../fixtures/content-database-data.mjs';
import { observeDataSequence } from '../fixtures/data-sequence.mjs';
const text = (value) => [...encodeCP932(value), 0];
for (const fixture of await engineFixtureSet())
  test(
    fixture.profile + ' independent mission conditions, progress and raw save sequences',
    { skip: fixture.available ? false : fixture.reason },
    async () => {
      const engine = await NativeEngineProcess.open({
        profile: fixture.profile,
        bytes: fixture.bytes,
      });
      const files = Object.fromEntries(contentFiles());
      files.missions = contentDatabase(
        MISSION_ROWS.map((row) => ({ ...row, CHAR: '[0]' })),
        MISSION_COLUMNS,
      );
      files.conditions = contentDatabase(
        [
          ...MISSION_ROWS,
          ...MISSION_CONDITION_ROWS,
          {
            TBL: 50,
            TYPE: 1,
            LV_MIN: 0,
            LV_MAX: 99,
            KEY: 0xffffffff,
            COND: 1,
            CPARAM: '[-1][2]',
            CHAR: '[1,0,1]',
          },
        ],
        MISSION_COLUMNS,
      );
      const steps = [
        ...Array.from({ length: 33 }, (_, index) => ({
          id: 0x31c + index,
          args:
            index + 0x31c === 0x323
              ? [0, 10, 1024, 1040]
              : [0, 0, 1024, 1040, 1056, 1072, 1088, 1104],
        })),
        {
          id: 0x31b,
          args: [64],
          write: [[64, text('missions')]],
          create: 'mission',
          type: 'content-database',
        },
        { id: 0x335, args: ['mission'] },
        { id: 0x31d, args: ['mission', 7] },
        { id: 0x31e, args: ['mission'] },
        { id: 0x31f, args: ['mission', 2] },
        { id: 0x320, args: ['mission'] },
        { id: 0x32f, args: ['mission'] },
        { id: 0x330, args: ['mission', 128, 2], write: [[128, [1, 0, 0, 0, 2, 0, 0, 0]]] },
        ...[0, 1, 2, 0xffffffff].flatMap((tag) => [
          { id: 0x331, args: ['mission', tag, 0] },
          { id: 0x332, args: ['mission', tag] },
          { id: 0x333, args: ['mission', tag] },
        ]),
        ...[10, 999].flatMap((id) => [
          { id: 0x324, args: ['mission', id, 512] },
          ...[0, 1, 3, 4].map((index) => ({ id: 0x326, args: ['mission', id, index, 512] })),
          ...[0, 1, 19, 20].map((index) => ({ id: 0x325, args: ['mission', id, index] })),
          ...Array.from({ length: 13 }, (_, selector) => ({
            id: 0x334,
            args: ['mission', id, selector, 768],
          })),
          { id: 0x339, args: ['mission', id, 0, 0] },
          { id: 0x33a, args: ['mission', id] },
        ]),
        { id: 0x321, args: ['mission', 10] },
        { id: 0x323, args: ['mission', 10, 1024, 1040] },
        { id: 0x322, args: ['mission', 1024, 1024, 0, 100] },
        ...[0, 19, 20].flatMap((index) => [
          { id: 0x327, args: ['mission', index, 1] },
          { id: 0x32b, args: ['mission', index, 5] },
          { id: 0x32c, args: ['mission', index, 7] },
          { id: 0x32d, args: ['mission', index] },
          { id: 0x32e, args: ['mission', index, 1024, 1040, 1056, 1072, 1088, 1104] },
        ]),
        { id: 0x328, args: ['mission', 0xffffffff] },
        { id: 0x329, args: ['mission', 10] },
        { id: 0x32a, args: ['mission', 10, 3] },
        { id: 0x33b, args: ['mission'] },
        { id: 0x33c, args: ['mission'] },
        { id: 0x336, args: ['mission'] },
        { id: 0x337, args: ['mission', 0], capture: 'size' },
        { id: 0x337, args: ['mission', 'raw'] },
        { id: 0x338, args: ['mission', 'raw', 'size'], writeRaw: [['raw', 48, [9, 0, 0, 0]]] },
        { id: 0x323, args: ['mission', 10, 1024, 1040] },
        { id: 0x338, args: ['mission', 0, 0] },
        { id: 0x31c, args: ['mission'], release: 'mission' },
        {
          id: 0x31b,
          args: [64],
          write: [[64, text('conditions')]],
          create: 'conditions',
          type: 'content-database',
        },
        { id: 0x335, args: ['conditions'] },
        { id: 0x31d, args: ['conditions', 0] },
        { id: 0x32f, args: ['conditions'] },
        { id: 0x330, args: ['conditions', 0, 0] },
        ...[200, 201, 202, 203].map((id) => ({ id: 0x334, args: ['conditions', id, 6, 768] })),
        ...[0, 1].flatMap((round) => [
          { id: 0x31d, args: ['conditions', 2] },
          { id: 0x31f, args: ['conditions', round ? 3 : 0] },
          ...[0, 1].flatMap((index) => [
            { id: 0x32b, args: ['conditions', index, round ? 4 : 0] },
            { id: 0x32c, args: ['conditions', index, round ? 2 : 0] },
            { id: 0x327, args: ['conditions', index, round] },
          ]),
          ...(round
            ? [
                { id: 0x321, args: ['conditions', 10] },
                { id: 0x321, args: ['conditions', 20] },
                { id: 0x321, args: ['conditions', 100] },
                { id: 0x321, args: ['conditions', 102] },
              ]
            : []),
          { id: 0x32f, args: ['conditions'] },
          { id: 0x330, args: ['conditions', 0, 0] },
          ...[50, 100, 101, 102, 103, 104, 105, 106, 107, 108, 109, 110, 111].map((id) => ({
            id: 0x334,
            args: ['conditions', id, 6, 768],
          })),
        ]),
        { id: 0x339, args: ['conditions', 50, 0, 0] },
        { id: 0x339, args: ['conditions', 50, 0, 1] },
        { id: 0x339, args: ['conditions', 50, 2, 0] },
        { id: 0x31c, args: ['conditions'], release: 'conditions' },
      ];
      async function setup(world, oracle, values) {
        const memory = oracle ? oracle.process : world.runtime.imageDataBuffers.process,
          base = memory.allocate(4096);
        memory.write(base, new Uint8Array(4096).fill(0xa5));
        values.set('raw', base + 16);
        return () => memory.free(base);
      }
      try {
        const options = { files, setup, rawRanges: [{ name: 'raw', offset: -16, size: 4096 }] },
          actual = await observeDataSequence(fixture.profile, steps, options),
          expected = await observeDataSequence(fixture.profile, steps, { ...options, engine });
        actual.forEach((value, index) =>
          assert.deepEqual(
            value,
            expected[index],
            `${index} native ${steps[index].id.toString(16)}`,
          ),
        );
      } finally {
        await engine.close();
      }
    },
  );
