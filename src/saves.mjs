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
      const tx = this.db.transaction('saves', mode),
        request = action(tx.objectStore('saves'));
      tx.oncomplete = () => resolve(request.result);
      tx.onabort = () => reject(tx.error || request.error || new Error('Save transaction aborted'));
      tx.onerror = () => reject(tx.error);
    });
  }
  async put(slot, data, info) {
    const size = checkpointBytes(data);
    if (!size) throw new Error('Save must be nonempty');
    const record = {
      ...info,
      key: `${this.namespace}:${slot}`,
      namespace: this.namespace,
      slot,
      data,
      date: Date.now(),
    };
    await this.request('readwrite', (store) => store.put(record));
    this.records.set(slot, record);
    return record;
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
