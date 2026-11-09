// SPDX-License-Identifier: MPL-2.0
// System language tables: game 5AB510/5AB7A0/5ABE00, SDK 47E690/47E770/47ECF0.
import { nativeABI } from './abi/index.mjs';
import { encodeCP932 } from '../kcs/strings.mjs';

const utf8 = new TextDecoder('utf-8', { ignoreBOM: true }),
  cp932 = new TextDecoder('shift_jis');
const byteKey = (bytes) => Array.from(bytes, (byte) => byte.toString(16).padStart(2, '0')).join('');
function terminated(bytes) {
  const end = bytes.indexOf(0);
  return end < 0 ? bytes : bytes.subarray(0, end);
}
function sourceRows(bytes) {
  const source = terminated(bytes),
    rows = [];
  let start = 0;
  for (let at = 0; at < source.length; at++)
    if (source[at] === 13 || source[at] === 10) {
      rows.push(source.subarray(start, at));
      if (source[at] === 13 && source[at + 1] === 10) at++;
      start = at + 1;
    }
  if (start < source.length) rows.push(source.subarray(start));
  let inComment = false;
  return (
    rows
      .map((row) => {
        const result = [];
        for (let i = 0; i < row.length; i++) {
          if (inComment) {
            if (row[i] === 42 && row[i + 1] === 47) {
              inComment = false;
              i++;
            }
          } else if (row[i] === 47 && row[i + 1] === 47) break;
          else if (row[i] === 47 && row[i + 1] === 42) {
            inComment = true;
            i++;
          } else result.push(row[i] === 9 ? 32 : row[i]);
        }
        // These are two single-character erasures, not general whitespace trim.
        if (result[0] === 32) result.shift();
        if (result[result.length - 1] === 32) result.pop();
        return Uint8Array.from(result);
      })
      // The original blank-row scan keeps comparing the saved first byte. Thus
      // a row still starting with a space is discarded, including indented text.
      .filter((row) => row.length && row[0] !== 32)
  );
}
const marker = (bytes, text) =>
  bytes.length === text.length && bytes.every((byte, i) => byte === text.charCodeAt(i));

export function parseNativeGlobalStrings(source, profile) {
  if (!(source instanceof Uint8Array)) throw new TypeError('Native language tables require bytes');
  const language = nativeABI(profile).language;
  const rows = sourceRows(source),
    entries = new Map();
  for (let at = 0; at + 1 < rows.length; at += 2) {
    let value = rows[at + 1];
    if (marker(value, '$nr$')) continue;
    if (marker(value, '$empty$')) value = new Uint8Array();
    const key = language.storage === 'text' ? utf8.decode(rows[at]) : byteKey(rows[at]);
    if (!entries.has(key))
      entries.set(key, language.storage === 'text' ? utf8.decode(value) : value.slice());
  }
  return entries;
}

export class NativeGlobalStrings {
  constructor({ profile, read, readArchive, configuration } = {}) {
    this.abi = nativeABI(profile);
    this.profile = profile;
    this.read = read;
    this.readArchive = readArchive;
    this.configuration = configuration;
    this.tables = new Map();
    this.filenames = new Map();
  }
  tableID(id) {
    if (!Number.isInteger(id) || id < -0x80000000 || id > 0xffffffff)
      throw new RangeError('Native language table ID requires a 32-bit word');
    if (this.abi.language.singleTable && id !== 0)
      throw new RangeError('The SDK has one global language table');
    return id | 0;
  }
  // The parser itself merges and retains the first occurrence of every key.
  parse(id, bytes) {
    id = this.tableID(id);
    const table = this.tables.get(id) ?? new Map();
    for (const [key, value] of parseNativeGlobalStrings(bytes, this.profile))
      if (!table.has(key)) table.set(key, value);
    this.tables.set(id, table);
    return this;
  }
  async reload(id, filename) {
    id = this.tableID(id);
    if (typeof this.read !== 'function') throw new Error('Native language file service is missing');
    if (this.abi.language.fixedFilename && filename !== this.abi.language.fixedFilename)
      throw new Error('The SDK language loader reads language.txt');
    filename = String(filename).split('\0', 1)[0];
    if (this.abi.language.resetOnReload) {
      this.tables.delete(id);
      this.filenames.delete(id);
    }
    let bytes = await this.read(filename);
    if (bytes === null && this.abi.language.archiveFallback && this.readArchive)
      bytes = await this.readArchive(filename, 3);
    if (bytes === null) return false;
    this.parse(id, bytes);
    this.filenames.set(id, filename);
    return true;
  }
  languagePrefix(field) {
    const language = this.configuration?.language;
    if (!language) throw new Error('Native language configuration is missing');
    const index = language[field] >>> 0;
    return (
      language.entries[index] ??
      (field === 'sub' ? undefined : language.entries[language.default >>> 0])
    )?.prefix;
  }
  uiFilename() {
    return `language_${this.languagePrefix('ui') ?? ''}.txt`;
  }
  optionFilename() {
    const language = this.configuration?.language;
    if (!language) throw new Error('Native language configuration is missing');
    let filename = language.optionTable;
    for (const [field, token] of [
      ['ui', '%LANG%'],
      ['main', '%LANG_M%'],
    ]) {
      const prefix = this.languagePrefix(field);
      if (prefix !== undefined) filename = filename.replaceAll(token, prefix);
    }
    return filename;
  }
  async initialize() {
    if (this.abi.language.fixedFilename)
      return [await this.reload(0, this.abi.language.fixedFilename)];
    return [await this.reload(0, this.uiFilename()), await this.reload(1, this.optionFilename())];
  }
  // Call after the Windows language handler has updated the shared settings.
  async languageChanged(field) {
    if (!this.abi.language.switchWindowProtocol)
      throw new Error('The ABI has no language-switch window protocol');
    if (field === 'ui') return this.initialize();
    if (field === 'main') return [await this.reload(1, this.optionFilename())];
    if (field === 'sub') return [];
    throw new Error(`Unknown native language change ${field}`);
  }
  get(text) {
    if (typeof text !== 'string') throw new TypeError('Native global string lookup requires text');
    text = text.split('\0', 1)[0];
    if (this.abi.language.storage === 'bytes')
      return cp932.decode(this.getBytes(encodeCP932(text)));
    const delimiter = text[0];
    if (delimiter !== '$' && delimiter !== '#') return text;
    const end = text.indexOf(delimiter, 1);
    if (end < 0) return text;
    const key = text.slice(0, end + 1);
    for (const id of [...this.tables.keys()].sort((a, b) => a - b)) {
      const table = this.tables.get(id);
      if (table.has(key)) return table.get(key);
    }
    return text.slice(end + 1);
  }
  getBytes(bytes) {
    if (this.abi.language.storage !== 'bytes')
      throw new Error('The game system translator accepts UTF16 text');
    if (!(bytes instanceof Uint8Array))
      throw new TypeError('Native global string lookup requires bytes');
    bytes = terminated(bytes);
    if (bytes[0] !== 36) return bytes.slice();
    const end = bytes.indexOf(36, 1);
    if (end < 0) return bytes.slice();
    const value = this.tables.get(0)?.get(byteKey(bytes.subarray(0, end + 1)));
    return value === undefined ? bytes.slice(end + 1) : value.slice();
  }
  snapshot() {
    return {
      profile: this.profile,
      filenames: [...this.filenames],
      tables: [...this.tables].map(([id, entries]) => [
        id,
        [...entries].map(([key, value]) => [
          key,
          this.abi.language.storage === 'bytes' ? [...value] : value,
        ]),
      ]),
    };
  }
  restore(state) {
    if (state.profile !== this.profile)
      throw new Error('Native language checkpoint profile mismatch');
    this.filenames = new Map(state.filenames);
    this.tables = new Map(
      state.tables.map(([id, entries]) => [
        this.tableID(id),
        new Map(
          entries.map(([key, value]) => [
            key,
            this.abi.language.storage === 'bytes' ? Uint8Array.from(value) : value,
          ]),
        ),
      ]),
    );
  }
}
