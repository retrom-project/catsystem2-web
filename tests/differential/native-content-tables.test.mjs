// SPDX-License-Identifier: MPL-2.0
import test from 'node:test';
import assert from 'node:assert/strict';
import { NativeEngineProcess } from '../../src/native/engine-process.mjs';
import { engineFixtureSet } from '../fixtures/oracle-fixtures.mjs';
import { contentFiles } from '../fixtures/content-databases-fixture.mjs';
import { encodeCP932 } from '../../src/kcs/strings.mjs';
import { observeDataSequence } from '../fixtures/data-sequence.mjs';
const text = (value) => [...encodeCP932(value), 0];
for (const fixture of await engineFixtureSet())
  test(
    `${fixture.profile} independent selection and compiled table sequences`,
    { skip: fixture.available ? false : fixture.reason },
    async () => {
      const engine = await NativeEngineProcess.open({
        profile: fixture.profile,
        bytes: fixture.bytes,
      });
      const steps = [
        ...[0x30c, 0x30d, 0x30e, 0x30f, 0x310, 0x33d, 0x33e, 0x33f, 0x340, 0x318, 0x319, 0x31a].map(
          (id) => ({ id, args: [0, 0, 0, 512] }),
        ),
        { id: 0x30b, args: [], create: 'selection', type: 'content-database' },
        ...[
          [100, 'alpha'],
          [101, 'beta'],
          [102, 'gamma'],
          [999, 'alpha'],
          [123, ''],
        ].map(([value, name]) => ({
          id: 0x30d,
          args: ['selection', value, 64],
          write: [[64, text(name)]],
        })),
        { id: 0x30e, args: ['selection', 64], write: [[64, text('selections')]] },
        { id: 0x30f, args: ['selection'] },
        { id: 0x33d, args: ['selection', 1] },
        ...[0, 1, 2, 3, 18, 19, 0xffffffff].map((index) => ({
          id: 0x310,
          args: ['selection', index],
        })),
        { id: 0x33e, args: ['selection', 100, 1] },
        { id: 0x33f, args: ['selection', 0] },
        { id: 0x340, args: ['selection', 2] },
        ...[0, 1, 2, 3, 18, 19, 20, 34, 35].map((index) => ({
          id: 0x310,
          args: ['selection', index],
        })),
        { id: 0x33e, args: ['selection', 100, 2] },
        { id: 0x33d, args: ['selection', 999] },
        { id: 0x310, args: ['selection', 0] },
        { id: 0x30e, args: ['selection', 64], write: [[64, text('badmagic')]] },
        { id: 0x30f, args: ['selection'] },
        { id: 0x30c, args: ['selection'], release: 'selection' },
        {
          id: 0x317,
          args: [64],
          write: [[64, text('questions')]],
          create: 'table',
          type: 'content-database',
        },
        ...['ID', 'Q', 'missing'].flatMap((name) =>
          [0, 1, 3, 0xffffffff].flatMap((row) => [
            { id: 0x319, args: ['table', 64, row], write: [[64, text(name)]] },
            { id: 0x31a, args: ['table', 64, row, 512], write: [[512, new Array(300).fill(0xa5)]] },
          ]),
        ),
        { id: 0x31a, args: ['table', 64, 0, 0xffffffff] },
        { id: 0x318, args: ['table'], release: 'table' },
        ...['badmagic', 'missing'].map((name) => ({
          id: 0x317,
          args: [64],
          write: [[64, text(name)]],
          create: 'invalid',
          type: 'content-database',
        })),
        {
          id: 0x317,
          args: [64],
          write: [[64, text('empty')]],
          create: 'empty',
          type: 'content-database',
        },
        { id: 0x318, args: ['empty'], release: 'empty' },
      ];
      try {
        const files = Object.fromEntries(contentFiles()),
          actual = await observeDataSequence(fixture.profile, steps, { files }),
          expected = await observeDataSequence(fixture.profile, steps, { files, engine });
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
