// SPDX-License-Identifier: MIT
// Copyright (c) 2011 Effekseer Project. See ../../licenses/effekseer-MIT.txt.
// Geometry port of official Effekseer 1.23, commit
// 5239bb1e416cbf55b4d3c8170594cbdc7815f263:
// RibbonRendererBase.h SHA256 31c584d3fa287544173c29cc7d67d7f6af3dd1f7124023a940b02cc94eba7790
// TrackRendererBase.h  SHA256 0cc1f1e82303016d74fb1856c07b8fa98c960203afbd382ff4e64d487c61d1f4
// Semantic RGBA/world-XYZ buffers, not a copy of proprietary native vertex bytes.
// GPU/material/projection and the wrapper's proven null-background discard are
// owned by the caller. This module neither sorts nor advances simulation.
import {
  getScale43,
  normalizeVector,
  transformVector43,
  vectorCross,
  vectorSub,
} from './math43.mjs';

const f = Math.fround;
const add = (a, b) => f(f(a) + f(b));
const sub = (a, b) => f(f(a) - f(b));
const mul = (a, b) => f(f(a) * f(b));
const div = (a, b) => f(f(a) / f(b));

export class EffekseerRibbonTrackGeometryError extends Error {
  constructor(field, reason) {
    super('Effekseer ribbon/track ' + field + ': ' + reason);
    this.name = 'EffekseerRibbonTrackGeometryError';
    this.field = field;
  }
}
function fail(field, reason) {
  throw new EffekseerRibbonTrackGeometryError(field, reason);
}
function integer(value, field) {
  if (!Number.isInteger(value) || value < 0 || value > 2147483647)
    fail(field, 'requires nonnegative signed-int32');
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
function checkFloats(value, length, field) {
  sequence(value, length, field);
  for (let i = 0; i < length; i++) float(value[i], field);
  return value;
}
function checkColor(value) {
  sequence(value, 4, 'color');
  for (let i = 0; i < 4; i++)
    if (!Number.isInteger(value[i]) || value[i] < 0 || value[i] > 255)
      fail('color', 'requires RGBA uint8 values');
  return value;
}

// One reusable output object and growable typed backing buffers. The builder
// intentionally exposes the SOURCE RESERVED range as well as its write cursor:
// multiple groups leave a zero-initialized tail in old StandardRenderer caches.
export class RibbonTrackGeometry {
  constructor({ maxVertices = 1048576, maxGroups = 65536 } = {}) {
    this.maxVertices = integer(maxVertices, 'maxVertices');
    this.maxGroups = integer(maxGroups, 'maxGroups');
    this.positions = new Float32Array(0);
    this.uv = new Float32Array(0);
    this.colors = new Uint8Array(0);
    this.indices = new Uint32Array(0);
    this.groupRanges = new Uint32Array(0);
    this.capacity = 0;
    this.groupCapacity = 0;
    this.bufferGrowths = 0;
    this.groupBufferGrowths = 0;
    this.mesh = {
      kind: null,
      positions: this.positions,
      uv: this.uv,
      colors: this.colors,
      indices: this.indices,
      groupRanges: this.groupRanges,
      vertexCount: 0,
      indexCount: 0,
      quadCount: 0,
      cursorVertexCount: 0,
      touchedVertexCount: 0,
      completedSegmentQuadCount: 0,
      sourceInstanceCount: 0,
      submittedInstanceCount: 0,
      groupCount: 0,
    };
    this.groupUV = new Float32Array(4);
    this.scale = new Float32Array(3);
    this.up = new Float32Array(3);
    this.forward = new Float32Array(3);
    this.right = new Float32Array(3);
    this.axis = new Float32Array(3);
    this.axisBefore = new Float32Array(3);
    this.axisOld = new Float32Array(3);
    this.local = new Float32Array(3);
    this.localLeft = new Float32Array(3);
    this.localCenter = new Float32Array(3);
    this.localRight = new Float32Array(3);
    this.center = new Float32Array(3);
    this.pointA = new Float32Array(3);
    this.pointB = new Float32Array(3);
    this.rotation = new Float32Array(12);
    this.leftColor = new Uint8Array(4);
    this.centerColor = new Uint8Array(4);
    this.rightColor = new Uint8Array(4);
    this.open = false;
    this.groupOpen = false;
  }

  _ensureCapacity(vertices) {
    if (vertices <= this.capacity) return;
    if (vertices > this.maxVertices)
      fail('capacity', 'source reservation exceeds configured vertex budget');
    let next = Math.max(4, this.capacity);
    while (next < vertices) next = Math.min(this.maxVertices, next * 2);
    this.capacity = next;
    this.positions = new Float32Array(next * 3);
    this.uv = new Float32Array(next * 2);
    this.colors = new Uint8Array(next * 4);
    this.indices = new Uint32Array(Math.floor(next / 4) * 6);
    // Original DX9 shared quad index order.
    for (let quad = 0; quad < Math.floor(next / 4); quad++) {
      const v = quad * 4,
        i = quad * 6;
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

  _ensureGroups(count) {
    if (count <= this.groupCapacity) return;
    if (count > this.maxGroups) fail('groups', 'configured group budget exceeded');
    let next = Math.max(1, this.groupCapacity);
    while (next < count) next = Math.min(this.maxGroups, next * 2);
    const values = new Uint32Array(next * 4);
    values.set(this.groupRanges);
    this.groupRanges = values;
    this.groupCapacity = next;
    this.mesh.groupRanges = values;
    this.groupBufferGrowths++;
  }

  beginNode(kind, sourceInstanceCount, { viewpointDependent = false, distortion = false } = {}) {
    if (this.open) fail('beginNode', 'previous node is still open');
    if (kind !== 'ribbon' && kind !== 'track') fail('kind', 'unimplemented renderer ' + kind);
    if (distortion !== false)
      fail(
        'distortion',
        'ordinary geometry only; caller must own the proven wrapper discard branch',
      );
    if (typeof viewpointDependent !== 'boolean') fail('viewpointDependent', 'requires boolean');
    sourceInstanceCount = integer(sourceInstanceCount, 'sourceInstanceCount');
    const vertices = Math.max(sourceInstanceCount - 1, 0) * (kind === 'ribbon' ? 4 : 8);
    if (vertices > 2147483647 || vertices > this.maxVertices)
      fail('capacity', 'source vertex reservation overflow/budget');
    this._ensureCapacity(vertices);
    // Original vector<uint8_t>::resize explicitly zeroes every appended byte,
    // including a tail that later group writes never reach.
    this.positions.fill(0, 0, vertices * 3);
    this.uv.fill(0, 0, vertices * 2);
    this.colors.fill(0, 0, vertices * 4);
    this.kind = kind;
    this.viewpointDependent = viewpointDependent;
    this.reserved = vertices;
    this.cursor = 0;
    this.touched = 0;
    this.segmentQuads = 0;
    this.submitted = 0;
    this.groups = 0;
    this.sourceInstanceCount = sourceInstanceCount;
    this.open = true;
    this.groupOpen = false;
    return this;
  }

  beginGroup(instanceCount, firstUV = null) {
    if (!this.open || this.groupOpen)
      fail('beginGroup', 'requires one open node with no unfinished group');
    instanceCount = integer(instanceCount, 'group.instanceCount');
    if (instanceCount >= 2) {
      checkFloats(firstUV, 4, 'group.firstUV');
      for (let i = 0; i < 4; i++) this.groupUV[i] = f(firstUV[i]);
    }
    // n<2 never reads UV/matrix/colors in Rendering_Internal. The CPU-state
    // adapter separately owns the actual original GetFirst()->GetUV() call.
    this._ensureGroups(this.groups + 1);
    this.groupCount = instanceCount;
    this.groupIndex = 0;
    this.groupBase = this.cursor;
    this.groupOpen = true;
    return this;
  }

  _need(vertexExclusive) {
    if (vertexExclusive > this.reserved || vertexExclusive < 0)
      fail(
        'source-write-range',
        'group would access outside this node reservation; stale/out-of-bounds native cache path is unverified',
      );
    if (vertexExclusive > this.touched) this.touched = vertexExclusive;
  }

  _vertex(index, x, y, z, color, u, v) {
    this._need(index + 1);
    const p = index * 3,
      c = index * 4,
      t = index * 2;
    this.positions[p] = float(x, 'vertex.x');
    this.positions[p + 1] = float(y, 'vertex.y');
    this.positions[p + 2] = float(z, 'vertex.z');
    this.uv[t] = float(u, 'vertex.u');
    this.uv[t + 1] = float(v, 'vertex.v');
    for (let i = 0; i < 4; i++) this.colors[c + i] = color[i];
  }

  _copyVertex(destination, source) {
    this._need(Math.max(destination, source) + 1);
    for (let i = 0; i < 3; i++)
      this.positions[destination * 3 + i] = this.positions[source * 3 + i];
    for (let i = 0; i < 2; i++) this.uv[destination * 2 + i] = this.uv[source * 2 + i];
    for (let i = 0; i < 4; i++) this.colors[destination * 4 + i] = this.colors[source * 4 + i];
  }

  _readPosition(index, out) {
    this._need(index + 1);
    for (let i = 0; i < 3; i++) out[i] = this.positions[index * 3 + i];
    return out;
  }

  _storePosition(index, point) {
    this._need(index + 1);
    for (let i = 0; i < 3; i++)
      this.positions[index * 3 + i] = float(point[i], 'transformed.position');
  }

  _transform(index, matrix) {
    this._readPosition(index, this.local);
    transformVector43(this.local, matrix, this.local);
    this._storePosition(index, this.local);
  }

  _facing(up, translation, camera) {
    checkFloats(camera, 16, 'camera44');
    this.forward[0] = -f(camera[2]);
    this.forward[1] = -f(camera[6]);
    this.forward[2] = -f(camera[10]);
    normalizeVector(this.forward, this.forward);
    vectorCross(up, this.forward, this.right);
    normalizeVector(this.right, this.right);
    vectorCross(this.right, up, this.forward);
    normalizeVector(this.forward, this.forward);
    const out = this.rotation;
    for (let i = 0; i < 3; i++) {
      out[i] = -this.right[i];
      out[3 + i] = up[i];
      out[6 + i] = this.forward[i];
      out[9 + i] = translation[i];
    }
    return out;
  }

  append(matrix43, renderOutput, camera44 = null) {
    if (!this.open || !this.groupOpen) fail('append', 'BeginRenderingGroup is required');
    if (
      renderOutput?.kind !== this.kind ||
      renderOutput.instanceCount !== this.groupCount ||
      renderOutput.instanceIndex !== this.groupIndex
    )
      fail(
        'instance-order',
        'requires the actual ordered renderer index/count, without sorting or filling gaps',
      );
    if (this.groupIndex >= this.groupCount)
      fail('instance-order', 'index exceeds original group count');
    // Source early return happens before matrix/color/UV reads for n<2.
    if (this.groupCount >= 2) {
      checkFloats(matrix43, 12, 'matrix43');
      if (this.kind === 'ribbon') this._ribbon(matrix43, renderOutput, camera44);
      else this._track(matrix43, renderOutput, camera44);
    }
    this.groupIndex++;
    this.submitted++;
    if (this.submitted > this.sourceInstanceCount)
      fail('source-count', 'more submitted ACTIVE instances than the node count');
    return this;
  }

  _ribbon(matrix, parameter, camera) {
    checkFloats(parameter.positions, 2, 'ribbon.positions');
    sequence(parameter.colors, 2, 'ribbon.colors');
    checkColor(parameter.colors[0]);
    checkColor(parameter.colors[1]);
    const index = this.groupIndex,
      count = this.groupCount,
      p = this.cursor,
      uv = this.groupUV;
    const v0 = add(uv[1], mul(div(index, count), uv[3]));
    const v1 = add(uv[1], mul(div(index + 1, count), uv[3]));
    this._vertex(p, parameter.positions[0], 0, 0, parameter.colors[0], uv[0], v0);
    this._vertex(p + 1, parameter.positions[1], 0, 0, parameter.colors[1], add(uv[0], uv[2]), v1);
    if (this.viewpointDependent) {
      getScale43(matrix, this.scale);
      // Old GetSRT computes all rotation rows; only row1 and scale.X are used
      // here. Zero X/Z scales produce unused NaN rows in C++ and need not
      // reject an otherwise finite ribbon. A zero up row actually reaches
      // the generated basis and is an explicit unsupported nonfinite path.
      if (this.scale[1] === 0)
        fail('ribbon.zero-up-scale', 'original GetSRT divides its used up row by zero');
      for (let i = 0; i < 3; i++) {
        this.up[i] = div(matrix[3 + i], this.scale[1]);
        this.center[i] = f(matrix[9 + i]);
      }
      this.positions[p * 3] = mul(this.positions[p * 3], this.scale[0]);
      this.positions[(p + 1) * 3] = mul(this.positions[(p + 1) * 3], this.scale[0]);
      this._facing(this.up, this.center, camera);
      this._transform(p, this.rotation);
      this._transform(p + 1, this.rotation);
    } else {
      this._transform(p, matrix);
      this._transform(p + 1, matrix);
    }
    if (index === 0 || index === count - 1) this.cursor += 2;
    else {
      this._copyVertex(p + 2, p);
      this._copyVertex(p + 3, p + 1);
      this.cursor += 4;
    }
    if (index !== 0) this.segmentQuads++;
  }

  _track(matrix, parameter, camera) {
    checkFloats(parameter.sizes, 3, 'track.sizes');
    sequence(parameter.colors, 6, 'track.colors');
    for (let i = 0; i < 6; i++) checkColor(parameter.colors[i]);
    const index = this.groupIndex,
      count = this.groupCount,
      p = this.cursor,
      uv = this.groupUV;
    let factor = div(index, count),
      width;
    if (index < Math.trunc(count / 2)) {
      factor = mul(factor, 2);
      width = add(parameter.sizes[0], mul(sub(parameter.sizes[1], parameter.sizes[0]), factor));
    } else {
      factor = sub(1, sub(mul(factor, 2), 1));
      width = add(parameter.sizes[2], mul(sub(parameter.sizes[1], parameter.sizes[2]), factor));
    }
    // Reader/render-state order L,LM,C,CM,R,RM. The back half intentionally
    // still interpolates each end color towards the middle color.
    for (let channel = 0; channel < 4; channel++) {
      this.leftColor[channel] = Math.trunc(
        Math.min(
          255,
          Math.max(
            0,
            add(
              parameter.colors[0][channel],
              mul(parameter.colors[1][channel] - parameter.colors[0][channel], factor),
            ),
          ),
        ),
      );
      this.centerColor[channel] = Math.trunc(
        Math.min(
          255,
          Math.max(
            0,
            add(
              parameter.colors[2][channel],
              mul(parameter.colors[3][channel] - parameter.colors[2][channel], factor),
            ),
          ),
        ),
      );
      this.rightColor[channel] = Math.trunc(
        Math.min(
          255,
          Math.max(
            0,
            add(
              parameter.colors[4][channel],
              mul(parameter.colors[5][channel] - parameter.colors[4][channel], factor),
            ),
          ),
        ),
      );
    }
    width = float(width, 'track.width');
    const v = add(uv[1], mul(div(index, count), uv[3]));
    const uc = add(uv[0], mul(uv[2], 0.5)),
      ur = add(uv[0], uv[2]);
    this._vertex(p, div(-width, 2), 0, 0, this.leftColor, uv[0], v);
    this._vertex(p + 1, matrix[9], matrix[10], matrix[11], this.centerColor, uc, v);
    this._copyVertex(p + 4, p + 1);
    this._vertex(p + 5, div(width, 2), 0, 0, this.rightColor, ur, v);
    if (index === 0) this.cursor += 2;
    else if (index === count - 1) {
      this.cursor += 6;
      this.segmentQuads += 2;
    } else {
      this._copyVertex(p + 6, p);
      this._copyVertex(p + 7, p + 1);
      this._copyVertex(p + 10, p + 1);
      this._copyVertex(p + 11, p + 5);
      this.cursor += 8;
      this.segmentQuads += 2;
    }
    // Like the source, an incomplete/partly submitted group does not run this
    // pass. Do not synthesize a final point or normalize a partial raw cache.
    if (index === count - 1) this._finishTrack(count, camera);
  }

  _finishTrack(count, camera) {
    checkFloats(camera, 16, 'track.camera44');
    let p = this.cursor - (count - 1) * 8;
    if (p !== this.groupBase)
      fail('track.group-base', 'source cursor no longer identifies this complete group');
    for (let index = 0; index < count; index++) {
      if (index === 0) {
        this._readPosition(p + 3, this.pointA);
        this._readPosition(p + 1, this.pointB);
        vectorSub(this.pointA, this.pointB, this.axis);
        normalizeVector(this.axis, this.axis);
        this.axisBefore.set(this.axis);
      } else if (index === count - 1) this.axis.set(this.axisBefore);
      else {
        this.axisOld.set(this.axisBefore);
        this._readPosition(p + 9, this.pointA);
        this._readPosition(p + 7, this.pointB);
        vectorSub(this.pointA, this.pointB, this.axis);
        normalizeVector(this.axis, this.axis);
        this.axisBefore.set(this.axis);
        for (let i = 0; i < 3; i++) this.axis[i] = div(add(this.axisBefore[i], this.axisOld[i]), 2);
      }
      this._readPosition(p + 1, this.center);
      this._readPosition(p, this.localLeft);
      this.localCenter.fill(0);
      this._readPosition(p + 5, this.localRight);
      this._facing(this.axis, this.center, camera);
      transformVector43(this.localLeft, this.rotation, this.localLeft);
      transformVector43(this.localCenter, this.rotation, this.localCenter);
      transformVector43(this.localRight, this.rotation, this.localRight);
      this._storePosition(p, this.localLeft);
      this._storePosition(p + 1, this.localCenter);
      this._storePosition(p + 5, this.localRight);
      this._copyVertex(p + 4, p + 1);
      if (index === 0) p += 2;
      else if (index === count - 1) p += 6;
      else {
        this._copyVertex(p + 6, p);
        this._copyVertex(p + 7, p + 1);
        this._copyVertex(p + 10, p + 1);
        this._copyVertex(p + 11, p + 5);
        p += 8;
      }
    }
  }

  endGroup() {
    if (!this.open || !this.groupOpen) fail('endGroup', 'no active group');
    // Partial groups preserve only the original submitted writes/cursor. This
    // matters when source group list size exceeds the ACTIVE render count.
    const at = this.groups * 4;
    this.groupRanges[at] = this.groupBase;
    this.groupRanges[at + 1] = this.groupCount;
    this.groupRanges[at + 2] = this.groupIndex;
    this.groupRanges[at + 3] = this.cursor;
    this.groups++;
    this.groupOpen = false;
    return this;
  }

  endNode() {
    if (!this.open || this.groupOpen) fail('endNode', 'node/group sequence incomplete');
    this.mesh.kind = this.kind;
    this.mesh.vertexCount = this.reserved;
    this.mesh.indexCount = (this.reserved / 4) * 6;
    this.mesh.quadCount = this.reserved / 4;
    this.mesh.cursorVertexCount = this.cursor;
    this.mesh.touchedVertexCount = this.touched;
    this.mesh.completedSegmentQuadCount = this.segmentQuads;
    this.mesh.sourceInstanceCount = this.sourceInstanceCount;
    this.mesh.submittedInstanceCount = this.submitted;
    this.mesh.groupCount = this.groups;
    this.open = false;
    return this.mesh;
  }
}
