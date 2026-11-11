// SPDX-License-Identifier: MPL-2.0
import test from 'node:test';
import assert from 'node:assert/strict';
import { NativeFESData } from '../src/native/fes-data.mjs';
import { FESPlayer } from '../src/fes/player.mjs';
import { encodeCP932 } from '../src/kcs/strings.mjs';
import { memoryGame } from './helpers.mjs';
import { readFile } from 'node:fs/promises';
const oracle = JSON.parse(
  await readFile(new URL('./fixtures/fes-string-table.json', import.meta.url), 'utf8'),
);
import { fesStringTableCell } from '../src/native/fes-string-table.mjs';

const source = `#DEFINE
STRTABLE words
#OBJECT FILE
words words.tsv
#START
words get 7 0 10 20
words get 7 1 11 21
words get -3 0 12 22
words get 0x10 0 13 23
words get 0 0 14 24
words get 7 2 10 25
words get 99 0 11 26
next WAIT
#WAIT
#QUERY
words get (6 + 1) (2 - 1) 15 27
`;
async function fixture(bytes) {
  const cells = new Map(),
    reads = [],
    game = memoryGame({ 'data.fes': encodeCP932(source) }),
    world = {
      profile: 'nekopara-vol3-engine-2.6.1.76',
      objects: { objects: new Map([[42, { context: { stringBank: 1 } }]]) },
      runtime: {
        async read(file, category) {
          reads.push([file, category]);
          return bytes;
        },
        handles: { get: () => ({ setBytes: (index, value) => cells.set(index, value.slice()) }) },
      },
      getNativeFeature() {
        throw new Error('STRTABLE must not request the EXE');
      },
    },
    service = new NativeFESData(world),
    player = new FESPlayer(game, {}, {});
  player.nativeData = service;
  await player.start('data');
  player.root.runtimeID = 42;
  await service.initialize(player.root, player.root.byKey.get('words'));
  return { player, world, service, cells, reads };
}

test('STRTABLE uses original byte cells, first duplicate rows and native numeric row IDs without an EXE', async () => {
  const bytes = Uint8Array.from([
      ...encodeCP932(
        '7\talpha\t"Hello, quoted"\r\n7\treplaced\r\n-3\tnegative\r\n0x10\thex\r\ninvalid\t',
      ),
      0xff,
      0xfe,
      ...encodeCP932('\r\n'),
    ]),
    f = await fixture(bytes);
  await f.player.step();
  assert.deepEqual(f.reads, [['words.tsv', 'config']]);
  const rows = f.player.root.byKey.get('words').nativeDataState.rows;
  assert.equal(rows.length, oracle.rowCount);
  for (const sample of oracle.queries) {
    const cell = fesStringTableCell(rows, sample.row, sample.column);
    assert.equal(Number(cell !== null), sample.result);
    assert.deepEqual([...(cell ?? encodeCP932('untouched'))], sample.bytes);
  }

  assert.deepEqual([...f.cells.keys()], [10, 11, 12, 13, 14]);
  assert.equal(new TextDecoder().decode(f.cells.get(10)), 'alpha');
  assert.equal(new TextDecoder().decode(f.cells.get(11)), 'Hello, quoted');
  assert.deepEqual(f.cells.get(14), Uint8Array.of(0xff, 0xfe));
  assert.deepEqual(
    [20, 21, 22, 23, 24, 25, 26].map((n) => f.player.globals[n]),
    [1, 1, 1, 1, 1, 0, 0],
  );
  const restored = await fixture(null);
  await restored.player.restore(f.player.snapshot());
  restored.player.root.runtimeID = 42;
  await restored.player.notify('QUERY');
  assert.equal(new TextDecoder().decode(restored.cells.get(15)), 'Hello, quoted');
  assert.equal(restored.player.globals[27], 1);
  assert.deepEqual(
    restored.reads,
    [['words.tsv', 'config']],
    'restore and later queries retain saved rows',
  );
});

test('STRTABLE lookup failure preserves output and a missing string bank reports failure', async () => {
  const f = await fixture(null);
  f.cells.set(10, encodeCP932('untouched'));
  await f.player.step();
  assert.equal(new TextDecoder().decode(f.cells.get(10)), 'untouched');
  assert.equal(f.player.globals[20], 0);
  f.world.objects.objects.get(42).context.stringBank = 0;
  f.player.root.byKey.get('words').nativeDataState.rows = [[7, [encodeCP932('found')]]];
  await f.service.command(f.player.root, f.player.root.byKey.get('words'), 'get', [
    '7',
    '0',
    '10',
    '28',
  ]);
  assert.equal(f.player.globals[28], 0);
  assert.equal(new TextDecoder().decode(f.cells.get(10)), 'untouched');
});
