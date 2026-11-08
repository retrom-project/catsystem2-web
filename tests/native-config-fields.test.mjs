// SPDX-License-Identifier: MPL-2.0
import test from 'node:test';
import assert from 'node:assert/strict';
import { parseXML } from '../src/xml.mjs';
import { NativeConfiguration } from '../src/native/config.mjs';
import { nativeFullscreenSize, nativeFullscreenAvailable } from '../src/native/config-fields.mjs';

const sdk = 'sdk-4.01-engine-2.6.1.74';
const game = 'nekopara-vol3-engine-2.6.1.76';
const xml = (text) => parseXML(`<document>${text}</document>`);

test('APP touch mode keeps the original zero default and startup word in both profiles', () => {
  for (const profile of [sdk, game]) {
    assert.equal(new NativeConfiguration({ profile }).getField('application.touch'), 0);
    const configuration = new NativeConfiguration({
      profile,
      startup: xml('<APP><touch>7</touch></APP>'),
    });
    assert.equal(configuration.getField('application.touch'), 7);
    assert.equal(configuration.setField('application.touch', 0xffffffff), true);
    assert.equal(configuration.getField('application.touch'), 0xffffffff);
  }
});

test('texture paging preserves constructor sentinels, all startup regions and live typed arrays', () => {
  for (const profile of [sdk, game]) {
    const config = new NativeConfiguration({ profile });
    assert.deepEqual([...config.fields.texture.size], [256, 256]);
    assert.deepEqual([...config.fields.texture.grid], [0, 0]);
    assert.deepEqual(
      [...config.fields.texture.areas[7]],
      [0xffffffff, 0xffffffff, 0xffffffff, 0xffffffff],
    );
    config.fields.applyStartup(
      xml(
        '<TEXTURE><size><x>256</x><y>128</y></size><vt><x>12</x><y>26</y></vt><area00><sx>0</sx><sy>2</sy><dx>12</dx><dy>8</dy></area00><area07><dy>0x20</dy></area07><bpp16y>26</bpp16y></TEXTURE>',
      ),
    );
    assert.deepEqual([...config.getField('texture.size')], [256, 128]);
    assert.deepEqual([...config.getField('texture.grid')], [12, 26]);
    assert.deepEqual([...config.getField('texture.areas')[0]], [0, 2, 12, 8]);
    assert.deepEqual(
      [...config.getField('texture.areas')[7]],
      [0xffffffff, 0xffffffff, 0xffffffff, 32],
    );
    assert.deepEqual([...config.getField('texture.bppY')], [0, 26]);
    const live = config.getField('texture.grid');
    assert.equal(config.setField('texture.grid', [24, 52]), true);
    assert.deepEqual([...live], [24, 52]);
    config.applyUserPreferences(xml('<TEXTURE><size><x>1024</x></size></TEXTURE>'));
    assert.equal(config.getField('texture.size')[0], 256);
  }
});

test('font and key storage preserve the two native encodings and record layouts', () => {
  for (const profile of [sdk, game]) {
    const config = new NativeConfiguration({
      profile,
      startup: xml(
        '<KEYCUSTOMIZE><key00><name>猫</name><keyboard1>257</keyboard1><mouse2>-1</mouse2><joypad3>19</joypad3><touch4>23</touch4><rep_keyboard2>31</rep_keyboard2><rep_mouse3>37</rep_mouse3><rep_joypad4>41</rep_joypad4><rep_touch1>47</rep_touch1><hide>2</hide></key00></KEYCUSTOMIZE>',
      ),
    });
    const { fields } = config,
      row = config.keys.rows[0];
    assert.equal(fields.data.length, profile === sdk ? 5592 : 8600);
    assert.equal(fields.layout.keyStride, profile === sdk ? 36 : 40);
    assert.deepEqual(
      Array.from(fields.data.subarray(0, 4)),
      profile === sdk ? [0x82, 0x6c, 0x82, 0x72] : [0x2d, 0xff, 0x33, 0xff],
    );
    assert.equal(row.name, '猫');
    assert.equal(row.enabled, 1);
    assert.deepEqual(
      [
        row.keyboard[0],
        row.mouse[1],
        row.joypad[2],
        row.touch[3],
        row.rep_keyboard[1],
        row.rep_mouse[2],
        row.rep_joypad[3],
        row.rep_touch[0],
      ],
      [1, 255, 19, 23, 31, 37, 41, 47],
    );
    assert.equal(row.hide, profile === sdk ? undefined : 2);
    assert.equal(config.keys.rows[1].enabled, 0);
    assert.equal(config.getField('not.a.field'), undefined);
    assert.equal(config.setField('not.a.field', 1), false);
  }
});

test('startup fonts choose the first installed candidate and preserve preference overrides', () => {
  const startup = xml(
    '<FONT><face><f00>Missing</f00><f02>Available</f02><f03>Other</f03></face><faceruby><f07>Ruby</f07></faceruby></FONT>',
  );
  const config = new NativeConfiguration({
    profile: game,
    startup,
    fontAvailability: (name) => ['Available', 'Other', 'Ruby'].includes(name),
  });
  assert.equal(config.font.name, 'Available');
  assert.equal(config.font.ruby, 'Ruby');
  config.applyUserPreferences(
    xml('<FONT><face>User choice</face><bold>7</bold><proportional>0</proportional></FONT>'),
  );
  config.resolveFonts(() => true);
  assert.equal(config.font.name, 'User choice');
  assert.equal(config.font.fix, 0);
  assert.equal(config.font.weight, 7);
  config.getField('font.shadow')[2] = 13;
  assert.equal(config.font.weight, 13);
  assert.equal(config.setField('font.weight', 19), true);
  assert.equal(config.getField('font.shadow')[2], 19);
  const noService = new NativeConfiguration({ profile: sdk, startup });
  assert.equal(noService.font.name, 'ＭＳ ゴシック');
  noService.resolveFonts((name) => name === 'Other');
  assert.equal(noService.font.name, 'Other');
});

test('key preferences update enabled rows and leave touch mappings intact', () => {
  for (const profile of [sdk, game]) {
    const config = new NativeConfiguration({
      profile,
      startup: xml(
        '<KEYCUSTOMIZE><key00><name>Confirm</name><keyboard1>13</keyboard1><touch1>9</touch1><rep_touch1>1</rep_touch1></key00><key01><keyboard1>17</keyboard1></key01></KEYCUSTOMIZE>',
      ),
      preferences: xml(
        '<KEY><enable_joypad>1</enable_joypad><kb1_00>32</kb1_00><kb2r_00>258</kb2r_00><kb1_01>99</kb1_01><touch1_00>3</touch1_00></KEY>',
      ),
    });
    assert.equal(config.keys.enableJoypad, 1);
    assert.equal(config.keys.rows[0].keyboard[0], 32);
    assert.equal(config.keys.rows[0].rep_keyboard[1], 2);
    assert.equal(config.keys.rows[0].touch[0], 9);
    assert.equal(config.keys.rows[0].rep_touch[0], 1);
    assert.equal(config.keys.rows[1].keyboard[0], 17);
  }
});

test('game language enumeration stops at the first empty code and validates saved indices', () => {
  const startup = xml(
    '<language><default>7</default><L00><code>1041</code><prefix>jp</prefix><lang>日本語</lang><accel>JA</accel></L00><L01><code>1033</code><prefix>en</prefix><lang>English</lang><accel>EC</accel><accelsub>ES</accelsub></L01><L03><code>2052</code></L03></language>',
  );
  const config = new NativeConfiguration({
    profile: game,
    startup,
    uiLanguage: 1033,
    preferences: xml('<language><id><UI>99</UI><main>0</main><sub>22</sub></id></language>'),
  });
  assert.deepEqual(
    [config.language.default, config.language.ui, config.language.main, config.language.sub],
    [1, 1, 0, 1],
  );
  assert.equal(config.language.entries.length, 2);
  assert.deepEqual(
    config.language.entries.map((entry) => [entry.accel, entry.accelsub]),
    [
      [
        [74, 16],
        [0, 0],
      ],
      [
        [69, 8],
        [69, 4],
      ],
    ],
  );
  const absentSystemLanguage = new NativeConfiguration({ profile: game, startup });
  assert.deepEqual(
    [
      absentSystemLanguage.language.default,
      absentSystemLanguage.language.ui,
      absentSystemLanguage.language.main,
      absentSystemLanguage.language.sub,
    ],
    [7, 0, 0, 0xffffffff],
  );
  const old = new NativeConfiguration({ profile: sdk, startup });
  assert.equal(old.language, undefined);
  assert.equal(old.getField('language.ui'), undefined);
});

test('screen startup normalization and saved fullscreen checks use distinct native rules', () => {
  const display = {
    current: { width: 1920, height: 1080, refresh: 60, format: 22 },
    modes: [
      { width: 1024, height: 768, refresh: 59, format: 22 },
      { width: 1600, height: 900, refresh: 59, format: 22 },
      { width: 1280, height: 720, refresh: 60, format: 22 },
    ],
  };
  assert.deepEqual(nativeFullscreenSize(1000, 600, display), [1600, 900]);
  assert.deepEqual(nativeFullscreenSize(1280, 720, display), [1280, 720]);
  assert.equal(nativeFullscreenAvailable(1024, 768, display), true);
  assert.equal(nativeFullscreenAvailable(1000, 600, display), false);
  const config = new NativeConfiguration({
    profile: game,
    displayModes: display,
    startup: xml('<SCREEN><width>1000</width><height>600</height><fps>-1</fps></SCREEN>'),
    preferences: xml(
      '<WINDOW><width>900</width><height>500</height><full_width>1024</full_width><full_height>768</full_height><fullscreen>1</fullscreen></WINDOW><FULL_SCREEN><full_size>3</full_size></FULL_SCREEN>',
    ),
  });
  assert.deepEqual(
    [
      config.screen.fullWidth,
      config.screen.fullHeight,
      config.screen.currentWidth,
      config.screen.currentHeight,
    ],
    [1024, 768, 1024, 768],
  );
  assert.equal(config.screen.fps, 0xffffffff);
  assert.equal(config.getField('screen.fullSize'), 3);
});

test('FES configuration views and sound setup fields survive snapshots without duplicating state', () => {
  const config = new NativeConfiguration({
    profile: game,
    startup: xml(
      '<ETC><dragwnd>0</dragwnd></ETC><SYSTEMVOICE><ch47><play>0</play></ch47></SYSTEMVOICE><SOUNDGROUP><group07><id>12</id><type>voice</type><min>9</min><max>15</max></group07></SOUNDGROUP>',
    ),
    preferences: xml(
      '<SYSTEMVOICE><play00>9</play00></SYSTEMVOICE><GAME><always_active>0</always_active><enable_scene_anm>0</enable_scene_anm></GAME><SOUND><ds3d>1</ds3d><sticky>0</sticky><stereo>0</stereo></SOUND>',
    ),
  });
  assert.equal(config.getField('window.drag'), 0);
  assert.equal(config.getField('window.active'), 0);
  assert.equal(config.getField('scene.animation'), 0);
  assert.deepEqual(config.soundOptions, { use3d: 1, sticky: 0, stereo: 0 });
  assert.deepEqual(config.soundGroups[7], { id: 12, type: 'voice', min: 9, max: 15 });
  const fresh = new NativeConfiguration({ profile: game }),
    flags = fresh.getField('voice.sysplay'),
    shadow = fresh.getField('font.shadow');
  fresh.restore(config.snapshot());
  assert.equal(fresh.getField('voice.sysplay'), flags);
  assert.equal(flags[0], 9);
  assert.equal(flags[47], 0);
  fresh.setField('font.weight', 11);
  assert.equal(shadow[2], 11);
  assert.equal(new NativeConfiguration({ profile: sdk }).getField('window.active'), undefined);
});
