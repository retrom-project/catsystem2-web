// SPDX-License-Identifier: MPL-2.0
// Settings is an interior pointer into Engine, never a second allocation.
import { encodeCP932 } from '../kcs/strings.mjs';

const SDK = 'sdk-4.01-engine-2.6.1.74',
  GAME = 'nekopara-vol3-engine-2.6.1.76';
export const NATIVE_CONFIGURATION_MEMORY_LAYOUTS = Object.freeze({
  [SDK]: Object.freeze({
    settingsOffset: 528,
    font: 53288,
    blocks: [58880, 64508, 64568, 64596],
    systemVoice: 64608,
    first: 52320,
    second: 53188,
    virtualSize: 1050,
    sizes: 1056,
    noSkip: 46960,
    frameImage: 49336,
    authorMode: 47888,
    autoPresets: 47916,
    variableCount: 49600,
    variableRanges: 49604,
    alphaPercent: 47532,
    soundGroups: 47620,
    autoSelect: 67872,
    pathBytes: 260,
    texture: 46204,
    log: 48960,
  }),
  [GAME]: Object.freeze({
    settingsOffset: 1048,
    font: 64528,
    blocks: [73128, 78756, 78828, 78860],
    systemVoice: 78872,
    first: 62768,
    second: 64416,
    virtualSize: 1570,
    sizes: 1576,
    noSkip: 49624,
    frameImage: 52256,
    authorMode: 51072,
    autoPresets: 51100,
    variableCount: 53304,
    variableRanges: 53308,
    alphaPercent: 50716,
    soundGroups: 50804,
    autoSelect: 82136,
    pathBytes: 520,
    texture: 48284,
    log: 52144,
    languageVector: 58596,
    optionTable: 58600,
  }),
});

function scalars(layout, game) {
  const a = layout.first,
    b = layout.second;
  return [
    ...['width', 'height', 'fullWidth', 'fullHeight', 'currentWidth', 'currentHeight'].map(
      (name, i) => [`screen.${name}`, a + i * 2, 2],
    ),
    ...[
      ['screen.fullWide', 12],
      ['screen.limit', 16],
      ['screen.fps', 20],
      ['screen.cursorMode', 24],
      ['texture.bpp', 28],
      ['texture.min', 32],
      ['texture.mag', 36],
      ['texture.dither', 40],
      ['sound.use3d', 44],
      ['sound.sticky', 48],
      ['sound.stereo', 52],
      ['general.imageCache', 56],
      ['screen.screensaver', 60],
      ['screen.camouflage', 64],
      ['general.gdiCap', 68],
      ['general.z32', 72],
      ['general.useZ', 76],
      ['screen.outInfo', 80],
      ['general.cache', 84],
    ].map(([name, offset]) => [name, a + offset, 4]),
    ...[
      ['screen.mode', 0],
      ['screen.fullscreen', 4],
      ['screen.bpp', 8],
      ['d3d.hardTnL', 12],
      ['d3d.backBuffer', 16],
      ['d3d.light', 20],
      ['d3d.vsync', 24],
      ['d3d.antialias', 28],
      ['d3d.fogType', 32],
      ['d3d.textureSize', 36],
      ['d3d.textureCompression', 40],
      ['general.dualCore', 48],
      ['general.disableMovie', 52],
      ['general.disablePixelShader', 56],
      ['screen.fullSize', 60],
      ['screen.fullPosition', 64],
      ['screen.multiWindowPosition', 68],
      ['screen.wall', 72],
      ['general.waitD3DCommand', 76],
      ['screen.noFullResolution', 80],
    ].map(([name, offset]) => [name, b + offset, 4]),
    ['screen.setMode', a - 4, 4],
    ['configuration.type', layout.font - 8, 4],
    ['window.drag', layout.font - 4, 4],
    ['screen.virtualWidth', layout.virtualSize, 2],
    ['screen.virtualHeight', layout.virtualSize + 2, 2],
    ['screen.noSkip', layout.noSkip, 4],
    ['scene.autoSelect', layout.autoSelect, 4],
    ['scene.staticLog', game ? 52248 : 49064, 4],
    ['application.touch', game ? 58056 : 52044, 4],
    ['general.renderTargetCount', game ? 51076 : 47892, 4],
    ...[
      ['type', 0],
      ['col', 4],
      ['prof', 8],
      ['nameline', 12],
      ['indent', 80],
      ['nameindent', 84],
      ['dispMes', 88],
      ['dispName', 92],
      ['space', 96],
      ['escape', 100],
      ['crNext', 108],
    ].map(([name, offset]) => [`log.${name}`, layout.log + offset, 4]),
    ...(game
      ? [
          ['language.ui', 64508, 4],
          ['language.main', 64512, 4],
          ['language.sub', 64516, 4],
          ['language.default', 58592, 4],
          ['window.active', 82140, 4],
          ['scene.animation', 82144, 4],
        ]
      : []),
  ];
}
function scalarRuns(fields) {
  const runs = [];
  for (const [name, offset, width] of fields) {
    let run = runs.at(-1);
    if (!run || run.offset + run.length !== offset) {
      run = { offset, length: 0, fields: [] };
      runs.push(run);
    }
    run.fields.push([name, run.length, width]);
    run.length += width;
  }
  return runs.map(({ offset, length, fields }) => {
    const bytes = new Uint8Array(length);
    return { offset, fields, bytes, view: new DataView(bytes.buffer) };
  });
}
const equal = (a, b) => a.length === b.length && a.every((value, index) => value === b[index]);
function wideBytes(text) {
  const bytes = new Uint8Array((text.length + 1) * 2),
    view = new DataView(bytes.buffer);
  for (let i = 0; i < text.length; i++) view.setUint16(i * 2, text.charCodeAt(i), true);
  return bytes;
}

export class NativeConfigurationMemory {
  constructor(process, configuration, { owner, settings } = {}) {
    this.process = process;
    this.configuration = configuration;
    this.layout = NATIVE_CONFIGURATION_MEMORY_LAYOUTS[configuration?.profile];
    if (!this.layout)
      throw new Error('Native settings memory requires a recovered configuration profile');
    if (!Number.isInteger(owner) || owner <= 0)
      throw new Error('Native settings memory requires the shared Engine owner address');
    this.owner = owner >>> 0;
    this.settings = (settings ?? this.owner + this.layout.settingsOffset) >>> 0;
    if (this.settings !== this.owner + this.layout.settingsOffset)
      throw new Error('Native Settings must alias the recovered interior Engine address');
    this.scalarRuns = scalarRuns(scalars(this.layout, configuration.profile === GAME));
    // Confirm that the supplied owner covers the fields this codec owns.
    process.read(this.owner + this.layout.autoSelect, configuration.profile === GAME ? 12 : 4);
  }
  arrays() {
    const c = this.configuration,
      l = this.layout;
    return [
      [l.font, c.fields.data],
      ...c.blocks.map((bytes, i) => [l.blocks[i], bytes]),
      [l.systemVoice, c.fields.systemVoice],
      ...[
        [l.texture, c.fields.texture.size],
        [l.texture + 8, c.fields.texture.grid],
        ...c.fields.texture.areas.map((row, i) => [l.texture + 16 + i * 16, row]),
        [l.texture + 144, c.fields.texture.bppY],
      ].map(([offset, values]) => [
        offset,
        new Uint8Array(values.buffer, values.byteOffset, values.byteLength),
      ]),
      [
        l.autoPresets,
        new Uint8Array(c.autoPresets.buffer, c.autoPresets.byteOffset, c.autoPresets.byteLength),
      ],
      [
        l.variableRanges,
        new Uint8Array(c.variableRanges.local.buffer, c.variableRanges.local.byteOffset, 64),
      ],
      [
        l.variableRanges + 64,
        new Uint8Array(c.variableRanges.global.buffer, c.variableRanges.global.byteOffset, 64),
      ],
    ];
  }
  getScalar(name) {
    return name.startsWith('sound.')
      ? this.configuration.soundOptions[name.slice(6)]
      : this.configuration.getField(name);
  }
  setScalar(name, value) {
    if (name.startsWith('sound.')) this.configuration.soundOptions[name.slice(6)] = value;
    else if (!this.configuration.setField(name, value))
      throw new Error(`Native settings field has no canonical backing: ${name}`);
  }
  load(at, width = 4) {
    const bytes = this.process.read(at, width),
      view = new DataView(bytes.buffer, bytes.byteOffset, width);
    return width === 1 ? bytes[0] : width === 2 ? view.getUint16(0, true) : view.getUint32(0, true);
  }
  store(at, value, width = 4) {
    const bytes = new Uint8Array(width),
      view = new DataView(bytes.buffer);
    if (width === 1) bytes[0] = value;
    else if (width === 2) view.setUint16(0, value, true);
    else view.setUint32(0, value, true);
    this.process.write(at, bytes);
  }
  text(at, value, wide) {
    const bytes = wide
      ? wideBytes(String(value))
      : Uint8Array.from([...encodeCP932(String(value)), 0]);
    this.process.write(at, bytes);
  }
  stringFields() {
    const l = this.layout,
      wide = this.configuration.profile === GAME;
    return [
      ['application.title', wide ? 2136 : 1356, wide],
      ...['picture', 'export', 'imageImport'].map((name, i) => [
        `paths.${name}`,
        l.first + 88 + i * l.pathBytes,
        wide,
      ]),
      ['screen.frameImage', l.frameImage, wide],
      ['log.nameFirst', l.log + 16, false],
      ['log.nameLast', l.log + 48, false],
      ...(wide ? [['language.optionTable', l.optionTable, true]] : []),
    ];
  }
  push() {
    const p = this.process,
      c = this.configuration,
      l = this.layout;
    for (const [offset, bytes] of this.arrays()) p.write(this.owner + offset, bytes);
    // Transfer adjacent canonical fields together. Bytes in the gaps are
    // owned by the original engine and must never be included in a write.
    for (const { offset, fields, bytes, view } of this.scalarRuns) {
      for (const [name, at, width] of fields) {
        const value = this.getScalar(name);
        if (width === 2) view.setUint16(at, value, true);
        else view.setUint32(at, value, true);
      }
      p.write(this.owner + offset, bytes);
    }
    // The original startup/preference readers copy windowed SCREEN width and
    // height into these interior Settings words before constructing kcView.
    // They are derived mirrors, rather than another independently writable
    // preference field (game 71D760/71FF80, immediately before authorMode).
    this.store(this.owner + l.authorMode - 4, c.screen.width, 2);
    this.store(this.owner + l.authorMode - 2, c.screen.height, 2);
    for (const [name, offset] of [
      ['authorMode', l.authorMode],
      ['variableCount', l.variableCount],
      ['windowAlphaPercent', l.alphaPercent],
    ])
      p.store(this.owner + offset, c[name]);
    for (const [name, offset, wide] of this.stringFields())
      this.text(
        this.owner + offset,
        name === 'language.optionTable' ? c.language.optionTable : c.getField(name),
        wide,
      );
    for (let i = 0; i < 5; i++)
      for (let j = 0; j < 2; j++)
        p.store(this.owner + l.sizes + i * 8 + j * 4, c.screen.sizes[i][j]);
    for (let i = 0; i < c.soundGroups.length; i++) {
      const row = c.soundGroups[i],
        at = this.owner + l.soundGroups + i * 32;
      if (i >= 8) throw new Error('Native legacy sound group array has eight records');
      p.store(at, row.enabled === undefined ? Number(row.id !== -1) : Number(row.enabled));
      this.text(at + 4, row.type, false);
      p.store(at + 20, row.id);
      p.store(at + 24, row.min);
      p.store(at + 28, row.max);
    }
    if (c.language) this.pushLanguage();
  }
  wideSSO(at, value) {
    const p = this.process,
      bytes = wideBytes(value),
      size = value.length,
      capacity = p.load(at + 20);
    if (capacity >= size && capacity >= 8) {
      p.write(p.load(at), bytes);
      p.store(at + 16, size);
      return;
    }
    if (capacity >= 8) p.free(p.load(at));
    if (size < 8) {
      p.write(at, bytes);
      p.store(at + 20, 7);
    } else {
      const buffer = p.allocate(bytes.length, true);
      p.write(buffer, bytes);
      p.store(at, buffer);
      p.store(at + 20, size);
    }
    p.store(at + 16, size);
  }
  readWideSSO(at) {
    const p = this.process,
      size = p.load(at + 16),
      capacity = p.load(at + 20);
    if (size > capacity) throw new Error('Native language string size exceeds its allocation');
    const bytes = p.read(capacity < 8 ? at : p.load(at), size * 2);
    return new TextDecoder('utf-16le', { ignoreBOM: true }).decode(bytes);
  }
  pushLanguage() {
    const p = this.process,
      at = this.owner + this.layout.languageVector,
      entries = this.configuration.language.entries;
    let vector = p.load(at);
    if (!vector) {
      vector = p.allocate(12, true);
      p.store(at, vector);
    }
    let rows = p.load(vector),
      end = p.load(vector + 4),
      capacity = p.load(vector + 8);
    if (end < rows || capacity < end || (end - rows) % 56 || (capacity - rows) % 56)
      throw new Error('Native language vector layout is invalid');
    const oldCount = (end - rows) / 56;
    if (entries.length * 56 > capacity - rows) {
      const next = p.allocate(entries.length * 56, true);
      if (oldCount) p.write(next, p.read(rows, oldCount * 56));
      if (rows) p.free(rows);
      rows = next;
      capacity = rows + entries.length * 56;
    }
    for (let i = entries.length; i < oldCount; i++)
      for (const offset of [0, 24]) {
        const s = rows + i * 56 + offset;
        if (p.load(s + 20) >= 8) p.free(p.load(s));
      }
    for (let i = 0; i < entries.length; i++) {
      const row = entries[i],
        base = rows + i * 56;
      this.wideSSO(base, row.prefix);
      this.wideSSO(base + 24, row.lang);
      for (const [name, offset] of [
        ['accel', 48],
        ['accelsub', 52],
      ]) {
        this.store(base + offset, row[name][1], 1);
        this.store(base + offset + 2, row[name][0], 2);
      }
    }
    p.store(vector, rows);
    p.store(vector + 4, rows + entries.length * 56);
    p.store(vector + 8, capacity);
  }
  pull() {
    const p = this.process,
      c = this.configuration,
      l = this.layout,
      previousFonts = { name: c.font.name, ruby: c.font.ruby };
    let changed = false;
    for (const [offset, bytes] of this.arrays()) {
      const value = p.read(this.owner + offset, bytes.length);
      if (!equal(bytes, value)) {
        bytes.set(value);
        changed = true;
      }
    }
    for (const name of ['name', 'ruby'])
      if (c.font[name] !== previousFonts[name]) c.fields.fontOverrides[name] = true;
    for (const { offset, fields, bytes } of this.scalarRuns) {
      const input = p.read(this.owner + offset, bytes.length),
        view = new DataView(input.buffer, input.byteOffset, input.byteLength);
      for (const [name, at, width] of fields) {
        const value = width === 2 ? view.getUint16(at, true) : view.getUint32(at, true);
        if (this.getScalar(name) !== value) {
          this.setScalar(name, value);
          changed = true;
        }
      }
    }
    for (const [name, offset] of [
      ['authorMode', l.authorMode],
      ['variableCount', l.variableCount],
      ['windowAlphaPercent', l.alphaPercent],
    ]) {
      const value = p.load(this.owner + offset);
      if (c[name] !== value) {
        c[name] = value;
        changed = true;
      }
    }
    for (const [name, offset, wide] of this.stringFields()) {
      const value = p.string(this.owner + offset, wide),
        current = name === 'language.optionTable' ? c.language.optionTable : c.getField(name);
      if (value !== current) {
        if (name === 'language.optionTable') c.language.optionTable = value;
        else c.setField(name, value);
        changed = true;
      }
    }
    for (let i = 0; i < 5; i++)
      for (let j = 0; j < 2; j++) {
        const value = p.load(this.owner + l.sizes + i * 8 + j * 4);
        if (c.screen.sizes[i][j] !== value) {
          c.screen.sizes[i][j] = value;
          changed = true;
        }
      }
    for (let i = 0; i < c.soundGroups.length; i++) {
      const row = c.soundGroups[i],
        at = this.owner + l.soundGroups + i * 32,
        next = {
          enabled: !!p.load(at),
          type: p.string(at + 4),
          id: p.load(at + 20) | 0,
          min: p.load(at + 24) | 0,
          max: p.load(at + 28) | 0,
        };
      for (const [name, value] of Object.entries(next))
        if (
          (name === 'enabled' && row.enabled === undefined ? row.id !== -1 : row[name]) !== value
        ) {
          row[name] = value;
          changed = true;
        }
    }
    if (c.language) {
      const vector = p.load(this.owner + l.languageVector),
        rows = vector ? p.load(vector) : 0,
        end = vector ? p.load(vector + 4) : 0;
      if (end < rows || (end - rows) % 56 || (end - rows) / 56 !== c.language.entries.length)
        throw new Error(
          'Native language record count changed without its startup language identities',
        );
      for (let i = 0; i < c.language.entries.length; i++) {
        const row = c.language.entries[i],
          base = rows + i * 56,
          next = {
            prefix: this.readWideSSO(base),
            lang: this.readWideSSO(base + 24),
            accel: [this.load(base + 50, 2), this.load(base + 48, 1)],
            accelsub: [this.load(base + 54, 2), this.load(base + 52, 1)],
          };
        for (const [name, value] of Object.entries(next))
          if (Array.isArray(value) ? !equal(row[name], value) : row[name] !== value) {
            row[name] = value;
            changed = true;
          }
      }
    }
    return changed;
  }
  snapshotRefs() {
    return { profile: this.configuration.profile, owner: this.owner, settings: this.settings };
  }
  restoreRefs(state) {
    if (
      state.profile !== this.configuration.profile ||
      state.settings !== state.owner + this.layout.settingsOffset
    )
      throw new Error('Native configuration memory checkpoint layout differs');
    this.process.read(state.owner + this.layout.autoSelect, 4);
    this.owner = state.owner;
    this.settings = state.settings;
  }
}
