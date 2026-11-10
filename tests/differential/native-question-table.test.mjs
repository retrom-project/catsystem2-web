// SPDX-License-Identifier: MPL-2.0
import test from 'node:test';
import assert from 'node:assert/strict';
import { NativeEngineProcess } from '../../src/native/engine-process.mjs';
import { NativeRandomMemory } from '../../src/native/random-memory.mjs';
import { encodeCP932 } from '../../src/kcs/strings.mjs';
import { engineFixtureSet } from '../fixtures/oracle-fixtures.mjs';
import {
  contentFiles,
  contentDatabase,
  QUESTION_COLUMNS,
  QUESTION_ROWS,
} from '../fixtures/content-database-data.mjs';
import { observeDataSequence } from '../fixtures/data-sequence.mjs';
const text = (value) => [...encodeCP932(value), 0];
for (const fixture of await engineFixtureSet())
  test(
    fixture.profile + ' independent question state, pool, RNG and raw serialization',
    { skip: fixture.available ? false : fixture.reason },
    async () => {
      const engine = await NativeEngineProcess.open({
        profile: fixture.profile,
        bytes: fixture.bytes,
      });
      const files = Object.fromEntries(contentFiles());
      files.many = contentDatabase(
        Array.from({ length: 45 }, (_, index) => ({
          ...QUESTION_ROWS[0],
          G_A: 1,
          G_B: 1,
          G_C: 1,
          ID: index + 1,
          Q: `Question ${index}`,
        })),
        QUESTION_COLUMNS,
      );
      files.corrupt = files.questions.slice();
      files.corrupt[12] ^= 0xff;
      files.ranges = encodeCP932(
        '#ranges\nCNT 9\nBG "quoted file.png"\nNORMA 3\nDISABLE 1 3\nMEMBER 0\nPARTNER 1\n$GEN\nGENRE_A 1-2\nGENRE_B @\nGENRE_C @\nDISABLE 2\n',
      );
      const steps = [
        ...Array.from({ length: 36 }, (_, index) => ({
          id: 0x2e7 + index,
          args: [0, 512, 768, 1024, 1040],
        })),
        { id: 0x2e6, args: [], create: 'question', type: 'content-database' },
        ...[
          [0x2e8, 'questions'],
          [0x2e8, 'questions'],
          [0x2ee, 'configurations'],
          [0x2ef, 'alpha'],
        ].map(([id, name]) => ({ id, args: ['question', 64], write: [[64, text(name)]] })),
        ...[0, 1, 2, 19, 20, 0xffffffff].map((member) => ({
          id: 0x306,
          args: ['question', member],
        })),
        { id: 0x2fc, args: ['question'] },
        ...[0x2e9, 0x2f0, 0x2f1, 0x2f3, 0x2f4, 0x2f8, 0x2f9, 0x2fa, 0x307].map((id) => ({
          id,
          args: ['question'],
        })),
        { id: 0x2f2, args: ['question', 512] },
        { id: 0x2f5, args: ['question', 768] },
        { id: 0x2f6, args: ['question', 1024, 1024] },
        { id: 0x2fb, args: ['question', 1024, 1040, 1056, 1072] },
        ...[0, 1, 2, 19, 20, 0xffffffff].map((member) => ({
          id: 0x2f7,
          args: ['question', member],
        })),
        ...Array.from({ length: 4 }, () => [
          { id: 0x2fd, args: ['question'] },
          ...[0, 1, 3, 0xffffffff].flatMap((index) => [
            { id: 0x2eb, args: ['question', index] },
            { id: 0x2ea, args: ['question', index, 512] },
            { id: 0x2ec, args: ['question', index, 3, 768] },
            { id: 0x2ed, args: ['question', index] },
            { id: 0x2fe, args: ['question', index] },
            { id: 0x303, args: ['question', index] },
            { id: 0x304, args: ['question', index] },
            { id: 0x308, args: ['question', index, 1024] },
          ]),
        ]).flat(),
        { id: 0x2ff, args: ['question', 0] },
        { id: 0x2ff, args: ['question', 'raw'] },
        { id: 0x300, args: ['question', 'raw'] },
        ...[0x301, 0x302, 0x305].map((id) => ({ id, args: ['question'] })),
        { id: 0x2ee, args: ['question', 64], write: [[64, text('ranges')]] },
        { id: 0x2ef, args: ['question', 64], write: [[64, text('ranges')]] },
        { id: 0x2f2, args: ['question', 512] },
        { id: 0x309, args: ['question', 1, 2] },
        { id: 0x309, args: ['question', 2, 3] },
        { id: 0x2fc, args: ['question'] },
        { id: 0x2fd, args: ['question'] },
        { id: 0x2ea, args: ['question', 0, 512] },
        { id: 0x30a, args: ['question'] },
        { id: 0x2e7, args: ['question'], release: 'question' },
        { id: 0x2e6, args: [], create: 'large', type: 'content-database' },
        { id: 0x2e8, args: ['large', 64], write: [[64, text('many')]] },
        { id: 0x2fc, args: ['large'] },
        { id: 0x2ff, args: ['large', 'raw'] },
        {
          id: 0x300,
          args: ['large', 'raw'],
          writeRaw: Array.from({ length: 45 }, (_, index) => [
            'raw',
            12 + 88 * index + 68 + 12,
            [index % 4, 0, 0, 0, index % 3 === 0 ? 1 : 0, 0, 0, 0],
          ]),
        },
        ...Array.from({ length: 4 }, () => [
          { id: 0x2fd, args: ['large'], capture: 'drawn' },
          { id: 0x308, args: ['large', 0, 512] },
          { id: 0x2ea, args: ['large', 'drawn', 768] },
        ]).flat(),
        { id: 0x2e7, args: ['large'], release: 'large' },
        { id: 0x2e6, args: [], create: 'invalid', type: 'content-database' },
        { id: 0x2e8, args: ['invalid', 64], write: [[64, text('corrupt')]] },
        { id: 0x2e8, args: ['invalid', 64], write: [[64, text('missing')]] },
        { id: 0x2e8, args: ['invalid', 64], write: [[64, text('empty')]] },
        { id: 0x2fc, args: ['invalid'] },
        { id: 0x2fd, args: ['invalid'] },
        { id: 0x2e7, args: ['invalid'], release: 'invalid' },
      ];
      async function setup(world, oracle, values) {
        const raw = oracle ? oracle.process : world.runtime.imageDataBuffers.process,
          base = raw.allocate(4096);
        raw.write(base, new Uint8Array(4096).fill(0xa5));
        values.set('raw', base + 16);
        if (oracle) new NativeRandomMemory(oracle, world.random);
        else world.runtime.services.dataBuffers = () => world.runtime.imageDataBuffers;
        return () => raw.free(base);
      }
      try {
        const options = {
          files,
          setup,
          random: true,
          rawRanges: [{ name: 'raw', offset: -16, size: 4096 }],
        };
        const actual = await observeDataSequence(fixture.profile, steps, options),
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
