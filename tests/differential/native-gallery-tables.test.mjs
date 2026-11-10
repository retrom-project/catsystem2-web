// SPDX-License-Identifier: MPL-2.0
import test from 'node:test';
import assert from 'node:assert/strict';
import { NativeEngineProcess } from '../../src/native/engine-process.mjs';
import { engineFixtureSet } from '../fixtures/oracle-fixtures.mjs';
import { observeDataSequence } from '../fixtures/data-sequence.mjs';
import { galleryTableFiles } from '../fixtures/gallery-table-fixture.mjs';
const text = (value) => [...new TextEncoder().encode(value), 0];
for (const fixture of await engineFixtureSet())
  test(
    fixture.profile + ' independent gallery binary tables and references',
    { skip: fixture.available ? false : fixture.reason },
    async () => {
      const engine = await NativeEngineProcess.open({
        profile: fixture.profile,
        bytes: fixture.bytes,
      });
      const steps = [
        {
          id: 0x195,
          args: [64],
          write: [[64, text('variants2')]],
          create: 'variants',
          type: 'gallery-table',
        },
        { id: 0x197, args: ['variants'] },
        ...[0, 1, 4, 19, 20, 0xffffffff].flatMap((group) => [
          { id: 0x198, args: ['variants', group] },
          { id: 0x199, args: ['variants', group, 0] },
          { id: 0x19a, args: ['variants', group, 0] },
          { id: 0x19b, args: ['variants', group, 0, 0, 0, 512] },
        ]),
        ...[
          [1, 1, 0],
          [2, 0, 512],
          [3, 0, 512],
          [0, 2, 512],
          [16, 16, 512],
          [0, 0, 0xffffffff],
        ].map(([first, second, destination]) => ({
          id: 0x19b,
          args: ['variants', 0, 0, first, second, destination],
          write: [[512, new Array(80).fill(0xa5)]],
        })),
        { id: 0x196, args: ['variants'], release: 'variants' },
        {
          id: 0x195,
          args: [64],
          write: [[64, text('missing')]],
          create: 'empty',
          type: 'gallery-table',
        },
        { id: 0x197, args: ['empty'] },
        { id: 0x196, args: ['empty'], release: 'empty' },
        {
          id: 0x19c,
          args: [64],
          write: [[64, text('names1')]],
          create: 'names',
          type: 'gallery-table',
        },
        { id: 0x19e, args: ['names'] },
        ...[
          [0, 0],
          [1, 0],
          [2, 0],
          [2, 3],
          [3, 0],
          [0, 4],
          [0xffffffff, 0],
        ].flatMap(([row, column]) => [
          { id: 0x19f, args: ['names', row, column] },
          {
            id: 0x1a0,
            args: ['names', row, column, 512],
            write: [[512, new Array(128).fill(0xa5)]],
          },
        ]),
        { id: 0x1a0, args: ['names', 1, 0, 0xffffffff] },
        { id: 0x19d, args: ['names'], release: 'names' },
        {
          id: 0x19c,
          args: [64],
          write: [[64, text('names2')]],
          create: 'signed',
          type: 'gallery-table',
        },
        { id: 0x19e, args: ['signed'] },
        { id: 0x19f, args: ['signed', 0, 0] },
        { id: 0x19d, args: ['signed'], release: 'signed' },
        {
          id: 0x19c,
          args: [64],
          write: [[64, text('missing')]],
          create: 'missing',
          type: 'gallery-table',
        },
        ...Array.from({ length: 11 }, (_, index) => 0x196 + index)
          .filter((id) => id !== 0x19c)
          .map((id) => ({ id, args: [0, 0, 0, 0, 0, 512] })),
      ];
      try {
        const options = { files: Object.fromEntries(galleryTableFiles()) },
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
