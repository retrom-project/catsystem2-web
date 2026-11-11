// SPDX-License-Identifier: MPL-2.0
// JS owns callback phases, captures and submission. Legacy models enter only
// through the temporary graph traversal until phase6.6 replaces those models.
import { floatBits } from '../kcs.mjs';
import { advanceD3DContext } from '../ppi/render-state.mjs';
const nativeItem = (item) => Boolean(item.p?.nativeGraph || item.type === 'particle');
const compare = (a, b) =>
  a.priority - b.priority || (a.order ?? 0) - (b.order ?? 0) || Number(a.n) - Number(b.n);
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
    return this.world.getNativeGPU();
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
        .map(([n, p]) => ({ n, p, priority: p.priority })),
      ...(this.world.particles?.drawItems() ?? []),
    ].sort(compare);
    return {
      items,
      draw: async (item, gpu) => {
        if (item.drawGPU) await item.drawGPU(gpu, { fromHost: true });
        else await this.world.graphics.get(Number(item.n)).drawGPU(gpu, { fromHost: true });
      },
    };
  }
  paused() {
    const world = this.world,
      platform = world.nativeEngine?.features.get('graphics-platform');
    // The existing view remains a movie/FES consumer until the graph removal.
    return Boolean(
      world.graphics.view.paused ||
        (platform?.refs.view && world.nativeEngine.process.load(platform.refs.view + 12)),
    );
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
    const engine = this.world.nativeEngine,
      platform = engine?.features.get('graphics-platform'),
      device = engine?.features.get('renderer')?.d3d;
    if (platform?.refs.view3D) {
      const p = engine.process,
        output = p.allocate(4, true);
      platform.graphRendering.frameProvider = () => this.currentFrame();
      platform.sync();
      try {
        const target = this.gpu.target,
          depth = target.stageSurface
            ? this.stage.surfaceDepth(target.stageSurface)
            : this.stage.screenDepth();
        return await device.withStageTarget(
          target,
          () => platform.graphRendering.draw([output, floatBits(minimum), floatBits(maximum)]),
          depth,
        );
      } finally {
        platform.pull();
        p.free(output);
      }
    }
    const frame = this.currentFrame();
    for (const item of frame.items)
      if (minimum <= item.priority && item.priority < maximum) await frame.draw(item, this.gpu);
  }
  async prepareModels() {
    const platform = this.world.nativeEngine?.features.get('graphics-platform');
    // Until phase6.6, original graph models initialize the device. Complete
    // that boundary before choosing targets, clearing or copying captures.
    if (platform && !platform.refs.view3D) await platform.ensureRenderer();
  }
  clear(color, depthOnly = false) {
    const enabled = this.world.graphics.d3dContext.depthStencilEnabled;
    if (!depthOnly || enabled)
      this.gpu.clear({ flags: (depthOnly ? 0 : 1) | (enabled ? 2 : 0), color });
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
    this.frame = { items: items.filter(nativeItem), draw };
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
