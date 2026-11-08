// SPDX-License-Identifier: MPL-2.0
import test from 'node:test';
import assert from 'node:assert/strict';
import { parseXML } from '../src/xml.mjs';
import {
  NativeSoundConfiguration,
  nativeSoundConfiguration,
  nativeSoundConfigurationFilename,
  serializeNativeSoundPreferences,
  applyNativeSoundPreferences,
} from '../src/native/sound-config.mjs';

const xml = (source) => parseXML(`<document>${source}</document>`);
const tree = () =>
  new NativeSoundConfiguration({
    document: xml(`
  <SOUNDGROUP><g><id>2</id><label>voice</label><min>8</min><max>14</max></g><duplicate><id>2</id><label>ignored</label></duplicate></SOUNDGROUP>
  <MASTER><volume>80</volume><play>1</play></MASTER>
  <PART><VOICE><id>4</id><type>voice</type><volume>90</volume><mastervol>80</mastervol><voicevol>50</voicevol><play>1</play><sysplay>-1</sysplay><skipvol>25</skipvol><part>
  <A><id>2</id><type>woman</type><head>A_</head><volume>75</volume><mastervol>60</mastervol><voicevol>40</voicevol><play>1</play></A>
  <B><id>3</id><type>woman</type><head>B_</head><play>-1</play><mute>-1</mute></B>
  </part></VOICE></PART>`),
  });

test('soundconf parses exact paths, duplicate groups and immediate inheritance', () => {
  const sound = tree();
  assert.equal(sound.loaded, true);
  assert.equal(sound.groups.get(2).label, 'voice');
  assert.equal(sound.parts[0].key, 'voice');
  assert.equal(sound.parts[0].children[1].defaults.volume, 90);
  assert.equal(sound.parts[0].children[1].defaults.play, 1);
  assert.equal(sound.parts[0].children[1].defaults.mute, -1);
  assert.equal(sound.get('volume', { by: 'filename', query: 'A_line.ogg' }), 75);
  assert.equal(sound.get('volume', { by: 'type', query: 'woman' }), 75);
  assert.equal(sound.get('volume', { by: 'key', query: 'A' }), 75);
  assert.equal(sound.get('volume', { by: 'key', query: 'a_line.ogg' }), 100);
  const deep = new NativeSoundConfiguration({
    document: xml('<PART><a><volume>60</volume><part><b><part><c/></part></b></part></a></PART>'),
  });
  assert.equal(deep.parts[0].children[0].defaults.volume, 60);
  assert.equal(deep.parts[0].children[0].children[0].defaults.volume, -1);
});

test('sound mix follows parent-first prefixes, signed wrapped percentages and category bubbles', () => {
  const sound = tree();
  assert.equal(sound.effectiveVolume('A_line'), 25);
  assert.equal(sound.effectiveVolume('A_line', { voice: true }), 7);
  assert.equal(sound.effectiveVolume('B_line'), 0);
  assert.equal(sound.effectiveVolume('missing'), 80);
  assert.equal(sound.effectiveVolume('A_line', { category: 'VOICE' }), 40);
  sound.parts[0].head = 'a';
  assert.equal(sound.effectiveVolume('A_line'), 57);
  sound.master.current.mute = -1;
  assert.equal(sound.effectiveVolume('A_line'), 57);
  sound.master.current.mute = 1;
  assert.equal(sound.effectiveVolume('A_line'), 0);
});

test('sound setters distinguish named, ID and type reset rules and preferences fallback', () => {
  const sound = tree();
  sound.set('volume', -1, { by: 'key', query: 'a' });
  assert.equal(sound.get('volume', { query: 'a' }), -1);
  sound.set('volume', -1, { by: 'idPath', ids: [4, 2] });
  assert.equal(sound.get('volume', { query: 'a' }), 75);
  sound.set('volume', 31, { by: 'type', query: 'woman' });
  assert.deepEqual(
    sound.parts[0].children.map((item) => item.current.volume),
    [31, 31],
  );
  sound.set('sysplay', 1, { query: 'a' });
  assert.equal(sound.get('sysplay', { query: 'a' }), -1);
  sound.parts[0].children[0].current.skipvol = 123;
  sound.reset({ query: 'a' });
  assert.equal(sound.get('volume', { query: 'a' }), 75);
  assert.equal(sound.get('skipvol', { query: 'a' }), 123);
  sound.applyPreferences(
    xml('<PART><voice><part><a><volume>55</volume></a></part></voice></PART>'),
  );
  assert.equal(sound.get('volume', { query: 'a' }), 55);
  assert.equal(sound.parts[0].children[0].current.mute, -1);
  assert.equal(sound.get('mute', { query: 'a' }), 0);
  assert.equal(sound.effectiveVolume('A_line'), 0);
  const restored = new NativeSoundConfiguration().restore(sound.snapshot());
  assert.deepEqual(restored.snapshot(), sound.snapshot());
});

test('native sound selectors use one formatted argument and preserve return words', () => {
  const sound = tree(),
    services = { soundConfiguration: sound, format: (value) => value };
  assert.deepEqual(nativeSoundConfiguration(0x3aa, [], null, services), { control: 1, value: 1 });
  assert.equal(nativeSoundConfiguration(0x3ab, [], null, services).value, 80);
  assert.equal(nativeSoundConfiguration(0x3af, ['A_line'], null, services).value, 75);
  assert.equal(nativeSoundConfiguration(0x3b6, ['woman'], null, services).value, 75);
  assert.equal(nativeSoundConfiguration(0x3bd, ['a'], null, services).value, 75);
  assert.equal(nativeSoundConfiguration(0x3c4, ['A_line'], null, services).value, 25);
  assert.equal(nativeSoundConfiguration(0x3e9, ['missing'], null, services).value, 0xffffffff);
  assert.equal(nativeSoundConfiguration(0x3e9, ['A_line'], null, services).value, 2);
  assert.throws(() => nativeSoundConfiguration(0x3af, [], null, services), /expects 1/);
  assert.equal(nativeSoundConfiguration(0x3c5, [], null, services), undefined);
  assert.equal(
    nativeSoundConfiguration(0x3aa, [], null, {
      soundConfiguration: new NativeSoundConfiguration(),
    }).value,
    0,
  );
});

test('sound preferences retain their startup filename and serialize the mutable recursive tree', () => {
  assert.equal(nativeSoundConfigurationFilename(xml('')), '');
  assert.equal(
    nativeSoundConfigurationFilename(xml('<SOUNDCONFIG>audio-user.xml</SOUNDCONFIG>')),
    'audio-user.xml',
  );
  for (const profile of ['sdk-4.01-engine-2.6.1.74', 'nekopara-vol3-engine-2.6.1.76']) {
    const sound = tree();
    sound.profile = profile;
    sound.filename = 'audio-user.xml';
    sound.parts[0].children[0].key = profile.startsWith('sdk') ? 'child' : '日本語';
    sound.parts[0].children[0].current.volume = -2147483648;
    sound.master.current.volume = 0x7fffffff;
    const bytes = serializeNativeSoundPreferences(sound),
      source = new TextDecoder(profile.startsWith('sdk') ? 'shift_jis' : 'utf-8').decode(bytes);
    assert.ok(
      source.startsWith(
        `<?xml version="1.0" encoding="${profile.startsWith('sdk') ? 'Shift_JIS' : 'UTF-8'}"?>\r\n<document>\r\n  <PART>`,
      ),
    );
    assert.ok(
      source.indexOf('<b>') < source.indexOf(profile.startsWith('sdk') ? '<child>' : '<日本語>'),
    );
    assert.ok(source.indexOf('<mute>') < source.indexOf('<volume>'));
    assert.ok(source.includes('<volume>-2147483648</volume>'));
    assert.equal(source.includes('<mastervol>'), false);
    assert.equal(source.includes('<head>'), false);
    assert.equal(source.includes('<part></part>'), false);
    const restored = new NativeSoundConfiguration({ profile }).restore(sound.snapshot());
    restored.parts[0].children[0].current.volume = 13;
    assert.equal(applyNativeSoundPreferences(restored, bytes), true);
    assert.equal(restored.parts[0].children[0].current.volume, -2147483648);
    assert.equal(restored.master.current.volume, 0x7fffffff);
    assert.equal(restored.filename, 'audio-user.xml');
    const before = restored.snapshot();
    assert.equal(
      applyNativeSoundPreferences(restored, new TextEncoder().encode('<document/>')),
      false,
    );
    assert.deepEqual(restored.snapshot(), before);
  }
});
