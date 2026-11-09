// SPDX-License-Identifier: MPL-2.0
// Configuration block layouts recovered independently for the two frozen builds.
import { nativeReply } from '../kcs/vm.mjs';
import { encodeCP932 } from '../kcs/strings.mjs';
import { findNativeXML } from './xml.mjs';
import { parseNativeInteger } from './standard.mjs';
import { NativeConfigurationFields } from './config-fields.mjs';
import { NativeScriptReplacements } from './script-replacement.mjs';
import { NATIVE_ABIS, nativeABI } from './abi/index.mjs';

export const NATIVE_CONFIGURATION_LAYOUTS = Object.freeze(
  Object.fromEntries(
    Object.entries(NATIVE_ABIS).map(([profile, abi]) => [
      profile,
      { sizes: abi.configuration.blockSizes },
    ]),
  ),
);

const words = (bytes) => new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
const get = (bytes, index) => words(bytes).getUint32(index * 4, true);
const set = (bytes, index, value) => words(bytes).setUint32(index * 4, value >>> 0, true);
const integer = (root, path, fallback) => {
  const node = root && findNativeXML(root, path);
  return node ? (parseNativeInteger(node.text) ?? 0) >>> 0 : fallback >>> 0;
};
const numberName = (index) => String(index).padStart(2, '0');
const presetDefaults = [5, 7, 7, 8, 8, 8, 12, 7, 15, 5, 16, 9, 17, 12, 21, 11, 25, 10, 29, 10];

const preferenceFields = [
  [0, 5588 / 4, 'VOICE/vol_master'],
  [0, 5592 / 4, 'VOICE/vol_bgm'],
  [0, 5596 / 4, 'VOICE/vol_se'],
  [0, 5600 / 4, 'VOICE/vol_voice'],
  [0, 5604 / 4, 'VOICE/vol_play'],
  [0, 4, 'VOICE/cont_voice'],
  [0, 5608 / 4, 'VOICE/mute_master'],
  [0, 5612 / 4, 'VOICE/mute_bgm'],
  [0, 5616 / 4, 'VOICE/mute_se'],
  [0, 5620 / 4, 'VOICE/mute_voice'],
  [0, 5624 / 4, 'VOICE/mute_play'],
  [1, 0, 'MESSAGE/speed'],
  [1, 1, 'MESSAGE/auto_p'],
  [1, 2, 'MESSAGE/ind'],
  [1, 3, 'MESSAGE/base'],
  [1, 4, 'MESSAGE/CHAR'],
  [1, 5, 'MESSAGE/still'],
  [1, 6, 'MESSAGE/cont'],
  [1, 7, 'MESSAGE/waitpcm'],
  [1, 8, 'MESSAGE/skip_full'],
  [1, 9, 'MESSAGE/log_limit'],
  [1, 10, 'MESSAGE/enable_read'],
  [1, 11, 'MESSAGE/read_color'],
  [1, 12, 'MESSAGE/skipspeed'],
  [1, 13, 'MESSAGE/contskip'],
  [1, 14, 'MESSAGE/wipe'],
  [1, 15, 'MESSAGE/ctrlmode'],
  [1, 16, 'MESSAGE/autoleft'],
  [1, 17, 'MESSAGE/enable_read_sel'],
  [2, 0, 'EFFECT/speed'],
  [2, 1, 'EFFECT/skipdraw'],
  [2, 2, 'EFFECT/help'],
  [2, 3, 'EFFECT/auto_c'],
  [2, 4, 'EFFECT/auto_cd'],
  [2, 5, 'EFFECT/auto_cds'],
  [2, 6, 'EFFECT/dramatic'],
  [2, 7, 'EFFECT/skipmot'],
  [3, 0, 'GAME/wndcolor'],
  [3, 1, 'GAME/enabledrag'],
  [3, 2, 'GAME/drawwnd'],
];

function mapped(machine, address) {
  try {
    machine.region(address >>> 0, 1);
    return true;
  } catch {
    return false;
  }
}

export class NativeConfiguration {
  constructor({
    profile,
    startup,
    gamedef,
    preferences,
    authorMode = 0,
    uiLanguage,
    fontAvailability,
    displayModes,
  } = {}) {
    const layout = NATIVE_CONFIGURATION_LAYOUTS[profile];
    if (!layout) throw new Error(`Unrecovered native configuration profile ${profile}`);
    this.profile = profile;
    // These startup rules are immutable engine input, independent of mutable
    // preference words. A fresh World reads them from its same frozen source.
    this.scriptReplacements = new NativeScriptReplacements(startup, {
      encoding: nativeABI(profile).xmlEncoding,
    });
    this.authorMode = authorMode >>> 0;
    this.variableCount = 1024;
    this.variableRanges = {
      local: new Uint32Array(16).fill(0xffffffff),
      global: new Uint32Array(16).fill(0xffffffff),
    };
    this.variableRanges.local.set([0, 512]);
    this.variableRanges.global.set([512, 512]);
    this.blocks = layout.sizes.map((size) => new Uint8Array(size));
    this.autoPresets = new Uint32Array(64);
    this.autoPresets.set(presetDefaults);
    this.windowAlphaPercent = 1;
    this.soundOptions = { use3d: 0, sticky: 1, stereo: 1 };
    this.soundGroups = [];
    this.fields = new NativeConfigurationFields({
      profile,
      uiLanguage,
      fontAvailability,
      displayModes,
    });
    for (const family of ['font', 'language', 'screen', 'keys']) this[family] = this.fields[family];
    const [voice, message, effect, window] = this.blocks;
    set(voice, 4, 1);
    for (let i = 0; i < 48; i++) {
      const record = 20 + 116 * i;
      set(voice, record / 4, 1);
      set(voice, (record + 36) / 4, 100);
      set(voice, (record + 80) / 4, 100);
    }
    for (let i = 0; i < 5; i++) set(voice, 1397 + i, 100);
    [4, 4, 0, 15, 5, 1, 0, 1, 0, 100, 0, -1, 0, 0, 0].forEach((v, i) => set(message, i, v));
    [0, 0, 1, 1, 1, 5, 0].forEach((v, i) => set(effect, i, v));
    [-1, 1, 1].forEach((v, i) => set(window, i, v));
    this.applyStartup(startup);
    if (gamedef) this.applyPreferences(gamedef);
    if (preferences) this.applyUserPreferences(preferences);
    this.deriveVolumes();
  }

  applyStartup(root) {
    const [voice, message, , window] = this.blocks;
    this.fields.applyStartup(root);
    this.soundOptions = {
      ...this.soundOptions,
      use3d: integer(root, 'SOUND/use3d', this.soundOptions.use3d),
      sticky: integer(root, 'SOUND/sticky', this.soundOptions.sticky),
    };
    // 71D760 visits these eight numbered records even across gaps. The
    // dynamic soundconf SOUNDGROUP tree is a separate configuration source.
    this.soundGroups = Array.from({ length: 8 }, (_, index) => {
      const path = `SOUNDGROUP/group${numberName(index)}`;
      return {
        id: integer(root, `${path}/id`, -1) | 0,
        type: (root && findNativeXML(root, `${path}/type`)?.text) || '',
        min: integer(root, `${path}/min`, -1) | 0,
        max: integer(root, `${path}/max`, -1) | 0,
      };
    });
    this.variableCount = integer(root, 'GAME/flag/max', this.variableCount);
    for (const type of ['local', 'global'])
      for (let index = 0; index < 8; index++)
        for (const [part, name] of ['start', 'count'].entries()) {
          const at = index * 2 + part;
          this.variableRanges[type][at] = integer(
            root,
            `GAME/flag/${type}${index}/${name}`,
            this.variableRanges[type][at],
          );
        }
    this.windowAlphaPercent = integer(root, 'CONFIG_B/wnd_alpha', 1);
    for (let i = 0; i < 32; i++) {
      for (const [field, word] of [
        ['base', 0],
        ['char', 1],
      ]) {
        const at = i * 2 + word;
        this.autoPresets[at] = integer(
          root,
          `GAME/autopriset/p${numberName(i)}/${field}`,
          this.autoPresets[at],
        );
      }
    }
    const preset = get(message, 1);
    if (preset >= 32)
      throw new Error(`Native auto-message preset outside recovered table: ${preset}`);
    set(message, 3, this.autoPresets[preset * 2]);
    set(message, 4, this.autoPresets[preset * 2 + 1]);
    for (let i = 0; i < 48; i++) {
      const record = 20 + 116 * i;
      const path = `VOICE/v${numberName(i)}`;
      set(voice, record / 4, 1);
      set(
        voice,
        (record + 36) / 4,
        integer(root, `${path}/mastervol`, get(voice, (record + 36) / 4)),
      );
      set(voice, (record + 80) / 4, integer(root, `${path}/group`, get(voice, (record + 80) / 4)));
      for (const [name, offset, size] of [
        ['voice', 4, 32],
        ['head', 40, 40],
        ['int', 84, 32],
      ]) {
        const node = root && findNativeXML(root, `${path}/${name}`);
        if (!node) continue;
        const bytes = encodeCP932(node.text);
        if (bytes.length >= size)
          throw new Error(`Native VOICE ${name} field exceeds ${size - 1} bytes`);
        voice.set(bytes, record + offset);
        voice[record + offset + bytes.length] = 0;
      }
      // The native lowercases the archive specification while skipping CP932 pairs.
      for (let at = record + 84; at < record + 116 && voice[at]; at++) {
        const b = voice[at];
        const trail = voice[at + 1];
        if (
          ((b >= 0x81 && b <= 0x9f) || (b >= 0xe0 && b <= 0xef)) &&
          ((trail >= 0x40 && trail <= 0x7e) || (trail >= 0x80 && trail <= 0xfc))
        )
          at++;
        else if (b >= 65 && b <= 90) voice[at] += 32;
      }
    }
    for (const [index, name] of [
      [1397, 'master'],
      [1398, 'bgm'],
      [1399, 'se'],
      [1400, 'voice'],
      [1401, 'play'],
    ])
      set(voice, index, integer(root, `VOICE/vol/${name}`, get(voice, index)));
    for (const [index, path] of [
      [9, 'GAME/log/limit'],
      [10, 'GAME/read/enable'],
      [11, 'GAME/read/color'],
      [12, 'GAME/skipspeed'],
      [14, 'GAME/string/wipe'],
      [15, 'GAME/ctrlmode'],
      [16, 'GAME/autoleft'],
      [17, 'GAME/readsel/enable'],
    ]) {
      if (index * 4 < message.length) set(message, index, integer(root, path, get(message, index)));
    }
    const old = get(window, 0);
    const r = integer(root, 'GAME/wndcolor/r', (old >>> 16) & 255);
    const g = integer(root, 'GAME/wndcolor/g', (old >>> 8) & 255);
    const b = integer(root, 'GAME/wndcolor/b', old & 255);
    let a = integer(root, 'GAME/wndcolor/a', old >>> 24);
    if (this.windowAlphaPercent) a = Math.trunc(Math.imul(a, 100) / 255);
    set(window, 0, b | ((g | ((r | (a << 8)) << 8)) << 8));
  }

  applyPreferences(root) {
    this.fields.applyAdvancedPreferences(root);
    for (const [block, word, path] of preferenceFields) {
      const bytes = this.blocks[block];
      if (word * 4 < bytes.length) set(bytes, word, integer(root, path, get(bytes, word)));
    }
    for (let i = 0; i < 48; i++) {
      const word = (20 + i * 116) / 4;
      set(
        this.blocks[0],
        word,
        integer(root, `VOICE/play${numberName(i)}`, get(this.blocks[0], word)),
      );
    }
  }

  deriveVolumes() {
    const voice = this.blocks[0];
    for (let i = 0; i < 4; i++)
      set(voice, i, Math.floor((Math.imul(get(voice, 1397), get(voice, 1398 + i)) >>> 0) / 100));
  }

  copyTo(machine, addresses) {
    this.blocks.forEach((block, i) => {
      if (mapped(machine, addresses[i])) machine.bytes(addresses[i], block.length).set(block);
    });
  }

  copyFrom(machine, addresses) {
    for (let i = 0; i < 3; i++) {
      const block = this.blocks[i];
      if (mapped(machine, addresses[i])) block.set(machine.bytes(addresses[i], block.length));
    }
  }

  snapshot() {
    return {
      profile: this.profile,
      authorMode: this.authorMode,
      variableCount: this.variableCount,
      variableRanges: Object.fromEntries(
        Object.entries(this.variableRanges).map(([name, data]) => [name, data.slice()]),
      ),
      windowAlphaPercent: this.windowAlphaPercent,
      soundOptions: { ...this.soundOptions },
      soundGroups: structuredClone(this.soundGroups),
      fields: this.fields.snapshot(),
      autoPresets: this.autoPresets.slice(),
      blocks: this.blocks.map((b) => b.slice()),
    };
  }

  restore(state) {
    if (
      state.profile !== this.profile ||
      state.blocks.length !== 4 ||
      state.autoPresets.length !== 64
    )
      throw new Error('Native configuration checkpoint profile/layout mismatch');
    state.blocks.forEach((bytes, i) => {
      if (!(bytes instanceof Uint8Array) || bytes.length !== this.blocks[i].length)
        throw new Error('Native configuration checkpoint block size mismatch');
    });
    this.authorMode = state.authorMode >>> 0;
    this.variableCount = state.variableCount >>> 0;
    for (const name of ['local', 'global']) {
      if (state.variableRanges[name].length !== 16)
        throw new Error('Native configuration variable range layout');
      this.variableRanges[name].set(state.variableRanges[name]);
    }
    this.windowAlphaPercent = state.windowAlphaPercent >>> 0;
    this.soundOptions = { ...state.soundOptions };
    this.soundGroups = structuredClone(state.soundGroups);
    this.fields.restore(state.fields);
    this.autoPresets.set(state.autoPresets);
    state.blocks.forEach((bytes, i) => this.blocks[i].set(bytes));
  }

  getField(name) {
    return this.fields.getField(name);
  }
  setField(name, value) {
    return this.fields.setField(name, value);
  }
  resolveFonts(available) {
    this.fields.resolveFonts(available);
  }
  applyUserPreferences(root, flags = 3) {
    this.fields.applyUserPreferences(root, flags);
    if (flags & 1) {
      this.soundOptions.use3d = integer(root, 'SOUND/ds3d', this.soundOptions.use3d);
      this.soundOptions.sticky = integer(root, 'SOUND/sticky', this.soundOptions.sticky);
      this.soundOptions.stereo = integer(root, 'SOUND/stereo', this.soundOptions.stereo);
    }
    if (flags & 2) this.applyPreferences(root);
  }
}

export function nativeConfiguration(id, args, machine, services = {}) {
  const count = new Map([
    [0x167, 4],
    [0x168, 3],
    [0x1d1, 0],
    [0x274, 1],
    [0x315, 0],
    [0x316, 4],
    [0x3e7, 0],
    [0x2e5, 0],
    [0x354, 0],
    [0x41a, 0],
    [0x246, 1],
    [0x247, 0],
    [0x248, 2],
    [0x40c, 2],
    [0x41d, 2],
  ]).get(id);
  if (count === undefined) return undefined;
  if (args.length !== count)
    throw new Error(`KCS configuration native 0x${id.toString(16)} expects ${count} arguments`);
  const config = services.configuration;
  if (!config) return undefined;
  if (
    [0x40c, 0x41a, 0x41d].includes(id) &&
    !nativeABI(config.profile).configuration.extendedQueries
  )
    return undefined;
  if (id === 0x1d1) return nativeReply(1, config.authorMode);
  if (id === 0x315) return nativeReply(1, config.variableCount);
  if (id === 0x3e7) return nativeReply(1, config.getField('scene.autoSelect'));
  if (id === 0x2e5)
    return nativeReply(1, config.screen.fullscreen ? config.screen.multiWindowPosition : 0);
  if (id === 0x354) return nativeReply(1, config.getField('scene.staticLog'));
  if (id === 0x41a) return nativeReply(1, config.getField('scene.animation'));
  if (id === 0x40c) {
    const language = config.language;
    for (const [i, field] of ['main', 'sub'].entries()) {
      const entry = language.entries[language[field]] ?? language.entries[language.default],
        bytes = encodeCP932(entry?.prefix ?? '');
      // The original first clears the destination, then performs the Windows
      // conversion with a 4096-byte capacity including the terminator.
      machine.store(args[i], 0, 1);
      if (bytes.length + 1 <= 4096) {
        machine.bytes(args[i], bytes.length + 1).set(bytes);
        machine.store(args[i] + bytes.length, 0, 1);
      }
    }
    return nativeReply(2);
  }
  if (id === 0x41d) {
    const field = ['ui', 'main', 'sub'][args[0] >>> 0],
      value = args[1] >>> 0;
    if (!field || config.language[field] === value) return nativeReply(2);
    const world = services.world,
      mark = services.configurationChanged ?? (world && (() => world.markConfigurationDirty())),
      windowMessage =
        services.configurationWindowMessage ??
        (world &&
          ((message) => world.window.post(message.message, message.wParam, message.lParam)));
    if (!mark || !windowMessage) return undefined;
    config.language[field] = value;
    mark(`language.${field}`);
    windowMessage({ message: 0x46e + (args[0] >>> 0), wParam: 0, lParam: 0 });
    return nativeReply(2);
  }
  if (id === 0x246 || id === 0x248) {
    // The native wrappers do not clamp the index. Neighboring system-voice
    // strings share this same mapped byte region, including negative indices.
    const bytes = config.fields.systemVoice,
      offset = 1536 + Math.imul(args[0], 4);
    if (offset < 0 || offset + 4 > bytes.length)
      throw new Error('Native system voice word is outside recovered mapped configuration');
    const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
    if (id === 0x246) return nativeReply(1, view.getUint32(offset, true));
    view.setUint32(offset, args[1], true);
    return nativeReply(2);
  }
  if (id === 0x247) {
    const enabled = Array.from(config.fields.sysplay, (value, index) =>
      value ? index : -1,
    ).filter((index) => index !== -1);
    if (!enabled.length) return nativeReply(1, 0xffffffff);
    if (!services.random) return undefined;
    return nativeReply(1, enabled[(services.random.rand() >>> 0) % enabled.length]);
  }
  if (id === 0x316) {
    const index = args[1] >>> 0;
    if (index >= 8) return nativeReply(1, 0);
    const ranges = config.variableRanges[args[0] ? 'global' : 'local'];
    machine.store(args[2], ranges[index * 2]);
    machine.store(args[3], ranges[index * 2 + 1]);
    return nativeReply(1, 1);
  }
  if (id === 0x274) {
    config.authorMode = args[0] >>> 0;
    services.configurationChanged?.('authorMode');
  } else if (id === 0x167) config.copyTo(machine, args);
  else config.copyFrom(machine, args);
  return nativeReply(2);
}
