// SPDX-License-Identifier: MPL-2.0
import test from 'node:test';
import assert from 'node:assert/strict';
import { browserWindowsLanguageID } from '../src/native/windows-language-ids.mjs';
import { NativeConfiguration } from '../src/native/config.mjs';
import { parseXML } from '../src/xml.mjs';

test('browser UI language uses region/script LANGIDs and ignores collation extensions', () => {
  for (const [name, id] of [
    ['en', 0x409],
    ['en-US', 0x409],
    ['en-GB', 0x809],
    ['ja', 0x411],
    ['zh-Hans', 0x804],
    ['zh-Hant', 0x404],
    ['zh-HK', 0xc04],
    ['zh-SG', 0x1004],
    ['pt', 0x416],
    ['pt-PT', 0x816],
    ['es-ES', 0xc0a],
    ['es-MX', 0x80a],
    ['sr-Latn-RS', 0x241a],
    ['sr-Cyrl-RS', 0x281a],
    ['az-Cyrl-AZ', 0x82c],
    ['no-NO', 0x414],
    ['fr-CA', 0xc0c],
    ['de-DE-u-co-phonebk', 0x407],
  ])
    assert.equal(browserWindowsLanguageID(name), id, name);
  for (const name of ['', 'invalid_tag', 'und-ZZ', 'en-XX', 'zh-Hant-CN'])
    assert.equal(browserWindowsLanguageID(name), undefined, name);
});

test('the injected host LANGID selects the last exact startup match and retains the default when unknown', () => {
  const startup = parseXML(
    '<document><language><default>1</default><L00><code>1041</code><prefix>ja</prefix></L00><L01><code>1033</code><prefix>en</prefix></L01><L02><code>1041</code><prefix>ja2</prefix></L02><L03><code>0</code></L03><L04><code>2052</code><prefix>zh</prefix></L04></language></document>',
  );
  const japanese = new NativeConfiguration({
    profile: 'nekopara-vol3-engine-2.6.1.76',
    startup,
    uiLanguage: browserWindowsLanguageID('ja-JP'),
  });
  assert.equal(japanese.language.ui, 2);
  assert.equal(japanese.language.main, 2);
  assert.equal(japanese.language.default, 2);
  assert.equal(japanese.language.entries.length, 3);
  const unknown = new NativeConfiguration({
    profile: 'nekopara-vol3-engine-2.6.1.76',
    startup,
    uiLanguage: browserWindowsLanguageID('en-XX'),
  });
  assert.equal(unknown.language.default, 1);
  assert.equal(unknown.language.ui, 0);
});
