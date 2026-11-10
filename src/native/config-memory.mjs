// SPDX-License-Identifier: MPL-2.0
// Settings is an interior pointer into Engine, never a second allocation.
import { NATIVE_ABIS, nativeABI } from './abi/index.mjs';
import { encodeCP932 } from '../kcs/strings.mjs';

export const NATIVE_CONFIGURATION_MEMORY_LAYOUTS = Object.freeze(
  Object.fromEntries(
    Object.entries(NATIVE_ABIS).map(([profile, abi]) => [profile, abi.configuration.memory.layout]),
  ),
);

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
    const abi = nativeABI(configuration?.profile);
    this.abi = abi;
    this.layout = abi.configuration.memory.layout;
    if (!this.layout)
      throw new Error('Native settings memory requires a recovered configuration profile');
    if (!Number.isInteger(owner) || owner <= 0)
      throw new Error('Native settings memory requires the shared Engine owner address');
    this.owner = owner >>> 0;
    this.settings = (settings ?? this.owner + this.layout.settingsOffset) >>> 0;
    if (this.settings !== this.owner + this.layout.settingsOffset)
      throw new Error('Native Settings must alias the recovered interior Engine address');
    this.scalarRuns = scalarRuns(abi.configuration.memory.scalarFields);
    // Confirm that the supplied owner covers the fields this codec owns.
    process.read(this.owner + this.layout.autoSelect, abi.configuration.memory.autoSelectBytes);
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
      wide = this.abi.text.settingsCharacterBytes === 2;
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
    c.queryWords.forEach((word, i) =>
      p.store(this.owner + this.abi.layouts.configurationQuery.query24D + i * 4, word),
    );
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
