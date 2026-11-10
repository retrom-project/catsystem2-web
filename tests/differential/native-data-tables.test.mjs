// SPDX-License-Identifier: MPL-2.0
import test from 'node:test';
import assert from 'node:assert/strict';
import { NativeEngineProcess } from '../../src/native/engine-process.mjs';
import { nativeABI } from '../../src/native/abi/index.mjs';
import { encodeCP932 } from '../../src/kcs/strings.mjs';
import { engineFixtureSet } from '../fixtures/oracle-fixtures.mjs';
import { nameTableFiles } from '../fixtures/name-table-fixture.mjs';
import { sectionFiles } from '../fixtures/section-table-fixture.mjs';
import { observeDataSequence } from '../fixtures/data-sequence.mjs';
const text = (value) => [...encodeCP932(value), 0];
async function compare(profile, engine, steps, files) {
  const actual = await observeDataSequence(profile, steps, { files }),
    expected = await observeDataSequence(profile, steps, { files, engine });
  assert.equal(actual.length, expected.length);
  actual.forEach((value, i) =>
    assert.deepEqual(value, expected[i], `${i} native ${steps[i].id.toString(16)}`),
  );
}
for (const fixture of await engineFixtureSet())
  test(
    `${fixture.profile} independent data-table sequences`,
    { skip: fixture.available ? false : fixture.reason },
    async (t) => {
      const engine = await NativeEngineProcess.open({
        profile: fixture.profile,
        bytes: fixture.bytes,
      });
      try {
        await t.test('name table byte rows, aliases, filename rules and release', async () => {
          const files = Object.fromEntries(
              [...nameTableFiles()].map(([name, bytes]) => [
                name.replace(/^@cat\/fes\//, ''),
                bytes,
              ]),
            ),
            steps = [
              {
                id: 0x279,
                args: [64],
                write: [[64, text('names.tsv')]],
                create: 'table',
                type: 'nametable',
              },
              ...['猫', 'Same', 'Dup', 'Hex', 'missing'].map((name) => ({
                id: 0x27b,
                args: ['table', 128],
                write: [[128, text(name)]],
              })),
              ...[0, 4, 5, 0xffffffff].map((index) => ({ id: 0x27c, args: ['table', index] })),
              { id: 0x27d, args: ['table', 0, 512], write: [[512, new Array(64).fill(0xa5)]] },
              ...[0, 1, 2].map((field) => ({ id: 0x27e, args: ['table', 0, field, 512] })),
              { id: 0x27e, args: ['table', 0, 0, 0xffffffff] },
              ...['bga.hg2', 'bg001.hg2', 'bgA.HG2'].map((name) => ({
                id: 0x27f,
                args: ['table', 0, 128],
                write: [[128, text(name)]],
              })),
              { id: 0x280, args: ['table', 0, 128, 512], write: [[128, text('abc123,tail')]] },
              { id: 0x280, args: ['table', 2, 128, 128], write: [[128, text('song.ogg')]] },
              { id: 0x27a, args: ['table'], release: 'table' },
              { id: 0x27a, args: [0] },
              {
                id: 0x279,
                args: [64],
                write: [[64, text('quoted.tsv')]],
                create: 'quoted',
                type: 'nametable',
              },
              { id: 0x27d, args: ['quoted', 0, 512] },
              { id: 0x27e, args: ['quoted', 0, 0, 512] },
              { id: 0x27e, args: ['quoted', 0, 1, 512] },
              { id: 0x27a, args: ['quoted'], release: 'quoted' },
            ];
          await compare(fixture.profile, engine, steps, files);
        });
        await t.test('section repeated keys, comments, byte outputs and release', async () => {
          const files = Object.fromEntries(sectionFiles()),
            steps = [
              {
                id: 0x2ab,
                args: [64],
                write: [[64, text('basic.txt')]],
                create: 'table',
                type: 'section-table',
              },
              ...[0, 1, 2, 3, 0xffffffff].map((ordinal) => ({
                id: 0x2ad,
                args: ['table', 128, 256, ordinal, 512],
                write: [
                  [128, text('#first')],
                  [256, text('key')],
                  [512, new Array(128).fill(0xa5)],
                ],
              })),
              { id: 0x2ad, args: ['table', 128, 256, 0, 512], write: [[256, text('comment')]] },
              { id: 0x2ad, args: ['table', 128, 256, 0, 0xffffffff] },
              { id: 0x2ac, args: ['table'], release: 'table' },
              {
                id: 0x2ab,
                args: [64],
                write: [[64, text('empty.txt')]],
                create: 'empty',
                type: 'section-table',
              },
              { id: 0x2ad, args: ['empty', 128, 256, 0, 512] },
              { id: 0x2ac, args: ['empty'], release: 'empty' },
            ];
          await compare(fixture.profile, engine, steps, files);
        });
        await t.test(
          'XML open, duplicate nodes, integer defaults, raw text and release',
          async () => {
            const encoding = nativeABI(fixture.profile).xmlEncoding,
              xml = `<?xml version="1.0" encoding="${encoding}"?><root><i>0x12</i><i>-7</i><text>日本語 &amp; literal</text></root>`,
              files = {
                'probe.xml':
                  encoding === 'UTF-8' ? new TextEncoder().encode(xml) : encodeCP932(xml),
              },
              steps = [
                {
                  id: 0x24e,
                  args: [64],
                  write: [[64, text('probe.xml')]],
                  create: 'xml',
                  type: 'xml',
                },
                { id: 0x250, args: ['xml', 123, 128], write: [[128, text('root/i')]] },
                { id: 0x250, args: ['xml', 123, 128], write: [[128, text('missing')]] },
                {
                  id: 0x251,
                  args: ['xml', 512, 128],
                  write: [
                    [128, text('root/text')],
                    [512, new Array(128).fill(0xa5)],
                  ],
                },
                { id: 0x251, args: ['xml', 512, 128], write: [[128, text('missing')]] },
                { id: 0x24f, args: ['xml'], release: 'xml' },
                { id: 0x250, args: [0, 123, 128] },
              ];
            await compare(fixture.profile, engine, steps, files);
          },
        );
      } finally {
        await engine.close();
      }
    },
  );
