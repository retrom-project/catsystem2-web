// SPDX-License-Identifier: MPL-2.0
// Authored state shared by the public contract tests and the original-PE probe.
import { NativeConfiguration } from '../../src/native/config.mjs';

export function fesConfigurationFixture(profile) {
  const configuration = new NativeConfiguration({ profile });
  configuration.blocks.forEach((bytes, block) => {
    const words = new Uint32Array(bytes.buffer, bytes.byteOffset, bytes.length / 4);
    for (let i = 0; i < words.length; i++) words[i] = 1000 + block * 5000 + i;
  });
  configuration.autoPresets.forEach((_, i, words) => {
    words[i] = 0x1000 + i;
  });
  configuration.setField('font.name', '比較フォント');
  configuration.setField('font.ruby', 'Ruby比較');
  configuration.getField('font.shadow').set([11, 22, 33]);
  configuration.setField('font.prop', 44);
  configuration.setField('font.fix', 55);
  configuration.setField('screen.fullscreen', 1);
  configuration.setField('language.ui', 1);
  configuration.setField('language.main', 2);
  configuration.setField('language.sub', 0xffffffff);
  configuration.setField('window.active', 3);
  configuration.setField('scene.animation', 4);
  configuration.getField('voice.sysplay').forEach((_, i, words) => {
    words[i] = 100 + i;
  });
  configuration.deriveVolumes();
  return configuration;
}

export const fesConfigurationStrings = Object.freeze({ 3: '猫フォント', 4: 'Ruby猫' });

// A separate list, copied from the two original dispatch chains rather than
// deriving expected coverage from the implementation's field catalogue.
const common =
  'vol_master vol_bgm vol_se vol_voice vol_play mute_master mute_bgm mute_se mute_voice mute_play play sysplay messpd autospd stillread contauto waitpcm autocur dorama effspd autodel dragwnd wndcolor wndframe fshadow effcut autospd_b autospd_c autoind contvoice screen fullskip readcol enable_readcol skip_speed contskip iswindow font ruby fontweight fontfix fontprop strscroll';
const additional =
  'lang_ui lang_text_main lang_text_sub ctrlmode autoleft activewindow motcut enable_readselcol enable_sceneanm';

export function fesConfigurationCases() {
  const fields = `${common} ${additional} unknown WNDCOLOR wndfram`.split(' ');
  const result = fields.flatMap((name) => [
    { operation: 'get', name, ex1: 0, ex2: 0 },
    {
      operation: 'set',
      name,
      value: name === 'autospd' ? 4 : name === 'font' || name === 'ruby' ? 3 : 7,
      ex1: 0,
      ex2: 0,
    },
  ]);
  for (const name of ['play', 'sysplay'])
    for (const [ex1, ex2] of [
      [4, 2],
      [-1, 0],
      [47, 0],
      [48, 0],
      [0, -1],
      [47, 1],
    ])
      for (const operation of ['get', 'set']) result.push({ operation, name, value: 17, ex1, ex2 });
  for (const ex1 of [-1, 1, 2, 3, 0x7fffffff])
    for (const operation of ['get', 'set'])
      result.push({ operation, name: 'fshadow', value: 19, ex1, ex2: 0 });
  for (const name of ['lang_ui', 'lang_text_main', 'lang_text_sub'])
    for (const value of [-1, 0, 1, 2, 3, 99])
      result.push({ operation: 'set', name, value, ex1: 0, ex2: 0 });
  result.push({ operation: 'set', name: 'ruby', value: 4, ex1: 0, ex2: 0 });
  return result;
}

export function fesConfigurationStateBytes(configuration) {
  const sysplay = configuration.getField('voice.sysplay');
  const words = [
    configuration.getField('screen.fullscreen'),
    configuration.getField('language.ui'),
    configuration.getField('language.main'),
    configuration.getField('language.sub'),
    configuration.getField('window.active'),
    configuration.getField('scene.animation'),
  ].map((value) => value ?? 0);
  const arrays = [
    ...configuration.blocks,
    configuration.fields.data,
    new Uint8Array(configuration.autoPresets.buffer),
    new Uint8Array(sysplay.buffer, sysplay.byteOffset, sysplay.byteLength),
    new Uint8Array(Uint32Array.from(words).buffer),
  ];
  const bytes = new Uint8Array(arrays.reduce((sum, array) => sum + array.length, 0));
  let at = 0;
  for (const array of arrays) {
    bytes.set(array, at);
    at += array.length;
  }
  return bytes;
}

export const fesM2Models = Object.freeze([
  ['left', { motion: 0, eff_dif: 2, eff_iner: 0, eff_blink: 0, eff_lip: 0, fade: 3, level: 97 }],
  ['right', { motion: 5, eff_dif: 0, eff_iner: 1, eff_blink: 0, eff_lip: 0, fade: 0, level: 88 }],
]);
export function fesM2Cases() {
  const result = [];
  for (const manager of ['loaded', 'empty', 'absent'])
    for (const name of [
      'motion',
      'eff_dif',
      'eff_iner',
      'eff_blink',
      'eff_lip',
      'fade',
      'interleave',
      'iner_lv',
      'iner_enable',
      'reset',
      'unknown',
    ]) {
      result.push({ operation: 'get', manager, name, part: 'Body' });
      for (const value of [0, 7, undefined])
        result.push({ operation: 'set', manager, name, value, part: 'Body' });
    }
  for (const name of ['iner_lv', 'iner_enable'])
    for (const part of ['Body', 'Missing', undefined]) {
      result.push({ operation: 'get', manager: 'loaded', name, part });
      for (const value of [-1, 1, 200, 201])
        result.push({ operation: 'set', manager: 'loaded', name, value, part });
    }
  for (const index of [511, 512, -1])
    result.push({ operation: 'get', manager: 'loaded', name: 'motion', index });
  return result;
}
