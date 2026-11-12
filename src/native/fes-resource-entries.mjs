// SPDX-License-Identifier: MPL-2.0
// Requested resource entries have their own FIFO lifetime. Ordinary objects
// are resolved by canonical byte key on every visit and never retained here.
const allocationTypes = new Set([
  1, 2, 3, 4, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16, 17, 18, 19, 20, 21, 22, 23, 24, 25, 26, 27,
  28, 29, 30, 31, 32, 33, 36, 37, 38,
]);
const noEntryTypes = new Set([0, 34, 35]);
const clone = (value) => structuredClone(value);
function counter(value) {
  if (!Number.isSafeInteger(value) || value < 1)
    throw new RangeError('FES resource entry counter must be a positive safe integer');
  return value;
}
function key(nameBytes, index) {
  if (!(nameBytes instanceof Uint8Array) || nameBytes.length > 31 || nameBytes.includes(0))
    throw new TypeError('FES resource entry requires a canonical CP932 byte name');
  if (!Number.isInteger(index) || (index | 0) !== index)
    throw new RangeError('FES resource entry index must be int32');
}

export class FESResourceEntries {
  constructor({
    resolve,
    allocate,
    visit,
    cleanup,
    validate,
    serialize = clone,
    deserialize = clone,
  }) {
    for (const operation of [resolve, allocate, visit, cleanup, validate, serialize, deserialize])
      if (typeof operation !== 'function')
        throw new TypeError(
          'FES resource FIFO requires its complete allocation and lifecycle services',
        );
    Object.assign(this, { resolve, allocate, visit, cleanup, validate, serialize, deserialize });
    this.entries = [];
    this.nextEntryID = 1;
  }
  async appendPending(collection) {
    if (typeof collection?.shiftPending !== 'function')
      throw new TypeError('FES resource initialization requires the owning pending-key FIFO');
    let request,
      appended = 0;
    while ((request = collection.shiftPending()) !== null) {
      key(request.nameBytes, request.index);
      const object = this.resolve(request.nameBytes, request.index);
      if (!object) continue;
      const type = object.nativeType;
      if (noEntryTypes.has(type)) continue;
      if (!allocationTypes.has(type))
        throw new TypeError(`Unsupported FES resource allocation type ${type}`);
      if (this.nextEntryID === Number.MAX_SAFE_INTEGER)
        throw new RangeError('FES resource entry identity space is exhausted');
      const entry = {
        id: this.nextEntryID++,
        name: request.name,
        nameBytes: request.nameBytes.slice(),
        index: request.index,
        savedType: type,
      };
      if ((await this.allocate(entry, object)) === false) continue;
      this.entries.push(entry);
      appended++;
    }
    return appended;
  }
  async traverse() {
    let at = 0,
      visited = 0,
      cleaned = 0;
    while (at < this.entries.length) {
      const entry = this.entries[at],
        object = this.resolve(entry.nameBytes, entry.index);
      if (object) {
        await this.visit(entry, object);
        at++;
        visited++;
      } else {
        await this.cleanup(entry);
        this.entries.splice(at, 1);
        cleaned++;
      }
    }
    return { visited, cleaned };
  }
  snapshot() {
    return {
      nextEntryID: this.nextEntryID,
      entries: this.entries.map((entry) => this.serialize(entry)),
    };
  }
  async restore(snapshot) {
    if (this.entries.length || this.nextEntryID !== 1)
      throw new Error('FES resource FIFO restore requires a fresh list');
    const next = counter(snapshot.nextEntryID),
      entries = [],
      ids = new Set();
    for (const state of snapshot.entries) {
      const entry = this.deserialize(state),
        id = counter(entry.id);
      key(entry.nameBytes, entry.index);
      if (!allocationTypes.has(entry.savedType) || ids.has(id) || id >= next)
        throw new Error('FES resource checkpoint has an invalid allocation type or identity');
      ids.add(id);
      entries.push(entry);
    }
    this.entries = entries;
    this.nextEntryID = next;
    for (const entry of this.entries)
      await this.validate(entry, this.resolve(entry.nameBytes, entry.index));
  }
  async close() {
    while (this.entries.length) {
      await this.cleanup(this.entries[0]);
      this.entries.shift();
    }
  }
}
