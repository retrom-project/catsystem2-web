// SPDX-License-Identifier: MPL-2.0
import test from 'node:test';
import assert from 'node:assert/strict';
import { GameFiles, BlobFile } from '../src/files.mjs';
import { NativeResources } from '../src/native/resources.mjs';
import { parseXML } from '../src/xml.mjs';
import { NativeFileAccess } from '../src/native/storage.mjs';
import { NativeHandles } from '../src/native/handles.mjs';
import { nativeInteger64, readLoopPoints } from '../src/native/loop-points.mjs';
import { checkpointBytes } from '../src/checkpoint.mjs';
import { kif } from './helpers.mjs';
import { NativeGlobalStrings } from '../src/native/global-strings.mjs';

const text = (source) => new TextEncoder().encode(source);
test('native language files use exact loose paths before the game archive fallback', async () => {
  const input = new Map(
    Object.entries({
      'strings.int': kif([
        ['language_en.txt', text('$key$\narchive\n')],
        ['language.txt', text('$key$\nSDK archive\n')],
      ]),
      'Language_EN.txt': text('$key$\nloose\n'),
      'directory/Language.txt': text('$key$\nnested\n'),
    }).map(([name, bytes]) => [name, new BlobFile(new Blob([bytes]))]),
  );
  const game = new GameFiles(input);
  await game.open();
  const services = {
    read: (name) => game.readLoose(name),
    readArchive: (name) => game.readArchive(name),
  };
  const current = new NativeGlobalStrings({
    ...services,
    profile: 'nekopara-vol3-engine-2.6.1.76',
  });
  assert.equal(await current.reload(0, 'language_en.txt'), true);
  assert.equal(current.get('$key$fallback'), 'loose');
  assert.equal(await game.readLoose('language.txt'), null);
  assert.deepEqual(await game.readLoose('DIRECTORY\\language.txt'), text('$key$\nnested\n'));
  assert.equal(await current.reload(0, 'language.txt'), true);
  assert.equal(current.get('$key$fallback'), 'SDK archive');
  const sdk = new NativeGlobalStrings({ ...services, profile: 'sdk-4.01-engine-2.6.1.74' });
  assert.deepEqual(await sdk.initialize(), [false]);
  assert.equal(sdk.get('$key$fallback'), 'fallback');
  assert.deepEqual(await game.readArchive('STRINGS.INT/language_en.txt'), text('$key$\narchive\n'));
});
test('native category resolution uses configured archive/extension and retains explicit paths', async () => {
  const startup = `<?xml version="1.0" encoding="UTF-8"?><document><INT><int00><name>image</name><int>images.lst</int><ext>hg3</ext></int00><int01><name>kcs</name><int>script.int</int><ext>kcs</ext></int01><int02><name>mot</name><int>moves.int</int><ext>kcs</ext></int02></INT></document>`;
  const input = new Map(
    Object.entries({
      'startup.xml': text(startup),
      'images.lst': text('loose\\first/parts/first.int\r\nloose\\second/parts/second.int\r\n'),
      'parts/first.int': kif([['same.hg3', new Uint8Array([1])]]),
      'parts/second.int': kif([
        ['same.hg3', new Uint8Array([2])],
        ['second.hg3', new Uint8Array([3])],
      ]),
      'script.int': kif([['same.kcs', new Uint8Array([4])]]),
      'moves.int': kif([['same.kcs', new Uint8Array([5])]]),
    }).map(([name, bytes]) => [name, new BlobFile(new Blob([bytes]))]),
  );
  const game = new GameFiles(input);
  await game.open();
  assert.deepEqual(await game.requireCategory('same', 'kcs'), new Uint8Array([4]));
  assert.deepEqual(await game.requireCategory('same', 'mot'), new Uint8Array([5]));
  assert.deepEqual(await game.requireCategory('same', 'IMAGE'), new Uint8Array([1]));
  assert.deepEqual(await game.requireCategory('second', 'image'), new Uint8Array([3]));
  assert.equal(await game.readCategory('absent.int/same.hg3', 'image'), null);
  assert.equal(await game.readCategory('parts/second.int/same', 'image'), null);
  assert.deepEqual(
    await game.readCategory('parts/second.int/same.hg3', 'image'),
    new Uint8Array([2]),
  );
  assert.equal(await game.readCategory('same', 'undefined-category'), null);
  const resources = new NativeResources(parseXML(startup), { soundCategory: () => 'kcs' });
  assert.equal(resources.resolve('same', 'sound'), 'script.int/same.kcs');
  assert.equal(resources.resolve('same.', 'sound'), 'script.int/same.');
  assert.equal(resources.resolve('.hidden', 'sound'), 'script.int/.hidden');
});

test('native file access preserves raw bytes, byte counts, independent cursors and the r/w mode scan', async () => {
  const files = new Map([['input', new Uint8Array([13, 10, 0, 255])]]),
    handles = new NativeHandles();
  const access = new NativeFileAccess(
    {
      read: async (name) => files.get(name)?.slice() ?? null,
      write: async (name, bytes) => files.set(name, bytes.slice()),
    },
    () => handles,
  );
  const a = await access.open('input', 'r+'),
    b = await access.open('input', 'a');
  assert.deepEqual(access.read(a, 3), new Uint8Array([13, 10, 0]));
  assert.equal(access.write(a, new Uint8Array([1])), -1);
  assert.deepEqual(access.read(b, 2), new Uint8Array([13, 10]));
  assert.equal(access.write(b, new Uint8Array([8, 9, 10])), 3);
  await access.close(b);
  assert.deepEqual(files.get('input'), new Uint8Array([13, 10, 8, 9, 10]));
  const w = await access.open('created', 'wb');
  assert.equal(access.read(w, 1), null);
  await access.close(w);
  assert.deepEqual(files.get('created'), new Uint8Array());
  assert.equal(await access.open('missing', 'r'), 0);
  assert.equal(access.read(0, 5), null);
  await access.closeAll();
  assert.equal(handles.records.size, 0);
});

test('native loop points retain signed 64-bit values, hex prefixes, defaults and comment/quote rules', () => {
  assert.equal(nativeInteger64('18446744073709551615'), -1n);
  assert.equal(nativeInteger64('-0x100000002tail'), -4294967298n);
  assert.equal(nativeInteger64('2.5'), 0n);
  assert.equal(nativeInteger64(' 12'), 0n);
  assert.deepEqual(
    readLoopPoints(
      text('"file.ogg"\t9007199254740993\t0x7fffffffffffffff // end\n/* block\n*/other.ogg\n'),
    ),
    [
      { file: 'file.ogg', start: 9007199254740993n, end: 9223372036854775807n },
      { file: 'other.ogg', start: 0n, end: -1n },
    ],
  );
});

test('checkpoint sizing counts shared binary buffers once and accepts structured native state', () => {
  const bytes = new Uint8Array(1024),
    state = {
      bytes,
      subset: bytes.subarray(0, 128),
      map: new Map([[1, bytes]]),
      set: new Set([bytes]),
    };
  state.self = state;
  assert.equal(checkpointBytes(state), 1053);
  assert.throws(() => checkpointBytes(state, 1000), /exceeds/);
  assert.throws(() => checkpointBytes({ callback() {} }), /non-serializable/);
});
