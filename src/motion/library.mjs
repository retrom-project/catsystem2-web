// SPDX-License-Identifier: MPL-2.0
import { readKCS } from '../kcs.mjs';
import { encodeCP932 } from '../kcs/strings.mjs';
import { MotionManager } from './manager.mjs';
import { ParticleRandom } from '../ppi/random.mjs';
import { nativeABI } from '../native/abi/index.mjs';
import { nativeDataPair, nativeDataKey } from '../native/data-text.mjs';

const cp932 = new TextDecoder('shift_jis');
const lowerAscii = (name) => name.replace(/[A-Z]/g, (character) => character.toLowerCase());
const lastSeparator = (bytes) => Math.max(bytes.lastIndexOf(0x2f), bytes.lastIndexOf(0x5c));

export class MotionLibrary {
  constructor(
    game,
    { profile, random = new ParticleRandom(), onDebug = null, calculations, read = null } = {},
  ) {
    this.game = game;
    this.profile = profile;
    this.random = random;
    this.onDebug = onDebug;
    this.calculations = calculations;
    this.read = read;
    this.scripts = new Map();
    this.nativeFilenameQuery = profile && nativeABI(profile).motion?.nativeFilenameQuery;
    this.nativeFilenameWide = profile && nativeABI(profile).layouts?.motionCheckpoint?.wide;
  }
  withCalculations(calculations) {
    const bound = new MotionLibrary(this.game, {
      profile: this.profile,
      random: this.random,
      onDebug: this.onDebug,
      calculations,
      read: this.read,
    });
    bound.scripts = this.scripts;
    return bound;
  }
  withResources(game, read) {
    const bound = new MotionLibrary(game, {
      profile: this.profile,
      random: this.random,
      onDebug: this.onDebug,
      calculations: this.calculations,
      read: this.read ?? read,
    });
    bound.scripts = this.scripts;
    return bound;
  }
  clear() {
    this.scripts.clear();
  }
  managerDestroyed() {
    if (this.profile && nativeABI(this.profile).motion?.sourceCacheRelease === 'manager-delete')
      this.clear();
  }
  snapshot() {
    return [...this.scripts].map(([key, entry]) => [key, entry.source.slice()]);
  }
  restore(state) {
    if (!Array.isArray(state)) throw new Error('Invalid MOT source cache');
    const entries = new Map();
    for (const [key, source] of state) {
      if (
        typeof key !== 'string' ||
        !(source instanceof Uint8Array) ||
        !source.length ||
        entries.has(key)
      )
        throw new Error('Invalid MOT cached source');
      entries.set(key, { source: source.slice(), script: null, pending: null });
    }
    this.clear();
    for (const entry of entries) this.scripts.set(...entry);
  }
  nativeFilename(bytes) {
    const wide = typeof bytes === 'string';
    if (wide) {
      if (!this.nativeFilenameWide) throw new TypeError('Narrow MOT filename requires bytes');
      for (let at = 1; at < bytes.length; at++)
        if (bytes[at] === '/' || bytes[at] === '\\') return bytes;
    } else
      for (let at = 0; at < bytes.length; at++) {
        if (nativeDataPair(bytes, at)) at++;
        else if (at > 0 && (bytes[at] === 0x2f || bytes[at] === 0x5c)) return bytes;
      }
    const resources = this.game.nativeResources;
    const entry = resources?.entries.find(({ name }) => lowerAscii(name) === 'mot');
    if (resources && !entry) return null;
    if (wide) {
      // CSS supplies WCHAR names directly to the wide loader. Configuration
      // category fields retain their existing narrow conversion separately.
      const prefix = entry?.archive ? cp932.decode(encodeCP932(entry.archive)) + '/' : '',
        separator = Math.max(bytes.lastIndexOf('/'), bytes.lastIndexOf('\\')),
        suffix =
          bytes.lastIndexOf('.') > separator
            ? ''
            : cp932.decode(encodeCP932('.' + (entry?.extension ?? 'kcs')));
      return prefix + bytes + suffix;
    }
    const prefix = entry?.archive ? encodeCP932(entry.archive + '/') : [];
    const suffix =
      bytes.lastIndexOf(0x2e) > lastSeparator(bytes)
        ? []
        : encodeCP932('.' + (entry?.extension ?? 'kcs'));
    return Uint8Array.from([...prefix, ...bytes, ...suffix]);
  }
  nativeFilenameKey(bytes) {
    return this.nativeFilenameWide
      ? (typeof bytes === 'string' ? bytes : cp932.decode(bytes)).toLowerCase()
      : lowerAscii(nativeDataKey(bytes));
  }
  #inputName(name, nameBytes) {
    return nameBytes ?? (this.nativeFilenameWide ? name : encodeCP932(name));
  }
  #key(name, nameBytes) {
    if (this.nativeFilenameQuery) {
      const filename = this.nativeFilename(this.#inputName(name, nameBytes));
      return filename === null ? null : this.nativeFilenameKey(filename);
    }
    return (
      this.nativeFilenameQuery && !this.nativeFilenameWide ? lowerAscii(name) : name.toLowerCase()
    ).replace(/\.kcs$/, '');
  }
  #describe(script, name, key, nameBytes) {
    // Cache folding is not a resource filename: a qualified path needs its
    // extension when an independent cold manager loads this script again.
    script.name = name;
    script.nameBytes = nameBytes?.slice() ?? (this.nativeFilenameWide ? null : encodeCP932(name));
    if (this.nativeFilenameQuery) {
      const input = this.#inputName(name, nameBytes),
        bytes = this.nativeFilename(input) ?? input;
      if (this.nativeFilenameWide) {
        const filename = typeof bytes === 'string' ? bytes : cp932.decode(bytes),
          separator = Math.max(filename.lastIndexOf('/'), filename.lastIndexOf('\\'));
        script.recordName = filename.slice(separator > 0 ? separator + 1 : 0);
        script.recordNameBytes = encodeCP932(script.recordName);
      } else {
        // The narrow native record uses byte strrchr, including a CP932 trail
        // byte equal to backslash. The wide record splits after conversion.
        const separator = lastSeparator(bytes);
        script.recordNameBytes = bytes.slice(separator > 0 ? separator + 1 : 0);
        script.recordName = cp932.decode(script.recordNameBytes);
      }
    } else script.recordName = key.replaceAll('\\', '/').split('/').at(-1) + '.kcs';
    return script;
  }
  async load(name, { source = null, nameBytes } = {}) {
    const script = await this.optional(name, { source, nameBytes });
    if (!script) throw new Error(`Missing mot resource: ${name}`);
    return script;
  }
  async optional(name, { read, nameBytes, source = null } = {}) {
    const key = this.#key(name, nameBytes);
    if (key === null) return null;
    if (source !== null) {
      if (!(source instanceof Uint8Array) || !source.length)
        throw new Error('Invalid MOT instance source');
      const cached = this.scripts.get(key)?.source;
      if (
        !cached ||
        source.length !== cached.length ||
        source.some((byte, at) => byte !== cached[at])
      )
        return this.#describe({ ...(await readKCS(source)), source }, name, key, nameBytes);
      // Reuse the current immutable entry only when the actual bytes match.
      // Restoring an older actor must not replace the current named cache.
    }
    if (!this.scripts.has(key)) {
      const filename = this.nativeFilenameQuery
          ? this.nativeFilename(this.#inputName(name, nameBytes))
          : name,
        fallbackName = this.nativeFilenameQuery
          ? typeof filename === 'string'
            ? filename
            : cp932.decode(filename)
          : `${key}.kcs`,
        bytes = read
          ? await read(name)
          : this.read
            ? await this.read(typeof filename === 'string' ? filename : cp932.decode(filename))
            : this.game.readCategory
              ? await this.game.readCategory(name, 'mot')
              : this.game.requireCategory
                ? await this.game.requireCategory(name, 'mot')
                : this.game.read
                  ? await this.game.read(fallbackName)
                  : await this.game.require(fallbackName);
      // A missing or zero-size source is not inserted in the native source list.
      if (!bytes || bytes.byteLength === 0) return null;
      this.scripts.set(key, { source: bytes.slice(), script: null, pending: null });
    }
    const entry = this.scripts.get(key);
    if (!entry.script) {
      entry.pending ??= readKCS(entry.source).then((script) => (entry.script = script));
      await entry.pending;
    }
    const script = entry.script;
    // Cached code is shared; each record retains its own requested filename.
    return this.#describe({ ...script, source: entry.source }, name, key, nameBytes);
  }
  manager(base, speed = 1) {
    return new MotionManager({
      profile: this.profile,
      base,
      speed,
      random: this.random,
      calculations: this.calculations,
      onDebug: this.onDebug,
      loadScript: (name, source, nameBytes) => this.load(name, { source, nameBytes }),
    });
  }
}
