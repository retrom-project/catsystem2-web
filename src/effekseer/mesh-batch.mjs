// SPDX-License-Identifier: MIT
// Copyright (c) 2011 Effekseer Project. See ../../licenses/effekseer-MIT.txt.
// Fixed1.23 normal renderer Begin/reserve/Rendering/End ordering, including the
// verified original76 zero-submission Ring End guard. No World/task owner.
import { EffekseerStandardBatch } from './standard-batch.mjs';
import { EffekseerPackedMesh } from './mesh-packet.mjs';
import { EffekseerRingCurrentState } from './ring-current-state.mjs';
import { EffekseerDeviceScope } from './materials.mjs';
import { SpriteRingGeometry } from './sprite-ring-geometry.mjs';
import { RibbonTrackGeometry } from './ribbon-track-geometry.mjs';
import { createEffekseerColorVisitor } from './instance-operations.mjs';
const NORMAL = new Set(['sprite', 'ribbon', 'ring', 'track']);
const resetResult = (r) => {
  for (const key of Object.keys(r)) r[key] = key === 'suppressedByCurrentEffect' ? false : 0;
};
export class EffekseerMeshBatch {
  constructor({
    stage,
    loads,
    device,
    bindNormalPipeline,
    getCamera,
    getProjection,
    getViewport,
    trace = null,
  } = {}) {
    for (const [name, fn] of Object.entries({
      bindNormalPipeline,
      getCamera,
      getProjection,
      getViewport,
    }))
      if (typeof fn !== 'function') throw new TypeError('Effekseer mesh batch requires ' + name);
    if (
      typeof stage?.drawEffekseer !== 'function' ||
      typeof loads?.get !== 'function' ||
      typeof loads?.bindingFor !== 'function' ||
      !device?.state
    )
      throw new TypeError('Effekseer mesh batch requires the shared stage/load/device owners');
    if (trace !== null && typeof trace !== 'function') throw new TypeError('Invalid batch trace');
    Object.assign(this, {
      stage,
      loads,
      device,
      bindNormalPipeline,
      getCamera,
      getProjection,
      getViewport,
    });
    this.scope = new EffekseerDeviceScope(device);
    this.ring = new EffekseerRingCurrentState();
    this.spriteRing = new SpriteRingGeometry();
    this.ribbonTrack = new RibbonTrackGeometry();
    this.packed = new EffekseerPackedMesh();
    this.ringCamera = new Float32Array(16);
    this.material = {
      depthTest: false,
      depthWrite: false,
      distortion: false,
      distortionIntensity: 1,
      alphaBlend: 1,
      culling: 2,
      filter: 0,
      wrap: 0,
      texture: null,
    };
    this.current = {
      node: null,
      builder: null,
      count: 0,
      reserved: 0,
      offset: 0,
      stride: 24,
      bytes: null,
    };
    this.pipeline = { device, frame: null, textureToken: null };
    this.batch = new EffekseerStandardBatch({
      camera: getCamera,
      projection: getProjection,
      trace,
      prepare: (packet) => {
        const state = packet.state,
          binding = this.loads.bindingFor(state.texture);
        if (state.culling !== 2) throw new Error('Normal mesh batch requires fixed Double culling');
        this.scope.applyValues(
          state.depthTest,
          state.depthWrite,
          state.alphaBlend,
          state.filter,
          state.wrap,
        );
        this.pipeline.textureToken = state.texture;
        this.pipeline.frame = binding?.frame ?? null;
        const value = this.bindNormalPipeline(this.pipeline);
        if (typeof value?.then === 'function')
          throw new Error('Effekseer pipeline must be synchronous');
      },
      draw: (packet) => {
        const packed = this.packed.prepareBatch(packet, { viewport: this.getViewport() });
        this.stage.drawEffekseer(packed, this.pipeline.frame, {
          state: this.device.state,
          context: this.device.context,
        });
        this.result.drawCalls++;
        this.result.vertexCount += packed.vertexCount;
        this.result.indexCount += packed.indexCount;
      },
      // Original DX9 EndShader is empty, and render-state Pop does not apply
      // another device update. The outer renderer End restores12states/5bindings.
      finish: () => {},
    });
    this.visitors = new WeakMap();
    this.drawing = false;
    this.closed = false;
    this.fresh = true;
    this.fault = null;
    this.result = {
      nodes: 0,
      instances: 0,
      normalNodes: 0,
      modelNodes: 0,
      distortionNodes: 0,
      reservedVertices: 0,
      drawCalls: 0,
      vertexCount: 0,
      indexCount: 0,
      suppressedByCurrentEffect: false,
    };
  }
  assertReady() {
    if (this.closed || this.drawing || this.fault)
      throw new Error('Effekseer mesh batch is closed, drawing or faulted', { cause: this.fault });
  }
  setMaterial(set, node) {
    const m = this.material,
      index = node.renderer.textureIndex;
    if (!Number.isInteger(index)) throw new Error('Unimplemented Effekseer texture index');
    let token = null;
    if (index >= 0) {
      const kind = node.texture.distortion ? 'distortion' : 'color',
        binding = this.loads.get(set.assetID).textures[kind][index];
      if (!binding) throw new Error('Effekseer texture index exceeds its loaded table');
      token = binding.token;
    }
    m.depthTest = node.texture.zTest;
    m.depthWrite = node.texture.zWrite;
    m.distortion = node.texture.distortion;
    m.distortionIntensity = node.texture.distortionIntensity;
    m.alphaBlend = node.renderer.alphaBlend ?? node.texture.alphaBlend;
    m.filter = node.texture.filter;
    m.wrap = node.texture.wrap;
    m.texture = token;
    this.batch.updateState(m);
  }
  beginNode({ set, node, count }) {
    const a = this.current;
    a.node = node;
    a.count = count;
    a.builder = null;
    a.reserved = 0;
    a.bytes = null;
    this.result.nodes++;
    if (node.type === 'model') {
      this.result.modelNodes++;
      return;
    }
    if (!NORMAL.has(node.type)) throw new Error('Unimplemented mesh renderer ' + node.type);
    const trail = node.type === 'ribbon' || node.type === 'track',
      builder = trail ? this.ribbonTrack : this.spriteRing,
      vertices = trail
        ? Math.max(count - 1, 0) * (node.type === 'ribbon' ? 4 : 8)
        : count * (node.type === 'ring' ? node.renderer.vertexCount * 8 : 4);
    if (node.type === 'ring' && count === 1) this.batch.reset();
    // Ribbon/Track Begin returns before material/reserve for count<=1.
    if (!trail || count > 1) {
      this.setMaterial(set, node);
      const reservation = this.batch.reserve(vertices);
      a.reserved = vertices;
      a.offset = reservation.offset;
      a.stride = reservation.stride;
      a.bytes = reservation.buffer;
      this.result.reservedVertices += vertices;
    }
    if (trail)
      builder.beginNode(node.type, count, {
        viewpointDependent: node.renderer.viewpointDependent ?? false,
      });
    else
      builder.beginNode(node.type, count, {
        billboard: node.renderer.billboard,
        vertexCount: node.renderer.vertexCount,
      });
    a.builder = builder;
    if (node.texture.distortion) this.result.distortionNodes++;
    else this.result.normalNodes++;
  }
  writeMesh(mesh) {
    const a = this.current;
    if (mesh.vertexCount !== a.reserved)
      throw new Error('Effekseer source reservation changed during node');
    // Null-background distortion still reserved its48-byte range and executed
    // color/group/Ring matrix state. Its vertex payload is never consumed by
    // this wrapper's GPU branch; no normal solid substitution is submitted.
    if (!a.bytes || a.stride === 48) return;
    if (this.byteSource !== a.bytes) {
      this.byteSource = a.bytes;
      this.byteData = new DataView(a.bytes.buffer, a.bytes.byteOffset, a.bytes.byteLength);
    }
    const data = this.byteData,
      bytes = a.bytes;
    for (let i = 0; i < mesh.vertexCount; i++) {
      const dst = a.offset + i * 24;
      for (let axis = 0; axis < 3; axis++)
        data.setFloat32(dst + axis * 4, mesh.positions[i * 3 + axis], true);
      bytes[dst + 12] = mesh.colors[i * 4 + 2];
      bytes[dst + 13] = mesh.colors[i * 4 + 1];
      bytes[dst + 14] = mesh.colors[i * 4];
      bytes[dst + 15] = mesh.colors[i * 4 + 3];
      data.setFloat32(dst + 16, mesh.uv[i * 2], true);
      data.setFloat32(dst + 20, mesh.uv[i * 2 + 1], true);
    }
  }
  visitorFor(manager) {
    const prior = this.visitors.get(manager);
    if (prior) return prior;
    const color = createEffekseerColorVisitor({
        manager,
        onInstance: ({ node, instance, output }) => {
          this.result.instances++;
          const a = this.current;
          if (node !== a.node) throw new Error('Effekseer node ownership changed');
          if (!a.builder) return;
          a.builder.append(instance.matrix, output, this.getCamera());
          if (node.type === 'ring' && a.count === 1 && a.builder.deferredReady)
            this.ring.updateMatrix43(a.builder.deferredStorage);
        },
      }),
      visitor = {
        beginNode: (input) => this.beginNode(input),
        beginGroup: (input) => {
          color.beginGroup(input);
          if (this.current.builder === this.ribbonTrack)
            this.ribbonTrack.beginGroup(input.group.active.length, input.group.values.draw.uv);
        },
        instance: (input) => color.instance(input),
        endGroup: () => {
          if (this.current.builder === this.ribbonTrack) this.ribbonTrack.endGroup();
        },
        endNode: () => {
          const a = this.current;
          if (!a.builder) return;
          const mesh = a.builder.endNode();
          this.writeMesh(mesh);
          if (mesh.flushAfter)
            this.batch.flush(
              this.ring.cameraMatrix(this.getCamera(), this.ringCamera),
              this.getProjection(),
            );
          a.builder = null;
          a.node = null;
        },
      };
    this.visitors.set(manager, visitor);
    return visitor;
  }
  draw(manager, { hasCurrentEffect, depthStencilEnabled } = {}) {
    this.assertReady();
    if (
      typeof manager?.draw !== 'function' ||
      typeof hasCurrentEffect !== 'boolean' ||
      typeof depthStencilEnabled !== 'boolean'
    )
      throw new TypeError('Explicit task/device draw gates required');
    resetResult(this.result);
    if (!hasCurrentEffect) {
      this.result.suppressedByCurrentEffect = true;
      return this.result;
    }
    this.drawing = true;
    this.fresh = false;
    let failure = null;
    try {
      this.scope.begin();
      this.batch.begin();
      this.scope.clearCurrentDepth(depthStencilEnabled);
      manager.draw(this.visitorFor(manager));
      this.batch.end();
    } catch (error) {
      failure = error;
      this.fault = error;
    } finally {
      try {
        try {
          if (this.batch.active) this.batch.abort();
        } finally {
          if (this.scope.active) this.scope.end();
        }
      } catch (cleanup) {
        this.fault = failure
          ? new AggregateError([failure, cleanup], 'Effekseer draw and cleanup failed')
          : cleanup;
        failure = this.fault;
      } finally {
        this.current.builder = null;
        this.current.node = null;
        this.current.bytes = null;
        // These are borrowed submission arguments, not retained load references.
        this.pipeline.frame = null;
        this.pipeline.textureToken = null;
        this.drawing = false;
      }
    }
    if (failure) throw failure;
    return this.result;
  }
  snapshot() {
    this.assertReady();
    return { batch: this.batch.snapshot(), ring: this.ring.snapshot() };
  }
  restore(saved) {
    this.assertReady();
    if (!this.fresh) throw new Error('Effekseer mesh batch restore requires fresh owner');
    try {
      if (!saved || Object.keys(saved).length !== 2)
        throw new Error('Invalid Effekseer mesh batch checkpoint');
      this.batch.restore(saved.batch);
      this.ring.restore(saved.ring);
      this.fresh = false;
      return this;
    } catch (error) {
      this.fault = error;
      throw error;
    }
  }
  close() {
    if (this.closed) return;
    if (this.drawing) throw new Error('Cannot close a drawing Effekseer batch');
    this.batch.close();
    this.ring.close();
    this.scope.close();
    this.closed = true;
  }
}
