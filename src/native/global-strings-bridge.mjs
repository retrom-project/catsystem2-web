// SPDX-License-Identifier: MPL-2.0
// Shared native callers use the World's language tables. Pointer identity for
// plain strings and the fallback suffix follows game 5ABE00 / SDK 47ECF0.
const keyOf = (bytes) => Array.from(bytes, (byte) => byte.toString(16).padStart(2, '0')).join('');
const utf16 = (text) => {
  const bytes = new Uint8Array((text.length + 1) * 2),
    view = new DataView(bytes.buffer);
  for (let i = 0; i < text.length; i++) view.setUint16(i * 2, text.charCodeAt(i), true);
  return bytes;
};
export class NativeGlobalStringsBridge {
  constructor(engine, strings) {
    Object.assign(this, { engine, strings, cache: new Map() });
    this.wide = !engine.profile.startsWith('sdk-');
    engine.patch(this.wide ? 0x5abe00 : 0x47ecf0, 'system language lookup', 1, ([input]) =>
      this.lookup(input),
    );
    engine.registerFeature('global-strings', this);
  }
  lookup(input) {
    if (!input) throw new Error('Native global string lookup dereferences a NULL input');
    const p = this.engine.process;
    let end, key;
    if (this.wide) {
      const text = p.string(input, true),
        delimiter = text[0];
      if (delimiter !== '$' && delimiter !== '#') return input;
      end = text.indexOf(delimiter, 1);
      if (end < 0) return input;
      key = text.slice(0, end + 1);
    } else {
      const bytes = p.stringBytes(input);
      if (bytes[0] !== 36) return input;
      end = bytes.indexOf(36, 1);
      if (end < 0) return input;
      key = keyOf(bytes.subarray(0, end + 1));
    }
    for (const id of [...this.strings.tables.keys()].sort((a, b) => a - b)) {
      const table = this.strings.tables.get(id);
      if (!table.has(key)) continue;
      const value = table.get(key),
        bytes = this.wide ? utf16(value) : Uint8Array.from([...value, 0]),
        cacheKey = JSON.stringify([id, key]),
        cached = this.cache.get(cacheKey),
        identity = keyOf(bytes);
      if (cached?.identity === identity) return cached.pointer;
      if (cached) p.free(cached.pointer);
      const pointer = p.allocate(bytes.length, true);
      p.write(pointer, bytes);
      this.cache.set(cacheKey, { pointer, identity });
      return pointer;
    }
    return input + (end + 1) * (this.wide ? 2 : 1);
  }
  invalidate(ids = null) {
    for (const [key, { pointer }] of this.cache) {
      if (ids && !ids.includes(JSON.parse(key)[0])) continue;
      this.engine.process.free(pointer);
      this.cache.delete(key);
    }
  }
  snapshot() {
    return { cache: [...this.cache] };
  }
  restore(state) {
    this.cache = new Map(structuredClone(state.cache));
  }
  close() {
    this.invalidate();
  }
}
