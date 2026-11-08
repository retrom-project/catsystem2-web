// SPDX-License-Identifier: MPL-2.0
// Serializable opaque handles for browser-owned resource records.
export class NativeHandles {
  constructor() {
    this.next = 1;
    this.records = new Map();
    this.codecs = new Map();
  }
  registerType(type, codec) {
    if (
      this.codecs.has(type) ||
      typeof codec?.snapshot !== 'function' ||
      typeof codec?.restore !== 'function'
    )
      throw new Error(`Invalid or duplicate native resource codec ${type}`);
    this.codecs.set(type, codec);
  }
  add(type, value) {
    if (!type || typeof type !== 'string')
      throw new Error('Native handle requires a resource type');
    if (this.next > 0x7fffffff) throw new Error('Native resource handle space exhausted');
    const handle = this.next++;
    this.records.set(handle, { type, value });
    return handle;
  }
  get(handle, type) {
    const record = this.records.get(handle >>> 0);
    if (!record) throw new Error(`Invalid or released native ${type} handle ${handle}`);
    if (record.type !== type)
      throw new Error(`Native handle ${handle} has type ${record.type}, expected ${type}`);
    return record.value;
  }
  release(handle, type) {
    const value = this.get(handle, type);
    this.records.delete(handle >>> 0);
    return value;
  }
  snapshot() {
    return {
      next: this.next,
      records: structuredClone(
        [...this.records].map(([id, record]) => [
          id,
          {
            type: record.type,
            value: this.codecs.get(record.type)?.snapshot(record.value) ?? record.value,
          },
        ]),
      ),
    };
  }
  restore(state) {
    if (!Number.isSafeInteger(state.next) || state.next < 1 || state.next > 0x80000000)
      throw new Error('Invalid native handle checkpoint sequence');
    const records = new Map();
    for (const [id, record] of state.records) {
      if (
        !Number.isSafeInteger(id) ||
        id < 1 ||
        id >= state.next ||
        records.has(id) ||
        !record.type
      )
        throw new Error('Invalid native handle checkpoint record');
      const value = structuredClone(record.value);
      records.set(id, {
        type: record.type,
        value: this.codecs.get(record.type)?.restore(value) ?? value,
      });
    }
    this.records = records;
    this.next = state.next;
  }
}
