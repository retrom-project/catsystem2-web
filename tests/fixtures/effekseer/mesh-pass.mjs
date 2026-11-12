// SPDX-License-Identifier: MPL-2.0
// Explicit CPU/geometry/current-device seam. No task/world/native ownership.
import { RibbonTrackGeometry } from '../../../src/effekseer/ribbon-track-geometry.mjs';
import { SpriteRingGeometry } from '../../../src/effekseer/sprite-ring-geometry.mjs';
import { createEffekseerColorVisitor } from '../../../src/effekseer/instance-operations.mjs';
import { EffekseerDeviceScope } from '../../../src/effekseer/materials.mjs';
import { EffekseerPackedMesh } from '../../../src/effekseer/mesh-packet.mjs';
const normal = new Set(['sprite', 'ribbon', 'ring', 'track']);
export class EffekseerMeshPass {
  constructor({
    stage,
    resources,
    device,
    bindNormalPipeline,
    getCamera,
    getProjection,
    getViewport,
  } = {}) {
    for (const [name, value] of Object.entries({
      bindNormalPipeline,
      getCamera,
      getProjection,
      getViewport,
    }))
      if (typeof value !== 'function')
        throw new TypeError('Effekseer mesh pass ' + name + ' operation is required');
    if (
      typeof stage?.drawEffekseer !== 'function' ||
      typeof resources?.get !== 'function' ||
      !device?.state
    )
      throw new TypeError(
        'Effekseer mesh pass needs current StageRenderer, resources and shared device',
      );
    Object.assign(this, {
      stage,
      resources,
      device,
      bindNormalPipeline,
      getCamera,
      getProjection,
      getViewport,
    });
    this.scope = new EffekseerDeviceScope(device);
    this.ribbonTrack = new RibbonTrackGeometry({ maxVertices: 8000 });
    this.spriteRing = new SpriteRingGeometry({ maxVertices: 8000 });
    this.packed = new EffekseerPackedMesh();
    this.active = null;
    this.visitors = new WeakMap();
    this.closed = false;
    this.fault = null;
    this.drawing = false;
    this.result = {
      nodes: 0,
      instances: 0,
      drawnNodes: 0,
      modelNodes: 0,
      distortionNodes: 0,
      vertexCount: 0,
      indexCount: 0,
      suppressedByCurrentEffect: false,
    };
  }
  frameFor(set, node) {
    const asset = this.resources.get(set.assetID),
      index = node.renderer.textureIndex;
    if (!Number.isInteger(index)) throw new Error('Unimplemented Effekseer texture index');
    if (index < 0) return null;
    const binding = asset.textures.color[index];
    if (!binding) throw new Error('Effekseer texture index exceeds mounted dependency table');
    return binding.missing ? null : binding.frame;
  }
  visitorFor(manager) {
    const existing = this.visitors.get(manager);
    if (existing) return existing;
    const color = createEffekseerColorVisitor({
      manager,
      onInstance: ({ node, instance, output, unavailable }) => {
        this.result.instances++;
        if (unavailable) return; // Cache evaluation has run; the color visitor still advances its group.
        if (!this.active?.builder || node !== this.active.node)
          throw new Error('Effekseer node/geometry ownership mismatch');
        this.active.builder.append(instance.matrix, output, this.getCamera());
      },
    });
    const visitor = {
      beginNode: ({ set, node, count }) => {
        this.result.nodes++;
        const unavailable =
          node.type === 'model' ? 'model' : node.texture.distortion ? 'distortion' : null;
        if (unavailable) {
          this.result[unavailable === 'model' ? 'modelNodes' : 'distortionNodes']++;
          this.active = { set, node, builder: null };
          return;
        }
        if (!normal.has(node.type))
          throw new Error('Unimplemented Effekseer mesh node ' + node.type);
        const builder =
          node.type === 'ribbon' || node.type === 'track' ? this.ribbonTrack : this.spriteRing;
        if (builder === this.ribbonTrack)
          builder.beginNode(node.type, count, {
            viewpointDependent: node.renderer.viewpointDependent ?? false,
          });
        else builder.beginNode(node.type, count, node.renderer);
        this.active = { set, node, builder };
      },
      beginGroup: (input) => {
        color.beginGroup(input);
        if (this.active.builder === this.ribbonTrack)
          this.ribbonTrack.beginGroup(input.group.active.length, input.group.values.draw.uv);
      },
      instance: (input) => color.instance(input),
      endGroup: () => {
        if (this.active.builder === this.ribbonTrack) this.ribbonTrack.endGroup();
      },
      endNode: ({ set, node }) => {
        if (this.active.builder) {
          const mesh = this.active.builder.endNode(),
            packet = this.packed.prepare(mesh, {
              camera: this.getCamera(),
              projection: this.getProjection(),
              viewport: this.getViewport(),
            }),
            frame = this.frameFor(set, node);
          this.scope.applyNormalMaterial(node);
          this.bindNormalPipeline({ device: this.device, packet, frame });
          this.stage.drawEffekseer(packet, frame, {
            state: this.device.state,
            context: this.device.context,
          });
          this.result.drawnNodes++;
          this.result.vertexCount += packet.vertexCount;
          this.result.indexCount += packet.indexCount;
        }
        this.active = null;
      },
    };
    this.visitors.set(manager, visitor);
    return visitor;
  }
  draw(manager, { hasCurrentEffect, depthStencilEnabled } = {}) {
    if (this.closed || this.fault || this.drawing)
      throw new Error('Effekseer mesh pass is closed, faulted or already drawing');
    if (
      typeof manager?.draw !== 'function' ||
      typeof hasCurrentEffect !== 'boolean' ||
      typeof depthStencilEnabled !== 'boolean'
    )
      throw new TypeError('Effekseer mesh pass requires manager and explicit task/device flags');
    for (const key of Object.keys(this.result))
      this.result[key] = key === 'suppressedByCurrentEffect' ? false : 0;
    if (!hasCurrentEffect) {
      this.result.suppressedByCurrentEffect = true;
      return this.result;
    }
    this.drawing = true;
    const visitor = this.visitorFor(manager);
    try {
      this.scope.begin();
      this.scope.clearCurrentDepth(depthStencilEnabled);
      manager.draw(visitor);
      return this.result;
    } catch (error) {
      this.fault = error;
      throw error;
    } finally {
      this.active = null;
      this.drawing = false;
      if (this.scope.active) this.scope.end();
    }
  }
  close() {
    if (this.closed) return;
    this.scope.close();
    this.closed = true;
  }
}
