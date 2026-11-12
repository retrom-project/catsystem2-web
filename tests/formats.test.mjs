// SPDX-License-Identifier: MPL-2.0
import test from 'node:test';
import assert from 'node:assert/strict';
import { deflateSync } from 'node:zlib';
import { Binary, inflate } from '../src/binary.mjs';
import { BlobFile, GameFiles, KIFArchive } from '../src/files.mjs';
import { readScene, readTranslation, readFES } from '../src/formats/scene.mjs';
import { HG3 } from '../src/formats/hg3.mjs';
import { PSB } from '../src/formats/psb.mjs';
import { parseXML } from '../src/xml.mjs';
import { sourceIdentity } from '../src/identity.mjs';
import { catScene, translation, kif, hg3, ascii, u32 } from './helpers.mjs';

test('binary magic includes embedded NUL and rejects incomplete signatures', () => {
  assert.equal(new Binary(new Uint8Array([75, 67, 83, 0])).magic('KCS\0'), true);
  assert.equal(new Binary(new Uint8Array([75, 67, 83])).magic('KCS\0'), false);
  assert.throws(() => new Binary(new Uint8Array(2)).u32(0), /range/);
});
test('zlib validates output size, truncation, and an explicit expansion ceiling', async () => {
  const compressed = deflateSync(new Uint8Array(4096));
  assert.equal((await inflate(compressed, 4096)).length, 4096);
  await assert.rejects(inflate(compressed, 4095), /exceeds/);
  await assert.rejects(inflate(compressed.subarray(0, -1), 4096));
  await assert.rejects(inflate(compressed, 4096, 1024), /size/);
});
test('KIF reads entry boundaries and refuses encrypted input explicitly', async () => {
  const archive = await KIFArchive.open(
    new BlobFile(new Blob([kif([['test.bin', new Uint8Array([1, 2, 3])]])])),
    'test.int',
  );
  assert.deepEqual([...(await archive.read(archive.entries[0]))], [1, 2, 3]);
  await assert.rejects(
    KIFArchive.open(
      new BlobFile(new Blob([kif([['__key__.dat', new Uint8Array()]])])),
      'encrypted.int',
    ),
    /encrypted/,
  );
  const malformed = kif([['test', new Uint8Array([1])]]);
  new DataView(malformed.buffer).setUint32(76, 999, true);
  await assert.rejects(KIFArchive.open(new BlobFile(new Blob([malformed])), 'broken.int'), /entry/);
});
test('loose patch data wins over patch archives, and patch archives win over base', async () => {
  const file = (b) => new BlobFile(new Blob([b]));
  const game = new GameFiles(
    new Map([
      ['base.int', file(kif([['HELLO.txt', new Uint8Array([1])]]))],
      ['patch/patch.int', file(kif([['hello.txt', new Uint8Array([2])]]))],
      ['patch/loose/hello.txt', file(new Uint8Array([3]))],
    ]),
  );
  await game.open();
  assert.deepEqual([...(await game.require('Hello.TXT'))], [3]);
});
test('archive-qualified reads preserve distinct same-named resources and never fall back to another namespace', async () => {
  const file = (bytes) => new BlobFile(new Blob([bytes]));
  const game = new GameFiles(
    new Map([
      ['left.int', file(kif([['same.bin', new Uint8Array([1])]]))],
      ['right.int', file(kif([['same.bin', new Uint8Array([2])]]))],
      ['config/setting.xml', file(new TextEncoder().encode('config'))],
      ['patch/left.int', file(kif([['same.bin', new Uint8Array([3])]]))],
    ]),
  );
  await game.open();
  assert.deepEqual([...(await game.require('RIGHT.INT\\same.bin'))], [2]);
  assert.deepEqual([...(await game.require('left.int/same.bin'))], [3]);
  assert.deepEqual([...(await game.require('left/same.bin'))], [3]);
  assert.equal(await game.read('missing.int/same.bin'), null);
  assert.equal(new TextDecoder().decode(await game.require('config.int/setting.xml')), 'config');
  assert.throws(() => game.has('../left.int/same.bin'), /escapes/);
});
test('CatScene preserves Japanese CP932 and command/message boundaries', async () => {
  const scene = await readScene(
    catScene([
      [0x30, 'bg 0 room'],
      [0x21, '名前'],
      [0x20, 'こんにちは'],
      [2, ''],
    ]),
  );
  assert.deepEqual(
    scene.lines.map((l) => l.kind),
    [48, 33, 32, 2],
  );
  assert.equal(scene.lines[2].text, 'こんにちは');
});
test('CSTL indexes UTF-8 by message and language, including 255-byte length runs', () => {
  const bytes = translation(
    ['en', 'jp'],
    [{ en: ['Speaker', 'x'.repeat(300)], jp: ['名前', '文章'] }],
  );
  const t = readTranslation(bytes);
  assert.equal(t.en[0].text.length, 300);
  assert.equal(t.jp[0].speaker, '名前');
  assert.throws(() => readTranslation(new Uint8Array([...bytes, 1])), /trailing/);
});
test('FES recognizes both original UTF-8 and CP932 script text', async () => {
  const text = new TextEncoder().encode('#START\nstrvar 1 日本語\0'),
    packed = deflateSync(text);
  assert.deepEqual(
    await readFES(
      new Uint8Array([
        ...ascii('FES\0'),
        ...u32(packed.length),
        ...u32(text.length),
        ...u32(0),
        ...packed,
      ]),
    ),
    { bytes: text.slice(0, -1), text: '#START\nstrvar 1 日本語', prepared: true },
  );
});
test('FES owns exact NUL-bounded body bytes for plain and compressed sources', async () => {
  for (const tail of [
    new TextEncoder().encode('日本語'),
    new Uint8Array([0x93, 0xfa, 0x96, 0x7b]),
    new Uint8Array([0xc2, 0xa5]), // Valid UTF8 and CP932, with different decoded views.
    new Uint8Array([0x81, 0xff, 0x80]), // Opaque bytes, without replacement-character repair.
  ]) {
    const body = new Uint8Array([0xef, 0xbb, 0xbf, ...ascii('#START\r\nx str '), ...tail]),
      input = new Uint8Array([...body, 0, ...ascii('ignored')]),
      compressed = deflateSync(input),
      packed = new Uint8Array([
        ...ascii('FES\0'),
        ...u32(compressed.length),
        ...u32(input.length),
        ...u32(0),
        ...compressed,
      ]);
    for (const source of [input, packed]) {
      const result = await readFES(source);
      assert.deepEqual(result.bytes, body);
      assert.equal(result.prepared, source === packed);
      result.bytes[0] = 0;
      assert.notEqual(source[0], 0, 'the decoder owns its source copy');
    }
  }
});
test('HG3 reconstructs known RGBA pixels, including vertical order and horizontal/vertical deltas', async () => {
  const pixels = new Uint8Array([
    255, 0, 0, 255, 0, 255, 0, 255, 0, 0, 255, 128, 255, 255, 255, 255,
  ]);
  const image = new HG3(hg3(2, 2, pixels));
  await image.decode(image.frames[0]);
  assert.deepEqual([...image.frames[0].rgba], [...pixels]);
});
test('PSB parses tagged scalar/list values and rejects out-of-bounds references', () => {
  const array = [13, 0, 13],
    names = [...array, ...array, ...array],
    strings = array,
    chunks = array,
    headerSize = 56;
  const rootAt = headerSize + names.length + strings.length + chunks.length * 2;
  const root = [32, 13, 3, 13, 0, 1, 2, 2, 3, 5, 249];
  const bytes = new Uint8Array([
    ...ascii('PSB\0'),
    4,
    0,
    0,
    0,
    ...[
      56,
      56,
      56 + names.length,
      56 + names.length + strings.length,
      56 + names.length + strings.length,
      56 + names.length + strings.length + chunks.length,
      rootAt,
      rootAt,
      0,
      0,
      0,
      0,
    ].flatMap(u32),
    ...names,
    ...strings,
    ...chunks,
    ...chunks,
    ...root,
  ]);
  assert.deepEqual(new PSB(bytes).root, [false, true, -7]);
  const bad = bytes.slice();
  new DataView(bad.buffer).setUint32(36, bytes.length + 1, true);
  assert.throws(() => new PSB(bad), /range/);
});
test('XML handles comments, nested values and entities without evaluating external declarations', () => {
  const doc = parseXML('<root><!-- x --><section><label>A &amp; B</label></section></root>');
  assert.equal(doc.value('section', 'label'), 'A & B');
  assert.throws(() => parseXML('<!DOCTYPE root><root/>'), /Unsupported/);
  assert.throws(() => parseXML('<a><b></a>'), /Mismatched/);
});
test('content identity is stable under enumeration order and changes when bytes change', async () => {
  const file = (value) => new BlobFile(new Blob([new Uint8Array(value)]));
  const a = new Map([
      ['b', file([2])],
      ['a', file([1])],
    ]),
    b = new Map([...a].reverse());
  assert.equal(await sourceIdentity(a), await sourceIdentity(b));
  b.set('a', file([9]));
  assert.notEqual(await sourceIdentity(a), await sourceIdentity(b));
});
