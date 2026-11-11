// SPDX-License-Identifier: MPL-2.0
import test from 'node:test';
import assert from 'node:assert/strict';
import {
  FESImageTable,
  parseFESImageCSV,
  mergeFESSectionReferences,
} from '../src/native/fes-image-table-model.mjs';
import { encodeCP932 } from '../src/kcs/strings.mjs';
import { NativeGraphicsPacket } from '../src/native/graphics-task.mjs';
import { floatBits } from '../src/kcs.mjs';
import { dataWorld } from './fixtures/data-world.mjs';
import { hg3 } from './helpers.mjs';

const decoder = new TextDecoder('shift_jis');
const text = (bytes) => (bytes === null ? null : decoder.decode(bytes));
const csvText = (bytes) => parseFESImageCSV(encodeCP932(bytes)).map((row) => row.map(text));

// Independently authored bytes and expected selections from native-fes-images.
function backgrounds() {
  const bytes = new Uint8Array(4 + 2 * 128),
    view = new DataView(bytes.buffer);
  view.setUint32(0, 2, true);
  [
    ['authored', 'second', '', 'authored'],
    ['second', '', 'authored', ''],
  ].forEach((row, i) =>
    row.forEach((name, variant) => bytes.set(encodeCP932(name), 4 + i * 128 + variant * 32)),
  );
  return bytes;
}
function characters() {
  const bytes = new Uint8Array(20 * 8 * 540),
    view = new DataView(bytes.buffer);
  for (const [character, name, variants] of [
    [0, 'authored', 2],
    [1, 'second', 1],
  ]) {
    const at = character * 8 * 540;
    view.setUint32(at, 1, true);
    bytes.set(encodeCP932(name), at + 4);
    view.setUint32(at + 20, variants, true);
    view.setUint32(at + 280, 1, true);
  }
  return bytes;
}
function characterTree(nodes) {
  const entries = nodes.map((node) => {
    const children = node.children ? characterTree(node.children) : new Uint8Array();
    const bytes = new Uint8Array(112 + children.length),
      view = new DataView(bytes.buffer);
    view.setUint32(4, children.length ? 112 : 0, true);
    view.setUint32(8, 100, true);
    view.setUint32(12, node.id, true);
    bytes.set(encodeCP932(node.prefix || ''), 48);
    bytes.set(encodeCP932(node.mask || ''), 80);
    bytes.set(children, 112);
    return bytes;
  });
  const bytes = new Uint8Array(entries.reduce((size, entry) => size + entry.length, 0));
  let at = 0;
  entries.forEach((entry, index) => {
    new DataView(entry.buffer).setUint32(0, index + 1 < entries.length ? entry.length : 0, true);
    bytes.set(entry, at);
    at += entry.length;
  });
  return bytes;
}
const authoredTree = () =>
  characterTree([
    {
      id: 0,
      children: [
        {
          id: 0,
          children: [
            {
              id: 0,
              children: [
                { id: 0, prefix: 'authored' },
                { id: 1, prefix: 'second' },
                { id: 2, prefix: 'merged', mask: '1@2' },
              ],
            },
          ],
        },
      ],
    },
  ]);
const authoredSections = () =>
  encodeCP932(
    '#_TOP_\r\nauthored A\r\nsecond B\r\nmerged,1,@ MASK\r\n#A\r\n@ FINAL\r\nchanged STOP\r\n#B\r\n@ FINAL\r\n#MASK\r\n@,@,2 END\r\n',
  );
const authoredCSV = () =>
  encodeCP932(
    'ignored,header,second,authored\r\n○,one,authored,second,,authored\r\n○,two,second,,authored,\r\n',
  );

test('BGTABLE frozen two-row fixture retains distinct miss/empty/variant gates', () => {
  const table = new FESImageTable(16, backgrounds());
  assert.equal(table.max([]), 2);
  let selected = table.select([0, 1]);
  assert.equal(text(selected), 'second');
  for (const selectors of [
    [-1, 0],
    [2, 0],
    [0, 4],
    [0, 2],
    [0, -1],
  ]) {
    const next = table.select(selectors);
    assert.equal(next, null);
    if (next !== null) selected = next;
  }
  assert.equal(text(selected), 'second');
  assert.equal(text(table.select([0, 0])), 'authored');
  assert.throws(() => table.select([0]), /complete/);
});

test('BGTABLE2 frozen CSV fixture counts only marker rows and retains actual empty fields', () => {
  const table = new FESImageTable(17, authoredCSV());
  assert.equal(table.max([]), 2);
  assert.equal(text(table.select([0, 1])), 'second');
  for (const selectors of [
    [-1, 0],
    [2, 0],
    [0, 4],
    [0, 2],
  ])
    assert.equal(table.select(selectors), null);
  assert.equal(text(table.select([0, 0])), 'authored');
  assert.equal(text(table.select([1, 2])), 'authored');
});

test('BGTABLE2 uses signed column=variant+2 rather than a shared four-variant range', () => {
  const table = new FESImageTable(17, encodeCP932('○,description,a,b,c,d,e\n'));
  assert.equal(text(table.select([0, -1])), 'description');
  assert.equal(text(table.select([0, -2])), '○');
  assert.equal(table.select([0, -3]), null);
  assert.equal(text(table.select([0, 4])), 'e');
  assert.equal(table.select([0, 5]), null);
});

test('CSV parser follows 7282E0 quotes, newlines, discarded tails and empty final columns', () => {
  assert.deepEqual(csvText('a,,b,\r\n\r\n"a,b","c""d","line\r\nbreak"tail,last\n'), [
    ['a', '', 'b'],
    [],
    ['a,b', 'c"d', 'linebreak', 'last'],
  ]);
  assert.deepEqual(csvText('a"ignored",b\n"unterminated\r\nnext'), [
    ['a', 'b'],
    ['unterminatednext'],
  ]);
  assert.deepEqual(csvText('○,label,"a  b\t//c/*d*/"\n'), [['○', 'label', 'a  b\t//c/*d*/']]);
  assert.throws(() => parseFESImageCSV(Uint8Array.of(65, 0, 66)), /embedded NUL/);
});

test('CSV marker comparison is exact and comments remain field data', () => {
  const table = new FESImageTable(
    17,
    encodeCP932('//,comment,no\n ○,spaced,no\n"○",quoted,"path,1"\n○,plain,a/*b*/c\n'),
  );
  assert.equal(table.max([]), 2);
  assert.equal(text(table.select([0, 0])), 'path,1');
  assert.equal(text(table.select([1, 0])), 'a/*b*/c');
});

test('CHTABLE frozen character/pose/two-bank fixture keeps its own ranges and max modes', () => {
  const table = new FESImageTable(18, characters());
  assert.deepEqual(
    [[0], [1, 0], [2, 0, 0], [3, 0, 0]].map((query) => table.max(query)),
    [2, 1, 2, 1],
  );
  assert.equal(text(table.select([1, 0, 0, 0])), 'second');
  for (const selector of [
    [-1, 0, 0, 0],
    [2, 0, 0, 0],
    [20, 0, 0, 0],
    [1, 1, 0, 0],
    [1, 8, 0, 0],
    [1, 0, 1, 0],
    [1, 0, 16, 0],
    [1, 0, 0, 1],
    [1, 0, 0, 16],
  ])
    assert.equal(table.select(selector), null);
  assert.equal(text(table.select([0, 0, 1, 0])), 'authored');
  assert.throws(() => table.select([0, 0]), /complete/);
  assert.throws(() => table.max([]), /CHTABLE max/);
});

test('CHTABLE merges both fixed variant banks with zero-transparent bytes', () => {
  const bytes = characters();
  bytes.set(Uint8Array.of(49, 0, 50, 48), 24);
  bytes.set(Uint8Array.of(48, 51, 0, 52), 284);
  assert.equal(text(new FESImageTable(18, bytes).select([0, 0, 0, 0])), 'authored,1,3,2,4');
});

test('CHTABLE2 frozen tree fixture preserves max, hard miss and lower partial success', () => {
  const table = new FESImageTable(19, authoredTree());
  assert.deepEqual(
    [[], [0], [0, 0], [0, 0, 0]].map((query) => table.max(query)),
    [1, 1, 1, 3],
  );
  assert.equal(text(table.select([0, 0, 1])), 'second');
  assert.equal(table.select([9, 0, 0]), null);
  assert.equal(table.select([0, 9, 0]), null);
  table.setBaseOption(encodeCP932('_alt'));
  assert.equal(text(table.select([0, 0, 0])), 'authored_alt');
  assert.equal(text(table.select([0, 0, 9])), '_alt');
  assert.equal(text(table.select([0, 0, 2])), 'merged_alt,1,0,2');
  assert.throws(() => table.select([0]), /complete/);
});

test('CHTABLE2 matches IDs, prepends wire siblings and retains duplicates in max counts', () => {
  const table = new FESImageTable(
    19,
    characterTree([
      {
        id: 7,
        children: [
          {
            id: 9,
            children: [
              {
                id: 0,
                children: [
                  { id: 3, prefix: 'first' },
                  { id: 3, prefix: 'last' },
                ],
              },
            ],
          },
        ],
      },
    ]),
  );
  assert.equal(table.max([7, 9, 0]), 2);
  assert.equal(text(table.select([7, 9, 3])), 'last');
  assert.equal(table.select([0, 0, 0]), null, 'IDs are not row ordinals');
});

test('CHTABLE2 bank selection accumulates prefix once, overlays mask0, and skips missing banks', () => {
  const table = new FESImageTable(
    19,
    characterTree([
      {
        id: 0,
        children: [
          {
            id: 0,
            children: [
              { id: 0, children: [{ id: 2, prefix: '@', mask: '12' }] },
              { id: 1, children: [{ id: 3, prefix: 'base', mask: '@0@' }] },
              { id: 3, children: [{ id: 5, prefix: 'ignored', mask: '@@4' }] },
            ],
          },
        ],
      },
    ]),
  );
  table.setBaseOption(encodeCP932('_alt'));
  assert.equal(text(table.select([0, 0, 2, 3, 99, 5])), 'base_alt,1,0,4');
  assert.equal(
    text(table.select([0, 0, 2])),
    '@_alt,1,2',
    'prefix@ is not globally zeroed in CHTABLE2',
  );
  assert.equal(
    new FESImageTable(19, characterTree([{ id: 0, children: [{ id: 0 }] }])).select([0, 0]),
    null,
  );
});

test('CHTABLE2 base option appends to the entire prefix rather than using CHTABLE3 comma insertion', () => {
  const table = new FESImageTable(
    19,
    characterTree([
      {
        id: 0,
        children: [
          { id: 0, children: [{ id: 0, children: [{ id: 0, prefix: 'base,1', mask: '2' }] }] },
        ],
      },
    ]),
  );
  table.setBaseOption(encodeCP932('_alt'));
  assert.equal(text(table.select([0, 0, 0])), 'base,1_alt,2');
});

test('CHTABLE3 frozen section fixture preserves max, replacement, partial and empty success', () => {
  const table = new FESImageTable(20, authoredSections());
  assert.deepEqual(
    [[], [0], [0, 0], [9]].map((query) => table.max(query)),
    [3, 2, 0, 0],
  );
  assert.equal(text(table.select([1, 0])), 'second');
  table.setBaseOption(encodeCP932('_alt'));
  assert.equal(text(table.select([0, 1])), 'changed');
  assert.equal(text(table.select([0, 9])), 'authored');
  assert.equal(text(table.select([2, 0])), 'merged_alt,1,2');
  assert.equal(text(table.select([9])), '');
  assert.notEqual(table.select([9]), null);
  assert.equal(text(table.select([])), '');
  assert.equal(new FESImageTable(20, encodeCP932('#OTHER\na b\n')).select([0]), null);
});

test('CHTABLE3 raw reader ignores space-only blank rows but preserves tabs, comments and semicolon rows', () => {
  const table = new FESImageTable(
    20,
    encodeCP932(
      '#_TOP_\n\n   \n\t\n// comment\n/* block */\n; comment\nreal NEXT //suffix\n#NEXT\ntail END\n',
    ),
  );
  assert.equal(table.max([]), 5);
  assert.equal(text(table.select([0])), '\t');
  assert.equal(text(table.select([1])), '//');
  assert.equal(text(table.select([2])), '/*');
  assert.equal(text(table.select([3])), ';');
  assert.equal(table.max([4]), 1);
  assert.equal(text(table.select([4, 0])), 'tail');
});

test('CHTABLE3 section keys are raw and repeated nonempty sections keep the first', () => {
  const table = new FESImageTable(
    20,
    encodeCP932('#_TOP_\nfirst A\n#_TOP_\nsecond B\n#A \nwrong END\n#A\nright END\n'),
  );
  assert.equal(table.max([]), 1);
  assert.equal(text(table.select([0, 0])), 'right');
  assert.equal(new FESImageTable(20, encodeCP932(' #_TOP_\na A\n')).select([0]), null);
  const empty = new FESImageTable(20, encodeCP932('#_TOP_\n   \n#OTHER\na A\n'));
  assert.equal(empty.select([0]), null, 'empty sections are not inserted into the original map');
});

test('CHTABLE3 pre-header rows belong to the empty-name section; TAB is not a field delimiter', () => {
  const table = new FESImageTable(20, encodeCP932('preamble END\n#_TOP_\nauthored\nname\tNEXT\n'));
  assert.equal(table.max([0]), 1);
  assert.equal(text(table.select([0, 0])), 'preamble');
  assert.equal(text(table.select([1])), 'name\tNEXT');
});

test('CHTABLE3 merge discards empty comma tokens and treats only an exact@ as a placeholder', () => {
  assert.equal(
    text(mergeFESSectionReferences(encodeCP932('base,,1'), encodeCP932('@,,2'))),
    'base,2',
  );
  assert.equal(
    text(mergeFESSectionReferences(encodeCP932('base,1,2'), encodeCP932('@'))),
    'base,1,2',
  );
  assert.equal(text(mergeFESSectionReferences(new Uint8Array(), encodeCP932('@,1'))), '@,1');
  assert.equal(
    text(mergeFESSectionReferences(encodeCP932('base,1'), encodeCP932('@x,0,3'))),
    '@x,0,3',
  );
});

test('CHTABLE3 final placeholder replacement is byte-blind, including baseopt and CP932 trail0x40', () => {
  const table = new FESImageTable(20, encodeCP932('#_TOP_\nァ,1 END\n'));
  table.setBaseOption(encodeCP932('_@alt'));
  assert.deepEqual([...table.select([0])], [0x83, 0x30, 95, 48, 97, 108, 116, 44, 49]);
  table.setBaseOption(null);
  assert.deepEqual([...table.select([0])], [0x83, 0x30, 44, 49]);
});

test('binary malformed bounds/cycles stay visible instead of yielding fake successful defaults', () => {
  assert.throws(() => new FESImageTable(19, new Uint8Array(12)), /complete/);
  const unterminated = characterTree([{ id: 0 }]);
  unterminated.fill(65, 48, 80);
  assert.throws(() => new FESImageTable(19, unterminated), /native stack boundary/);
  const bytes = characterTree([{ id: 0 }, { id: 1 }]);
  new DataView(bytes.buffer).setInt32(112 + 4, -112, true);
  assert.throws(() => new FESImageTable(19, bytes), /cycle/);
  assert.throws(() => new FESImageTable(99, new Uint8Array()), /not implemented/);
});

const sampleTables = () => [
  [16, backgrounds(), [0, 1]],
  [17, authoredCSV(), [0, 1]],
  [18, characters(), [1, 0, 0, 0]],
  [19, authoredTree(), [0, 0, 1]],
  [20, authoredSections(), [1, 0]],
];
test('snapshots restore each distinct semantic model without re-reading resource bytes', () => {
  for (const [type, bytes, selectors] of sampleTables()) {
    const table = new FESImageTable(type, bytes),
      snapshot = table.snapshot();
    if (type >= 19) table.setBaseOption(encodeCP932('_alt'));
    bytes.fill(0);
    const restored = FESImageTable.restore(snapshot);
    assert.equal(text(restored.select(selectors)), 'second');
    assert.deepEqual(restored.snapshot(), snapshot);
    const selected = restored.select(selectors);
    selected.fill(0);
    assert.equal(
      text(restored.select(selectors)),
      'second',
      'selection output is independently owned',
    );
  }
});

for (const profile of ['sdk-4.01-engine-2.6.1.74', 'nekopara-vol3-engine-2.6.1.76'])
  test(`${profile} selected original filenames feed real JS image decode/Draw and a fresh World without table files`, async () => {
    const pixels = Uint8Array.of(
      14,
      91,
      207,
      255,
      24,
      101,
      217,
      255,
      34,
      111,
      227,
      255,
      44,
      121,
      237,
      255,
    );
    const world = await dataWorld(profile, { 'second.hg3': hg3(2, 2, pixels) });
    let fresh;
    try {
      const tables = sampleTables().map(([type, bytes, selectors]) => [
        new FESImageTable(type, bytes),
        selectors,
      ]);
      const filename = text(tables[0][0].select(tables[0][1]));
      for (const [table, selectors] of tables)
        assert.equal(text(table.select(selectors)), filename);
      const handle = await world.graphics.images.load(`${filename}.hg3`, 0, world.main.id);
      assert.deepEqual(new Uint8Array(await world.graphics.images.get(handle).pixels()), pixels);
      const drawId = await world.objects.create({ kind: 15, parent: world.main.id });
      await world.sendEngine(drawId, world.main.id, 279, 8, 6);
      await world.sendEngine(drawId, world.main.id, 283, 0, 0);
      await world.sendEngine(drawId, world.main.id, 280, 0, 0, {
        payload: new NativeGraphicsPacket([
          handle,
          0,
          0,
          0,
          floatBits(1),
          floatBits(1),
          0,
          0,
          0,
          floatBits(1),
          floatBits(1),
          255,
          1,
          0,
          0,
        ]),
      });
      const draw = world.graphics.drawTasks.get(drawId);
      await draw.render();
      const output = (await world.graphics.images.get(draw.state.renderer.bitmap).pixels()).slice();
      assert.ok(output.some((byte) => byte));
      const models = tables.map(([table]) => table.snapshot()),
        saved = structuredClone(world.snapshot());
      fresh = await dataWorld(profile, {}, { initialize: false });
      await fresh.restore(saved);
      const restoredModels = models.map(FESImageTable.restore);
      restoredModels.forEach((table, index) =>
        assert.equal(text(table.select(tables[index][1])), 'second'),
      );
      const freshDraw = fresh.graphics.drawTasks.get(drawId);
      await freshDraw.render();
      assert.deepEqual(
        await fresh.graphics.images.get(freshDraw.state.renderer.bitmap).pixels(),
        output,
      );
      assert.deepEqual(new Uint8Array(await fresh.graphics.images.get(handle).pixels()), pixels);
      assert.ok(!world.nativeEngine && !fresh.nativeEngine, 'no original engine is loaded');
    } finally {
      await fresh?.close();
      await world.close();
    }
  });
