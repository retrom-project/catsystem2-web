// SPDX-License-Identifier: MPL-2.0
// kcFileServer preload list: game 5D36D0/5D3C80/5D4410/5D4FF0/5D61C0.
import { nativeReply } from '../kcs/vm.mjs';

export const NATIVE_RESOURCE_CACHE_IDS = Object.freeze([0x1b2, 0x1b3, 0x1b4, 0x1b5, 0x1b6]);
const key = (filename) => filename.toLowerCase();
const MAX = 0x7fffffff;

export class NativeResourceCache {
  constructor({ enabled = 1, read, diagnostic = () => {} } = {}) {
    if (typeof read !== 'function') throw new TypeError('Native resource cache requires a reader');
    Object.assign(this, { enabled: enabled >>> 0, sourceRead: read, diagnostic });
    this.entries = [];
    this.progress = 0;
    this.awake = false;
    this.lock = Promise.resolve();
    this.pending = 0;
    this.worker = null;
    this.failure = null;
    this.closed = false;
  }
  exclusive(operation) {
    if (this.closed) throw new Error('Native resource cache is closed');
    this.pending++;
    const result = this.lock.then(operation);
    this.lock = result.then(
      () => {},
      () => {},
    );
    return result.finally(() => {
      this.pending--;
    });
  }
  queue(filename, lifetime, type = 3) {
    return this.exclusive(() => {
      if (!this.enabled) return 1;
      if (typeof filename !== 'string' || filename.includes('\0') || filename.length > 259)
        throw new RangeError('Native preload filename crosses its 260-character field');
      const existing = this.entries.find((entry) => key(entry.filename) === key(filename));
      if (existing) existing.lifetime = lifetime | 0;
      else
        this.entries.push({
          filename,
          lifetime: lifetime | 0,
          priority: lifetime | 0,
          type: type >>> 0,
          loaded: 0,
          bytes: null,
        });
      return 1;
    });
  }
  clear() {
    return this.exclusive(() => {
      if (this.enabled) {
        this.entries = [];
        this.progress = MAX;
      }
      return 1;
    });
  }
  age() {
    return this.exclusive(() => {
      if (this.enabled) {
        this.entries = this.entries.filter((entry) => {
          entry.lifetime = (entry.lifetime - 1) | 0;
          if (entry.lifetime < 0) return false;
          entry.priority = (entry.priority - 1) | 0;
          return true;
        });
        this.progress = (this.progress - 1) | 0;
      }
      return 1;
    });
  }
  start() {
    return this.exclusive(() => {
      if (this.enabled) {
        this.entries.sort((a, b) => a.priority - b.priority);
        this.progress = 0;
        this.awake = true;
        this.wake();
      }
      return 1;
    });
  }
  wake() {
    if (this.worker || !this.awake) return;
    this.worker = Promise.resolve()
      .then(async () => {
        while (this.awake)
          await this.exclusive(async () => {
            let group = -1;
            for (const entry of this.entries) {
              if (group !== -1 && group !== entry.lifetime) {
                this.progress = group;
                return;
              }
              if (!entry.loaded) {
                const bytes = await this.sourceRead(entry.filename);
                entry.bytes = bytes === null ? null : new Uint8Array(bytes);
                entry.loaded = 1;
                group = entry.lifetime;
              }
            }
            this.progress = MAX;
            this.awake = false;
          });
      })
      .catch((error) => {
        this.failure = error;
        this.awake = false;
        this.diagnostic({ type: 'native-preload-error', message: error.message });
      })
      .finally(() => {
        this.worker = null;
        if (this.awake) this.wake();
      });
  }
  complete(threshold) {
    if (this.failure) throw this.failure;
    return Number(!this.enabled || (threshold | 0) <= this.progress);
  }
  async read(filename) {
    if (!this.enabled) return this.sourceRead(filename);
    const cached = await this.exclusive(
      () =>
        this.entries.find((entry) => entry.loaded && key(entry.filename) === key(filename))?.bytes,
    );
    return cached ? cached.slice() : this.sourceRead(filename);
  }
  peek(filename) {
    return this.exclusive(() => {
      if (!this.enabled) return null;
      const entry = this.entries.find(
        (entry) => entry.loaded && entry.bytes !== null && key(entry.filename) === key(filename),
      );
      return entry ? entry.bytes.slice() : null;
    });
  }
  async settle() {
    await this.lock;
    while (this.worker) await this.worker;
    if (this.failure) throw this.failure;
  }
  snapshot() {
    if (this.pending || this.worker)
      throw new Error('Native preload must settle before checkpointing');
    if (this.failure) throw this.failure;
    return structuredClone({
      enabled: this.enabled,
      entries: this.entries,
      progress: this.progress,
    });
  }
  restore(state) {
    if (this.pending || this.worker || this.entries.length)
      throw new Error('Native preload restore requires a fresh cache');
    Object.assign(this, structuredClone(state));
  }
  async close() {
    if (this.closed) return;
    await this.settle();
    await this.clear();
    this.closed = true;
  }
}

export function nativeResourceCache(id, args, machine, services) {
  if (!NATIVE_RESOURCE_CACHE_IDS.includes(id)) return undefined;
  const count = id === 0x1b3 ? 3 : id === 0x1b5 ? 1 : 0;
  if (args.length !== count)
    throw new Error(`Native preload 0x${id.toString(16)} expects ${count} arguments`);
  const cache = services.resourceCache;
  if (!cache) return undefined;
  if (id === 0x1b5) return nativeReply(1, cache.complete(args[0]));
  let operation;
  if (id === 0x1b2) operation = cache.clear();
  else if (id === 0x1b4) operation = cache.start();
  else if (id === 0x1b6) operation = cache.age();
  else {
    // The original formatter succeeds for empty strings too. An unknown
    // category clears its path output; it does not substitute an image name.
    const category = services.format(args[1], machine),
      name = services.format(args[0], machine),
      filename = services.resourceFilename(name, category) ?? '';
    operation = cache.queue(filename, args[2], 3);
  }
  return operation.then(() => nativeReply(2));
}
