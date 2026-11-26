// SPDX-License-Identifier: MPL-2.0
import { encodeSparseBytes, decodeSparseBytes } from '../native/sparse-bytes.mjs';

const surfaceStorage = new WeakMap(),
  surfaceReaders = new WeakMap(),
  borrowedSurfaces = new WeakSet(),
  borrowedSurfaceIDs = new WeakMap(),
  surfaceMapGet = Map.prototype.get,
  surfaceMapForEach = Map.prototype.forEach,
  surfaceMapHas = Map.prototype.has;
const mapPorts = Reflect.ownKeys(Map.prototype).map((key) => [
  key,
  Object.getOwnPropertyDescriptor(Map.prototype, key),
]);
function settleSurfaceReaders(surfaces, id) {
  const readers = surfaceReaders.get(surfaces);
  if (!readers) return;
  if (id !== undefined) Reflect.apply(surfaceMapGet, readers, [id])?.settle();
  else Reflect.apply(surfaceMapForEach, readers, [(reader) => reader.settle()]);
}
function borrowSurfaceStorage(surfaces) {
  try {
    settleSurfaceReaders(surfaces);
  } finally {
    if (!borrowedSurfaces.has(surfaces)) {
      borrowedSurfaces.add(surfaces);
      const readers = surfaceReaders.get(surfaces);
      if (readers) Reflect.apply(surfaceMapForEach, readers, [(reader) => reader.borrow()]);
    }
  }
}
function ordinarySurfaceStorage(surfaces) {
  if (!surfaceStorage.has(surfaces) || Object.getPrototypeOf(surfaces) !== StageSurfaces.prototype)
    return false;
  if (
    !surfacePorts.every(([key, descriptor]) => {
      const current = Object.getOwnPropertyDescriptor(StageSurfaces.prototype, key);
      return (
        !Object.hasOwn(surfaces, key) &&
        current?.value === descriptor.value &&
        current?.get === descriptor.get &&
        current?.set === descriptor.set
      );
    })
  )
    return false;
  const records = surfaceStorage.get(surfaces);
  try {
    Reflect.apply(surfaceMapHas, records, [undefined]);
  } catch {
    return false;
  }
  return (
    Object.getPrototypeOf(records) === Map.prototype &&
    mapPorts.every(([key, descriptor]) => {
      const current = Object.getOwnPropertyDescriptor(Map.prototype, key);
      return (
        !Object.hasOwn(records, key) &&
        current?.value === descriptor.value &&
        current?.get === descriptor.get &&
        current?.set === descriptor.set
      );
    })
  );
}
// Internal short reads retain the original storage; public records/get return
// the same objects after fencing and permanently lending this surface owner.
export function borrowNativeSurfaceStorage(surfaces) {
  borrowSurfaceStorage(surfaces);
}
export function nativeStageSurfaceRecords(surfaces) {
  settleSurfaceReaders(surfaces);
  if (ordinarySurfaceStorage(surfaces)) return surfaceStorage.get(surfaces);
  borrowSurfaceStorage(surfaces);
  return surfaces.records;
}
export function nativeStageSurface(surfaces, id) {
  settleSurfaceReaders(surfaces, id);
  if (!ordinarySurfaceStorage(surfaces)) {
    borrowSurfaceStorage(surfaces);
    return surfaces.get(id);
  }
  const record = Reflect.apply(surfaceMapGet, surfaceStorage.get(surfaces), [id]);
  if (!record) throw new Error(`Unknown or released stage surface ${id}`);
  return record;
}
export function registerNativeSurfaceRead(surfaces, id, settle, borrow) {
  if (!ordinarySurfaceStorage(surfaces)) {
    settle();
    borrow();
    return;
  }
  surfaceReaders.get(surfaces).set(id, { settle, borrow });
  if (borrowedSurfaces.has(surfaces) || borrowedSurfaceIDs.get(surfaces)?.has(id)) {
    settle();
    borrow();
  }
}

// Packed surface bytes belong to the renderer. A DLL lock is a temporary
// writable projection, committed before any JS draw or snapshot can read it.
export class StageSurfaces {
  constructor() {
    this.next = 1;
    surfaceStorage.set(this, new Map());
    surfaceReaders.set(this, new Map());
    borrowedSurfaceIDs.set(this, new Set());
  }
  get records() {
    borrowSurfaceStorage(this);
    return surfaceStorage.get(this);
  }
  set records(value) {
    borrowSurfaceStorage(this);
    surfaceStorage.set(this, value);
  }
  create(options) {
    settleSurfaceReaders(this);
    const { width, height, pitch, format } = options;
    if (
      !Number.isSafeInteger(width) ||
      !Number.isSafeInteger(height) ||
      !Number.isSafeInteger(pitch) ||
      width < 1 ||
      height < 1 ||
      pitch < width ||
      pitch * height > 256 * 1024 * 1024
    )
      throw new RangeError('Invalid stage surface dimensions');
    const id = this.next++;
    nativeStageSurfaceRecords(this).set(id, {
      width,
      height,
      pitch,
      format,
      bytes: new Uint8Array(pitch * height),
    });
    return id;
  }
  get(id) {
    settleSurfaceReaders(this, id);
    const ids = borrowedSurfaceIDs.get(this);
    if (!ids?.has(id)) {
      ids?.add(id);
      Reflect.apply(surfaceMapGet, surfaceReaders.get(this), [id])?.borrow();
    }
    const records = ordinarySurfaceStorage(this) ? surfaceStorage.get(this) : this.records;
    const record = records.get(id);
    if (!record) throw new Error(`Unknown or released stage surface ${id}`);
    return record;
  }
  clear() {
    settleSurfaceReaders(this);
    nativeStageSurfaceRecords(this).clear();
    surfaceReaders.get(this).clear();
  }
  release(id) {
    nativeStageSurface(this, id);
    nativeStageSurfaceRecords(this).delete(id);
    surfaceReaders.get(this)?.delete(id);
  }
  snapshot(ids = nativeStageSurfaceRecords(this).keys()) {
    settleSurfaceReaders(this);
    return [...ids].map((id) => {
      const { bytes, ...record } = nativeStageSurface(this, id);
      const depthStencil = record.depthStencil;
      return [
        id,
        {
          ...record,
          bytes: encodeSparseBytes(bytes),
          ...(depthStencil
            ? { depthStencil: { ...depthStencil, bytes: encodeSparseBytes(depthStencil.bytes) } }
            : {}),
        },
      ];
    });
  }
  restore(records) {
    settleSurfaceReaders(this);
    for (const [id, record] of records) {
      const bytes = decodeSparseBytes(record.bytes);
      if (!Number.isSafeInteger(id) || id < 1 || bytes.length !== record.pitch * record.height)
        throw new Error('Invalid stage surface checkpoint');
      const depthStencil = record.depthStencil;
      nativeStageSurfaceRecords(this).set(id, {
        ...structuredClone(record),
        bytes,
        ...(depthStencil
          ? { depthStencil: { ...depthStencil, bytes: decodeSparseBytes(depthStencil.bytes) } }
          : {}),
      });
      this.next = Math.max(this.next, id + 1);
    }
  }
}

const surfacePorts = Reflect.ownKeys(StageSurfaces.prototype)
  .filter((key) => key !== 'constructor')
  .map((key) => [key, Object.getOwnPropertyDescriptor(StageSurfaces.prototype, key)]);
