// SPDX-License-Identifier: MPL-2.0
import test from 'node:test';
import assert from 'node:assert/strict';
import { NativeEngineProcess } from '../../src/native/engine-process.mjs';
import { engineFixtureSet } from '../fixtures/oracle-fixtures.mjs';
import { observeDataSequence } from '../fixtures/data-sequence.mjs';
for (const fixture of await engineFixtureSet())
  test(
    fixture.profile + ' independent JS raw heap, CSS records and dictionary memory',
    { skip: fixture.available ? false : fixture.reason },
    async () => {
      const engine = await NativeEngineProcess.open({
        profile: fixture.profile,
        bytes: fixture.bytes,
      });
      const bytes = [7, 8, 9, 10, 11, 12, 13, 14],
        steps = [
          { id: 0x342, args: [0] },
          { id: 0x343, args: [0, 0, 8, 0] },
          { id: 0x344, args: [0, 0, 1024] },
          { id: 0xee, args: [17], create: 'file', type: 'global-file' },
          {
            id: 0x341,
            args: [8],
            pointer: 'raw',
            rawRanges: [{ name: 'raw', offset: -4, size: 4 }],
          },
          {
            id: 0x343,
            args: ['file', 7, 8, 'raw'],
            writeRaw: [['raw', 0, bytes]],
            rawRanges: [{ name: 'raw', size: 8 }],
          },
          {
            id: 0x344,
            args: ['file', 7, 1024],
            pointer: 'copy',
            rawRanges: [{ name: 'copy', size: 8 }],
          },
          { id: 0x344, args: ['file', 8, 1024], pointer: 'missing' },
          { id: 0x342, args: ['raw'] },
          { id: 0x342, args: ['copy'] },
          { id: 0xf6, args: ['file'], release: 'file' },
          { id: 0x37e, args: [], create: 'dictionary', type: 'dictionary' },
          { id: 0x380, args: ['dictionary', 64, 42], write: [[64, [97, 98, 99, 0]]] },
          { id: 0x383, args: ['dictionary'], capture: 'size' },
          { id: 0x341, args: ['size'], pointer: 'packed' },
          {
            id: 0x384,
            args: ['dictionary', 'packed'],
            writeRaw: [['packed', 0, new Array(12).fill(0xa5)]],
            rawRanges: [{ name: 'packed', size: 12 }],
          },
          { id: 0x37e, args: [], create: 'peer', type: 'dictionary' },
          { id: 0x385, args: ['peer', 'packed'] },
          { id: 0x381, args: ['peer', 64] },
          { id: 0x342, args: ['packed'] },
          { id: 0x37f, args: ['peer'], release: 'peer' },
          { id: 0x37f, args: ['dictionary'], release: 'dictionary' },
          {
            id: 0x341,
            args: [0],
            pointer: 'zero',
            rawRanges: [{ name: 'zero', offset: -4, size: 4 }],
          },
          { id: 0x342, args: ['zero'] },
        ];
      try {
        const actual = await observeDataSequence(fixture.profile, steps),
          expected = await observeDataSequence(fixture.profile, steps, { engine });
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
