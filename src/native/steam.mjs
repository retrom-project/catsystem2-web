// SPDX-License-Identifier: MPL-2.0
// Optional browser Steam provider; no Windows Steam entry point is executed.
import { nativeABI } from './abi/index.mjs';
import { nativeReply, NATIVE_RESULT_SENTINEL } from '../kcs/vm.mjs';
import { encodeCP932 } from '../kcs/strings.mjs';
const identity = (bytes) =>
  Array.from(bytes, (byte) => byte.toString(16).padStart(2, '0')).join('');
export class NativeSteam {
  constructor(provider) {
    this.provider = provider;
    this.ready = Boolean(provider && !provider.initialize);
    this.managerExists = this.ready;
    this.initialization = null;
    this.achievements = null;
    if (this.ready) this.refreshAchievements();
  }
  async initialize() {
    if (this.closed) return 0;
    if (!this.initialization)
      this.initialization = Promise.resolve().then(async () => {
        // The original singleton remains allocated when SteamAPI_Init fails.
        this.managerExists = true;
        if (!this.provider) return 0;
        const value = this.provider.initialize ? await this.provider.initialize() : true;
        if (typeof value !== 'boolean' && value !== 0 && value !== 1)
          throw new Error('Steam provider initialization must report availability');
        this.ready = Boolean(value);
        if (this.ready) this.refreshAchievements();
        return Number(this.ready);
      });
    return this.initialization;
  }
  get enabled() {
    return Boolean(this.ready && !this.closed);
  }
  get statsReady() {
    return this.enabled && this.achievements !== null && this.provider.statsReady !== false;
  }
  refreshAchievements(entries = this.provider?.achievements) {
    if (entries == null) {
      this.achievements = null;
      return;
    }
    if (!(entries instanceof Map))
      throw new Error('Steam achievement cache requires a complete Map');
    const next = new Map();
    for (const [name, value] of entries) {
      if (
        typeof name !== 'string' ||
        name.includes('\0') ||
        !(typeof value === 'boolean' || (Number.isInteger(value) && value >= 0 && value <= 255))
      )
        throw new Error('Invalid Steam achievement cache entry');
      next.set(identity(new TextEncoder().encode(name)), { name, unlocked: Number(value) });
    }
    this.achievements = next;
  }
  entry(name) {
    const bytes = typeof name === 'string' ? new TextEncoder().encode(name) : name;
    if (!(bytes instanceof Uint8Array))
      throw new Error('Steam achievement name requires bytes or a string');
    const end = bytes.indexOf(0);
    return this.achievements?.get(identity(end < 0 ? bytes : bytes.subarray(0, end)));
  }
  method(name) {
    const fn = this.provider?.[name];
    if (typeof fn !== 'function') throw new Error(`Steam provider requires ${name}`);
    return fn.bind(this.provider);
  }
  async achievement(name) {
    if (!this.statsReady) return 0;
    const entry = this.entry(name);
    if (!entry) return 0;
    if (!entry.unlocked) {
      entry.unlocked = 1;
      // The native cache changes before SetAchievement and StoreStats, and
      // their boolean results do not undo that change.
      await this.method('achievement')(entry.name);
    }
    return 1;
  }
  achievementState(name) {
    if (!this.statsReady) return 0;
    return Number(Boolean(this.entry(name)?.unlocked));
  }
  resetAllStats() {
    if (!this.enabled || this.achievements === null) return;
    for (const entry of this.achievements.values()) entry.unlocked = 0;
    if (this.provider.statsReady !== false) return this.method('resetAllStats')(1);
  }
  enableScreenshot(word) {
    if (this.enabled) return this.method('enableScreenshot')(word >>> 0);
  }
  async observeBroadcastQuery() {
    if (this.enabled && typeof this.provider.isBroadcasting === 'function')
      await this.provider.isBroadcasting();
  }
  async close() {
    if (this.closed) return;
    if (this.initialization) await this.initialization;
    const enabled = this.enabled;
    this.closed = true;
    if (enabled && this.provider.shutdown) await this.provider.shutdown();
    this.ready = false;
    this.managerExists = false;
  }
}
export async function nativeSteam(id, args, machine, world) {
  if (!nativeABI(world.profile).capabilities.steam || id < 0x411 || id > 0x414) return undefined;
  const count = id === 0x412 || id === 0x413 ? 1 : 0;
  if (args.length !== count)
    throw new Error(`Native Steam 0x${id.toString(16)} expects ${count} arguments`);
  const steam = world.steamService;
  if (id === 0x411) {
    await steam.initialize();
    return nativeReply(2);
  }
  if (id === 0x414) {
    await steam.resetAllStats();
    return nativeReply(1, NATIVE_RESULT_SENTINEL);
  }
  const services = world.runtime.services,
    bytes = services.formatBytes
      ? services.formatBytes(args[0], machine)
      : encodeCP932(services.format(args[0], machine));
  if (!steam.statsReady) return nativeReply(id === 0x413 ? 1 : 2, id === 0x413 ? 0 : undefined);
  if (id === 0x412) {
    await steam.achievement(bytes);
    return nativeReply(2);
  }
  return nativeReply(1, steam.achievementState(bytes));
}
export function installNativeSteam(world, provider) {
  world.ownsSteam = !(provider instanceof NativeSteam);
  world.steamService = provider instanceof NativeSteam ? provider : new NativeSteam(provider);
  if (!nativeABI(world.profile).capabilities.steam) return;
  for (let id = 0x411; id <= 0x414; id++)
    world.runtime.register('main', id, (args, machine) => nativeSteam(id, args, machine, world));
}
