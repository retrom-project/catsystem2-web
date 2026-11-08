// SPDX-License-Identifier: MPL-2.0
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { NativeResourceSearch, nativeUpdatePriority } from '../src/native/resource-search.mjs';
import { GameFiles, BlobFile } from '../src/files.mjs';
import { kif } from './helpers.mjs';
const text = (value) => new TextEncoder().encode(value);

test('all 108 original search dispatches and 105 update priorities preserve their candidates and results', async () => {
  const golden = JSON.parse(
      await readFile(
        new URL('./fixtures/native-resource-search-golden.json', import.meta.url),
        'utf8',
      ),
    ),
    a = {
      name: 'a.int',
      entries: new Map([
        ['same.bin', 11],
        ['only-a.bin', 12],
      ]),
    },
    b = {
      name: 'b.int',
      entries: new Map([
        ['same.bin', 21],
        ['only-b.bin', 22],
      ]),
    },
    update = { name: 'update01.int', entries: new Map([['same.bin', 31]]) },
    search = new NativeResourceSearch({
      archives: new Map([
        ['a.int', a],
        ['b.int', b],
      ]),
      loose: new Map([
        ['same.bin', 100],
        ['loose-a/same.bin', 101],
        ['loose-b/same.bin', 102],
        ['list-a/same.bin', 111],
        ['list-b/same.bin', 112],
        ['list-b/only-b.bin', 113],
      ]),
      directories: new Set(['loose-a', 'loose-b', 'list-a', 'list-b']),
      lists: new Map(),
      mounts: [
        { archive: 'a.int', directory: 'loose-a' },
        { archive: 'b.int', directory: 'loose-b' },
      ],
    });
  // These are the typed counterparts of the original probe's linked group
  // and row records; slot registration is separately exercised below.
  search.groups.set('images.lst', [
    { slot: 0, directory: 'list-a', directoryExists: true },
    { slot: 1, directory: 'list-b', directoryExists: true },
  ]);
  for (const row of golden.results) {
    search.overrides = row.override ? [update] : [];
    let value = null;
    const attempts = [];
    for (const candidate of search.candidates(row.path, row.mode)) {
      const archive =
        candidate.kind === 'loose'
          ? -1
          : ['a.int', 'b.int', 'update01.int'].indexOf(candidate.archive);
      attempts.push([archive, candidate.path]);
      if (candidate.hit !== null) {
        value = candidate.hit;
        break;
      }
    }
    assert.deepEqual(
      { value, attempts },
      { value: row.value, attempts: row.attempts },
      JSON.stringify(row),
    );
  }
  for (const { name, value } of golden.priorities)
    assert.equal(nativeUpdatePriority(name), value, name);
});

async function mounted(files = {}) {
  const startup =
      '<?xml version="1.0" encoding="UTF-8"?><document><INT><int00><name>image</name><int>images.lst</int><ext>bin</ext><dir>images</dir></int00></INT></document>',
    input = {
      'startup.xml': text(startup),
      'images.lst': text('list-a/a.int\r\nlist-b/b.int\r\nnone/a.int\r\n'),
      'a.int': kif([
        ['same.bin', Uint8Array.of(11)],
        ['only-a.bin', Uint8Array.of(12)],
      ]),
      'b.int': kif([
        ['same.bin', Uint8Array.of(21)],
        ['only-b.bin', Uint8Array.of(22)],
      ]),
      'list-a/same.bin': Uint8Array.of(111),
      'list-b/same.bin': Uint8Array.of(112),
      'list-b/only-b.bin': Uint8Array.of(113),
      'same.bin': Uint8Array.of(100),
      ...files,
    },
    game = new GameFiles(
      new Map(
        Object.entries(input).map(([name, bytes]) => [name, new BlobFile(new Blob([bytes]))]),
      ),
    );
  await game.open();
  return game;
}
test('registered list rows keep independent loose/archive ordering and replacement slots', async () => {
  const game = await mounted();
  assert.deepEqual(await game.readNative('same.bin', 1), Uint8Array.of(100));
  assert.deepEqual(await game.readNative('images.lst/same.bin', 2), Uint8Array.of(11));
  assert.deepEqual(await game.readNative('images.lst/same.bin', 3), Uint8Array.of(111));
  assert.deepEqual(await game.readNative('images.lst/same.bin', 4), Uint8Array.of(11));
  assert.deepEqual(await game.readNative('images.lst/only-b.bin', 3), Uint8Array.of(113));
  assert.deepEqual(await game.readNative('images.lst/only-b.bin', 4), Uint8Array.of(22));
  assert.deepEqual(
    await game.readNative('a.int/same.bin', 3),
    Uint8Array.of(11),
    'the last registration moved the a.int slot to the missing none directory',
  );
  assert.equal(await game.readNative('missing.int/same.bin', 3), null);
  assert.equal(await game.readNative('same.bin', 4), null);
  assert.equal(await game.readNative('list-a/same.bin', 3), null);
  assert.deepEqual(await game.readNative('list-a/same.bin', 1), Uint8Array.of(111));
  assert.throws(() => game.nativeCandidates('../same.bin'), /escapes/);
});
test('global updates precede every search mode while prepared patch files keep their logical source', async () => {
  const patched = await mounted({
    'patch/a.int': kif([['same.bin', Uint8Array.of(41)]]),
    'patch/list-a/same.bin': Uint8Array.of(141),
  });
  assert.deepEqual(await patched.readNative('images.lst/same.bin', 3), Uint8Array.of(141));
  assert.deepEqual(await patched.readNative('images.lst/same.bin', 4), Uint8Array.of(41));
  const updated = await mounted({
    'update02.INT': kif([['same.bin', Uint8Array.of(52)]]),
    'update10.INT': kif([['same.bin', Uint8Array.of(60)]]),
  });
  for (const mode of [0, 1, 2, 3, 4, 5])
    assert.deepEqual(await updated.readNative('missing.int/same.bin', mode), Uint8Array.of(60));
  assert.equal(await updated.readNative('missing.int/only-a.bin', 3), null);
});
