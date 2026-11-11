// SPDX-License-Identifier: MPL-2.0
// Browser FES object identities and lifetime links. Native malloc addresses are
// not identities; child order is the approved ascending semantic-handle order.
export const FES_FIRST_OBJECT_HANDLE = 0x1001;
export const FES_LAST_OBJECT_HANDLE = 0xfffffffe;
const exhausted = 0xffffffff;
function validHandle(value) {
  return (
    Number.isInteger(value) && value >= FES_FIRST_OBJECT_HANDLE && value <= FES_LAST_OBJECT_HANDLE
  );
}
function insert(list, object) {
  let low = 0,
    high = list.length;
  while (low < high) {
    const middle = (low + high) >>> 1;
    if (list[middle].handle < object.handle) low = middle + 1;
    else high = middle;
  }
  list.splice(low, 0, object);
}
function remove(list, object) {
  const index = list.indexOf(object);
  if (index < 0) throw new Error(`FES lifetime link is missing for ${object.key}`);
  list.splice(index, 1);
}
export class FESObjectGraph {
  constructor({ objects = [], nextHandle = FES_FIRST_OBJECT_HANDLE } = {}) {
    if (
      !Number.isInteger(nextHandle) ||
      nextHandle < FES_FIRST_OBJECT_HANDLE ||
      nextHandle > exhausted
    )
      throw new RangeError('FES next object handle is outside its uint32 allocation range');
    this.nextHandle = nextHandle;
    this.records = new Map();
    this.pendingHandles = new Set();
    this.parents = new Map();
    this.childLists = new Map([[null, []]]);
    this.cache = new WeakMap();
    this.revision = 0;
    this.seen = new Set();
    const parents = objects.map((object) => object.parentHandle ?? null);
    for (const object of objects) this.#adopt(object);
    for (let index = 0; index < objects.length; index++) {
      const object = objects[index],
        handle = parents[index];
      if (handle === null) continue;
      const parent = this.get(handle);
      if (!parent) throw new Error(`FES parent handle ${handle} is missing for ${object.key}`);
      this.bind(object, parent);
    }
  }
  allocateHandle() {
    if (this.nextHandle === exhausted) throw new RangeError('FES object handle space is exhausted');
    const handle = this.nextHandle++;
    this.pendingHandles.add(handle);
    return handle;
  }
  register(object) {
    if (!this.pendingHandles.delete(object.handle))
      throw new Error(`FES object handle ${object.handle} was not allocated for registration`);
    return this.#adopt(object);
  }
  #adopt(object) {
    const { handle } = object;
    if (
      !validHandle(handle) ||
      handle >= this.nextHandle ||
      this.records.has(handle) ||
      object.deleted
    )
      throw new Error(`Invalid or duplicate FES object handle ${handle}`);
    this.records.set(handle, object);
    this.parents.set(handle, null);
    this.childLists.set(handle, []);
    insert(this.childLists.get(null), object);
    object.parentHandle = null;
    object.parent = null;
    this.revision++;
    return object;
  }
  get(handle) {
    const object = this.records.get(handle);
    return object?.deleted ? null : (object ?? null);
  }
  require(object) {
    if (!object || this.get(object.handle) !== object)
      throw new Error('FES lifetime operation requires a live object in its collection');
  }
  bind(object, parent) {
    this.require(object);
    if (parent !== null) this.require(parent);
    this.seen.clear();
    for (let current = parent; current; current = this.get(this.parents.get(current.handle))) {
      if (current === object || this.seen.has(current))
        throw new Error(`FES object parent cycle at ${object.key}`);
      this.seen.add(current);
    }
    const next = parent?.handle ?? null,
      previous = this.parents.get(object.handle);
    if (previous === next) return;
    remove(this.childLists.get(previous), object);
    insert(this.childLists.get(next), object);
    this.parents.set(object.handle, next);
    object.parentHandle = next;
    object.parent = parent?.key ?? null;
    this.revision++;
  }
  // Borrowed arrays: callers do not mutate them. Reparent/create/delete are the
  // only ordering changes, so frame queries reuse the same traversal buffer.
  children(object = null) {
    if (object !== null) this.require(object);
    return this.childLists.get(object?.handle ?? null);
  }
  postorder(object) {
    this.require(object);
    let entry = this.cache.get(object);
    if (!entry) {
      entry = { revision: -1, pending: [], order: [] };
      this.cache.set(object, entry);
    }
    if (entry.revision === this.revision) return entry.order;
    const { pending, order } = entry;
    pending.length = order.length = 0;
    pending.push(object);
    while (pending.length) {
      const current = pending.pop();
      order.push(current);
      for (const child of this.childLists.get(current.handle)) pending.push(child);
    }
    order.reverse();
    entry.revision = this.revision;
    return order;
  }
  release(object) {
    this.require(object);
    if (this.children(object).length)
      throw new Error(`FES object ${object.key} still owns lifetime children`);
    remove(this.childLists.get(this.parents.get(object.handle)), object);
    this.parents.delete(object.handle);
    this.childLists.delete(object.handle);
    this.records.delete(object.handle);
    object.parentHandle = null;
    object.parent = null;
    object.deleted = true;
    this.revision++;
  }
  snapshot() {
    return { nextHandle: this.nextHandle };
  }
}
