// SPDX-License-Identifier: MPL-2.0
import test from 'node:test';
import assert from 'node:assert/strict';
import { NativeGlobalStrings } from '../src/native/global-strings.mjs';
import { encodeCP932 } from '../src/kcs/strings.mjs';

const game = 'nekopara-vol3-engine-2.6.1.76',
  sdk = 'sdk-4.01-engine-2.6.1.74';
const bytes = (text) => new TextEncoder().encode(text);

test('system language pairs retain one-space trim, first duplicates and native value markers', () => {
  const strings = new NativeGlobalStrings({ profile: game });
  strings.parse(
    0,
    bytes(
      ' // comment\r\n $a$ \r\n first value \n$a$\nsecond\n$b$\n$nr$\n$b$\naccepted\n$c$\n$empty$\n $spaced$  \n value  \n  $discard$\n  indented value\n$tabs$\nt\ta\tb\n/* multi\nline */$last$\nlast\n$dangling$',
    ),
  );
  assert.equal(strings.get('$a$literal'), 'first value');
  assert.equal(strings.get('$b$literal'), 'accepted');
  assert.equal(strings.get('$c$literal'), '');
  assert.equal(strings.tables.get(0).get('$spaced$ '), 'value ');
  assert.equal(strings.tables.get(0).has(' $discard$'), false);
  assert.equal(strings.get('$spaced$fallback'), 'fallback');
  assert.equal(strings.get('$tabs$'), 't a b');
  assert.equal(strings.get('$last$'), 'last');
  assert.equal(strings.get('$dangling$literal'), 'literal');
});

test('system lookup uses signed table order, literal fallback and one leading key', () => {
  const strings = new NativeGlobalStrings({ profile: game });
  strings.parse(1, bytes('$key$\none\n#hash#\nhashed\n$recursive$\n$key$literal\n$$\nempty key\n'));
  strings.parse(0, bytes('$key$\nzero\n'));
  strings.parse(0xffffffff, bytes('$key$\nminus one\n'));
  assert.equal(strings.get('$key$fallback'), 'minus one');
  assert.equal(strings.get('#hash#fallback'), 'hashed');
  assert.equal(strings.get('$recursive$fallback'), '$key$literal');
  assert.equal(strings.get('$$fallback'), 'empty key');
  assert.equal(strings.get('$missing$literal$key$'), 'literal$key$');
  assert.equal(strings.get('$unclosed'), '$unclosed');
  assert.equal(strings.get('before$key$'), 'before$key$');
  assert.equal(strings.get('plain\0ignored'), 'plain');
});

test('UTF8 system tables keep BOMs and support non-ASCII keys without folding', () => {
  const strings = new NativeGlobalStrings({ profile: game });
  strings.parse(0, bytes('\ufeff$first$\nvalue\n$猫$\n猫の名前\n$A$\nupper\n'));
  assert.equal(strings.get('$first$fallback'), 'fallback');
  assert.equal(strings.tables.get(0).get('\ufeff$first$'), 'value');
  assert.equal(strings.get('$猫$literal'), '猫の名前');
  assert.equal(strings.get('$a$lower'), 'lower');
});

test('game reload removes the prior table before direct and archive reads, even on failure', async () => {
  const calls = [],
    files = new Map([['present', bytes('$key$\ndirect\n')]]);
  const strings = new NativeGlobalStrings({
    profile: game,
    read(name) {
      calls.push(['direct', name]);
      assert.equal(strings.tables.has(0), false);
      return files.get(name) ?? null;
    },
    readArchive(name, flag) {
      calls.push(['archive', name, flag]);
      return name === 'archived' ? bytes('$key$\narchive\n') : null;
    },
  });
  assert.equal(await strings.reload(0, 'present'), true);
  assert.equal(strings.get('$key$fallback'), 'direct');
  assert.equal(await strings.reload(0, 'archived'), true);
  assert.equal(strings.get('$key$fallback'), 'archive');
  assert.equal(await strings.reload(0, 'missing'), false);
  assert.equal(strings.get('$key$fallback'), 'fallback');
  assert.deepEqual(calls, [
    ['direct', 'present'],
    ['direct', 'archived'],
    ['archive', 'archived', 3],
    ['direct', 'missing'],
    ['archive', 'missing', 3],
  ]);
});

test('language changes reload UI and option tables in native order without changing shared config', async () => {
  const configuration = {
      language: {
        default: 0,
        ui: 0,
        main: 1,
        sub: 0xffffffff,
        entries: [{ prefix: 'jp' }, { prefix: 'en' }],
        optionTable: 'opt_%LANG%_%LANG_M%_%LANG%_%LANG_S%.txt',
      },
    },
    calls = [];
  const strings = new NativeGlobalStrings({
    profile: game,
    configuration,
    read(name) {
      calls.push(name);
      return bytes('');
    },
  });
  assert.deepEqual(await strings.initialize(), [true, true]);
  configuration.language.ui = 1;
  await strings.languageChanged('ui');
  configuration.language.main = 0;
  await strings.languageChanged('main');
  configuration.language.sub = 0;
  assert.deepEqual(await strings.languageChanged('sub'), []);
  assert.deepEqual(calls, [
    'language_jp.txt',
    'opt_jp_en_jp_%LANG_S%.txt',
    'language_en.txt',
    'opt_en_en_en_%LANG_S%.txt',
    'opt_en_jp_en_%LANG_S%.txt',
  ]);
  configuration.language.ui = 99;
  assert.equal(strings.uiFilename(), 'language_jp.txt');
  configuration.language.default = 99;
  assert.equal(strings.uiFilename(), 'language_.txt');
  assert.equal(strings.optionFilename(), 'opt_%LANG%_jp_%LANG%_%LANG_S%.txt');
});

test('SDK language is one CP932 byte table and reload merges without replacing existing entries', async () => {
  let source = encodeCP932('$猫$\n猫の名前\n#hash#\nhashed\n$raw$\nvalue\n');
  const calls = [],
    strings = new NativeGlobalStrings({
      profile: sdk,
      read(name) {
        calls.push(name);
        return source;
      },
    });
  assert.deepEqual(await strings.initialize(), [true]);
  assert.equal(strings.get('$猫$fallback'), '猫の名前');
  assert.equal(strings.get('#hash#fallback'), '#hash#fallback');
  source = encodeCP932('$猫$\nreplaced\n$added$\nadded\n');
  assert.equal(await strings.reload(0, 'language.txt'), true);
  assert.equal(strings.get('$猫$'), '猫の名前');
  assert.equal(strings.get('$added$'), 'added');
  source = null;
  assert.equal(await strings.reload(0, 'language.txt'), false);
  assert.equal(strings.get('$added$'), 'added');
  assert.deepEqual(calls, ['language.txt', 'language.txt', 'language.txt']);
  assert.throws(() => strings.parse(1, bytes('')), /one global/);
});

test('SDK raw lookup and checkpoint preserve undecodable byte keys and values', () => {
  const strings = new NativeGlobalStrings({ profile: sdk }),
    source = Uint8Array.of(36, 0x81, 36, 10, 0x81, 10);
  strings.parse(0, source);
  assert.deepEqual(strings.getBytes(Uint8Array.of(36, 0x81, 36, 65)), Uint8Array.of(0x81));
  const restored = new NativeGlobalStrings({ profile: sdk });
  restored.restore(structuredClone(strings.snapshot()));
  assert.deepEqual(restored.getBytes(Uint8Array.of(36, 0x81, 36, 65)), Uint8Array.of(0x81));
  const value = restored.getBytes(Uint8Array.of(36, 0x81, 36));
  value[0] = 0;
  assert.deepEqual(restored.getBytes(Uint8Array.of(36, 0x81, 36)), Uint8Array.of(0x81));
});
