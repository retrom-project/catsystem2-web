// SPDX-License-Identifier: MPL-2.0
import { fesConfigurationFixture } from './fes-config-fixture.mjs';
import { encodeCP932 } from '../../src/kcs/strings.mjs';

export const preferenceScalarNames = Object.freeze([
  'screen.width',
  'screen.height',
  'screen.fullWidth',
  'screen.fullHeight',
  'screen.currentWidth',
  'screen.currentHeight',
  'screen.fullWide',
  'screen.limit',
  'screen.fps',
  'screen.cursorMode',
  'texture.bpp',
  'texture.min',
  'texture.mag',
  'texture.dither',
  'sound.use3d',
  'sound.sticky',
  'sound.stereo',
  'general.imageCache',
  'screen.screensaver',
  'screen.camouflage',
  'general.gdiCap',
  'general.z32',
  'general.useZ',
  'screen.outInfo',
  'general.cache',
  'screen.mode',
  'screen.fullscreen',
  'screen.bpp',
  'd3d.hardTnL',
  'd3d.backBuffer',
  'd3d.light',
  'd3d.vsync',
  'd3d.antialias',
  'd3d.fogType',
  'd3d.textureSize',
  'd3d.textureCompression',
  'general.dualCore',
  'general.disableMovie',
  'general.disablePixelShader',
  'screen.fullSize',
  'screen.fullPosition',
  'screen.multiWindowPosition',
  'screen.wall',
  'general.waitD3DCommand',
  'screen.noFullResolution',
  'screen.setMode',
  'configuration.type',
  'window.drag',
  'language.ui',
  'language.main',
  'language.sub',
  'language.default',
  'window.active',
  'scene.animation',
  'scene.autoSelect',
]);
export const preferencePaths = Object.freeze([
  'paths.picture',
  'paths.export',
  'paths.imageImport',
]);
export function preferenceScalar(configuration, name) {
  return name.startsWith('sound.')
    ? configuration.soundOptions[name.slice(6)]
    : (configuration.getField(name) ?? 0);
}

export function preferencesFixture(profile, variant = 'authored') {
  const configuration = fesConfigurationFixture(profile),
    target = variant === 'target';
  preferenceScalarNames.forEach((name, i) => {
    const value = target ? 3 : i * 23 + 1;
    if (name.startsWith('sound.')) configuration.soundOptions[name.slice(6)] = value;
    else configuration.setField(name, value);
  });
  configuration.setField('language.default', 1);
  configuration.setField('language.ui', target ? 1 : 2);
  configuration.setField('language.main', target ? 1 : 0);
  configuration.setField('language.sub', 0xffffffff);
  if (configuration.language) configuration.language.entries = [{}, {}, {}];
  configuration.setField(
    'font.name',
    target
      ? '初期Font'
      : variant === 'empty'
        ? ''
        : variant === 'xml-text'
          ? '猫<&>"\''
          : '猫フォント',
  );
  configuration.setField('font.ruby', target ? '初期Ruby' : variant === 'empty' ? '' : 'Ruby猫');
  preferencePaths.forEach((name, i) =>
    configuration.setField(name, variant === 'empty' ? '' : `${target ? '初期' : '仮想'}/p${i}`),
  );
  for (let i = 0; i < 80; i++) {
    const row = configuration.keys.rows[i];
    row.name = `key${i}`;
    row.enabled = Number(variant === 'allkeys' || [0, 37, 79].includes(i));
    for (const [fieldIndex, field] of [
      'keyboard',
      'mouse',
      'joypad',
      'touch',
      'rep_keyboard',
      'rep_mouse',
      'rep_joypad',
      'rep_touch',
    ].entries())
      row[field].set(Array.from({ length: 4 }, (_, j) => (i + fieldIndex * 23 + j * 17) & 255));
  }
  if (variant === 'signed') {
    configuration.blocks.forEach((block) => new Uint32Array(block.buffer).fill(0xffffffff));
    configuration.setField('font.weight', 0xffffffff);
    configuration.setField('screen.fps', 0xffffffff);
  }
  return configuration;
}

export function preferenceStateBytes(configuration) {
  const scalars = new Uint8Array(
    Uint32Array.from(
      preferenceScalarNames.map((name) => preferenceScalar(configuration, name)),
    ).buffer,
  );
  const paths = new TextEncoder().encode(
    JSON.stringify(preferencePaths.map((name) => configuration.getField(name))),
  );
  const arrays = [
    ...configuration.blocks,
    configuration.fields.data,
    configuration.fields.systemVoice,
    scalars,
    paths,
  ];
  const out = new Uint8Array(arrays.reduce((sum, bytes) => sum + bytes.length, 0));
  let at = 0;
  for (const array of arrays) {
    out.set(array, at);
    at += array.length;
  }
  return out;
}

export function preferenceReaderInputs(profile) {
  const game = profile.startsWith('nekopara'),
    encoding = game ? 'UTF-8' : 'Shift_JIS';
  const declaration = `<?xml version="1.0" encoding="${encoding}"?>`;
  const documents = [
    ['entities', '<document><FONT><face>猫&amp;&lt;&gt;&quot;&apos;</face></FONT></document>'],
    ['numeric-entities', '<document><FONT><face>&#29483;&#x732b;</face></FONT></document>'],
    [
      'whitespace',
      '<document><FONT><face> A\r\nB\tC </face></FONT><VOICE><vol_master> 0xA </vol_master></VOICE></document>',
    ],
    [
      'duplicates',
      '<document><VOICE><vol_master>11</vol_master><vol_master>22</vol_master></VOICE><VOICE><vol_master>33</vol_master></VOICE></document>',
    ],
    ['comments', '<document><!-- comment --><VOICE><vol_master>17</vol_master></VOICE></document>'],
    ['cdata', '<document><FONT><face><![CDATA[猫 text]]></face></FONT></document>'],
    ['self-closing', '<document><FONT><face/><proportional>5</proportional></FONT></document>'],
    [
      'self-closing-space',
      '<document><FONT><face /><proportional>5</proportional></FONT></document>',
    ],
    [
      'attributes',
      '<document a="b"><VOICE data="x"><vol_master q="1">12</vol_master></VOICE></document>',
    ],
    ['unescaped-amp', '<document><FONT><face>猫&dog</face></FONT></document>'],
    [
      'multiple-root',
      '<document><VOICE><vol_master>11</vol_master></VOICE></document><document><VOICE><vol_master>22</vol_master></VOICE></document>',
    ],
    [
      'processing-instruction',
      '<document><?ignore value?><VOICE><vol_master>15</vol_master></VOICE></document>',
    ],
    [
      'doctype',
      '<!DOCTYPE document><document><VOICE><vol_master>21</vol_master></VOICE></document>',
    ],
    ['wrong-root', '<other><VOICE><vol_master>71</vol_master></VOICE></other>'],
    ['trailing', '<document><VOICE><vol_master>91</vol_master></VOICE></document>trailing'],
    ['mismatch', '<document><VOICE></document>'],
    ['case-sensitive', '<document><voice><vol_master>93</vol_master></voice></document>'],
  ].map(([variant, body]) => ({ variant, text: declaration + body }));
  documents.push({
    variant: 'no-declaration',
    text: '<document><VOICE><vol_master>77</vol_master></VOICE></document>',
  });
  documents.push({
    variant: 'wrong-encoding',
    text: `<?xml version="1.0" encoding="${game ? 'Shift_JIS' : 'UTF-8'}"?><document/>`,
  });
  documents.push({ variant: 'declaration-only', text: declaration });
  documents.push({
    variant: 'upper-declaration',
    text: declaration.replace('<?xml', '<?XML') + '<document></document>',
  });
  documents.push({
    variant: 'upper-attributes',
    text:
      declaration.replace('version', 'VERSION').replace('encoding', 'ENCODING') +
      '<document></document>',
  });
  documents.push({
    variant: 'header-lines',
    text:
      declaration.replace(' encoding=', '\r\nencoding=') +
      '<document><VOICE><vol_master>51</vol_master></VOICE></document>',
  });
  documents.push({
    variant: 'bom',
    text:
      '\uFEFF' + declaration + '<document><VOICE><vol_master>52</vol_master></VOICE></document>',
  });
  documents.push({ variant: 'text-only', text: declaration + 'text only' });
  return documents.map(({ variant, text }) => ({
    variant,
    xml: game ? new TextEncoder().encode(text) : encodeCP932(text),
  }));
}
