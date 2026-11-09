// SPDX-License-Identifier: MPL-2.0
import { nativeABI } from './abi/index.mjs';
// FES getconf/setconf: SDK 616610/617310, game 77CDB0/77DD20.
// Global configuration and the Emote manager have distinct field namespaces.
const legacyVolumeFields = ['vol_bgm', 'vol_se', 'vol_pcm'];
const blockFields = Object.freeze({
  vol_master: [0, 1397],
  vol_bgm: [0, 1398],
  vol_se: [0, 1399],
  vol_voice: [0, 1400],
  vol_play: [0, 1401],
  mute_master: [0, 1402],
  mute_bgm: [0, 1403],
  mute_se: [0, 1404],
  mute_voice: [0, 1405],
  mute_play: [0, 1406],
  messpd: [1, 0],
  autospd: [1, 1],
  autoind: [1, 2],
  autospd_b: [1, 3],
  autospd_c: [1, 4],
  stillread: [1, 5],
  contauto: [1, 6],
  waitpcm: [1, 7],
  fullskip: [1, 8],
  enable_readcol: [1, 10],
  readcol: [1, 11],
  skip_speed: [1, 12],
  contskip: [1, 13],
  strscroll: [1, 14],
  ctrlmode: [1, 15],
  autoleft: [1, 16],
  enable_readselcol: [1, 17],
  effspd: [2, 0],
  effcut: [2, 1],
  autocur: [2, 3],
  autodel: [2, 4],
  dorama: [2, 6],
  motcut: [2, 7],
  wndcolor: [3, 0],
  dragwnd: [3, 1],
  wndframe: [3, 2],
  contvoice: [0, 4],
});
const scalarFields = Object.freeze({
  font: 'font.name',
  ruby: 'font.ruby',
  fontweight: 'font.weight',
  fontprop: 'font.prop',
  fontfix: 'font.fix',
  screen: 'screen.fullscreen',
  lang_ui: 'language.ui',
  lang_text_main: 'language.main',
  lang_text_sub: 'language.sub',
  activewindow: 'window.active',
  enable_sceneanm: 'scene.animation',
});
const gameFields = new Set([
  'ctrlmode',
  'autoleft',
  'enable_readselcol',
  'motcut',
  'lang_ui',
  'lang_text_main',
  'lang_text_sub',
  'activewindow',
  'enable_sceneanm',
]);
export const FES_CONFIGURATION_FIELDS = Object.freeze([
  ...Object.keys(blockFields),
  ...Object.keys(scalarFields),
  'play',
  'sysplay',
  'fshadow',
  'iswindow',
]);
const read = (bytes, index) =>
  new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength).getUint32(index * 4, true);
const write = (bytes, index, value) =>
  new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength).setUint32(
    index * 4,
    value >>> 0,
    true,
  );

export class NativeFESConfiguration {
  constructor({ configuration, languages = () => [], isWindow, emit, changed, m2 } = {}) {
    this.abi = nativeABI(configuration?.profile);
    Object.assign(this, { configuration, languages, isWindow, emit, changed, m2 });
  }
  recognized(name) {
    return (
      FES_CONFIGURATION_FIELDS.includes(name) &&
      (this.abi.configuration.extendedPreferences || !gameFields.has(name))
    );
  }
  get(name, ex1 = 0, ex2 = 0, { legacyVolume = false } = {}) {
    if (legacyVolume) {
      const index = legacyVolumeFields.indexOf(name.toLowerCase());
      return index >= 0 ? read(this.configuration.blocks[0], index) : undefined;
    }
    if (!this.recognized(name)) return undefined;
    const config = this.configuration;
    if (name === 'iswindow') return this.isWindow?.();
    if (name === 'play') {
      const index = ((ex1 | 0) + (ex2 | 0)) | 0;
      return index < 0 || index >= 48 ? 0 : read(config.blocks[0], 5 + 29 * index);
    }
    if (name === 'sysplay') {
      const index = ((ex1 | 0) + (ex2 | 0)) | 0;
      if (index < 0 || index >= 48) return 0;
      // Native checks ex1+ex2, then indexes by ex1 alone.
      const rows = config.getField('voice.sysplay');
      if ((ex1 | 0) < 0 || (ex1 | 0) >= 48)
        throw new RangeError('Native FES sysplay indexes outside its 48-row backing');
      return rows[ex1 | 0];
    }
    if (name === 'fshadow') {
      const index = Math.min(2, ex1 | 0);
      const shadow = config.getField('font.shadow');
      return new DataView(shadow.buffer).getUint32(shadow.byteOffset + index * 4, true);
    }
    if (blockFields[name]) {
      const [block, index] = blockFields[name];
      return read(config.blocks[block], index);
    }
    return config.getField(scalarFields[name]);
  }
  set(name, value, ex1 = 0, ex2 = 0, context = {}) {
    const config = this.configuration,
      recognized = this.recognized(name) && name !== 'iswindow';
    let pending;
    if (recognized) {
      const word = value >>> 0;
      if (name === 'screen')
        pending = this.emit?.([this.abi.messages.screenEvent, word, 0, 0, 0], context);
      else if (name === 'lang_ui' || name === 'lang_text_main' || name === 'lang_text_sub') {
        const languages = this.languages(),
          count = typeof languages === 'number' ? languages : languages.length,
          field = scalarFields[name];
        if (name === 'lang_text_sub') config.setField(field, word < count ? word : 0xffffffff);
        else if (word < count && (name !== 'lang_ui' || config.getField(field) !== word)) {
          config.setField(field, word);
          pending = this.emit?.([name === 'lang_ui' ? 0x2b : 0x2c, word, 0, 0, 0], context);
        }
      } else if (name === 'font' || name === 'ruby') {
        const text = typeof value === 'string' ? value : String(context.strings?.[word] ?? '');
        config.setField(scalarFields[name], text);
      } else if (name === 'play') {
        const index = ((ex1 | 0) + (ex2 | 0)) | 0;
        if (index >= 0 && index < 48) write(config.blocks[0], 5 + 29 * index, word);
      } else if (name === 'sysplay') {
        const index = ((ex1 | 0) + (ex2 | 0)) | 0;
        if (index >= 0 && index < 48) {
          if ((ex1 | 0) < 0 || (ex1 | 0) >= 48)
            throw new RangeError('Native FES sysplay indexes outside its 48-row backing');
          config.getField('voice.sysplay')[ex1 | 0] = word;
        }
      } else if (name === 'fshadow') {
        const index = Math.min(2, ex1 | 0);
        const shadow = config.getField('font.shadow');
        new DataView(shadow.buffer).setUint32(shadow.byteOffset + index * 4, word, true);
      } else if (blockFields[name]) {
        const [block, index] = blockFields[name];
        write(config.blocks[block], index, word);
        if (name === 'autospd') {
          if (word >= 32)
            throw new RangeError('Native FES autospd indexes outside its 32 preset rows');
          write(config.blocks[1], 3, config.autoPresets[word * 2]);
          write(config.blocks[1], 4, config.autoPresets[word * 2 + 1]);
        }
      } else config.setField(scalarFields[name], word);
    }
    // Both handlers' shared epilogues run this even for an unknown key.
    config.deriveVolumes();
    const changed = this.changed?.(name, context, { recognized });
    if (pending?.then || changed?.then)
      return Promise.all([pending, changed]).then(() => recognized);
    return recognized;
  }
  getM2(name, part) {
    return part === undefined && (name === 'iner_lv' || name === 'iner_enable')
      ? undefined
      : this.m2?.get(name, part);
  }
  setM2(name, value, part) {
    return this.m2?.set(name, value, part) ?? false;
  }
}

const modelFields = Object.freeze([
  'motion',
  'eff_dif',
  'eff_iner',
  'eff_blink',
  'eff_lip',
  'fade',
]);
export class NativeM2Configuration {
  constructor({ models = [], parts = [], changed } = {}) {
    this.models = new Map(
      models.map((name) => [
        name,
        { motion: 1, eff_dif: 1, eff_iner: 1, eff_blink: 1, eff_lip: 1, fade: 0, level: 100 },
      ]),
    );
    this.levels = new Map(parts.map((part) => [part, 100]));
    this.enabled = new Map(parts.map((part) => [part, 1]));
    this.interleave = 0;
    this.changed = changed;
  }
  get(name, part) {
    if (modelFields.includes(name))
      return Number([...this.models.values()].some((model) => model[name] !== 0));
    if (name === 'interleave') return this.interleave;
    if (name === 'iner_lv') return this.levels.get(part) ?? 100;
    if (name === 'iner_enable') return this.enabled.get(part) ?? 1;
    return undefined;
  }
  set(name, value, part) {
    if (modelFields.includes(name))
      for (const model of this.models.values()) model[name] = (value ?? 1) >>> 0;
    else if (name === 'interleave') this.interleave = (value ?? 0) >>> 0;
    else if (name === 'iner_lv') {
      if (part === undefined) return false;
      if (!this.levels.has(part)) return true;
      if (this.levels.has(part))
        this.levels.set(part, Math.max(0, Math.min(200, (value ?? 100) | 0)));
    } else if (name === 'iner_enable') {
      if (part === undefined) return false;
      if (!this.enabled.has(part)) return true;
      if (this.enabled.has(part)) this.enabled.set(part, (value ?? 1) >>> 0);
    } else if (name === 'reset') {
      for (const model of this.models.values())
        Object.assign(model, {
          motion: 1,
          eff_dif: 1,
          eff_iner: 1,
          eff_blink: 1,
          eff_lip: 1,
          fade: 0,
          level: 100,
        });
      for (const part of this.levels.keys()) this.levels.set(part, 100);
      for (const part of this.enabled.keys()) this.enabled.set(part, 1);
      this.interleave = 0;
    } else return false;
    return this.changed?.(name, part) ?? true;
  }
  snapshot() {
    return structuredClone({
      models: [...this.models],
      levels: [...this.levels],
      enabled: [...this.enabled],
      interleave: this.interleave,
    });
  }
  restore(state) {
    this.models = new Map(state.models);
    this.levels = new Map(state.levels);
    this.enabled = new Map(state.enabled);
    this.interleave = state.interleave;
  }
}
