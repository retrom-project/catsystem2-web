// SPDX-License-Identifier: MIT
// Copyright (c) 2011 Effekseer Project. See ../../licenses/effekseer-MIT.txt.
// Official Effekseer 1.23 algorithm reference:
// 5239bb1e416cbf55b4d3c8170594cbdc7815f263 (source scope in ../../docs/effekseer.md).
// Normal CPU geometry only. No original binary bytes, simulation, RNG or GPU.
// TransformVertexes uses the original DX9 paired SSE operation tree; Fixed
// Sprite instead uses Vector3D::Transform's sequential additions.
import {
  getScale43,
  multiply43,
  normalizeVector,
  scaling43,
  transformVector43,
  vectorCross,
} from './math43.mjs';

const f = Math.fround;
const add = (a, b) => f(f(a) + f(b)),
  sub = (a, b) => f(f(a) - f(b));
const mul = (a, b) => f(f(a) * f(b)),
  div = (a, b) => f(f(a) / f(b));
export class EffekseerSpriteRingGeometryError extends Error {
  constructor(field, reason) {
    super('Effekseer sprite/ring ' + field + ': ' + reason);
    this.name = 'EffekseerSpriteRingGeometryError';
    this.field = field;
  }
}
function fail(field, reason) {
  throw new EffekseerSpriteRingGeometryError(field, reason);
}
function integer(value, field) {
  if (!Number.isInteger(value) || value < 0 || value > 2147483647)
    fail(field, 'requires nonnegative int32');
  return value;
}
function float(value, field) {
  if (typeof value !== 'number' || !Number.isFinite(f(value)))
    fail(field, 'requires finite float32');
  return f(value);
}
function sequence(value, length, field) {
  if (!value || typeof value.length !== 'number' || value.length < length)
    fail(field, 'missing elements');
  return value;
}
function floats(value, length, field) {
  sequence(value, length, field);
  for (let i = 0; i < length; i++) float(value[i], field);
  return value;
}
function color(value) {
  sequence(value, 4, 'color');
  for (let i = 0; i < 4; i++)
    if (!Number.isInteger(value[i]) || value[i] < 0 || value[i] > 255)
      fail('color', 'requires RGBA uint8');
  return value;
}

export class SpriteRingGeometry {
  constructor({ maxVertices = 1048576 } = {}) {
    this.maxVertices = integer(maxVertices, 'maxVertices');
    this.capacity = 0;
    this.bufferGrowths = 0;
    this.positions = new Float32Array(0);
    this.uv = new Float32Array(0);
    this.colors = new Uint8Array(0);
    this.indices = new Uint32Array(0);
    this.scale = new Float32Array(3);
    this.up = new Float32Array(3);
    this.forward = new Float32Array(3);
    this.right = new Float32Array(3);
    this.oldRight = new Float32Array(3);
    this.oldUp = new Float32Array(3);
    this.point = new Float32Array(3);
    this.basis = new Float32Array(12);
    this.scaleMatrix = new Float32Array(12);
    this.srtMatrix = new Float32Array(12);
    this.deferredStorage = new Float32Array(12);
    this.mesh = {
      kind: null,
      positions: this.positions,
      uv: this.uv,
      colors: this.colors,
      indices: this.indices,
      vertexCount: 0,
      indexCount: 0,
      quadCount: 0,
      cursorVertexCount: 0,
      completedQuadCount: 0,
      sourceInstanceCount: 0,
      submittedInstanceCount: 0,
      coordinateSpace: 'world',
      deferredMatrix43: null,
      flushBefore: false,
      flushAfter: false,
    };
    this.open = false;
  }
  _capacity(vertices) {
    if (vertices <= this.capacity) return;
    if (vertices > this.maxVertices)
      fail('capacity', 'source reservation exceeds typed CPU budget');
    let next = Math.max(4, this.capacity);
    while (next < vertices) next = Math.min(this.maxVertices, next * 2);
    this.capacity = next;
    this.positions = new Float32Array(next * 3);
    this.uv = new Float32Array(next * 2);
    this.colors = new Uint8Array(next * 4);
    this.indices = new Uint32Array(Math.floor(next / 4) * 6);
    for (let q = 0; q < Math.floor(next / 4); q++) {
      const v = q * 4,
        i = q * 6;
      this.indices[i] = v + 3;
      this.indices[i + 1] = v + 1;
      this.indices[i + 2] = v;
      this.indices[i + 3] = v + 3;
      this.indices[i + 4] = v;
      this.indices[i + 5] = v + 2;
    }
    this.mesh.positions = this.positions;
    this.mesh.uv = this.uv;
    this.mesh.colors = this.colors;
    this.mesh.indices = this.indices;
    this.bufferGrowths++;
  }
  beginNode(kind, count, nodeParams) {
    if (this.open) fail('beginNode', 'previous node is still open');
    if (kind !== 'sprite' && kind !== 'ring') fail('kind', 'unimplemented renderer ' + kind);
    if (nodeParams?.distortion !== undefined && nodeParams.distortion !== false)
      fail('distortion', 'ordinary normal geometry only; caller owns the proven wrapper discard');
    if (
      !Number.isInteger(nodeParams?.billboard) ||
      nodeParams.billboard < 0 ||
      nodeParams.billboard > 3
    )
      fail('billboard', 'unimplemented old billboard mode ' + nodeParams?.billboard);
    count = integer(count, 'sourceInstanceCount');
    let perInstance = 4,
      segments = 0;
    if (kind === 'ring') {
      segments = integer(nodeParams.vertexCount, 'ring.vertexCount');
      if (segments < 1)
        fail('ring.vertexCount', 'zero/negative source angular division is unsupported');
      perInstance = segments * 8;
    }
    const vertices = count * perInstance;
    if (perInstance > 2147483647 || vertices > 2147483647 || vertices > this.maxVertices)
      fail('capacity', 'source reservation overflows/budget exceeded');
    this._capacity(vertices);
    this.positions.fill(0, 0, vertices * 3);
    this.uv.fill(0, 0, vertices * 2);
    this.colors.fill(0, 0, vertices * 4);
    this.kind = kind;
    this.count = count;
    this.billboard = nodeParams.billboard;
    this.segments = segments;
    this.perInstance = perInstance;
    this.reserved = vertices;
    this.cursor = 0;
    this.submitted = 0;
    this.deferredReady = false;
    this.open = true;
    this.mesh.deferredMatrix43 = null;
    this.mesh.flushBefore = false;
    this.mesh.flushAfter = false;
    return this;
  }
  _vertex(index, x, y, z, c, u, v) {
    if (index < 0 || index >= this.reserved)
      fail('source-write-range', 'outside current node reservation');
    const p = index * 3,
      t = index * 2,
      b = index * 4;
    this.positions[p] = float(x, 'vertex.x');
    this.positions[p + 1] = float(y, 'vertex.y');
    this.positions[p + 2] = float(z, 'vertex.z');
    this.uv[t] = float(u, 'vertex.u');
    this.uv[t + 1] = float(v, 'vertex.v');
    for (let i = 0; i < 4; i++) this.colors[b + i] = c[i];
  }
  _copyVertex(to, from) {
    if (Math.max(to, from) >= this.reserved)
      fail('source-write-range', 'outside current node reservation');
    for (let i = 0; i < 3; i++) this.positions[to * 3 + i] = this.positions[from * 3 + i];
    for (let i = 0; i < 2; i++) this.uv[to * 2 + i] = this.uv[from * 2 + i];
    for (let i = 0; i < 4; i++) this.colors[to * 4 + i] = this.colors[from * 4 + i];
  }
  _transform(index, matrix, paired) {
    const p = index * 3,
      x = this.positions[p],
      y = this.positions[p + 1],
      z = this.positions[p + 2];
    if (paired) {
      for (let i = 0; i < 3; i++)
        this.point[i] = float(
          add(
            add(mul(x, matrix[i]), mul(y, matrix[3 + i])),
            add(mul(z, matrix[6 + i]), matrix[9 + i]),
          ),
          'paired-transform',
        );
    } else {
      this.point[0] = x;
      this.point[1] = y;
      this.point[2] = z;
      transformVector43(this.point, matrix, this.point);
    }
    for (let i = 0; i < 3; i++)
      this.positions[p + i] = float(this.point[i], 'transformed.position');
  }
  _basis(matrix, camera) {
    getScale43(matrix, this.scale);
    floats(camera, 16, 'camera44');
    this.forward[0] = -f(camera[2]);
    this.forward[1] = -f(camera[6]);
    this.forward[2] = -f(camera[10]);
    normalizeVector(this.forward, this.forward);
    if (this.billboard === 1) {
      if (this.scale[1] === 0)
        fail('billboard.zero-up-scale', 'used GetSRT up row divides by zero');
      for (let i = 0; i < 3; i++) this.up[i] = div(matrix[3 + i], this.scale[1]);
      vectorCross(this.up, this.forward, this.right);
      normalizeVector(this.right, this.right);
      vectorCross(this.right, this.up, this.forward);
      normalizeVector(this.forward, this.forward);
    } else {
      this.up[0] = 0;
      this.up[1] = 1;
      this.up[2] = 0;
      vectorCross(this.up, this.forward, this.right);
      normalizeVector(this.right, this.right);
      vectorCross(this.forward, this.right, this.up);
      normalizeVector(this.up, this.up);
      if (this.billboard === 3) {
        // Preserve the old fabs(c_zx)>0.05 branch, including an unused NaN
        // c_zx taking its explicit source else branch. Nonfinite final basis
        // is an error; no modern clamp/atan2 or invented rotation is added.
        const r21 = div(matrix[7], this.scale[2]);
        const czx = f(Math.sqrt(sub(1, mul(r21, r21))));
        let sz = 0,
          cz = 1;
        if (Math.abs(czx) > f(0.05)) {
          sz = div(-div(matrix[1], this.scale[0]), czx);
          cz = f(Math.sqrt(sub(1, mul(sz, sz))));
          if (div(matrix[4], this.scale[1]) < 0) cz = -cz;
        }
        this.oldRight.set(this.right);
        this.oldUp.set(this.up);
        for (let i = 0; i < 3; i++) {
          this.right[i] = float(
            add(mul(this.oldRight[i], cz), mul(this.oldUp[i], sz)),
            'rotated-billboard.basis',
          );
          this.up[i] = float(
            sub(mul(this.oldUp[i], cz), mul(this.oldRight[i], sz)),
            'rotated-billboard.basis',
          );
        }
      }
    }
    for (let i = 0; i < 3; i++) {
      this.basis[i] = float(-this.right[i], 'billboard.basis');
      this.basis[3 + i] = float(this.up[i], 'billboard.basis');
      this.basis[6 + i] = float(this.forward[i], 'billboard.basis');
      this.basis[9 + i] = f(matrix[9 + i]);
    }
    return this.basis;
  }
  append(matrix, renderOutput, camera = null) {
    if (!this.open) fail('append', 'BeginRendering is required');
    if (this.submitted >= this.count) fail('source-count', 'too many instance submissions');
    if (renderOutput?.kind !== this.kind) fail('kind', 'renderer output type mismatch');
    floats(matrix, 12, 'matrix43');
    floats(renderOutput.uv, 4, 'uv');
    if (this.kind === 'sprite') this._sprite(matrix, renderOutput, camera);
    else this._ring(matrix, renderOutput, camera);
    this.submitted++;
    return this;
  }
  _sprite(matrix, parameter, camera) {
    floats(parameter.positions, 8, 'sprite.positions');
    sequence(parameter.colors, 4, 'sprite.colors');
    for (let i = 0; i < 4; i++) color(parameter.colors[i]);
    const p = this.cursor,
      u = parameter.uv;
    this._vertex(
      p,
      parameter.positions[0],
      parameter.positions[1],
      0,
      parameter.colors[0],
      u[0],
      add(u[1], u[3]),
    );
    this._vertex(
      p + 1,
      parameter.positions[2],
      parameter.positions[3],
      0,
      parameter.colors[1],
      add(u[0], u[2]),
      add(u[1], u[3]),
    );
    this._vertex(
      p + 2,
      parameter.positions[4],
      parameter.positions[5],
      0,
      parameter.colors[2],
      u[0],
      u[1],
    );
    this._vertex(
      p + 3,
      parameter.positions[6],
      parameter.positions[7],
      0,
      parameter.colors[3],
      add(u[0], u[2]),
      u[1],
    );
    if (this.billboard === 2) for (let i = 0; i < 4; i++) this._transform(p + i, matrix, false);
    else {
      this._basis(matrix, camera);
      for (let i = 0; i < 4; i++) {
        this.positions[(p + i) * 3] = mul(this.positions[(p + i) * 3], this.scale[0]);
        this.positions[(p + i) * 3 + 1] = mul(this.positions[(p + i) * 3 + 1], this.scale[1]);
        this._transform(p + i, this.basis, true);
      }
    }
    this.cursor += 4;
  }
  _ring(matrix, parameter, camera) {
    const segments = this.segments,
      base = this.cursor,
      u = parameter.uv;
    const angle = float(parameter.viewingAngle, 'ring.viewingAngle');
    floats(parameter.outerLocation, 2, 'ring.outerLocation');
    floats(parameter.innerLocation, 2, 'ring.innerLocation');
    sequence(parameter.colors, 3, 'ring.colors');
    for (let i = 0; i < 3; i++) color(parameter.colors[i]);
    const ratio = float(parameter.centerRatio, 'ring.centerRatio');
    const radian = mul(div(angle, 180), f(3.141592)),
      step = div(radian, segments),
      begin = div(-radian, 2);
    const outerR = f(parameter.outerLocation[0]),
      innerR = f(parameter.innerLocation[0]);
    const centerR = add(innerR, mul(sub(outerR, innerR), ratio));
    const outerH = f(parameter.outerLocation[1]),
      innerH = f(parameter.innerLocation[1]);
    const centerH = add(innerH, mul(sub(outerH, innerH), ratio));
    // This seam uses the host's double sin/cos rounded to float32. The four
    // source calls and their order are explicit. Native CRT transcendental
    // rounding remains uncalibrated; no custom polynomial substitutes for it.
    const stepC = float(Math.cos(step), 'ring.cosStep'),
      stepS = float(Math.sin(step), 'ring.sinStep');
    let c = float(Math.cos(begin), 'ring.cosBegin'),
      s = float(Math.sin(begin), 'ring.sinBegin');
    let ox = mul(c, outerR),
      oy = mul(s, outerR),
      ix = mul(c, innerR),
      iy = mul(s, innerR);
    let cx = mul(c, centerR),
      cy = mul(s, centerR),
      tex = f(u[0]);
    const texStep = div(u[2], segments),
      v1 = f(u[1]),
      v2 = add(v1, mul(u[3], 0.5)),
      v3 = add(v1, u[3]);
    for (let segment = 0; segment < segments; segment++) {
      const nextC = sub(mul(c, stepC), mul(s, stepS));
      s = add(mul(s, stepC), mul(c, stepS));
      c = nextC;
      const nox = mul(c, outerR),
        noy = mul(s, outerR),
        nix = mul(c, innerR),
        niy = mul(s, innerR);
      const ncx = mul(c, centerR),
        ncy = mul(s, centerR),
        nextTex = add(tex, texStep),
        p = base + segment * 8;
      this._vertex(p, ox, oy, outerH, parameter.colors[0], tex, v1);
      this._vertex(p + 1, cx, cy, centerH, parameter.colors[1], tex, v2);
      this._vertex(p + 2, nox, noy, outerH, parameter.colors[0], nextTex, v1);
      this._vertex(p + 3, ncx, ncy, centerH, parameter.colors[1], nextTex, v2);
      this._copyVertex(p + 4, p + 1);
      this._vertex(p + 5, ix, iy, innerH, parameter.colors[2], tex, v3);
      this._copyVertex(p + 6, p + 3);
      this._vertex(p + 7, nix, niy, innerH, parameter.colors[2], nextTex, v3);
      ox = nox;
      oy = noy;
      ix = nix;
      iy = niy;
      cx = ncx;
      cy = ncy;
      tex = nextTex;
    }
    let transform = matrix;
    if (this.billboard !== 2) {
      this._basis(matrix, camera);
      scaling43(this.scale[0], this.scale[1], this.scale[2], this.scaleMatrix);
      multiply43(this.scaleMatrix, this.basis, this.srtMatrix);
      transform = this.srtMatrix;
    }
    if (this.count > 1)
      for (let i = 0; i < this.perInstance; i++) this._transform(base + i, transform, true);
    else {
      for (let i = 0; i < 12; i++)
        this.deferredStorage[i] = float(transform[i], 'ring.deferredMatrix43');
      this.deferredReady = true;
    }
    this.cursor += this.perInstance;
  }
  endNode() {
    if (!this.open) fail('endNode', 'no active node');
    const deferred = this.kind === 'ring' && this.count === 1;
    if (deferred && !this.deferredReady)
      fail(
        'ring.deferred-matrix-unset',
        'single-instance node never supplied its current transform; original stale matrix path is unverified',
      );
    const out = this.mesh;
    out.kind = this.kind;
    out.vertexCount = this.reserved;
    out.indexCount = (this.reserved / 4) * 6;
    out.quadCount = this.reserved / 4;
    out.cursorVertexCount = this.cursor;
    out.completedQuadCount = (this.submitted * this.perInstance) / 4;
    out.sourceInstanceCount = this.count;
    out.submittedInstanceCount = this.submitted;
    out.coordinateSpace = deferred ? 'local' : 'world';
    out.deferredMatrix43 = deferred ? this.deferredStorage : null;
    out.flushBefore = deferred;
    out.flushAfter = deferred;
    this.open = false;
    return out;
  }
}
