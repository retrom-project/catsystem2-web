// SPDX-License-Identifier: MPL-2.0
import test from 'node:test';
import assert from 'node:assert/strict';
import { Binary } from '../src/binary.mjs';
import { KCSMachine, nativeReply } from '../src/kcs/vm.mjs';
import { parseXML } from '../src/xml.mjs';
import { NativeConfiguration, nativeConfiguration } from '../src/native/config.mjs';

const game = 'nekopara-vol3-engine-2.6.1.76';
const sdk = 'sdk-4.01-engine-2.6.1.74';
const word = (bytes, at) =>
  new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength).getUint32(at * 4, true);
const xml = (text) => parseXML(`<document>${text}</document>`);
const machine = () =>
  new KCSMachine({
    body: new Binary(Uint8Array.of(59)),
    codeSize: 1,
    data: new Uint8Array(8192),
    stackSize: 1024,
  });

test('local and global variable ranges retain all eight startup records and native sentinel queries', () => {
  for (const profile of [sdk, game]) {
    const config = new NativeConfiguration({
        profile,
        startup: xml(
          '<GAME><flag><max>4096</max><local2><start>19</start><count>7</count></local2><global7><start>2000</start><count>30</count></global7></flag></GAME>',
        ),
      }),
      m = machine(),
      services = { configuration: config };
    assert.deepEqual(nativeConfiguration(0x316, [0, 0, 0, 4], m, services), nativeReply(1, 1));
    assert.deepEqual([m.load(0), m.load(4)], [0, 512]);
    nativeConfiguration(0x316, [0, 2, 0, 4], m, services);
    assert.deepEqual([m.load(0), m.load(4)], [19, 7]);
    nativeConfiguration(0x316, [1, 7, 0, 4], m, services);
    assert.deepEqual([m.load(0), m.load(4)], [2000, 30]);
    nativeConfiguration(0x316, [0, 1, 0, 4], m, services);
    assert.deepEqual([m.load(0), m.load(4)], [0xffffffff, 0xffffffff]);
    assert.deepEqual(
      nativeConfiguration(0x316, [1, 0xffffffff, 0xffffffff, 0xffffffff], m, services),
      nativeReply(1, 0),
    );
    assert.deepEqual([m.load(0), m.load(4)], [0xffffffff, 0xffffffff]);
  }
});

test('both engine layouts construct complete voice, message, effect and window defaults', () => {
  for (const profile of [sdk, game]) {
    const config = new NativeConfiguration({ profile });
    const [voice, message, effect, window] = config.blocks;
    assert.deepEqual(
      config.blocks.map((b) => b.length),
      profile === sdk ? [5628, 60, 28, 12] : [5628, 72, 32, 12],
    );
    assert.equal(config.variableCount, 1024);
    assert.deepEqual(
      [0, 1, 2, 3].map((i) => word(voice, i)),
      [100, 100, 100, 100],
    );
    for (let i = 0; i < 48; i++) {
      assert.equal(word(voice, 5 + 29 * i), 1);
      assert.equal(word(voice, 14 + 29 * i), 100);
      assert.equal(word(voice, 25 + 29 * i), 100);
    }
    assert.deepEqual(
      Array.from({ length: 15 }, (_, i) => word(message, i)),
      [4, 4, 0, 15, 5, 1, 0, 1, 0, 100, 0, 0xffffffff, 0, 0, 0],
    );
    assert.deepEqual(
      Array.from({ length: 7 }, (_, i) => word(effect, i)),
      [0, 0, 1, 1, 1, 5, 0],
    );
    assert.deepEqual(
      [0, 1, 2].map((i) => word(window, i)),
      [0x64ffffff, 1, 1],
    );
  }
});

test('startup paths configure records and automatic message timing with exact tag case', () => {
  const config = new NativeConfiguration({
    profile: game,
    startup: xml(`
    <GAME><flag><max>4096</max></flag><autopriset><p04><base>12</base><char>9</char></p04></autopriset><wndcolor><r>10</r><g>20</g><b>30</b><a>128</a></wndcolor><string><wipe>1</wipe></string><ctrlmode>3</ctrlmode></GAME>
    <VOICE><v00><voice>猫</voice><mastervol>67</mastervol><head>call</head><group>2</group><int>VOICE.INT/Audio</int></v00><vol><master>70</master><bgm>60</bgm></vol></VOICE>
    <game><flag><max>1</max></flag></game>`),
  });
  assert.equal(config.variableCount, 4096);
  assert.equal(word(config.blocks[0], 0), 42);
  assert.equal(word(config.blocks[0], 1), 70);
  assert.equal(word(config.blocks[0], 14), 67);
  assert.equal(word(config.blocks[0], 25), 2);
  assert.equal(new TextDecoder('shift_jis').decode(config.blocks[0].subarray(24, 26)), '猫');
  assert.equal(new TextDecoder().decode(config.blocks[0].subarray(104, 119)), 'voice.int/audio');
  assert.deepEqual(
    [3, 4, 14, 15].map((i) => word(config.blocks[1], i)),
    [12, 9, 1, 3],
  );
  assert.equal(word(config.blocks[3], 0), 0x320a141e);
});

test('game defaults and preferences overwrite only native schema fields and derive wrapped volumes', () => {
  const config = new NativeConfiguration({
    profile: game,
    gamedef: xml(
      '<VOICE><vol_master>80</vol_master><vol_bgm>50</vol_bgm></VOICE><MESSAGE><speed>2</speed><CHAR>17</CHAR></MESSAGE><EFFECT><skipmot>1</skipmot></EFFECT>',
    ),
    preferences: xml(
      '<VOICE><vol_bgm>25</vol_bgm><play47>0</play47><mute_master>1</mute_master></VOICE><MESSAGE><char>99</char><contskip>1</contskip></MESSAGE><GAME><wndcolor>0x99010203</wndcolor></GAME>',
    ),
  });
  assert.equal(word(config.blocks[0], 0), 20);
  assert.equal(word(config.blocks[0], 5 + 47 * 29), 0);
  assert.equal(word(config.blocks[0], 1402), 1);
  assert.deepEqual(
    [0, 4, 13].map((i) => word(config.blocks[1], i)),
    [2, 17, 1],
  );
  assert.equal(word(config.blocks[2], 7), 1);
  assert.equal(word(config.blocks[3], 0), 0x99010203);
  config.applyPreferences(xml('<VOICE><vol_master>-1</vol_master><vol_bgm>2</vol_bgm></VOICE>'));
  config.deriveVolumes();
  assert.equal(word(config.blocks[0], 0), Math.floor(0xfffffffe / 100));
});

test('native configuration copies accept address zero and invalid optional mappings, and setter has three blocks', () => {
  const config = new NativeConfiguration({ profile: game, authorMode: 1 }),
    m = machine();
  const services = { configuration: config };
  assert.deepEqual(nativeConfiguration(0x167, [0, 6000, 6100, 6200], m, services), nativeReply(2));
  assert.equal(m.load(0), 100);
  assert.equal(m.load(6000), 4);
  assert.equal(m.load(6200), 0x64ffffff);
  m.store(6000, 17);
  m.store(6100, 9);
  nativeConfiguration(0x168, [0x7fffffff, 6000, 6100], m, services);
  assert.equal(word(config.blocks[1], 0), 17);
  assert.equal(word(config.blocks[2], 0), 9);
  assert.equal(word(config.blocks[3], 0), 0x64ffffff);
  assert.deepEqual(nativeConfiguration(0x1d1, [], m, services), nativeReply(1, 1));
  assert.deepEqual(nativeConfiguration(0x315, [], m, services), nativeReply(1, 1024));
  config.setField('scene.autoSelect', 0xffffffff);
  assert.deepEqual(nativeConfiguration(0x3e7, [], m, services), nativeReply(1, 0xffffffff));
  let changed;
  nativeConfiguration(0x274, [2], m, {
    ...services,
    configurationChanged: (name) => (changed = name),
  });
  assert.equal(config.authorMode, 2);
  assert.equal(changed, 'authorMode');
  assert.throws(() => nativeConfiguration(0x168, [0, 1, 2, 3], m, services), /expects 3/);
  assert.equal(nativeConfiguration(0x167, [0, 1, 2, 3], m), undefined);
  const fresh = new NativeConfiguration({ profile: game });
  fresh.restore(config.snapshot());
  assert.deepEqual(fresh.snapshot(), config.snapshot());
  assert.throws(
    () => new NativeConfiguration({ profile: sdk }).restore(config.snapshot()),
    /profile/,
  );
});

test('configuration getters preserve system-voice neighbors, RNG consumption and distinct fullscreen settings', () => {
  for (const profile of [sdk, game]) {
    const config = new NativeConfiguration({
        profile,
        startup: xml('<GAME><log><static>3</static></log></GAME>'),
      }),
      services = { configuration: config };
    config.screen.fullSize = 7;
    config.screen.fullscreen = 0;
    config.screen.multiWindowPosition = 9;
    assert.equal(nativeConfiguration(0x2e5, [], null, services).value, 0);
    config.screen.fullscreen = 1;
    assert.equal(nativeConfiguration(0x2e5, [], null, services).value, 9);
    assert.equal(nativeConfiguration(0x354, [], null, services).value, 3);
    config.fields.sysplay.fill(0);
    let calls = 0;
    services.random = {
      rand() {
        calls++;
        return 0xffffffff;
      },
    };
    assert.equal(nativeConfiguration(0x247, [], null, services).value, 0xffffffff);
    assert.equal(calls, 0);
    config.fields.sysplay[4] = 1;
    config.fields.sysplay[8] = 0xffffffff;
    assert.equal(nativeConfiguration(0x247, [], null, services).value, 8);
    assert.equal(calls, 1);
    assert.equal(nativeConfiguration(0x246, [8], null, services).value, 0xffffffff);
    nativeConfiguration(0x248, [-1, 0x12345678], null, services);
    assert.equal(new DataView(config.fields.systemVoice.buffer).getUint32(1532, true), 0x12345678);
    assert.equal(nativeConfiguration(0x246, [-1], null, services).value, 0x12345678);
  }
});

test('language natives retain unvalidated indices, change notifications and prefix fallbacks', () => {
  const config = new NativeConfiguration({ profile: game }),
    m = machine(),
    messages = [],
    changes = [],
    services = {
      configuration: config,
      configurationChanged: (name) => changes.push(name),
      configurationWindowMessage: (packet) => messages.push(packet),
    };
  config.language.entries = [{ prefix: 'jp' }, { prefix: 'en' }];
  config.language.default = 1;
  config.language.main = 0;
  config.language.sub = 0xffffffff;
  m.bytes(0, 16).fill(0xa5);
  nativeConfiguration(0x40c, [0, 8], m, services);
  assert.deepEqual([...m.bytes(0, 4)], [106, 112, 0, 0xa5]);
  assert.deepEqual([...m.bytes(8, 4)], [101, 110, 0, 0xa5]);
  nativeConfiguration(0x41d, [2, 99], m, services);
  assert.equal(config.language.sub, 99);
  assert.deepEqual(changes, ['language.sub']);
  assert.deepEqual(messages, [{ message: 0x470, wParam: 0, lParam: 0 }]);
  nativeConfiguration(0x41d, [2, 99], m, services);
  nativeConfiguration(0x41d, [3, 7], m, services);
  assert.equal(messages.length, 1);
  config.language.default = 9;
  nativeConfiguration(0x40c, [0, 8], m, services);
  assert.equal(m.load(8, 1), 0);
  assert.equal(nativeConfiguration(0x41d, [1, 4], m, { configuration: config }), undefined);
  assert.equal(config.language.main, 0);
});
