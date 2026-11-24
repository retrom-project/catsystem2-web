// SPDX-License-Identifier: MPL-2.0
import { readKCS } from '../kcs.mjs';
import { encodeCP932 } from '../kcs/strings.mjs';
import { MotionManager } from './manager.mjs';
import { ParticleRandom } from '../ppi/random.mjs';
import { nativeABI } from '../native/abi/index.mjs';
import { nativeDataPair } from '../native/data-text.mjs';

const cp932 = new TextDecoder('shift_jis');
const lowerAscii = (name) => name.replace(/[A-Z]/g, (character) => character.toLowerCase());
const lastSeparator = (bytes) => Math.max(bytes.lastIndexOf(0x2f), bytes.lastIndexOf(0x5c));

export class MotionLibrary {
  constructor(game, { profile, random = new ParticleRandom(), onDebug = null, calculations } = {}) {
    this.game = game;
    this.profile = profile;
    this.random = random;
    this.onDebug = onDebug;
    this.calculations = calculations;
    this.scripts = new Map();
    this.nativeFilenameQuery = profile && nativeABI(profile).motion?.nativeFilenameQuery;
  }
  withCalculations(calculations) {
    const bound = new MotionLibrary(this.game, {
      profile: this.profile,
      random: this.random,
      onDebug: this.onDebug,
      calculations,
    });
    bound.scripts = this.scripts;
    return bound;
  }
  nativeFilename(bytes) {
    for (let at = 0; at < bytes.length; at++) {
      if (nativeDataPair(bytes, at)) at++;
      else if (at > 0 && (bytes[at] === 0x2f || bytes[at] === 0x5c)) return bytes;
    }
    const resources = this.game.nativeResources;
    const entry = resources?.entries.find(({ name }) => lowerAscii(name) === 'mot');
    if (resources && !entry) return null;
    const prefix = entry?.directory ? encodeCP932(entry.directory + '/') : [];
    const suffix =
      bytes.lastIndexOf(0x2e) > lastSeparator(bytes)
        ? []
        : encodeCP932('.' + (entry?.extension ?? 'kcs'));
    return Uint8Array.from([...prefix, ...bytes, ...suffix]);
  }
  #key(name) {
    return (this.nativeFilenameQuery ? lowerAscii(name) : name.toLowerCase()).replace(/\.kcs$/, '');
  }
  #describe(script, name, key, nameBytes) {
    script.name = key;
    if (this.nativeFilenameQuery) {
      nameBytes ??= encodeCP932(name);
      const bytes = this.nativeFilename(nameBytes) ?? nameBytes;
      const separator = lastSeparator(bytes);
      script.recordNameBytes = bytes.subarray(separator > 0 ? separator + 1 : 0);
      script.recordName = cp932.decode(script.recordNameBytes);
    } else script.recordName = key.replaceAll('\\', '/').split('/').at(-1) + '.kcs';
    return script;
  }
  async load(name) {
    const key = this.#key(name);
    if (!this.scripts.has(key))
      this.scripts.set(
        key,
        (async () => {
          const bytes = this.game.requireCategory
            ? await this.game.requireCategory(name, 'mot')
            : await this.game.require(`${key}.kcs`);
          return this.#describe(await readKCS(bytes), name, key);
        })(),
      );
    return this.scripts.get(key);
  }
  async optional(name, { read, nameBytes } = {}) {
    const key = this.#key(name);
    if (this.scripts.has(key)) return this.scripts.get(key);
    const bytes = read
      ? await read(name)
      : this.game.readCategory
        ? await this.game.readCategory(name, 'mot')
        : await this.game.read(`${key}.kcs`);
    // The original MOT manager returns zero before parsing a zero-size file.
    if (!bytes || bytes.byteLength === 0) return null;
    const script = this.#describe(await readKCS(bytes), name, key, nameBytes);
    this.scripts.set(key, Promise.resolve(script));
    return script;
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
