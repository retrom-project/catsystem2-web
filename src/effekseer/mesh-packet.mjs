// SPDX-License-Identifier: MIT
// Copyright (c) 2011 Effekseer Project.
// Matrix44 product follows fixed Effekseer 1.23. See ../../licenses/effekseer-MIT.txt.
// Typed upload adaptation is independent of World, device and original code.
const f = Math.fround;
const QUAD_ORDER = Object.freeze([3, 1, 0, 3, 0, 2]);
const fail = (field, reason) => {
  throw new Error(`Effekseer typed mesh ${field}: ${reason}`);
};
const count = (value, max, field) => {
  if (!Number.isSafeInteger(value) || value < 0 || value > max)
    fail(field, 'outside the verified upload range');
  return value;
};
function floats(values, length, field) {
  if (!values || values.length < length) fail(field, 'missing elements');
  for (let i = 0; i < length; i++)
    if (typeof values[i] !== 'number' || !Number.isFinite(f(values[i])))
      fail(field, 'nonfinite float32');
}

// The fixed source accumulates from +0 in k order. This preserves its float32
// stages instead of moving the Ring single-instance model product into GLSL.
export function multiply44(left, right, out) {
  floats(left, 16, 'matrix.left');
  floats(right, 16, 'matrix.right');
  if (!(out instanceof Float32Array) || out.length !== 16)
    fail('matrix.out', 'requires16 float32 slots');
  for (const input of [left, right])
    if (
      out === input ||
      (ArrayBuffer.isView(input) &&
        out.buffer === input.buffer &&
        out.byteOffset < input.byteOffset + input.byteLength &&
        input.byteOffset < out.byteOffset + out.byteLength)
    )
      fail('matrix.alias', 'use independent output for the deferred camera product');
  for (let row = 0; row < 4; row++)
    for (let col = 0; col < 4; col++) {
      let value = 0;
      for (let k = 0; k < 4; k++)
        value = f(value + f(f(left[row * 4 + k]) * f(right[k * 4 + col])));
      if (!Number.isFinite(value)) fail('matrix.result', 'nonfinite product');
      out[row * 4 + col] = value;
    }
  return out;
}

export class EffekseerPackedMesh {
  constructor({ maxVertices = 8000 } = {}) {
    count(maxVertices, 65536, 'capacity');
    if (!maxVertices || maxVertices % 4) fail('capacity', 'requires whole quads');
    this.maxVertices = maxVertices;
    this.capacity = 0;
    this.vertices = new Float32Array(0);
    this.indices = new Uint16Array(0);
    this.cameraInput = new Float32Array(16);
    this.camera = new Float32Array(16);
    this.projection = new Float32Array(16);
    this.model = new Float32Array(16);
    this.viewport = new Float32Array(6);
    this.packet = {
      effekseer: true,
      vertices: this.vertices,
      indices: this.indices,
      vertexCount: 0,
      indexCount: 0,
      camera: this.camera,
      projection: this.projection,
      viewport: this.viewport,
      flushBefore: false,
      flushAfter: false,
    };
    this.bufferGrowths = 0;
  }
  ensure(vertices) {
    if (vertices <= this.capacity) return;
    let next = Math.max(4, this.capacity);
    while (next < vertices) next = Math.min(this.maxVertices, next * 2);
    this.capacity = next;
    this.vertices = new Float32Array(next * 10);
    this.indices = new Uint16Array((next / 4) * 6);
    this.packet.vertices = this.vertices;
    this.packet.indices = this.indices;
    this.bufferGrowths++;
  }
  prepare(mesh, { camera, projection, viewport } = {}) {
    if (!['sprite', 'ribbon', 'ring', 'track'].includes(mesh?.kind))
      fail('kind', 'requires one implemented old normal renderer');
    const vertices = count(mesh?.vertexCount, this.maxVertices, 'vertexCount');
    if (vertices % 4) fail('vertexCount', 'source reservation is not whole quads');
    const indexCount = count(mesh?.indexCount, (this.maxVertices / 4) * 6, 'indexCount');
    if (indexCount !== (vertices / 4) * 6)
      fail('indexCount', 'requires the original whole reserved quad range');
    floats(mesh.positions, vertices * 3, 'positions');
    floats(mesh.uv, vertices * 2, 'UV');
    if (
      !mesh.colors ||
      mesh.colors.length < vertices * 4 ||
      !mesh.indices ||
      mesh.indices.length < indexCount
    )
      fail('storage', 'missing source storage');
    for (let i = 0; i < vertices * 4; i++)
      if (!Number.isInteger(mesh.colors[i]) || mesh.colors[i] < 0 || mesh.colors[i] > 255)
        fail('colors', 'requires RGBA uint8');
    for (let i = 0; i < indexCount; i++)
      if (mesh.indices[i] !== Math.floor(i / 6) * 4 + QUAD_ORDER[i % 6])
        fail('indices', 'original quad diagonal/order changed');
    floats(camera, 16, 'camera');
    floats(projection, 16, 'projection');
    floats(viewport, 6, 'viewport');
    if (viewport[2] <= 0 || viewport[3] <= 0) fail('viewport', 'requires positive width/height');
    if (
      viewport[4] < 0 ||
      viewport[4] > 1 ||
      viewport[5] < 0 ||
      viewport[5] > 1 ||
      viewport[4] > viewport[5]
    )
      fail('viewport.depth', 'invalid inherited depth range');
    const deferred = mesh.deferredMatrix43 ?? null;
    if (deferred !== null) {
      floats(deferred, 12, 'deferredMatrix43');
      if (
        mesh.kind !== 'ring' ||
        mesh.coordinateSpace !== 'local' ||
        !mesh.flushBefore ||
        !mesh.flushAfter
      )
        fail('deferredMatrix43', 'requires the Ring single-instance source flush boundary');
    } else if (mesh.coordinateSpace && mesh.coordinateSpace !== 'world')
      fail('coordinateSpace', 'missing deferred local matrix');
    this.ensure(vertices);
    // Inputs must not alias the reusable interleaved upload buffer. There is no
    // source geometry rewrite or in-place compacting of the reserved zero tail.
    for (const values of [mesh.positions, mesh.uv, mesh.colors])
      if (ArrayBuffer.isView(values) && values.buffer === this.vertices.buffer)
        fail('alias', 'source geometry aliases packed output');
    this.cameraInput.set(camera);
    this.projection.set(projection);
    this.viewport.set(viewport);
    if (deferred) {
      this.model.fill(0);
      this.model[15] = 1;
      for (let row = 0; row < 4; row++)
        for (let col = 0; col < 3; col++) this.model[row * 4 + col] = deferred[row * 3 + col];
      multiply44(this.model, this.cameraInput, this.camera);
    } else this.camera.set(this.cameraInput);
    for (let i = 0; i < vertices; i++) {
      const dst = i * 10;
      this.vertices[dst] = mesh.positions[i * 3];
      this.vertices[dst + 1] = mesh.positions[i * 3 + 1];
      this.vertices[dst + 2] = mesh.positions[i * 3 + 2];
      this.vertices[dst + 3] = 1;
      for (let c = 0; c < 4; c++)
        this.vertices[dst + 4 + c] = f(mesh.colors[i * 4 + c] * f(1 / 255));
      this.vertices[dst + 8] = mesh.uv[i * 2];
      this.vertices[dst + 9] = mesh.uv[i * 2 + 1];
    }
    for (let i = 0; i < indexCount; i++) this.indices[i] = mesh.indices[i];
    this.packet.vertexCount = vertices;
    this.packet.indexCount = indexCount;
    this.packet.flushBefore = !!mesh.flushBefore;
    this.packet.flushAfter = !!mesh.flushAfter;
    return this.packet;
  }
}
