// SPDX-License-Identifier: MPL-2.0
import { checkpointBytes } from './checkpoint.mjs';
export class SaveStore {
  constructor(namespace, database = 'catsystem2-web') {
    this.namespace = namespace;
    this.database = database;
    this.records = new Map();
  }
  async open() {
    this.db = await new Promise((resolve, reject) => {
      const request = indexedDB.open(this.database, 1);
      request.onupgradeneeded = () => request.result.createObjectStore('saves', { keyPath: 'key' });
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
    const all = await this.request('readonly', (store) => store.getAll());
    for (const record of all)
      if (record.namespace === this.namespace) this.records.set(record.slot, record);
  }
  request(mode, action) {
    return new Promise((resolve, reject) => {
      const tx = this.db.transaction('saves', mode);
      let request;
      try {
        request = action(tx.objectStore('saves'));
      } catch (error) {
        tx.abort();
        throw error;
      }
      tx.oncomplete = () => resolve(request.result);
      tx.onabort = () => reject(tx.error || request.error || new Error('Save transaction aborted'));
      tx.onerror = () => reject(tx.error);
    });
  }
  #makeRecord(slot, data, info) {
    const size = checkpointBytes(data);
    if (!size) throw new Error('Save must be nonempty');
    return {
      ...info,
      key: `${this.namespace}:${slot}`,
      namespace: this.namespace,
      slot,
      data,
      date: Date.now(),
    };
  }
  async put(slot, data, info, companion) {
    const record = this.#makeRecord(slot, data, info);
    if (companion && companion.store.database !== this.database)
      throw new Error('Linked saves require the same database');
    const linked = companion?.store.#makeRecord(companion.slot, companion.data, companion.info);
    await this.request('readwrite', (store) => {
      if (linked) store.put(linked);
      return store.put(record);
    });
    this.records.set(slot, record);
    if (linked) companion.store.records.set(linked.slot, linked);
    return record;
  }
  readStored(slot) {
    return this.request('readonly', (store) => store.get(`${this.namespace}:${slot}`));
  }
  get(slot) {
    return this.records.get(slot);
  }
  async delete(slot) {
    await this.request('readwrite', (store) => store.delete(`${this.namespace}:${slot}`));
    this.records.delete(slot);
  }
  async move(from, to) {
    const source = this.get(from);
    if (!source || this.get(to)) return false;
    const next = { ...source, key: `${this.namespace}:${to}`, slot: to };
    await this.request('readwrite', (store) => {
      store.put(next);
      return store.delete(`${this.namespace}:${from}`);
    });
    this.records.delete(from);
    this.records.set(to, next);
    return true;
  }
  newest(from, count) {
    return (
      [...this.records.values()]
        .filter((r) => r.slot >= from && r.slot < from + count)
        .sort((a, b) => b.date - a.date)[0]?.slot ?? -1
    );
  }
  close() {
    this.db?.close();
  }
}
