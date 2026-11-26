// SPDX-License-Identifier: MPL-2.0
// Layouts from the frozen CatSystem2 4.01 particle SDK and the native copy bridge.
import { NativeBufferMemory, NativeBufferAllocationError } from '../native/buffer-memory.mjs';

export const PTCL_REF_BUFFERS = Object.freeze(
  [
    ['quads', 112, Uint8Array],
    ['backupQuads', 112, Uint8Array],
    ['bases', 16, Float32Array],
    ['positions', 16, Float32Array],
    ['rotations', 16, Float32Array],
    ['scales', 16, Float32Array],
    ['visibility', 4, Int32Array],
    ['depthPairs', 8, Uint8Array],
    ['sortIndices', 4, Uint32Array],
  ].map(([name, stride, Type]) => Object.freeze({ name, stride, Type })),
);

export function particleRefBufferRequests(count, auxiliary = true) {
  if (!Number.isInteger(count) || count < 0 || count > 0xffffffff)
    throw new RangeError('Particle count is outside its DWORD ABI');
  return PTCL_REF_BUFFERS.slice(0, auxiliary ? 9 : 7).map(({ name, stride }) => {
    const payloadBytes = Math.imul(count, stride) >>> 0;
    return { name, payloadBytes, requestedBytes: (payloadBytes + 4) >>> 0 };
  });
}

const addKnownRange = (ranges, first, end) => {
  if (first === end) return ranges;
  const result = [];
  for (const [lo, hi] of ranges) {
    if (hi < first) result.push([lo, hi]);
    else if (end < lo) {
      result.push([first, end]);
      first = lo;
      end = hi;
    } else {
      first = Math.min(first, lo);
      end = Math.max(end, hi);
    }
  }
  result.push([first, end]);
  return result;
};

// These bytes and their known ranges have one owner. Missing allocations and
// allocated but unwritten bytes are different states; neither invents zeros.
export class ParticleRefBuffers {
  constructor(count, { memory = new NativeBufferMemory(), auxiliary = true, snapshot } = {}) {
    this.count = count;
    this.memory = memory;
    this.entries = new Map();
    this.known = new Map();
    const requests = particleRefBufferRequests(count, auxiliary);
    if (snapshot) this.validateSnapshot(snapshot, requests);
    try {
      for (const request of requests) {
        const layout = PTCL_REF_BUFFERS.find((field) => field.name === request.name),
          saved = snapshot?.fields[request.name];
        let pointer = 0;
        if (!snapshot || saved !== null) {
          // HeapAlloc(0) still supplies a header-sized physical block. Overflowed
          // payload requests retain their actual capacity until a consumer checks it.
          const storageBytes = Math.max(4, request.requestedBytes);
          if (snapshot) {
            const bytes = new Uint8Array(storageBytes);
            new DataView(bytes.buffer).setUint32(0, 1, true);
            bytes.set(new Uint8Array(saved.buffer, saved.byteOffset, saved.byteLength), 4);
            pointer = memory.reserve(storageBytes, bytes);
          } else {
            try {
              pointer = memory.allocate(storageBytes);
              if (!pointer)
                throw new Error('Particle RefBuffer allocator returned an invalid address');
            } catch (error) {
              if (!(error instanceof NativeBufferAllocationError)) throw error;
            }
            if (pointer) memory.store(pointer, 1);
          }
        }
        const bytes = pointer
            ? memory.view(pointer + 4, Math.max(0, request.requestedBytes - 4))
            : null,
          value = bytes
            ? new layout.Type(
                bytes.buffer,
                bytes.byteOffset,
                bytes.byteLength / layout.Type.BYTES_PER_ELEMENT,
              )
            : null;
        this.entries.set(request.name, { ...request, pointer, value });
        this.known.set(
          request.name,
          snapshot ? snapshot.known[request.name].map((r) => r.slice()) : [],
        );
      }
    } catch (error) {
      this.close();
      throw error;
    }
  }
  validateSnapshot(state, requests) {
    const names = requests
      .map((r) => r.name)
      .sort()
      .join(',');
    if (
      !state ||
      !state.fields ||
      !state.known ||
      Object.keys(state.fields).sort().join(',') !== names ||
      Object.keys(state.known).sort().join(',') !== names
    )
      throw new Error('Particle RefBuffer checkpoint requires its exact owners');
    for (const request of requests) {
      const Type = PTCL_REF_BUFFERS.find((field) => field.name === request.name).Type,
        value = state.fields[request.name],
        length = Math.max(0, request.requestedBytes - 4),
        ranges = state.known[request.name];
      if (value !== null && (!(value instanceof Type) || value.byteLength !== length))
        throw new Error(`Particle RefBuffer checkpoint ${request.name} length or type`);
      if (!Array.isArray(ranges) || (value === null && ranges.length))
        throw new Error(`Particle RefBuffer checkpoint ${request.name} known bytes`);
      let previous = -1;
      for (const range of ranges) {
        if (
          !Array.isArray(range) ||
          range.length !== 2 ||
          !range.every(Number.isSafeInteger) ||
          range[0] < 0 ||
          range[0] <= previous ||
          range[1] <= range[0] ||
          range[1] > length
        )
          throw new Error(`Particle RefBuffer checkpoint ${request.name} known range`);
        previous = range[1];
      }
    }
  }
  get(name) {
    if (this.closed) throw new Error('Particle RefBuffers are released');
    const entry = this.entries.get(name);
    if (!entry) throw new Error(`Particle RefBuffer was not requested: ${name}`);
    return entry.value;
  }
  get dataReady() {
    return PTCL_REF_BUFFERS.slice(0, 7).every(({ name, stride }) => {
      const entry = this.entries.get(name),
        size = this.count * stride;
      return (
        entry?.value !== null &&
        entry.value.byteLength >= size &&
        (!size || this.known.get(name).some(([lo, hi]) => lo === 0 && hi >= size))
      );
    });
  }
  span(name, offset, size, read = false) {
    const value = this.get(name);
    if (!Number.isSafeInteger(offset) || offset < 0 || !Number.isSafeInteger(size) || size < 0)
      throw new RangeError('Particle RefBuffer access requires an unsigned byte range');
    if (!size) return value;
    if (!value) throw new Error(`Particle RefBuffer ${name} allocation is missing`);
    if (offset + size > value.byteLength)
      throw new RangeError(`Particle RefBuffer ${name} capacity does not cover its consumer`);
    if (read && !this.known.get(name).some(([lo, hi]) => lo <= offset && hi >= offset + size))
      throw new Error(`Particle RefBuffer ${name} bytes are uninitialized`);
    return value;
  }
  mark(name, offset, size) {
    this.span(name, offset, size);
    this.known.set(name, addKnownRange(this.known.get(name), offset, offset + size));
  }
  copy(destination, source) {
    const size = this.entries.get(destination)?.payloadBytes;
    if (size === undefined || size !== this.entries.get(source)?.payloadBytes)
      throw new Error('Particle RefBuffer copy requires matching payloads');
    if (!size) return;
    const to = this.span(destination, 0, size),
      from = this.span(source, 0, size);
    new Uint8Array(to.buffer, to.byteOffset, to.byteLength).set(
      new Uint8Array(from.buffer, from.byteOffset, from.byteLength),
    );
    this.known.set(
      destination,
      this.known.get(source).map((range) => range.slice()),
    );
  }
  snapshot() {
    if (this.closed) throw new Error('Particle RefBuffers are released');
    return {
      fields: Object.fromEntries(
        [...this.entries].map(([name, { value }]) => [name, value?.slice() ?? null]),
      ),
      known: Object.fromEntries(
        [...this.known].map(([name, ranges]) => [name, ranges.map((range) => range.slice())]),
      ),
    };
  }
  close() {
    if (this.closed) return;
    this.closed = true;
    for (const entry of this.entries.values())
      if (entry.pointer) {
        if (!this.memory.free(entry.pointer)) throw new Error('Particle RefBuffer lost its owner');
        entry.pointer = 0;
        entry.value = null;
      }
  }
}

export const PPI_ABI = Object.freeze({
  pluginType: 1,
  sdkVersion: 0x00020001,
  nativeVersions: Object.freeze([0x00020000, 0x00020001, 0x00020002]),
  parameters: Object.freeze({
    size: 148,
    count: 0,
    screenWidth: 4,
    screenHeight: 8,
    width: 12,
    height: 16,
    values: 20,
    capacity: 32,
  }),
  vertex: Object.freeze({ size: 24, x: 0, y: 4, z: 8, color: 12, u: 16, v: 20 }),
  particle: Object.freeze({
    size: 148,
    vertices: 0,
    base: 96,
    pos: 108,
    rot: 120,
    scale: 132,
    disp: 144,
  }),
  object: Object.freeze({
    size: 52,
    vtable: 0,
    context: 4,
    functions: 8,
    particles: 12,
    blendMode: 16,
    attachPlane: 20,
    attachBase: 24,
    attachPos: 36,
    attachDisp: 48,
  }),
  hostSlots: Object.freeze({ 0x00020000: 31, 0x00020001: 32, 0x00020002: 35 }),
  exports: Object.freeze({
    MakeInstance: 1,
    ReleaseInstance: 2,
    GetPluginVersion: 3,
    GetPluginType: 4,
  }),
});

export const PTCL_ABI = Object.freeze({
  versions: Object.freeze([0x00010000, 0x00020000]),
  vertex: Object.freeze({ size: 28, x: 0, y: 4, z: 8, w: 12, color: 16, u: 20, v: 24 }),
  quadSize: 112,
  positionSize: 16,
  registerCount: 32,
});

export const PARTICLE_BLEND_MODES = Object.freeze({
  normal: 0,
  add1: 1,
  add2: 2,
  multiply: 3,
  invert: 4,
  double: 5,
});

// D3DRS_SRCBLEND / D3DRS_DESTBLEND values from native sub_671DF0.
export const PARTICLE_BLEND_FACTORS = Object.freeze([
  Object.freeze({
    source: 'src-alpha',
    destination: 'one-minus-src-alpha',
    d3dSource: 5,
    d3dDestination: 6,
  }),
  Object.freeze({ source: 'src-alpha', destination: 'one', d3dSource: 5, d3dDestination: 2 }),
  Object.freeze({
    source: 'one',
    destination: 'one-minus-src-alpha',
    d3dSource: 2,
    d3dDestination: 6,
  }),
  Object.freeze({ source: 'zero', destination: 'src-color', d3dSource: 1, d3dDestination: 3 }),
  Object.freeze({
    source: 'one-minus-dst-color',
    destination: 'zero',
    d3dSource: 10,
    d3dDestination: 1,
  }),
  Object.freeze({ source: 'dst-color', destination: 'one', d3dSource: 9, d3dDestination: 2 }),
]);

function view(buffer, offset, size) {
  const b =
    buffer instanceof DataView
      ? buffer
      : ArrayBuffer.isView(buffer)
        ? new DataView(buffer.buffer, buffer.byteOffset, buffer.byteLength)
        : new DataView(buffer);
  if (!Number.isSafeInteger(offset) || offset < 0 || offset + size > b.byteLength)
    throw new RangeError(`Particle ABI record exceeds buffer: ${offset}+${size}/${b.byteLength}`);
  return new DataView(b.buffer, b.byteOffset + offset, size);
}

function readVector(b, at) {
  return [b.getFloat32(at, true), b.getFloat32(at + 4, true), b.getFloat32(at + 8, true)];
}

function writeVector(b, at, value) {
  if (!value || value.length !== 3)
    throw new TypeError('Particle vector requires three components');
  for (let i = 0; i < 3; i++) b.setFloat32(at + 4 * i, value[i], true);
}

function readVertex(b, at, script) {
  const l = script ? PTCL_ABI.vertex : PPI_ABI.vertex;
  const v = {
    x: b.getFloat32(at, true),
    y: b.getFloat32(at + 4, true),
    z: b.getFloat32(at + 8, true),
    color: b.getUint32(at + l.color, true),
    u: b.getFloat32(at + l.u, true),
    v: b.getFloat32(at + l.v, true),
  };
  if (script) v.w = b.getFloat32(at + l.w, true);
  return v;
}

function writeVertex(b, at, v, script) {
  const l = script ? PTCL_ABI.vertex : PPI_ABI.vertex;
  for (const key of ['x', 'y', 'z', 'u', 'v']) b.setFloat32(at + l[key], v[key], true);
  b.setUint32(at + l.color, v.color, true);
  if (script) b.setFloat32(at + l.w, v.w, true);
}

export function readPPIParameters(buffer, offset = 0) {
  const b = view(buffer, offset, PPI_ABI.parameters.size);
  return {
    count: b.getUint32(0, true),
    screenWidth: b.getFloat32(4, true),
    screenHeight: b.getFloat32(8, true),
    width: b.getFloat32(12, true),
    height: b.getFloat32(16, true),
    values: Array.from({ length: 32 }, (_, i) => b.getFloat32(20 + 4 * i, true)),
  };
}

export function writePPIParameters(buffer, parameters, offset = 0) {
  const b = view(buffer, offset, PPI_ABI.parameters.size);
  const { count, screenWidth, screenHeight, width, height, values = [] } = parameters;
  if (!Number.isInteger(count) || count < 0 || count > 0xffffffff || values.length > 32)
    throw new RangeError('Invalid particle parameter count');
  b.setUint32(0, count, true);
  for (const [at, value] of [
    [4, screenWidth],
    [8, screenHeight],
    [12, width],
    [16, height],
  ])
    b.setFloat32(at, value, true);
  for (let i = 0; i < 32; i++) b.setFloat32(20 + 4 * i, values[i] ?? 0, true);
  return buffer;
}

export function readPPIRecord(buffer, offset = 0) {
  const b = view(buffer, offset, PPI_ABI.particle.size);
  return {
    vertices: Array.from({ length: 4 }, (_, i) => readVertex(b, i * 24, false)),
    base: readVector(b, 96),
    pos: readVector(b, 108),
    rot: readVector(b, 120),
    scale: readVector(b, 132),
    disp: b.getInt32(144, true),
  };
}

export function writePPIRecord(buffer, particle, offset = 0) {
  const b = view(buffer, offset, PPI_ABI.particle.size);
  if (particle.vertices.length !== 4) throw new RangeError('Particle requires four vertices');
  particle.vertices.forEach((v, i) => writeVertex(b, 24 * i, v, false));
  for (const [key, at] of [
    ['base', 96],
    ['pos', 108],
    ['rot', 120],
    ['scale', 132],
  ])
    writeVector(b, at, particle[key]);
  b.setInt32(144, particle.disp, true);
  return buffer;
}

export function readPTCLQuad(buffer, offset = 0) {
  const b = view(buffer, offset, PTCL_ABI.quadSize);
  return Array.from({ length: 4 }, (_, i) => readVertex(b, 28 * i, true));
}

export function writePTCLQuad(buffer, vertices, offset = 0) {
  const b = view(buffer, offset, PTCL_ABI.quadSize);
  if (vertices.length !== 4) throw new RangeError('Particle requires four vertices');
  vertices.forEach((v, i) => writeVertex(b, 28 * i, v, true));
  return buffer;
}

// Corner order is top-left, top-right, bottom-left, bottom-right.
export function initialParticle(width, height) {
  return {
    vertices: [
      [0, 0, 0, 0],
      [width, 0, 1, 0],
      [0, height, 0, 1],
      [width, height, 1, 1],
    ].map(([x, y, u, v]) => ({ x, y, z: 0, w: 1, color: 0xffffffff, u, v })),
    base: [0, 0, 0],
    pos: [0, 0, 0],
    rot: [0, 0, 0],
    scale: [1, 1, 1],
    disp: 1,
  };
}
