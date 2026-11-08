// SPDX-License-Identifier: MPL-2.0
// Original preference writers: SDK 5D1440/5D18F0; newer engine 721000/721510.
import { encodeCP932 } from '../kcs/strings.mjs';
import { parseNativeXML } from './xml.mjs';

const SDK = 'sdk-4.01-engine-2.6.1.74';
const GAME = 'nekopara-vol3-engine-2.6.1.76';
const two = (index) => String(index).padStart(2, '0');
const blockWord = (configuration, block, word) => {
  const bytes = configuration.blocks[block];
  return new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength).getUint32(word * 4, true);
};
const node = (name, children) => ({ name, children, text: '' });
const leaf = (name, value) => ({
  name,
  children: [],
  text: typeof value === 'number' ? String(value | 0) : String(value).split('\0')[0],
});
const fields = (configuration, pairs) =>
  pairs.map(([tag, field]) => {
    const value = configuration.getField(field);
    if (value === undefined) throw new Error(`Native preferences lack backing for ${field}`);
    return leaf(tag, value);
  });
const words = (configuration, block, pairs) =>
  pairs.map(([tag, index]) => leaf(tag, blockWord(configuration, block, index)));

function system(configuration, game) {
  const result = [];
  if (game)
    result.push(
      node('language', [
        node(
          'id',
          fields(configuration, [
            ['sub', 'language.sub'],
            ['main', 'language.main'],
            ['UI', 'language.ui'],
          ]),
        ),
      ]),
    );
  result.push(
    node(
      'FULL_SCREEN',
      fields(configuration, [
        ['no_full_res', 'screen.noFullResolution'],
        ['wall', 'screen.wall'],
        ['mw_pos', 'screen.multiWindowPosition'],
        ['full_pos', 'screen.fullPosition'],
        ['full_size', 'screen.fullSize'],
      ]),
    ),
    node(
      'D3D',
      fields(configuration, [
        ['tex_comp', 'd3d.textureCompression'],
        ['tex_size', 'd3d.textureSize'],
        ['fogtype', 'd3d.fogType'],
        ['antialias', 'd3d.antialias'],
        ['vsync', 'd3d.vsync'],
        ['light', 'd3d.light'],
        ['hardTnL', 'd3d.hardTnL'],
        ['backbuffer', 'd3d.backBuffer'],
      ]),
    ),
    node(
      'DEPEND',
      fields(configuration, [
        ['use_z', 'general.useZ'],
        ['z32', 'general.z32'],
        ['gdi_cap', 'general.gdiCap'],
      ]),
    ),
    node(
      'ETC',
      fields(configuration, [
        ['waitd3dcommand', 'general.waitD3DCommand'],
        ['disablepixelshader', 'general.disablePixelShader'],
        ['imgimport', 'paths.imageImport'],
        ['export', 'paths.export'],
        ['picture', 'paths.picture'],
        ['disablemovie', 'general.disableMovie'],
        ['dualcore', 'general.dualCore'],
        ['imgcache', 'general.imageCache'],
        ['cache', 'general.cache'],
      ]),
    ),
    node('SOUND', [
      leaf('stereo', configuration.soundOptions.stereo),
      leaf('sticky', configuration.soundOptions.sticky),
      leaf('ds3d', configuration.soundOptions.use3d),
    ]),
    node(
      'TEXTURE',
      fields(configuration, [
        ['dither', 'texture.dither'],
        ['mag', 'texture.mag'],
        ['min', 'texture.min'],
        ['bpp', 'texture.bpp'],
      ]),
    ),
    node(
      'WINDOW',
      fields(configuration, [
        ['setmode', 'screen.setMode'],
        ['fullscreen', 'screen.fullscreen'],
        ['out_info', 'screen.outInfo'],
        ['camouflage', 'screen.camouflage'],
        ['screensaver', 'screen.screensaver'],
        ['cursor_mode', 'screen.cursorMode'],
        ['limit', 'screen.limit'],
        ['full_wide', 'screen.fullWide'],
        ['bpp', 'screen.bpp'],
        ['mode', 'screen.mode'],
        ['fps', 'screen.fps'],
        ['full_height', 'screen.fullHeight'],
        ['full_width', 'screen.fullWidth'],
        ['height', 'screen.height'],
        ['width', 'screen.width'],
      ]),
    ),
  );
  return result;
}

function objects(configuration, game) {
  const keyRows = [];
  for (let row = 79; row >= 0; row--)
    if (configuration.keys.rows[row].enabled)
      for (let key = 3; key >= 0; key--)
        for (const [prefix, field, repeat] of [
          ['jp', 'rep_joypad', true],
          ['ms', 'rep_mouse', true],
          ['kb', 'rep_keyboard', true],
          ['jp', 'joypad', false],
          ['ms', 'mouse', false],
          ['kb', 'keyboard', false],
        ])
          keyRows.push(
            leaf(
              `${prefix}${key + 1}${repeat ? 'r' : ''}_${two(row)}`,
              configuration.keys.rows[row][field][key],
            ),
          );
  keyRows.push(leaf('enable_joypad', configuration.keys.enableJoypad));
  const message = [
    ...(game ? [['enable_read_sel', 17]] : []),
    ['wipe', 14],
    ['contskip', 13],
    ['skipspeed', 12],
    ['read_color', 11],
    ['enable_read', 10],
    ...(game
      ? [
          ['autoleft', 16],
          ['ctrlmode', 15],
        ]
      : []),
    ['log_limit', 9],
    ['skip_full', 8],
    ['waitpcm', 7],
    ['still', 5],
    ['cont', 6],
    ['ind', 2],
    ['CHAR', 4],
    ['base', 3],
    ['auto_p', 1],
    ['speed', 0],
  ];
  return [
    node(
      'SYSTEMVOICE',
      Array.from({ length: 48 }, (_, i) =>
        leaf(`play${two(47 - i)}`, configuration.getField('voice.sysplay')[47 - i]),
      ),
    ),
    node('GAME', [
      ...(game
        ? fields(configuration, [
            ['enable_scene_anm', 'scene.animation'],
            ['always_active', 'window.active'],
          ])
        : []),
      ...fields(configuration, [['autoselect', 'scene.autoSelect']]),
      ...words(configuration, 3, [
        ['drawwnd', 2],
        ['enabledrag', 1],
        ['wndcolor', 0],
      ]),
    ]),
    node(
      'EFFECT',
      words(configuration, 2, [
        ...(game ? [['skipmot', 7]] : []),
        ['dramatic', 6],
        ['auto_cds', 5],
        ['auto_cd', 4],
        ['auto_c', 3],
        ['help', 2],
        ['skipdraw', 1],
        ['speed', 0],
      ]),
    ),
    node('MESSAGE', words(configuration, 1, message)),
    node('VOICE', [
      ...words(configuration, 0, [
        ['mute_play', 1406],
        ['mute_voice', 1405],
        ['mute_se', 1404],
        ['mute_bgm', 1403],
        ['mute_master', 1402],
        ['cont_voice', 4],
      ]),
      ...Array.from({ length: 48 }, (_, i) =>
        leaf(`play${two(47 - i)}`, blockWord(configuration, 0, 5 + (47 - i) * 29)),
      ),
      ...words(configuration, 0, [
        ['vol_master', 1397],
        ['vol_play', 1401],
        ['vol_voice', 1400],
        ['vol_se', 1399],
        ['vol_bgm', 1398],
      ]),
    ]),
    node('KEY', keyRows),
    node('FONT', [
      ...fields(configuration, [
        ['fixed', 'font.fix'],
        ['proportional', 'font.prop'],
        ['bold', 'font.weight'],
      ]),
      node(
        'shadow',
        fields(configuration, [
          ['around', 'font.around'],
          ['rightdown', 'font.rightdown'],
        ]),
      ),
      ...fields(configuration, [
        ['faceruby', 'font.ruby'],
        ['face', 'font.name'],
      ]),
    ]),
    node('CONFIG', fields(configuration, [['type', 'configuration.type']])),
  ];
}

function serialize(node, depth = 0) {
  const indent = '  '.repeat(depth);
  if (!node.children.length) return `${indent}<${node.name}>${node.text}</${node.name}>\r\n`;
  return `${indent}<${node.name}>\r\n${node.children.map((child) => serialize(child, depth + 1)).join('')}${indent}</${node.name}>\r\n`;
}

export function serializeNativePreferences(configuration, { flags = 3 } = {}) {
  if (![SDK, GAME].includes(configuration?.profile))
    throw new Error('Native preferences require a recovered configuration profile');
  const game = configuration.profile === GAME;
  const document = node('document', [
    ...(flags & 2 ? objects(configuration, game) : []),
    ...(flags & 1 ? system(configuration, game) : []),
  ]);
  // Both original serializers write string contents verbatim, including XML
  // punctuation. Escaping these strings would change the native file format.
  const text = `<?xml version="1.0" encoding="${game ? 'UTF-8' : 'Shift_JIS'}"?>\r\n${serialize(document)}`;
  return game ? new TextEncoder().encode(text) : encodeCP932(text);
}

export function applyNativePreferences(configuration, bytes, { flags = 3 } = {}) {
  if (![SDK, GAME].includes(configuration?.profile))
    throw new Error('Native preferences require a recovered configuration profile');
  let root;
  try {
    root = parseNativeXML(bytes, configuration.profile === GAME ? 'utf-8' : 'shift_jis');
  } catch {
    return false;
  }
  configuration.applyUserPreferences(root, flags);
  return true;
}
