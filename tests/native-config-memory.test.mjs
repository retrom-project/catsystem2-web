// SPDX-License-Identifier: MPL-2.0
import test from 'node:test';
import assert from 'node:assert/strict';
import { NativeConfiguration } from '../src/native/config.mjs';
import {
  NativeConfigurationMemory,
  NATIVE_CONFIGURATION_MEMORY_LAYOUTS,
} from '../src/native/config-memory.mjs';
import { parseXML } from '../src/xml.mjs';

class Memory {
  constructor() {
    this.data = new Uint8Array(1024 * 1024);
    this.next = 0x40000;
    this.allocated = new Set();
  }
  allocate(size) {
    const at = this.next;
    this.next += Math.ceil(size / 16) * 16;
    this.allocated.add(at);
    return at;
  }
  free(at) {
    return this.allocated.delete(at);
  }
  read(at, size) {
    if (at < 0 || at + size > this.data.length) throw new Error('memory range');
    return this.data.slice(at, at + size);
  }
  write(at, bytes) {
    this.data.set(bytes, at);
  }
  load(at) {
    return new DataView(this.data.buffer).getUint32(at, true);
  }
  store(at, value) {
    new DataView(this.data.buffer).setUint32(at, value, true);
  }
  string(at, wide = false) {
    let end = at;
    for (; end < this.data.length; end += wide ? 2 : 1)
      if (wide ? !this.data[end] && !this.data[end + 1] : !this.data[end]) break;
    return new TextDecoder(wide ? 'utf-16le' : 'shift_jis').decode(this.data.subarray(at, end));
  }
}
const profiles = Object.keys(NATIVE_CONFIGURATION_MEMORY_LAYOUTS);
test('both native settings retain their original two-target allocation limit', () => {
  for (const profile of profiles) {
    const configuration = new NativeConfiguration({ profile }),
      p = new Memory(),
      owner = 0x1000,
      codec = new NativeConfigurationMemory(p, configuration, { owner }),
      offset = profile.startsWith('sdk-') ? 47892 : 51076;
    assert.equal(configuration.fields.general.renderTargetCount, 2);
    codec.push();
    assert.equal(p.load(owner + offset), 2);
    p.store(owner + offset, 0);
    assert.equal(codec.pull(), true);
    assert.equal(configuration.fields.general.renderTargetCount, 0);
    const fresh = new NativeConfiguration({ profile });
    fresh.restore(configuration.snapshot());
    assert.equal(fresh.fields.general.renderTargetCount, 0);
  }
});
test('display-log configuration keeps native defaults and shares both CP932 prefix fields with Settings', () => {
  for (const profile of profiles) {
    const configuration = new NativeConfiguration({ profile }),
      p = new Memory(),
      owner = 0x1000,
      codec = new NativeConfigurationMemory(p, configuration, { owner }),
      base = owner + codec.layout.log;
    assert.deepEqual(configuration.fields.log, {
      type: 1,
      col: 40,
      prof: 4,
      nameline: 1,
      nameFirst: '',
      nameLast: '',
      indent: 1,
      nameindent: 0,
      dispMes: 1,
      dispName: 1,
      space: 0,
      escape: 1,
      crNext: 0,
    });
    configuration.fields.applyStartup(
      parseXML(
        '<document><GAME><log><col>28</col><prof>2</prof><nameline>0</nameline><nameformat><first>「</first><last>」</last></nameformat><disp><mes>0</mes><name>3</name></disp><cr_next>1</cr_next></log></GAME></document>',
      ),
    );
    codec.push();
    assert.deepEqual(
      [0, 4, 8, 12, 88, 92, 108].map((offset) => p.load(base + offset)),
      [1, 28, 2, 0, 0, 3, 1],
    );
    assert.equal(p.string(base + 16), '「');
    assert.equal(p.string(base + 48), '」');
    assert.equal(codec.pull(), false);
    p.store(base + 4, 36);
    p.store(base + 100, 0);
    assert.equal(codec.pull(), true);
    assert.equal(configuration.getField('log.col'), 36);
    assert.equal(configuration.getField('log.escape'), 0);
    const restored = new NativeConfiguration({ profile });
    restored.restore(configuration.snapshot());
    assert.deepEqual(restored.fields.log, configuration.fields.log);
  }
});
test('one raw Engine allocation aliases Settings and shares live font, key, scene and variable storage', () => {
  for (const profile of profiles) {
    const configuration = new NativeConfiguration({
        profile,
        startup: parseXML('<document></document>'),
      }),
      p = new Memory(),
      owner = 0x1000,
      layout = NATIVE_CONFIGURATION_MEMORY_LAYOUTS[profile],
      codec = new NativeConfigurationMemory(p, configuration, {
        owner,
        settings: owner + layout.settingsOffset,
      });
    configuration.font.name = '猫 Family';
    configuration.keys.rows[10].keyboard.set([4, 5, 6, 7]);
    configuration.soundOptions.use3d = 1;
    configuration.screen.sizes[2] = [1024, 768];
    configuration.setField('paths.picture', '画像');
    configuration.setField('application.title', '$title$原題');
    configuration.setField('scene.autoSelect', 0xffffffff);
    configuration.variableRanges.global[15] = 0x80000000;
    configuration.setField('texture.size', [256, 128]);
    configuration.setField('texture.grid', [12, 26]);
    configuration.fields.texture.areas[7].set([1, 2, 3, 4]);
    configuration.fields.texture.bppY.set([0, 26]);
    p.store(owner + 0x80, 0xa5a5a5a5);
    codec.push();
    assert.equal(p.load(owner + 0x80), 0xa5a5a5a5);
    assert.equal(p.string(owner + layout.font, profile.startsWith('nekopara')), '猫 Family');
    assert.equal(p.load(owner + layout.autoSelect), 0xffffffff);
    assert.equal(
      p.string(
        owner + (profile.startsWith('nekopara') ? 2136 : 1356),
        profile.startsWith('nekopara'),
      ),
      '$title$原題',
    );
    assert.equal(p.load(owner + layout.variableRanges + 124), 0x80000000);
    assert.equal(p.load(owner + layout.texture + 4), 128);
    assert.equal(p.load(owner + layout.texture + 12), 26);
    assert.equal(p.load(owner + layout.texture + 16 + 7 * 16 + 12), 4);
    assert.equal(codec.pull(), false);
    p.store(codec.settings + layout.blocks[1] - layout.settingsOffset, 77);
    p.store(owner + layout.font + configuration.fields.styleOffset + 8, 1);
    p.store(owner + layout.systemVoice + 1536 + 12, 0);
    p.store(owner + layout.variableRanges + 64, 19);
    p.store(owner + layout.autoSelect, 2);
    p.store(owner + layout.texture + 144 + 4, 52);
    assert.equal(codec.pull(), true);
    assert.equal(new DataView(configuration.blocks[1].buffer).getUint32(0, true), 77);
    assert.equal(configuration.font.weight, 1);
    assert.equal(configuration.fields.sysplay[3], 0);
    assert.equal(configuration.variableRanges.global[0], 19);
    assert.equal(configuration.getField('scene.autoSelect'), 2);
    assert.equal(configuration.getField('texture.bppY')[1], 52);
    assert.equal(codec.pull(), false);
    const snapshot = configuration.snapshot(),
      refs = codec.snapshotRefs(),
      fresh = new NativeConfiguration({ profile });
    fresh.restore(snapshot);
    const restored = new NativeConfigurationMemory(p, fresh, { owner });
    restored.restoreRefs(refs);
    assert.equal(restored.pull(), false);
    assert.equal(restored.settings, codec.settings);
    assert.throws(
      () => new NativeConfigurationMemory(p, fresh, { owner, settings: owner }),
      /must alias/,
    );
  }
});

test('native language vectors use UTF16 SSO records while preserving startup language identities', () => {
  const configuration = new NativeConfiguration({
      profile: profiles.find((name) => name.startsWith('nekopara')),
    }),
    p = new Memory(),
    owner = 0x1000,
    codec = new NativeConfigurationMemory(p, configuration, { owner }),
    layout = codec.layout;
  configuration.language.entries = [
    { code: 0x411, prefix: 'ja', lang: '日本語', accel: [65, 8], accelsub: [66, 4] },
    {
      code: 0x409,
      prefix: 'long-prefix',
      lang: 'Long Language Name',
      accel: [67, 16],
      accelsub: [68, 0],
    },
  ];
  codec.push();
  const vector = p.load(owner + layout.languageVector),
    rows = p.load(vector);
  assert.equal(p.load(vector + 4) - rows, 112);
  assert.equal(codec.readWideSSO(rows), 'ja');
  assert.equal(codec.readWideSSO(rows + 56), 'long-prefix');
  assert.equal(p.load(rows + 20), 7);
  assert.ok(p.load(rows + 56 + 20) >= 8);
  assert.equal(codec.pull(), false);
  codec.store(rows + 50, 90, 2);
  codec.store(rows + 48, 16, 1);
  codec.wideSSO(rows + 24, '新しい名前');
  assert.equal(codec.pull(), true);
  assert.equal(configuration.language.entries[0].code, 0x411);
  assert.equal(configuration.language.entries[0].lang, '新しい名前');
  assert.deepEqual(configuration.language.entries[0].accel, [90, 16]);
  configuration.language.entries.splice(1);
  codec.push();
  assert.equal(p.load(vector + 4) - p.load(vector), 56);
  assert.equal(codec.pull(), false);
  p.store(vector + 4, p.load(vector) + 112);
  assert.throws(() => codec.pull(), /startup language identities/);
});
