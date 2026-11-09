// SPDX-License-Identifier: MPL-2.0
// Configuration sources: game 71C8D0/71D160/71D3A0/71D760/71EF80/720630;
// SDK 5CE2F0/5CFB50/5D0BA0. These two builds use different text encodings.
import { NATIVE_ABIS, nativeABI } from './abi/index.mjs';
import { encodeCP932 } from '../kcs/strings.mjs';
import { findNativeXML } from './xml.mjs';
import { parseNativeInteger } from './standard.mjs';

const f = Math.fround;
const node = (root, path) => root && findNativeXML(root, path);
const integer = (root, path, fallback) =>
  node(root, path) ? (parseNativeInteger(node(root, path).text) ?? 0) >>> 0 : fallback >>> 0;
const text = (root, path, fallback = '') => node(root, path)?.text ?? fallback;
const two = (index) => String(index).padStart(2, '0');
const categories = [
  'keyboard',
  'mouse',
  'joypad',
  'touch',
  'rep_keyboard',
  'rep_mouse',
  'rep_joypad',
  'rep_touch',
];
const modifier = (value) => ({ A: 16, C: 8, S: 4 })[value[1]] ?? 0;
const accelerator = (value) => [value.charCodeAt(0) || 0, modifier(value)];

export const NATIVE_TEXT_CONFIGURATION_LAYOUTS = Object.freeze(
  Object.fromEntries(
    Object.entries(NATIVE_ABIS).map(([profile, abi]) => [profile, abi.text.configurationLayout]),
  ),
);

// 714590 chooses an exact current-format/aspect/rate mode, then the first
// larger mode in enumeration order, then the desktop mode. No host means the
// original helper returns without altering the requested dimensions.
export function nativeFullscreenSize(width, height, display) {
  if (!display) return [width >>> 0, height >>> 0];
  const current = display.current,
    modes = display.modes;
  if (!current || !Array.isArray(modes))
    throw new Error('Native display mode service lacks its current mode and mode list');
  const aspect = (mode) => {
    const ratio = f(f(f(mode.height >>> 0) / f(mode.width >>> 0)) * 1000);
    return Number.isFinite(ratio) && ratio >= -2147483648 && ratio < 2147483648
      ? Math.trunc(ratio)
      : -2147483648;
  };
  const same = (mode) =>
    mode.format === current.format &&
    aspect(mode) === aspect(current) &&
    (mode.refresh === current.refresh ||
      [mode.refresh, current.refresh].every((value) => value === 59 || value === 60));
  if (
    modes.some((mode) => same(mode) && mode.width === width >>> 0 && mode.height === height >>> 0)
  )
    return [width >>> 0, height >>> 0];
  const found = modes.find(
    (mode) => same(mode) && width >>> 0 <= mode.width && height >>> 0 <= mode.height,
  );
  return found
    ? [found.width >>> 0, found.height >>> 0]
    : [current.width >>> 0, current.height >>> 0];
}

// Setup accepts a saved fullscreen size only when an exact format/rate mode
// exists. Unlike startup's nearest-size selection, this check has no aspect filter.
export function nativeFullscreenAvailable(width, height, display) {
  if (!display) return false;
  const current = display.current,
    modes = display.modes;
  if (!current || !Array.isArray(modes))
    throw new Error('Native display mode service lacks its current mode and mode list');
  return modes.some(
    (mode) =>
      mode.width === width >>> 0 &&
      mode.height === height >>> 0 &&
      mode.format === current.format &&
      (mode.refresh === current.refresh ||
        [mode.refresh, current.refresh].every((value) => value === 59 || value === 60)),
  );
}

export class NativeConfigurationFields {
  constructor({ profile, uiLanguage, fontAvailability, displayModes } = {}) {
    const abi = nativeABI(profile),
      layout = abi.text.configurationLayout;
    if (!layout) throw new Error(`Unrecovered text configuration profile ${profile}`);
    this.profile = profile;
    this.abi = abi;
    this.layout = layout;
    this.uiLanguage = uiLanguage === undefined ? undefined : uiLanguage & 65535;
    this.fontAvailability = fontAvailability;
    this.displayModes = displayModes;
    this.data = new Uint8Array(layout.bytes);
    this.view = new DataView(this.data.buffer);
    this.styleOffset = layout.fontBytes * 2;
    this.keyNameOffset = this.styleOffset + 24;
    this.keyOffset = this.keyNameOffset + 80 * layout.keyNameBytes;
    this.style = new Uint32Array(this.data.buffer, this.styleOffset, 5);
    this.style.set([1, 1, 0, 1, 1]);
    this.configType = 0;
    this.candidates = { name: [], ruby: [] };
    this.fontOverrides = { name: false, ruby: false };
    this.writeText(0, 'ＭＳ ゴシック');
    this.font = {};
    for (const [name, offset] of [
      ['name', 0],
      ['ruby', layout.fontBytes],
    ])
      Object.defineProperty(this.font, name, {
        enumerable: true,
        get: () => this.readText(offset),
        set: (value) => {
          this.writeText(offset, value);
        },
      });
    for (const [name, index] of [
      ['around', 0],
      ['rightdown', 1],
      ['weight', 2],
      ['prop', 3],
      ['fix', 4],
    ])
      Object.defineProperty(this.font, name, {
        enumerable: true,
        get: () => this.style[index],
        set: (value) => {
          this.style[index] = value >>> 0;
        },
      });
    Object.defineProperty(this.font, 'shadow', {
      enumerable: true,
      get: () => this.style.subarray(0, 3),
    });
    Object.defineProperty(this.font, 'candidates', {
      enumerable: true,
      get: () => this.candidates,
    });
    this.language = abi.configuration.language
      ? { default: 0, ui: 0, main: 0, sub: 0xffffffff, entries: [], optionTable: '' }
      : undefined;
    this.screen = {
      width: 800,
      height: 600,
      virtualWidth: 800,
      virtualHeight: 600,
      fullWidth: 800,
      fullHeight: 600,
      fullWide: 0,
      currentWidth: 800,
      currentHeight: 600,
      fps: 60,
      limit: 1,
      noSkip: 0,
      fullSize: 0,
      fullPosition: 0,
      multiWindowPosition: 0,
      wall: 1,
      noFullResolution: 0,
      mode: 0,
      fullscreen: 0,
      bpp: 0xffffffff,
      setMode: 0,
      cursorMode: 1,
      screensaver: 0,
      camouflage: 0,
      outInfo: 1,
      frameImage: '',
      sizes: [
        [800, 600],
        [0, 0],
        [0, 0],
        [0, 0],
        [0, 0],
      ],
    };
    this.window = { drag: 1, ...(abi.configuration.windowActive ? { active: 1 } : {}) };
    this.application = { title: 'CS2', touch: 0 };
    this.scene = {
      autoSelect: 0,
      staticLog: 0,
      ...(abi.configuration.sceneAnimation ? { animation: 1 } : {}),
    };
    this.log = {
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
    };
    this.texture = {
      bpp: 32,
      min: 0,
      mag: 0,
      dither: 1,
      size: Uint32Array.of(256, 256),
      grid: new Uint32Array(2),
      areas: Array.from({ length: 8 }, () => new Uint32Array(4).fill(0xffffffff)),
      bppY: new Uint32Array(2),
    };
    this.general = {
      cache: 1,
      imageCache: 32,
      dualCore: 1,
      disableMovie: 0,
      disablePixelShader: 0,
      waitD3DCommand: 0,
      gdiCap: 0,
      z32: 0,
      useZ: 1,
      renderTargetCount: 2,
    };
    this.d3d = {
      backBuffer: 1,
      hardTnL: 1,
      light: 1,
      vsync: 1,
      antialias: 0,
      fogType: 1,
      textureSize: 0,
      textureCompression: 0,
    };
    this.paths = { picture: '', export: '', imageImport: '' };
    this.systemVoice = new Uint8Array(3264);
    this.sysplay = new Uint32Array(this.systemVoice.buffer, 1536, 48);
    this.sysplay.fill(1);
    this.keys = { rows: Array.from({ length: 80 }, (_, i) => this.keyRow(i)) };
    Object.defineProperty(this.keys, 'enableJoypad', {
      enumerable: true,
      get: () => this.view.getUint32(this.styleOffset + 20, true),
      set: (value) => {
        this.view.setUint32(this.styleOffset + 20, value >>> 0, true);
      },
    });
  }
  encode(value) {
    value = String(value);
    if (this.abi.text.settingsCharacterBytes === 1) return encodeCP932(value);
    const bytes = new Uint8Array(value.length * 2),
      view = new DataView(bytes.buffer);
    for (let i = 0; i < value.length; i++) view.setUint16(i * 2, value.charCodeAt(i), true);
    return bytes;
  }
  readText(offset) {
    const width = this.abi.text.settingsCharacterBytes;
    let end = offset;
    for (; end + width <= this.data.length; end += width)
      if (width === 1 ? this.data[end] === 0 : this.view.getUint16(end, true) === 0) break;
    if (end + width > this.data.length)
      throw new Error('Native text configuration string has no terminator');
    return new TextDecoder(width === 1 ? 'shift_jis' : 'utf-16le').decode(
      this.data.subarray(offset, end),
    );
  }
  writeText(offset, value) {
    const bytes = this.encode(value),
      width = this.abi.text.settingsCharacterBytes;
    if (offset + bytes.length + width > this.data.length)
      throw new Error('Native text configuration string exceeds its mapped structure');
    this.data.set(bytes, offset);
    this.data.fill(0, offset + bytes.length, offset + bytes.length + width);
  }
  keyRow(index) {
    const row = {},
      base = this.keyOffset + this.layout.keyStride * index;
    Object.defineProperty(row, 'name', {
      enumerable: true,
      get: () => this.readText(this.keyNameOffset + index * this.layout.keyNameBytes),
      set: (value) => {
        this.writeText(this.keyNameOffset + index * this.layout.keyNameBytes, value);
      },
    });
    Object.defineProperty(row, 'enabled', {
      enumerable: true,
      get: () => this.view.getUint32(base, true),
      set: (value) => {
        this.view.setUint32(base, value >>> 0, true);
      },
    });
    for (let group = 0; group < categories.length; group++)
      row[categories[group]] = this.data.subarray(base + 4 + group * 4, base + 8 + group * 4);
    if (this.abi.configuration.keyHide)
      Object.defineProperty(row, 'hide', {
        enumerable: true,
        get: () => this.view.getUint32(base + 36, true),
        set: (value) => {
          this.view.setUint32(base + 36, value >>> 0, true);
        },
      });
    return row;
  }
  resolveFonts(available = this.fontAvailability) {
    if (typeof available !== 'function') return;
    this.fontAvailability = available;
    for (const name of ['name', 'ruby']) {
      if (this.fontOverrides[name]) continue;
      const chosen = this.candidates[name].find(
        (candidate) => candidate.present && available(candidate.value),
      );
      if (chosen) this.font[name] = chosen.value;
    }
  }
  applyStartup(root) {
    const s = this.screen;
    this.application.title = text(root, 'APP/title', this.application.title);
    this.application.touch = integer(root, 'APP/touch', this.application.touch);
    for (const [field, path] of [
      ['size', 'size'],
      ['grid', 'vt'],
    ])
      for (let axis = 0; axis < 2; axis++)
        this.texture[field][axis] = integer(
          root,
          `TEXTURE/${path}/${axis ? 'y' : 'x'}`,
          this.texture[field][axis],
        );
    for (let i = 0; i < 8; i++)
      for (let j = 0; j < 4; j++)
        this.texture.areas[i][j] = integer(
          root,
          `TEXTURE/area${two(i)}/${['sx', 'sy', 'dx', 'dy'][j]}`,
          this.texture.areas[i][j],
        );
    for (let i = 0; i < 2; i++)
      this.texture.bppY[i] = integer(
        root,
        `TEXTURE/${i ? 'bpp16y' : 'bpp32y'}`,
        this.texture.bppY[i],
      );
    this.scene.staticLog = integer(root, 'GAME/log/static', this.scene.staticLog);
    for (const [field, path] of [
      ['type', 'type'],
      ['col', 'col'],
      ['prof', 'prof'],
      ['nameline', 'nameline'],
      ['indent', 'indent'],
      ['nameindent', 'nameindent'],
      ['dispMes', 'disp/mes'],
      ['dispName', 'disp/name'],
      ['space', 'space'],
      ['escape', 'escape'],
      ['crNext', 'cr_next'],
    ])
      this.log[field] = integer(root, `GAME/log/${path}`, this.log[field]);
    this.log.nameFirst = text(root, 'GAME/log/nameformat/first', this.log.nameFirst);
    this.log.nameLast = text(root, 'GAME/log/nameformat/last', this.log.nameLast);
    for (const [field, path, width] of [
      ['virtualWidth', 'v_width', 2],
      ['virtualHeight', 'v_height', 2],
      ['width', 'width', 2],
      ['height', 'height', 2],
      ['fullSize', 'full_size', 4],
      ['fullPosition', 'full_pos', 4],
      ['multiWindowPosition', 'mw_pos', 4],
      ['wall', 'wall', 4],
      ['noFullResolution', 'no_full_res', 4],
      ['limit', 'limit', 4],
      ['fps', 'fps', 4],
      ['noSkip', 'no_skip', 4],
    ]) {
      const value = integer(root, `SCREEN/${path}`, s[field]);
      s[field] = width === 2 ? value & 65535 : value;
    }
    s.screensaver = integer(root, 'GENERAL/screensaver', s.screensaver);
    s.camouflage = integer(root, 'GENERAL/camouflage', s.camouflage);
    s.cursorMode = integer(root, 'CURSOR/mode', s.cursorMode);
    for (const [field, path] of [
      ['bpp', 'bpp'],
      ['min', 'filter_min'],
      ['mag', 'filter_mag'],
      ['dither', 'dither'],
    ])
      this.texture[field] = integer(root, `TEXTURE/${path}`, this.texture[field]);
    this.general.cache = integer(root, 'ETC/cache', 1);
    this.general.imageCache = integer(root, 'APP/imgcache', this.general.imageCache);
    this.general.dualCore = integer(root, 'APP/dualcore', this.general.dualCore);
    s.fullWidth = integer(root, 'SCREEN/full_width', s.width) & 65535;
    s.fullHeight = integer(root, 'SCREEN/full_height', s.height) & 65535;
    [s.fullWidth, s.fullHeight] = nativeFullscreenSize(
      s.fullWidth,
      s.fullHeight,
      this.displayModes,
    ).map((n) => n & 65535);
    s.currentWidth = s.width;
    s.currentHeight = s.height;
    s.frameImage = text(root, 'SCREEN/frameimg', s.frameImage);
    s.sizes = s.sizes.map((pair, i) => [
      integer(root, `SCREEN/list/type${i}/w`, pair[0]),
      integer(root, `SCREEN/list/type${i}/h`, pair[1]),
    ]);
    for (const [field, path] of [
      ['name', 'face'],
      ['ruby', 'faceruby'],
    ])
      this.candidates[field] = Array.from({ length: 8 }, (_, i) => {
        const source = node(root, `FONT/${path}/f${two(i)}`);
        return { present: !!source, value: source?.text ?? this.font.name };
      });
    this.resolveFonts();
    this.style[0] = integer(root, 'FONT/shadow/around', this.style[0]);
    this.style[1] = integer(root, 'FONT/shadow/rightdown', this.style[1]);
    this.window.drag = integer(root, 'ETC/dragwnd', 1);
    this.keys.enableJoypad = 0;
    for (let i = 0; i < 80; i++) {
      const row = this.keys.rows[i],
        path = `KEYCUSTOMIZE/key${two(i)}`;
      row.name = text(root, `${path}/name`, '');
      for (const category of categories)
        for (let key = 0; key < 4; key++)
          row[category][key] = integer(root, `${path}/${category}${key + 1}`, 0) & 255;
      row.enabled = Number(row.name.length !== 0);
      if (this.abi.configuration.keyHide) row.hide = integer(root, `${path}/hide`, 0);
    }
    for (let i = 0; i < 48; i++) {
      const path = `SYSTEMVOICE/ch${two(i)}`;
      for (const [name, offset] of [
        ['name', i * 32],
        ['int', 1728 + i * 32],
      ]) {
        const source = node(root, `${path}/${name}`);
        if (!source) continue;
        const bytes = encodeCP932(source.text);
        if (offset + bytes.length + 1 > this.systemVoice.length)
          throw new Error('Native system voice text exceeds mapped configuration');
        this.systemVoice.set(bytes, offset);
        this.systemVoice[offset + bytes.length] = 0;
      }
      this.sysplay[i] = integer(root, `${path}/play`, this.sysplay[i]);
    }
    this.scene.autoSelect = integer(root, 'GAME/autoselect', this.scene.autoSelect);
    const lang = this.language;
    if (!lang) return;
    lang.default = integer(root, 'language/default', lang.default);
    lang.entries = [];
    for (let i = 0; ; i++) {
      const path = `language/L${two(i)}`,
        code = integer(root, `${path}/code`, 0) & 65535;
      if (!code) break;
      const entry = {
        code,
        prefix: text(root, `${path}/prefix`),
        lang: text(root, `${path}/lang`),
        accel: accelerator(text(root, `${path}/accel`)),
        accelsub: accelerator(text(root, `${path}/accelsub`)),
      };
      lang.entries.push(entry);
      if (code === this.uiLanguage) lang.default = lang.ui = lang.main = i;
    }
    lang.optionTable = text(root, 'language/OPTTABLE', lang.optionTable);
  }
  applyUserPreferences(root, flags = 3) {
    if (flags & 1) this.applySystemPreferences(root);
    if (flags & 2) this.applyObjectPreferences(root);
  }
  applySystemPreferences(root) {
    const s = this.screen;
    s.width = integer(root, 'WINDOW/width', s.width) & 65535;
    s.height = integer(root, 'WINDOW/height', s.height) & 65535;
    const fullWidth = integer(root, 'WINDOW/full_width', s.width),
      fullHeight = integer(root, 'WINDOW/full_height', s.height);
    if (nativeFullscreenAvailable(fullWidth, fullHeight, this.displayModes)) {
      s.fullWidth = fullWidth & 65535;
      s.fullHeight = fullHeight & 65535;
    }
    for (const [field, path] of [
      ['fps', 'fps'],
      ['mode', 'mode'],
      ['bpp', 'bpp'],
      ['limit', 'limit'],
      ['fullscreen', 'fullscreen'],
      ['setMode', 'setmode'],
      ['cursorMode', 'cursor_mode'],
      ['screensaver', 'screensaver'],
      ['camouflage', 'camouflage'],
      ['outInfo', 'out_info'],
    ])
      s[field] = integer(root, `WINDOW/${path}`, s[field]);
    s.currentWidth = s.fullscreen ? s.fullWidth : s.width;
    s.currentHeight = s.fullscreen ? s.fullHeight : s.height;
    for (const [field, path] of [
      ['fullSize', 'full_size'],
      ['fullPosition', 'full_pos'],
      ['multiWindowPosition', 'mw_pos'],
      ['wall', 'wall'],
      ['noFullResolution', 'no_full_res'],
    ])
      s[field] = integer(root, `FULL_SCREEN/${path}`, s[field]);
    for (const field of ['bpp', 'min', 'mag', 'dither'])
      this.texture[field] = integer(root, `TEXTURE/${field}`, this.texture[field]);
    for (const [field, path] of [
      ['imageCache', 'imgcache'],
      ['dualCore', 'dualcore'],
      ['disableMovie', 'disablemovie'],
      ['disablePixelShader', 'disablepixelshader'],
      ['waitD3DCommand', 'waitd3dcommand'],
    ])
      this.general[field] = integer(
        root,
        `ETC/${path}`,
        field === 'disableMovie' ? 0 : this.general[field],
      );
    this.general.gdiCap = integer(root, 'DEPEND/gdi_cap', this.general.gdiCap);
    for (const [field, path] of [
      ['picture', 'picture'],
      ['export', 'export'],
      ['imageImport', 'imgimport'],
    ])
      this.paths[field] = text(root, `ETC/${path}`, this.paths[field]);
    for (const [field, path] of [
      ['backBuffer', 'backbuffer'],
      ['hardTnL', 'hardTnL'],
      ['light', 'light'],
      ['vsync', 'vsync'],
      ['antialias', 'antialias'],
      ['fogType', 'fogtype'],
      ['textureSize', 'tex_size'],
      ['textureCompression', 'tex_comp'],
    ])
      this.d3d[field] = integer(root, `D3D/${path}`, this.d3d[field]);
    if (this.language) {
      const lang = this.language,
        count = lang.entries.length;
      for (const [field, path] of [
        ['ui', 'UI'],
        ['main', 'main'],
        ['sub', 'sub'],
      ]) {
        lang[field] = integer(root, `language/id/${path}`, lang[field]);
        if ((field !== 'sub' || lang[field] !== 0xffffffff) && lang[field] >= count)
          lang[field] = lang.default;
      }
    }
  }
  applyObjectPreferences(root) {
    this.configType = integer(root, 'CONFIG/type', this.configType);
    for (const [field, path] of [
      ['name', 'face'],
      ['ruby', 'faceruby'],
    ]) {
      const source = node(root, `FONT/${path}`);
      if (!source) continue;
      if (
        this.abi.configuration.fontPreferenceLimit === null ||
        source.text.length < this.abi.configuration.fontPreferenceLimit
      ) {
        this.font[field] = source.text;
        this.fontOverrides[field] = true;
      }
    }
    this.style[0] = integer(root, 'FONT/shadow/around', this.style[0]);
    this.style[1] = integer(root, 'FONT/shadow/rightdown', this.style[1]);
    this.style[2] = integer(root, 'FONT/bold', this.style[2]);
    this.style[3] = integer(root, 'FONT/proportional', this.style[3]);
    // Both native builds pass the newly read proportional value as fixed's fallback.
    this.style[4] = integer(root, 'FONT/fixed', this.style[3]);
    this.keys.enableJoypad = integer(root, 'KEY/enable_joypad', this.keys.enableJoypad);
    for (let i = 0; i < 80; i++)
      if (this.keys.rows[i].enabled)
        for (const [field, prefix] of [
          ['keyboard', 'kb'],
          ['mouse', 'ms'],
          ['joypad', 'jp'],
          ['rep_keyboard', 'kbr'],
          ['rep_mouse', 'msr'],
          ['rep_joypad', 'jpr'],
        ]) {
          const row = this.keys.rows[i];
          for (let key = 0; key < 4; key++) {
            const name = prefix.endsWith('r')
              ? `${prefix.slice(0, -1)}${key + 1}r_${two(i)}`
              : `${prefix}${key + 1}_${two(i)}`;
            row[field][key] = integer(root, `KEY/${name}`, row[field][key]) & 255;
          }
        }
  }
  applyAdvancedPreferences(root) {
    for (let i = 0; i < 48; i++)
      this.sysplay[i] = integer(root, `SYSTEMVOICE/play${two(i)}`, this.sysplay[i]);
    this.scene.autoSelect = integer(root, 'GAME/autoselect', this.scene.autoSelect);
    if (this.abi.configuration.windowActive)
      this.window.active = integer(root, 'GAME/always_active', this.window.active);
    if (this.abi.configuration.sceneAnimation)
      this.scene.animation = integer(root, 'GAME/enable_scene_anm', this.scene.animation);
  }
  getField(name) {
    if (name === 'font.shadow') return this.style.subarray(0, 3);
    if (name === 'application.title') return this.application.title;
    const [family, field, extra] = String(name).split('.');
    if (extra) return undefined;
    if (
      family === 'font' &&
      ['name', 'ruby', 'around', 'rightdown', 'weight', 'prop', 'fix'].includes(field)
    )
      return this.font[field];
    if (family === 'language' && this.language && ['default', 'ui', 'main', 'sub'].includes(field))
      return this.language[field];
    if (family === 'screen' && Object.hasOwn(this.screen, field)) return this.screen[field];
    if (
      ['window', 'scene', 'log', 'texture', 'general', 'd3d', 'paths', 'application'].includes(
        family,
      ) &&
      Object.hasOwn(this[family], field)
    )
      return this[family][field];
    if (name === 'voice.sysplay') return this.sysplay;
    if (name === 'key.enableJoypad') return this.keys.enableJoypad;
    if (name === 'configuration.type') return this.configType;
    return undefined;
  }
  setField(name, value) {
    if (this.getField(name) === undefined) return false;
    const [family, field] = name.split('.');
    if (name === 'application.title') this.application.title = String(value);
    else if (name === 'font.shadow') {
      if (value.length !== 3) throw new Error('Native font shadow requires three words');
      this.style.set(value, 0);
    } else if (family === 'font') {
      this.font[field] = value;
      if (field === 'name' || field === 'ruby') this.fontOverrides[field] = true;
    } else if (family === 'language') this.language[field] = value >>> 0;
    else if (family === 'paths') this.paths[field] = String(value);
    else if (family === 'log' && ['nameFirst', 'nameLast'].includes(field))
      this.log[field] = String(value);
    else if (family === 'texture' && ['size', 'grid', 'bppY'].includes(field)) {
      if (value.length !== 2) throw new Error('Native texture dimensions require two words');
      this.texture[field].set(value);
    } else if (family === 'texture' && field === 'areas') {
      if (value.length !== 8 || value.some((row) => row.length !== 4))
        throw new Error('Native texture regions require eight four-word records');
      value.forEach((row, i) => this.texture.areas[i].set(row));
    } else if (
      ['screen', 'window', 'scene', 'log', 'texture', 'general', 'd3d', 'application'].includes(
        family,
      )
    ) {
      if (typeof this[family][field] !== 'number')
        throw new Error('Native configuration scalar setter requires a numeric field');
      this[family][field] = value >>> 0;
    } else if (name === 'voice.sysplay') {
      if (value.length !== 48) throw new Error('Native system voice flags require 48 words');
      this.sysplay.set(value);
    } else if (name === 'key.enableJoypad') this.keys.enableJoypad = value;
    else if (name === 'configuration.type') this.configType = value >>> 0;
    return true;
  }
  snapshot() {
    return {
      profile: this.profile,
      data: this.data.slice(),
      configType: this.configType,
      systemVoice: this.systemVoice.slice(),
      candidates: structuredClone(this.candidates),
      fontOverrides: { ...this.fontOverrides },
      ...Object.fromEntries(
        [
          'language',
          'screen',
          'window',
          'scene',
          'log',
          'texture',
          'general',
          'd3d',
          'paths',
          'application',
        ].map((name) => [name, structuredClone(this[name])]),
      ),
    };
  }
  restore(state) {
    if (
      state.profile !== this.profile ||
      state.data.length !== this.data.length ||
      state.systemVoice.length !== this.systemVoice.length
    )
      throw new Error('Native text configuration checkpoint layout mismatch');
    this.data.set(state.data);
    this.systemVoice.set(state.systemVoice);
    this.configType = state.configType;
    this.candidates = structuredClone(state.candidates);
    this.fontOverrides = { ...state.fontOverrides };
    for (const name of [
      'language',
      'screen',
      'window',
      'scene',
      'log',
      'texture',
      'general',
      'd3d',
      'paths',
      'application',
    ])
      if (this[name]) Object.assign(this[name], structuredClone(state[name]));
  }
}
