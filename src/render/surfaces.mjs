// SPDX-License-Identifier: MPL-2.0
import { encodeSparseBytes, decodeSparseBytes } from '../native/sparse-bytes.mjs';

// Packed surface bytes belong to the renderer. A DLL lock is a temporary
// writable projection, committed before any JS draw or snapshot can read it.
export class StageSurfaces {
  constructor() {
    this.next = 1;
    this.records = new Map();
  }
  create({ width, height, pitch, format }) {
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
    this.records.set(id, { width, height, pitch, format, bytes: new Uint8Array(pitch * height) });
    return id;
  }
  get(id) {
    const record = this.records.get(id);
    if (!record) throw new Error(`Unknown or released stage surface ${id}`);
    return record;
  }
  release(id) {
    this.get(id);
    this.records.delete(id);
  }
  snapshot(ids = this.records.keys()) {
    return [...ids].map((id) => {
      const { bytes, ...record } = this.get(id);
      return [id, { ...record, bytes: encodeSparseBytes(bytes) }];
    });
  }
  restore(records) {
    for (const [id, record] of records) {
      const bytes = decodeSparseBytes(record.bytes);
      if (!Number.isSafeInteger(id) || id < 1 || bytes.length !== record.pitch * record.height)
        throw new Error('Invalid stage surface checkpoint');
      this.records.set(id, { ...structuredClone(record), bytes });
      this.next = Math.max(this.next, id + 1);
    }
  }
}
