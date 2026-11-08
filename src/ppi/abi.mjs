// SPDX-License-Identifier: MPL-2.0
// Layouts from the frozen CatSystem2 4.01 particle SDK and the native copy bridge.
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
