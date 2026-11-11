// SPDX-License-Identifier: MPL-2.0
// JS owns callback phases, captures, model ordering and submission.
import { encodeSparseBytes, decodeSparseBytes } from './sparse-bytes.mjs';
import { compareNativeDrawItems as compare } from './graphics-render.mjs';
import { advanceD3DContext } from '../ppi/render-state.mjs';
const nativeItem = (item) => Boolean(item.p?.nativeGraph || item.type === 'particle');
export function screenQuad(
  width,
  height,
  textureWidth = width,
  textureHeight = height,
  color = 0xffffffff,
) {
  return [
    {
      vertices: [
        [-0.5, -0.5, 0, 0],
        [width - 0.5, -0.5, width / textureWidth, 0],
        [-0.5, height - 0.5, 0, height / textureHeight],
        [width - 0.5, height - 0.5, width / textureWidth, height / textureHeight],
      ].map(([x, y, u, v]) => ({
        x: Math.fround(x),
        y: Math.fround(y),
        z: 0.5,
        w: 1,
        color,
        u: Math.fround(u),
        v: Math.fround(v),
      })),
    },
  ];
}
export class NativeScreenEffectRenderer {
  constructor(effects) {
    this.effects = effects;
    this.world = effects.world;
    this.captures = [];
    this.prepared = false;
    this.frame = null;
    this.busy = 0;
  }
  get stage() {
    return this.world.stageRenderer;
  }
  get gpu() {
    return this.world.getNativeGPU?.() ?? this.stage?.gpu;
  }
  size() {
    const view = this.world.graphics.view;
    return [view.clientWidth, view.clientHeight];
  }
  currentFrame() {
    if (this.frame) return this.frame;
    const items = [
      ...Object.entries(this.world.graphics.stage.planes)
        .filter(([, p]) => p.nativeGraph)
        .map(([n, p]) => ({ n, p, priority: p.priority, order: p.nativeGraph.renderOrder })),
      ...(this.world.particles?.drawItems() ?? []),
      ...this.world.graphics.drawItems().filter(nativeItem),
    ].sort(compare);
    return {
      items,
      draw: async (item, gpu) => {
        if (item.drawGPU)
          await item.drawGPU(gpu, {
            fromHost: Boolean(this.world.nativeEngine?.process.asyncEnabled),
          });
        else
          await this.world.graphics.get(item.p?.nativeTaskWorldID ?? Number(item.n)).drawGPU(gpu, {
            fromHost: Boolean(this.world.nativeEngine?.process.asyncEnabled),
          });
      },
    };
  }
  paused() {
    return this.world.graphics.view.paused;
  }
  prepare(count) {
    count |= 0;
    const maximum = this.world.configuration.fields.general.renderTargetCount | 0;
    if (!this.world.graphics.view.active || maximum <= 0 || count > maximum) return false;
    if (this.prepared && this.captures.length >= count) return true;
    if (count < 0)
      throw new RangeError('Negative screen target count has no defined native allocation');
    this.releaseCaptures();
    const [width, height] = this.size();
    if (!width || !height) {
      this.captures = [];
      return count === 0;
    }
    try {
      for (let i = 0; i < count; i++) this.captures.push(this.stage.createSurface(width, height));
      this.prepared = true;
      this.effects.projectCaptures?.();
    } catch (error) {
      this.releaseCaptures();
      throw error;
    }
    return true;
  }
  releaseCaptures({ producer = true } = {}) {
    if (producer) this.effects.releaseProducerCaptures?.();
    for (const id of this.captures) this.stage.releaseSurface(id);
    this.captures = [];
    this.prepared = false;
  }
  async drawRange(minimum, maximum) {
    const frame = this.currentFrame(),
      gpu = this.gpu,
      previous = gpu.frameOpaqueTarget;
    // The primary native backbuffer is X8R8G8B8. Capture targets retain alpha.
    gpu.frameOpaqueTarget = gpu.target === gpu.primaryTarget;
    try {
      for (const item of frame.items)
        if (minimum <= item.priority && item.priority < maximum) await frame.draw(item, gpu);
    } finally {
      gpu.frameOpaqueTarget = previous;
    }
  }
  async prepareModels() {}
  clear(color, depthOnly = false) {
    const enabled = this.world.graphics.d3dContext.depthStencilEnabled;
    if (!depthOnly || enabled)
      this.gpu.clear({
        flags: (depthOnly ? 0 : 1) | (enabled ? 2 : 0),
        color,
        opaqueTarget: this.gpu.target === this.gpu.primaryTarget,
      });
  }
  async captureInto(id, minimum, maximum, color = 0) {
    this.busy++;
    try {
      await this.prepareModels();
      if (!this.gpu) {
        if (
          this.currentFrame().items.some(
            (item) => minimum <= item.priority && item.priority < maximum,
          )
        )
          throw new Error('A nonempty screen capture requires its GPU renderer');
        const bytes = new Uint8Array(this.stage.surfaces.get(id).bytes.length);
        for (let at = 0; at < bytes.length; at += 4)
          bytes.set([(color >>> 16) & 255, (color >>> 8) & 255, color & 255, color >>> 24], at);
        this.stage.writeSurface(id, bytes);
        return true;
      }
      const target = this.stage.surfaceTarget(id);
      await this.gpu.withRenderTargetAsync(
        target,
        async () => {
          this.clear(color);
          await this.drawRange(minimum, maximum);
        },
        { depthStencil: this.stage.surfaceDepth(id) },
      );
      const surface = this.stage.surfaces.get(id);
      surface.revision = (surface.revision ?? 0) + 1;
      return true;
    } finally {
      this.busy--;
    }
  }
  async capture(index, minimum, maximum) {
    if (!this.world.graphics.view.active) return false;
    index >>>= 0;
    if (index === 0xffffffff) {
      if (!this.gpu) throw new Error('Backbuffer capture requires its GPU renderer');
      this.busy++;
      try {
        await this.gpu.withRenderTargetAsync(
          this.gpu.primaryTarget,
          async () => {
            this.clear(0);
            await this.drawRange(minimum, maximum);
          },
          { depthStencil: this.stage.screenDepth() },
        );
      } finally {
        this.busy--;
      }
      return true;
    }
    if (!this.prepared) return false;
    if (index >= this.captures.length) return false;
    const result = await this.captureInto(this.captures[index], minimum, maximum);
    this.effects.projectCaptures?.();
    return result;
  }
  drawFrame(frame, geometry, { color, drawType = 0 } = {}) {
    if (!geometry) {
      const [width, height] = this.size();
      geometry = screenQuad(width, height, frame.width, frame.height, color);
    }
    const context = this.world.graphics.d3dContext,
      samplerStates = [5, 6].map((id) => [id, context.samplers.get(id)]),
      state = advanceD3DContext(context, { blendMode: 0, drawType, samplerStates });
    this.gpu.drawGeometry(geometry, frame, {
      state,
      opaqueTarget: this.gpu.target === this.gpu.primaryTarget,
    });
  }
  drawSurface(id, geometry, options) {
    if (id) this.drawFrame(this.stage.surfaceFrame(id), geometry, options);
  }
  async render(items, draw, present) {
    if (this.frame || this.busy) throw new Error('Screen-effect rendering cannot be reentered');
    if (!this.world.graphics.view.active || this.paused()) return true;
    this.frame = { items: items.filter(nativeItem).sort(compare), draw };
    this.busy++;
    try {
      await this.prepareModels();
      await this.gpu.withRenderTargetAsync(
        this.gpu.primaryTarget,
        async () => {
          const effect = this.effects.tasks.get(this.effects.callback),
            callback =
              effect &&
              effect.state.capability &&
              (![35, 36, 37].includes(effect.record.kind) || effect.state.active);
          if (!callback) {
            this.clear(0xff000000);
            await this.drawRange(0, 1000000);
          } else {
            this.clear(0xff000000);
            await effect.render();
          }
          await present({ stageTarget: this.gpu.primaryTarget });
        },
        { depthStencil: this.stage.screenDepth() },
      );
    } finally {
      this.busy--;
      this.frame = null;
    }
    return true;
  }
  snapshot() {
    if (this.busy || this.frame)
      throw new Error('Cannot checkpoint an unsettled screen capture or render');
    return {
      backbuffer: this.gpu && {
        width: this.gpu.primaryTarget.width,
        height: this.gpu.primaryTarget.height,
        pixels: encodeSparseBytes(this.gpu.pixels(this.gpu.primaryTarget)),
      },
      captures: [...this.captures],
      prepared: this.prepared,
      surfaces: this.stage.snapshotSurfaces(this.captures),
      depthFormat: this.stage.depthFormat,
      depth: this.stage.savedFrameDepth
        ? structuredClone(this.stage.savedFrameDepth)
        : this.stage.frameDepth && this.gpu.snapshotDepthStencil(this.stage.frameDepth),
    };
  }
  restore(state) {
    this.releaseCaptures({ producer: false });
    this.captures = [...state.captures];
    this.prepared = state.prepared;
    this.stage.restoreSurfaces(state.surfaces);
    this.stage.depthFormat = state.depthFormat;
    if (state.backbuffer && this.gpu)
      this.gpu.uploadRenderTarget(this.gpu.primaryTarget, {
        width: state.backbuffer.width,
        height: state.backbuffer.height,
        rgba: decodeSparseBytes(state.backbuffer.pixels),
      });
    if (this.stage.frameDepth) this.gpu.destroyDepthStencil(this.stage.frameDepth);
    this.stage.frameDepth = null;
    this.stage.savedFrameDepth = null;
    if (state.depth) {
      if (!this.gpu) this.stage.savedFrameDepth = state.depth;
      else this.gpu.restoreDepthStencil(this.stage.screenDepth(), state.depth);
    }
  }
  close() {
    this.releaseCaptures();
  }
}
