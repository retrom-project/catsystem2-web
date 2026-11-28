// SPDX-License-Identifier: MPL-2.0
import assert from 'node:assert/strict';
import test from 'node:test';
import { readFile } from 'node:fs/promises';
import {
  parseFESToneTable,
  lookupFESToneGroup,
  lookupFESToneFile,
  readFESToneRGB,
  replaceFESToneTable,
  clearFESToneTable,
} from '../src/native/fes-tone-table.mjs';

const ascii = (text) => new TextEncoder().encode(text),
  bytes = (hex) => new Uint8Array(Buffer.from(hex, 'hex')),
  fixture = JSON.parse(await readFile(new URL('./fixtures/fes-tone-table.json', import.meta.url))),
  initial = () => parseFESToneTable(ascii('#Initial(4,5,6)\nold'));

test('authored tone tables match both original ABI query records exactly', async (t) => {
  assert.equal(fixture.profiles.length, 2);
  assert.equal(fixture.cases.length, 17);
  assert.equal(
    fixture.cases.reduce((sum, item) => sum + item.queries.length, 0),
    57,
  );
  for (const item of fixture.cases) {
    await t.test(item.id, () => {
      const table = parseFESToneTable(bytes(item.bodyHex));
      for (const query of item.queries) {
        const key = bytes(query.hex),
          lookup = query.kind === 'group' ? lookupFESToneGroup : lookupFESToneFile,
          found = lookup(table, key);
        assert.equal(found !== null, query.found === 1, query.hex);
        assert.deepEqual(found, query.found ? query.rgb : null, query.hex);
        if (query.kind === 'file')
          assert.deepEqual(readFESToneRGB(table, key), found ?? [100, 100, 100], query.hex);
      }
    });
  }
});

for (const nativeType of [16, 17]) {
  test(`raw${nativeType} releases the old owner before open and accepts an empty file`, async () => {
    const object = { nativeType, toneTable: initial() },
      filename = Uint8Array.of(0x81, 0x41, 0x2e, 0x74, 0x62, 0x6c, 0, 0x58),
      opened = [];
    let finish;
    const pending = replaceFESToneTable(object, filename, async (name, mode) => {
      assert.equal(object.toneTable, null);
      opened.push({ name: name.slice(), mode });
      return await new Promise((resolve) => (finish = resolve));
    });
    assert.equal(object.toneTable, null);
    assert.deepEqual(readFESToneRGB(object.toneTable, ascii('old')), [100, 100, 100]);
    filename[0] = 0x61;
    finish(null);
    assert.equal(await pending, 0);
    assert.equal(object.toneTable, null);
    assert.deepEqual(opened, [
      { name: Uint8Array.of(0x81, 0x41, 0x2e, 0x74, 0x62, 0x6c), mode: 3 },
    ]);
    assert.equal(
      await replaceFESToneTable(object, ascii('empty'), async () => new Uint8Array()),
      1,
    );
    assert.ok(object.toneTable);
    assert.equal(object.toneTable.files.size, 0);
    assert.equal(object.toneTable.groups.size, 0);
    clearFESToneTable(object);
    assert.equal(object.toneTable, null);
  });
}

test('two objects read independently and own different maps even for one filename', async () => {
  const objects = [16, 17].map((nativeType) => ({ nativeType, toneTable: null }));
  let calls = 0;
  const read = async (name, mode) => {
    assert.deepEqual(name, ascii('same-file'));
    assert.equal(mode, 3);
    return ascii(`#A(${++calls},2,3)\nfile`);
  };
  for (const object of objects)
    assert.equal(await replaceFESToneTable(object, ascii('same-file'), read), 1);
  assert.equal(calls, 2);
  assert.notEqual(objects[0].toneTable, objects[1].toneTable);
  assert.notEqual(objects[0].toneTable.files, objects[1].toneTable.files);
  assert.deepEqual(readFESToneRGB(objects[0].toneTable, ascii('file')), [1, 2, 3]);
  assert.deepEqual(readFESToneRGB(objects[1].toneTable, ascii('file')), [2, 2, 3]);
  clearFESToneTable(objects[0]);
  assert.deepEqual(readFESToneRGB(objects[1].toneTable, ascii('file')), [2, 2, 3]);
});

test('current maps and byte keys restore by structured clone without resource access', () => {
  const source = bytes('234128312c322c33290a814158'),
    object = {
      nativeType: 16,
      fileBytes: Uint8Array.of(0x81, 0x41, 0x78),
      toneTable: parseFESToneTable(source),
    },
    snapshot = structuredClone(object),
    restored = structuredClone(snapshot);
  source.fill(0);
  object.fileBytes.fill(0);
  object.toneTable.files.clear();
  object.toneTable.groups.clear();
  assert.deepEqual(readFESToneRGB(restored.toneTable, restored.fileBytes), [1, 2, 3]);
  const result = readFESToneRGB(restored.toneTable, restored.fileBytes);
  result[0] = 999;
  assert.deepEqual(readFESToneRGB(restored.toneTable, restored.fileBytes), [1, 2, 3]);
  clearFESToneTable(restored);
  assert.deepEqual(readFESToneRGB(snapshot.toneTable, snapshot.fileBytes), [1, 2, 3]);
});

test('resource rejection retains the released state and invalid providers are not empty files', async () => {
  const object = { nativeType: 16, toneTable: initial() },
    failure = new Error('authored provider failure');
  await assert.rejects(
    replaceFESToneTable(object, ascii('bad'), async () => {
      throw failure;
    }),
    failure,
  );
  assert.equal(object.toneTable, null);
  object.toneTable = initial();
  await assert.rejects(
    replaceFESToneTable(object, ascii('bad'), async () => undefined),
    TypeError,
  );
  assert.equal(object.toneTable, null);
});

test('header-only groups are absent; queries are byte C-strings and return independent defaults', () => {
  const table = parseFESToneTable(ascii('#A(1,2,3)\n#B(4,5,6)\nfile'));
  assert.equal(lookupFESToneGroup(table, ascii('#A')), null);
  assert.deepEqual(lookupFESToneGroup(table, ascii('#B\0ignored')), [4, 5, 6]);
  assert.deepEqual(lookupFESToneFile(table, ascii('FILE\0other')), [4, 5, 6]);
  const result = readFESToneRGB(null, ascii('file'));
  result[0] = 0;
  assert.deepEqual(readFESToneRGB(null, ascii('file')), [100, 100, 100]);
  assert.throws(() => readFESToneRGB(table, 'file'), TypeError);
});

test('defined 511-byte keys work and unsafe native buffer overflow is rejected explicitly', () => {
  const group = '#' + 'A'.repeat(510),
    file = 'F'.repeat(511),
    table = parseFESToneTable(ascii(`${group}(1,2,3)\n${file}`));
  assert.deepEqual(lookupFESToneFile(table, ascii(file)), [1, 2, 3]);
  assert.deepEqual(lookupFESToneGroup(table, ascii(group)), [1, 2, 3]);
  for (const source of [
    '#' + 'A'.repeat(511) + '(1,2,3)\nf',
    '#A(' + '1'.repeat(512) + ',2,3)\nf',
    'F'.repeat(512),
  ])
    assert.throws(() => parseFESToneTable(ascii(source)), RangeError);
  assert.throws(() => lookupFESToneFile(table, ascii('F'.repeat(512))), RangeError);
});

test('service does not own unsupported raw types or mutate their prior state', async () => {
  const table = initial(),
    object = { nativeType: 18, toneTable: table };
  let opened = false;
  await assert.rejects(
    replaceFESToneTable(object, ascii('x'), async () => {
      opened = true;
      return null;
    }),
    TypeError,
  );
  assert.equal(opened, false);
  assert.equal(object.toneTable, table);
  assert.throws(() => clearFESToneTable(object), TypeError);
});

test('Buffer and Uint8Array lookup keys retain their exact caller bytes', () => {
  const table = parseFESToneTable(ascii('#G(1,2,3)\nUP\n'));
  for (const make of [Buffer.from, (source) => new Uint8Array(source)]) {
    const filename = make(ascii('UP')),
      group = make(ascii('#G'));
    assert.deepEqual(lookupFESToneFile(table, filename), [1, 2, 3]);
    assert.deepEqual([...filename], [85, 80]);
    assert.deepEqual(lookupFESToneGroup(table, group), [1, 2, 3]);
    assert.deepEqual([...group], [35, 71]);
    assert.deepEqual(readFESToneRGB(table, filename), [1, 2, 3]);
    assert.deepEqual([...filename], [85, 80]);
  }
});

test('resource filenames are independent plain bytes while asynchronous reads wait', async () => {
  for (const make of [Buffer.from, (source) => new Uint8Array(source)]) {
    const filename = make(Uint8Array.of(0x81, 0x7f, 0x58, 0, 0x59)),
      object = { nativeType: 16, toneTable: null };
    let retained, finish;
    const pending = replaceFESToneTable(object, filename, (name, mode) => {
      retained = name;
      assert.equal(mode, 3);
      return new Promise((resolve) => {
        finish = resolve;
      });
    });
    assert.equal(Object.getPrototypeOf(retained), Uint8Array.prototype);
    filename.fill(0);
    assert.deepEqual(retained, Uint8Array.of(0x81, 0x7f, 0x58));
    retained[0] = 0x80;
    assert.deepEqual([...filename], [0, 0, 0, 0, 0]);
    finish(new Uint8Array());
    assert.equal(await pending, 1);
  }
});
