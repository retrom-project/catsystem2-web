// SPDX-License-Identifier: MPL-2.0
import test from 'node:test';
import assert from 'node:assert/strict';
import { NativeEngineProcess } from '../../src/native/engine-process.mjs';
import { engineFixtureSet } from '../fixtures/oracle-fixtures.mjs';
import { observeDataSequence } from '../fixtures/data-sequence.mjs';
import { encodeHG2 } from '../../src/formats/hg2.mjs';
import { hg3 } from '../helpers.mjs';
const stack = [
  { id: 0x35f, args: [3, 2], create: 's', type: 'record-stack' },
  { id: 0x35f, args: [1, 1], create: 'copy', type: 'record-stack' },
  { id: 0x363, args: ['s'] },
  { id: 0x362, args: ['s', 64] },
  { id: 0x361, args: ['s', 0xffffffff] },
  ...[0, 1, 2].map((i) => ({ id: 0x361, args: ['s', 0], write: [[0, [i, 85 ^ i, 255 - i]]] })),
  { id: 0x364, args: ['copy', 's'] },
  { id: 0x363, args: ['copy'] },
  { id: 0x362, args: ['copy', 64] },
  { id: 0x362, args: ['s', 64] },
  { id: 0x360, args: ['copy'], release: 'copy' },
  { id: 0x360, args: ['s'], release: 's' },
  { id: 0x360, args: [0] },
];
const queue = [
  { id: 0x3f2, args: [3], create: 'q', type: 'record-queue' },
  { id: 0x400, args: [0] },
  { id: 0x400, args: ['q'] },
  { id: 0x3f5, args: ['q', 64] },
  { id: 0x3f4, args: ['q', 0xffffffff] },
  ...[0, 1, 2, 3, 4].map((i) => ({
    id: 0x3f4,
    args: ['q', 0],
    write: [[0, [i, 85 ^ i, 255 - i]]],
  })),
  ...[0, 1, 2, 3, 4, 5].map(() => ({ id: 0x3f5, args: ['q', 64] })),
  { id: 0x400, args: ['q'] },
  { id: 0x3f3, args: ['q'], release: 'q' },
  { id: 0x3f3, args: [0] },
];
for (const fixture of await engineFixtureSet())
  test(
    `${fixture.profile} independent data-container operation sequences`,
    { skip: fixture.available ? false : fixture.reason },
    async (t) => {
      const engine = await NativeEngineProcess.open({
        profile: fixture.profile,
        bytes: fixture.bytes,
      });
      try {
        await t.test('record stack create/push/pop/copy/count/release', async () => {
          assert.deepEqual(
            await observeDataSequence(fixture.profile, stack),
            await observeDataSequence(fixture.profile, stack, { engine }),
          );
        });
        if (fixture.profile === 'nekopara-vol3-engine-2.6.1.76')
          await t.test('record queue create/push/pop/status/release', async () => {
            assert.deepEqual(
              await observeDataSequence(fixture.profile, queue),
              await observeDataSequence(fixture.profile, queue, { engine }),
            );
          });
        for (const format of ['hg2', 'hg3'])
          await t.test(`${format} load/metadata/decode/release`, async () => {
            const rgba = Uint8ClampedArray.from([
                11, 22, 33, 255, 44, 55, 66, 128, 77, 88, 99, 255, 111, 122, 133, 255,
              ]),
              bytes =
                format === 'hg2'
                  ? await encodeHG2(
                      { width: 2, height: 2, rgba, bpp: 4 },
                      { crop: false, clearTransparent: false, id: 0 },
                    )
                  : hg3(2, 2, rgba),
              files = { image: bytes },
              steps = [
                {
                  id: 0x16d,
                  args: [64],
                  write: [[64, [105, 109, 97, 103, 101, 0]]],
                  create: 'image',
                  type: 'image-data',
                },
                { id: 0x170, args: ['image', 0, 256], write: [[256, new Array(40).fill(0xa5)]] },
                { id: 0x170, args: ['image', 99, 256] },
                { id: 0x1af, args: ['image', 256] },
                { id: 0x177, args: [64, 256], write: [[256, new Array(40).fill(0xa5)]] },
                { id: 0x16c, args: ['image', 0], bitmap: true, create: 'bitmap', type: 'bitmap' },
                { id: 0x16c, args: ['image', 99], bitmap: true },
                { id: 0x170, args: ['image', 0, 0xffffffff] },
                { id: 0x170, args: [0, 0, 256] },
                { id: 0x16e, args: ['image'], release: 'image' },
                { id: 0x16e, args: [0] },
              ];
            assert.deepEqual(
              await observeDataSequence(fixture.profile, steps, { files }),
              await observeDataSequence(fixture.profile, steps, { engine, files }),
            );
          });
      } finally {
        await engine.close();
      }
    },
  );
