// SPDX-License-Identifier: MPL-2.0
// Serializable opaque handles for browser-owned resource records.
import { nativeXMLHandleCodec } from './xml-node.mjs';
export class NativeHandles {
  constructor() {
    this.next = 1;
    this.records = new Map();
    this.codecs = new Map();
    this.releasing = new Set();
    this.registerType('xml', nativeXMLHandleCodec);
  }
  registerType(type, codec) {
    if (
      this.codecs.has(type) ||
      typeof codec?.snapshot !== 'function' ||
      typeof codec?.restore !== 'function' ||
      (codec.release !== undefined && typeof codec.release !== 'function')
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
    handle >>>= 0;
    const value = this.get(handle, type),
      records = this.records,
      record = records.get(handle),
      cleanup = this.codecs.get(type)?.release;
    if (!cleanup) {
      records.delete(handle);
      return value;
    }
    if (this.releasing.has(record)) throw new Error('Reentrant native resource release');
    this.releasing.add(record);
    try {
      const dependents = cleanup(value, handle) ?? [],
        plan = [[handle, record]],
        ids = new Set([handle]);
      if (!Array.isArray(dependents)) throw new Error('Invalid native resource cleanup plan');
      for (const dependent of dependents) {
        if (ids.has(dependent.handle)) throw new Error('Duplicate native resource cleanup');
        const entry = records.get(dependent.handle);
        if (!entry || entry.type !== dependent.type || entry.value !== dependent.value)
          throw new Error('Native resource cleanup lost its borrowed identity');
        ids.add(dependent.handle);
        plan.push([dependent.handle, entry]);
      }
      if (this.records !== records || plan.some(([id, entry]) => records.get(id) !== entry))
        throw new Error('Native resource owner changed during cleanup');
      // Validation and hooks finish before any record is removed. A failed or
      // reentrant hook cannot publish a half-retired borrowed pair.
      for (const [id] of plan) records.delete(id);
      return value;
    } finally {
      this.releasing.delete(record);
    }
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
