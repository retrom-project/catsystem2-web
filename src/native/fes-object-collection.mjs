// SPDX-License-Identifier: MPL-2.0
// Ordinary FES keys and requested initialization order are independent of
// lifetime handles, retained draw keys and input IDs.
import { FESObjectGraph } from './fes-object-graph.mjs';
import { FES_OBJECT_TYPES } from '../fes/types.mjs';
import { encodeCP932 } from '../kcs/strings.mjs';

const names = new Map([
    [0, 'BASE'],
    ...Object.entries(FES_OBJECT_TYPES).map(([name, type]) => [type, name]),
  ]),
  decoder = new TextDecoder('shift_jis');
const clone = (value) => structuredClone(value);
function signed(value, label) {
  if (!Number.isInteger(value) || value < -0x80000000 || value > 0x7fffffff)
    throw new RangeError(`FES ${label} must be an int32`);
  return value;
}
function nameValue(name) {
  if (typeof name !== 'string' && !(name instanceof Uint8Array))
    throw new TypeError('FES object name must be text or CP932 bytes');
  const source = typeof name === 'string' ? encodeCP932(name) : name,
    end = source.indexOf(0),
    bytes = source.slice(0, end < 0 ? source.length : end);
  if (bytes.length > 31)
    throw new RangeError('FES object name exceeds the defined 31-byte CP932 boundary');
  return {
    bytes,
    token: String.fromCharCode(...bytes),
    text: typeof name === 'string' ? name.split('\0', 1)[0] : decoder.decode(bytes),
  };
}
function nativeType(type) {
  const number = typeof type === 'string' ? (type === 'BASE' ? 0 : FES_OBJECT_TYPES[type]) : type;
  if (!names.has(number)) throw new Error(`Unknown FES object type ${type}`);
  return number;
}

// Object-map ordering uses signed bytes, including the terminating NUL, then
// a signed int32 index. Group-count-map ordering is not used for object visits.
export function compareFESObjectKeys(left, right) {
  const a = left.nameBytes,
    b = right.nameBytes;
  for (let at = 0; ; at++) {
    const x = a[at] ?? 0,
      y = b[at] ?? 0,
      difference = ((x << 24) >> 24) - ((y << 24) >> 24);
    if (difference) return difference;
    if (!x) break;
  }
  const x = left.index ?? 0,
    y = right.index ?? 0;
  return x < y ? -1 : Number(x > y);
}

export class FESObjectCollection {
  constructor({ create, close = () => {}, serialize = clone, restore = null } = {}) {
    if (
      typeof create !== 'function' ||
      typeof close !== 'function' ||
      typeof serialize !== 'function' ||
      (restore !== null && typeof restore !== 'function')
    )
      throw new TypeError('FES collection requires pure typed construction and lifecycle services');
    Object.assign(this, {
      createObject: create,
      closeObject: close,
      serializeObject: serialize,
      restoreObject: restore,
    });
    this.graph = new FESObjectGraph();
    this.objects = [];
    // Presentation keys support existing object consumers. Semantic lookup
    // always uses the encoded name and int32 index, never this string map.
    this.byKey = new Map();
    this.groups = new Map();
    this.entries = new Map();
    this.identities = new WeakMap();
    this.nameCache = new Map();
    this.pending = [];
    this.pendingHead = 0;
    this.order = [];
    this.orderDirty = false;
  }
  name(name) {
    if (typeof name !== 'string') return nameValue(name);
    let value = this.nameCache.get(name);
    if (!value) this.nameCache.set(name, (value = nameValue(name)));
    return value;
  }
  hasGroup(name) {
    return this.groups.has(this.name(name).token);
  }
  count(name) {
    return this.groups.get(this.name(name).token)?.count ?? 0;
  }
  lookup(name, index = 0) {
    return this.entries.get(this.name(name).token)?.get(index | 0) ?? null;
  }
  create(type, name, count, { scalar = false, parent = null, enqueue = true } = {}) {
    type = nativeType(type);
    count = signed(count, 'object count');
    if (scalar && count !== 1) throw new Error('FES scalar creation requires count1');
    if (parent !== null) this.graph.require(parent);
    const value = this.name(name),
      result = [];
    let entries = this.entries.get(value.token);
    if (!entries) this.entries.set(value.token, (entries = new Map()));
    for (let index = 0; index < count; index++) {
      let object = entries.get(index) ?? null;
      if (!object && type !== FES_OBJECT_TYPES.NUMIMG) {
        const identity = {
          type: names.get(type),
          nativeType: type === FES_OBJECT_TYPES.VIEW ? 0 : type,
          baseName: value.text,
          index: scalar ? null : index,
          key: scalar ? value.text : `${value.text}[${index}]`,
        };
        // Construction has no resources/events. Duplicates do not construct a
        // leaked native temporary or consume an approved semantic identity.
        object = this.createObject(identity);
        if (!object || typeof object !== 'object' || typeof object.then === 'function')
          throw new TypeError('FES typed construction must return a synchronous object');
        Object.assign(object, identity, { handle: this.graph.allocateHandle(), deleted: false });
        this.graph.register(object);
        if (parent !== null) this.graph.bind(object, parent);
        entries.set(index, object);
        this.identities.set(object, { name: value, nameBytes: value.bytes, index });
        this.objects.push(object);
        this.byKey.set(object.key, object);
        this.orderDirty = true;
      }
      if (enqueue) this.pending.push({ name: value, index });
      result.push(object);
    }
    if (!this.groups.has(value.token)) this.groups.set(value.token, { name: value, count });
    return result;
  }
  // Bare visits retain holes and the first count. Explicit lookup is never
  // bounded by that count; command coordinators choose their own null policy.
  *selection(name, index = -1) {
    if ((index | 0) !== -1) {
      yield this.lookup(name, index);
      return;
    }
    for (let at = 0, end = this.count(name); at < end; at++) yield this.lookup(name, at);
  }
  // Borrowed array, invalidated only by insertion/deletion. Do not sort frame
  // work by lifetime handle: this is the independent original object-key order.
  ordered() {
    if (this.orderDirty) {
      this.order.length = 0;
      for (const object of this.objects) this.order.push(object);
      this.order.sort((left, right) =>
        compareFESObjectKeys(this.identities.get(left), this.identities.get(right)),
      );
      this.orderDirty = false;
    }
    return this.order;
  }
  peekPending() {
    const entry = this.pending[this.pendingHead];
    return entry
      ? {
          name: entry.name.text,
          nameBytes: entry.name.bytes,
          index: entry.index,
          object: this.lookup(entry.name.bytes, entry.index),
        }
      : null;
  }
  shiftPending() {
    const entry = this.peekPending();
    if (entry) {
      this.pendingHead++;
      if (this.pendingHead === this.pending.length) {
        this.pending.length = 0;
        this.pendingHead = 0;
      } else if (this.pendingHead >= 1024 && this.pendingHead * 2 >= this.pending.length) {
        this.pending.splice(0, this.pendingHead);
        this.pendingHead = 0;
      }
    }
    return entry;
  }
  async remove(object) {
    this.graph.require(object);
    const selected = this.identities.get(object);
    if (!selected) throw new Error('FES deletion requires an ordinary collection object');
    const order = this.graph.postorder(object).slice();
    for (const current of order) {
      if (this.graph.get(current.handle) !== current) continue;
      const identity = this.identities.get(current);
      if (!identity) throw new Error('FES lifetime child is absent from its object collection');
      await this.closeObject(current);
      this.entries.get(identity.name.token).delete(identity.index);
      this.byKey.delete(current.key);
      this.objects.splice(this.objects.indexOf(current), 1);
      this.identities.delete(current);
      this.graph.release(current);
      this.orderDirty = true;
    }
    // The runtime delete wrapper removes only the first matching requested
    // initializer. Other duplicate or deleted-child entries remain in FIFO.
    const pending = this.pending.findIndex(
      (entry, at) =>
        at >= this.pendingHead &&
        entry.name.token === selected.name.token &&
        entry.index === selected.index,
    );
    if (pending >= 0) this.pending.splice(pending, 1);
  }
  async close() {
    while (this.objects.length) await this.remove(this.objects[0]);
    this.pending.length = this.pendingHead = 0;
    this.groups.clear();
    this.entries.clear();
    this.byKey.clear();
    this.nameCache.clear();
    this.order.length = 0;
    this.orderDirty = false;
  }
  snapshot() {
    return {
      graph: this.graph.snapshot(),
      groups: [...this.groups.values()].map(({ name, count }) => ({
        nameBytes: name.bytes.slice(),
        name: name.text,
        count,
      })),
      objects: this.objects.map((object) => {
        const identity = this.identities.get(object);
        return {
          nameBytes: identity.name.bytes.slice(),
          name: object.baseName,
          index: object.index,
          type: object.type,
          nativeType: object.nativeType,
          handle: object.handle,
          parentHandle: object.parentHandle,
          state: this.serializeObject(object),
        };
      }),
      pending: this.pending
        .slice(this.pendingHead)
        .map(({ name, index }) => ({ nameBytes: name.bytes.slice(), name: name.text, index })),
    };
  }
  restore(snapshot) {
    if (this.objects.length || this.groups.size || this.pending.length)
      throw new Error('FES collection restoration requires a fresh collection');
    const groups = new Map(),
      entries = new Map(),
      identities = new WeakMap(),
      objects = [],
      byKey = new Map();
    for (const record of snapshot.groups) {
      const name = this.name(record.nameBytes),
        count = signed(record.count, 'saved group count');
      name.text = record.name;
      if (groups.has(name.token)) throw new Error('Duplicate FES saved group');
      groups.set(name.token, { name, count });
    }
    for (const record of snapshot.objects) {
      const name = this.name(record.nameBytes),
        index = record.index === null ? 0 : signed(record.index, 'saved object index'),
        type = nativeType(record.type),
        rawType = type === FES_OBJECT_TYPES.VIEW ? 0 : type;
      name.text = record.name;
      if (record.nativeType !== rawType)
        throw new Error('FES saved declaration and raw object type disagree');
      if (type === FES_OBJECT_TYPES.NUMIMG)
        throw new Error('FES NUMIMG cannot restore an allocated object');
      if (!groups.has(name.token)) throw new Error('FES saved object has no declared group');
      let group = entries.get(name.token);
      if (!group) entries.set(name.token, (group = new Map()));
      if (group.has(index)) throw new Error('Duplicate FES saved object key');
      const identity = {
          type: names.get(type),
          nativeType: rawType,
          baseName: name.text,
          index: record.index,
          key: record.index === null ? name.text : `${name.text}[${index}]`,
          handle: record.handle,
          parentHandle: record.parentHandle,
          deleted: false,
        },
        state = clone(record.state),
        object = this.restoreObject
          ? this.restoreObject(state, identity)
          : Object.assign(this.createObject(identity), state);
      if (!object || typeof object !== 'object' || typeof object.then === 'function')
        throw new TypeError('FES typed restoration must return a synchronous object');
      Object.assign(object, identity);
      group.set(index, object);
      identities.set(object, { name, nameBytes: name.bytes, index });
      objects.push(object);
      byKey.set(object.key, object);
    }
    const graph = new FESObjectGraph({ ...snapshot.graph, objects }),
      pending = snapshot.pending.map((record) => {
        const name = this.name(record.nameBytes),
          index = signed(record.index, 'saved pending index');
        name.text = record.name;
        return { name, index };
      });
    Object.assign(this, {
      groups,
      entries,
      identities,
      objects,
      byKey,
      graph,
      pending,
      pendingHead: 0,
      orderDirty: true,
    });
  }
}
