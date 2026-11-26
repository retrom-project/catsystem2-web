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
  nativeFilename(bytes) {
    for (let at = 0; at < bytes.length; at++) {
      if (nativeDataPair(bytes, at)) at++;
      else if (at > 0 && (bytes[at] === 0x2f || bytes[at] === 0x5c)) return bytes;
    }
    const resources = this.game.nativeResources;
    const entry = resources?.entries.find(({ name }) => lowerAscii(name) === 'mot');
    if (resources && !entry) return null;
    const prefix = entry?.archive ? encodeCP932(entry.archive + '/') : [];
    const suffix =
      bytes.lastIndexOf(0x2e) > lastSeparator(bytes)
        ? []
        : encodeCP932('.' + (entry?.extension ?? 'kcs'));
    return Uint8Array.from([...prefix, ...bytes, ...suffix]);
  }
  nativeFilenameKey(bytes) {
    return this.nativeFilenameWide
      ? cp932.decode(bytes).toLowerCase()
      : lowerAscii(nativeDataKey(bytes));
  }
  #key(name, nameBytes) {
    if (this.nativeFilenameQuery) {
      const filename = this.nativeFilename(nameBytes ?? encodeCP932(name));
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
    if (this.nativeFilenameQuery) {
      nameBytes ??= encodeCP932(name);
      const bytes = this.nativeFilename(nameBytes) ?? nameBytes;
      if (this.nativeFilenameWide) {
        const filename = cp932.decode(bytes),
          separator = Math.max(filename.lastIndexOf('/'), filename.lastIndexOf('\\'));
        script.recordName = filename.slice(separator > 0 ? separator + 1 : 0);
        script.recordNameBytes = encodeCP932(script.recordName);
      } else {
        // The narrow native record uses byte strrchr, including a CP932 trail
        // byte equal to backslash. The wide record splits after conversion.
        const separator = lastSeparator(bytes);
        script.recordNameBytes = bytes.subarray(separator > 0 ? separator + 1 : 0);
        script.recordName = cp932.decode(script.recordNameBytes);
      }
    } else script.recordName = key.replaceAll('\\', '/').split('/').at(-1) + '.kcs';
    return script;
  }
  async load(name) {
    const script = await this.optional(name);
    if (!script) throw new Error(`Missing mot resource: ${name}`);
    return script;
  }
  async optional(name, { read, nameBytes } = {}) {
    const key = this.#key(name, nameBytes);
    if (key === null) return null;
    if (!this.scripts.has(key)) {
      const bytes = read
        ? await read(name)
        : this.read
          ? await this.read(
              this.nativeFilenameQuery
                ? cp932.decode(this.nativeFilename(nameBytes ?? encodeCP932(name)))
                : name,
            )
          : this.game.readCategory
            ? await this.game.readCategory(name, 'mot')
            : this.game.requireCategory
              ? await this.game.requireCategory(name, 'mot')
              : this.game.read
                ? await this.game.read(`${key}.kcs`)
                : await this.game.require(`${key}.kcs`);
      // A missing or zero-size source is not inserted in the native source list.
      if (!bytes || bytes.byteLength === 0) return null;
      this.scripts.set(key, readKCS(bytes));
    }
    const script = await this.scripts.get(key);
    // Cached code is shared; each record retains its own requested filename.
    return this.#describe({ ...script }, name, key, nameBytes);
  }
  manager(base, speed = 1) {
    return new MotionManager({
      profile: this.profile,
      base,
      speed,
      random: this.random,
      calculations: this.calculations,
      onDebug: this.onDebug,
      loadScript: (name) => this.load(name),
    });
  }
}
