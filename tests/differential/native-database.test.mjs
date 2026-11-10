// SPDX-License-Identifier: MPL-2.0
import test from 'node:test';
import assert from 'node:assert/strict';
import { NativeEngineProcess } from '../../src/native/engine-process.mjs';
import { engineFixtureSet } from '../fixtures/oracle-fixtures.mjs';
import { compiledDatabase, DATABASE_ROWS } from '../fixtures/database-fixture.mjs';
import { observeDataSequence } from '../fixtures/data-sequence.mjs';
import { encodeCP932 } from '../../src/kcs/strings.mjs';
const text = (value) => [...encodeCP932(value), 0];
for (const fixture of await engineFixtureSet())
  test(
    `${fixture.profile} independent compiled database flag sequence`,
    { skip: fixture.available ? false : fixture.reason },
    async () => {
      const engine = await NativeEngineProcess.open({
          profile: fixture.profile,
          bytes: fixture.bytes,
        }),
        files = {
          authored: compiledDatabase([
            ...DATABASE_ROWS,
            { ID: 4, INDEX: 'がゃっ' },
            { ID: 5, INDEX: 'かやつ' },
          ]),
        },
        setup = async (world, engine, values) => {
          const memory = engine ? engine.process : world.runtime.imageDataBuffers.process,
            at = memory.allocate(2048);
          memory.write(at, new Uint8Array(2048).fill(0xa5));
          values.set('raw', at + 16);
          if (!engine) world.runtime.services.dataBuffers = () => world.runtime.imageDataBuffers;
          return () => memory.free(at);
        },
        steps = [
          {
            id: 0x365,
            args: [64, 128, 128, 128],
            write: [
              [64, text('authored')],
              [128, [0]],
            ],
            create: 'db',
            type: 'database',
          },
          { id: 0x368, args: ['db', 0] },
          ...['alpha', 'がゃっ', 'missing'].map((name) => ({
            id: 0x367,
            args: ['db', 31, 256],
            write: [[256, text(name)]],
          })),
          { id: 0x36d, args: ['db'] },
          { id: 0x368, args: ['db', 'raw'] },
          { id: 0x36e, args: ['db'] },
          { id: 0x367, args: ['db', 31, 256], write: [[256, text('alpha')]] },
          { id: 0x36d, args: ['db'] },
          {
            id: 0x369,
            args: ['db', 'raw'],
            writeRaw: [
              ['raw', 4, text('がゃっ')],
              ['raw', 4 + 256, [7, 0, 0, 0, 9, 0, 0, 0, 11, 0, 0, 0]],
            ],
          },
          { id: 0x368, args: ['db', 'raw'] },
          { id: 0x369, args: ['db', 0] },
          { id: 0x366, args: ['db'], release: 'db' },
          { id: 0x368, args: [0, 0] },
          { id: 0x369, args: [0, 0] },
        ];
      try {
        const options = { files, setup, rawRanges: [{ name: 'raw', offset: -16, size: 2048 }] },
          actual = await observeDataSequence(fixture.profile, steps, options),
          expected = await observeDataSequence(fixture.profile, steps, { ...options, engine });
        actual.forEach((value, i) =>
          assert.deepEqual(value, expected[i], `${i} native ${steps[i].id.toString(16)}`),
        );
      } finally {
        await engine.close();
      }
    },
  );
