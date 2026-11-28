// SPDX-License-Identifier: MPL-2.0
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { serializeNativePreferences, applyNativePreferences } from '../src/native/preferences.mjs';
import { preferencesFixture, preferenceStateBytes } from './fixtures/preferences-fixture.mjs';
import { parseNativeXML, findNativeXML } from '../src/native/xml.mjs';

const golden = JSON.parse(
  await fs.readFile(new URL('fixtures/native-preferences-golden.json', import.meta.url)),
);
for (const profile of golden.profiles)
  test(`preference XML bytes and read-back state match original ${profile.profile}`, () => {
    for (const row of profile.cases) {
      const xml = new Uint8Array(Buffer.from(row.xml, 'base64'));
      if (!row.readerOnly)
        assert.deepEqual(
          serializeNativePreferences(preferencesFixture(profile.profile, row.variant), {
            flags: row.flags,
          }),
          xml,
          `writer ${row.variant}/${row.flags}`,
        );
      const target = preferencesFixture(profile.profile, 'target');
      assert.equal(
        applyNativePreferences(target, xml, { flags: row.flags }),
        row.parseStatus === 0,
        `parser ${row.variant}/${row.flags}`,
      );
      assert.equal(
        createHash('sha256').update(preferenceStateBytes(target)).digest('hex'),
        row.stateSHA256,
        `state ${row.variant}/${row.flags}`,
      );
    }
  });

test('preference flags select the two native groups and retain writer/reader asymmetries', () => {
  const profile = golden.profiles[1].profile;
  const source = preferencesFixture(profile),
    target = preferencesFixture(profile, 'target');
  source.setField('font.name', '保存フォント');
  source.setField('screen.width', 1440);
  source.setField('screen.fullWide', 47);
  source.setField('general.cache', 49);
  const xml = serializeNativePreferences(source);
  assert.equal(applyNativePreferences(target, xml, { flags: 1 }), true);
  assert.equal(target.getField('screen.width'), 1440);
  assert.equal(target.getField('font.name'), '初期Font');
  assert.equal(target.getField('screen.fullWide'), 3);
  assert.equal(target.getField('general.cache'), 3);
  assert.equal(applyNativePreferences(target, xml, { flags: 2 }), true);
  assert.equal(target.getField('font.name'), '保存フォント');
  const before = target.snapshot();
  assert.equal(
    applyNativePreferences(target, new TextEncoder().encode('<document></document>')),
    false,
  );
  assert.deepEqual(target.snapshot(), before);
});

test('native XML keeps literal entities, searches duplicate fields in reverse and reads one root', () => {
  const parse = (body) =>
    parseNativeXML(
      new TextEncoder().encode(`<?xml version="1.0" encoding="UTF-8"?>${body}`),
      'utf-8',
    );
  const root = parse('<document><FIELD>&amp;&#65;</FIELD><FIELD>last</FIELD></document>');
  assert.equal(findNativeXML(root, 'FIELD').text, 'last');
  assert.equal(root.children[1].text, '&amp;&#65;');
  assert.equal(
    findNativeXML(
      parse('<document><FIELD>first</FIELD></document><document><FIELD>second</FIELD></document>'),
      'FIELD',
    ).text,
    'first',
  );
  assert.equal(
    findNativeXML(parse('<!DOCTYPE document><document><FIELD>x</FIELD></document>'), 'FIELD'),
    null,
  );
  for (const body of [
    '<document/>',
    '<document><FIELD /></document>',
    '<document><![CDATA[x]]></document>',
    '<document><?ignore value?></document>',
  ])
    assert.throws(() => parse(body), /Native XML/);
});
