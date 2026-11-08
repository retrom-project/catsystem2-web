// SPDX-License-Identifier: MPL-2.0
import { readKCS } from '../kcs.mjs';
import { MotionManager } from './manager.mjs';
import { ParticleRandom } from '../ppi/random.mjs';

export class MotionLibrary {
  constructor(game, { profile, random = new ParticleRandom(), onDebug = null } = {}) {
    this.game = game;
    this.profile = profile;
    this.random = random;
    this.onDebug = onDebug;
    this.scripts = new Map();
  }
  async load(name) {
    const key = name.toLowerCase().replace(/\.kcs$/, '');
    if (!this.scripts.has(key))
      this.scripts.set(
        key,
        (async () => {
          const bytes = this.game.requireCategory
            ? await this.game.requireCategory(name, 'mot')
            : await this.game.require(`${key}.kcs`);
          const script = await readKCS(bytes);
          script.name = key;
          script.recordName = `${key.replaceAll('\\', '/').split('/').at(-1)}.kcs`;
          return script;
        })(),
      );
    return this.scripts.get(key);
  }
  async optional(name) {
    const key = name.toLowerCase().replace(/\.kcs$/, '');
    if (this.scripts.has(key)) return this.scripts.get(key);
    const bytes = this.game.readCategory
      ? await this.game.readCategory(name, 'mot')
      : await this.game.read(`${key}.kcs`);
    if (!bytes) return null;
    const script = await readKCS(bytes);
    script.name = key;
    script.recordName = `${key.replaceAll('\\', '/').split('/').at(-1)}.kcs`;
    this.scripts.set(key, Promise.resolve(script));
    return script;
  }
  manager(base, speed = 1) {
    return new MotionManager({
      profile: this.profile,
      base,
      speed,
      random: this.random,
      onDebug: this.onDebug,
      loadScript: (name) => this.load(name),
    });
  }
}
