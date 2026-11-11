// SPDX-License-Identifier: MPL-2.0
import { initialParticle, writePPIRecord } from './abi.mjs';

class RecordVector {
  constructor(view, at) {
    this.view = view;
    this.at = at;
  }
  get length() {
    return 3;
  }
  set(values) {
    for (let i = 0; i < 3; i++) this[i] = values[i];
  }
  fill(value) {
    for (let i = 0; i < 3; i++) this[i] = value;
    return this;
  }
  *[Symbol.iterator]() {
    for (let i = 0; i < 3; i++) yield this[i];
  }
}
for (let i = 0; i < 3; i++)
  for (const key of [String(i), ['x', 'y', 'z'][i]])
    Object.defineProperty(RecordVector.prototype, key, {
      get() {
        return this.view.getFloat32(this.at + i * 4, true);
      },
      set(value) {
        this.view.setFloat32(this.at + i * 4, value, true);
      },
    });
class RecordVertex {
  constructor(view, at) {
    this.view = view;
    this.at = at;
  }
}
for (const [key, offset] of Object.entries({ x: 0, y: 4, z: 8, color: 12, u: 16, v: 20 }))
  Object.defineProperty(RecordVertex.prototype, key, {
    get() {
      return this.view[key === 'color' ? 'getUint32' : 'getFloat32'](this.at + offset, true);
    },
    set(value) {
      this.view[key === 'color' ? 'setUint32' : 'setFloat32'](this.at + offset, value, true);
    },
  });
class ParticleRecord {
  constructor(view, at) {
    this.view = view;
    this.at = at;
    this.vertices = Array.from({ length: 4 }, (_, i) => new RecordVertex(view, at + i * 24));
    for (const [name, offset] of Object.entries({ base: 96, pos: 108, rot: 120, scale: 132 }))
      this[name] = new RecordVector(view, at + offset);
  }
  get disp() {
    return this.view.getInt32(this.at + 144, true);
  }
  set disp(value) {
    this.view.setInt32(this.at + 144, value, true);
  }
}
export class PPIParticleRecords {
  constructor(count, width, height) {
    if (!Number.isSafeInteger(count) || count < 0 || count > 1000000)
      throw new RangeError('Invalid PPI particle count');
    this.bytes = new Uint8Array(count * 148);
    const view = new DataView(this.bytes.buffer),
      initial = initialParticle(width, height);
    this.particles = Array.from({ length: count }, (_, i) => {
      writePPIRecord(this.bytes, initial, i * 148);
      return new ParticleRecord(view, i * 148);
    });
  }
}
