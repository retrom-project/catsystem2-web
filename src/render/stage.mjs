// SPDX-License-Identifier: MPL-2.0
// Stage placement and pixel effects adapted from CatSystemKit StageLayout (OWCramer).
import { StageSurfaces } from './surfaces.mjs';
import { ParticlesGL, createD3DContext } from './particles-gl.mjs';
function boxBlur(pixels, width, height, radius, horizontal) {
  const count = horizontal ? width : height,
    lines = horizontal ? height : width,
    step = horizontal ? 4 : width * 4,
    span = radius * 2 + 1;
  for (let l = 0; l < lines; l++) {
    const start = horizontal ? l * width * 4 : l * 4,
      line = new Uint8Array(count * 4),
      sum = [0, 0, 0, 0];
    for (let i = 0; i < count; i++)
      for (let c = 0; c < 4; c++) line[i * 4 + c] = pixels[start + i * step + c];
    for (let k = -radius; k <= radius; k++)
      for (let c = 0; c < 4; c++) sum[c] += line[Math.max(0, Math.min(count - 1, k)) * 4 + c];
    for (let i = 0; i < count; i++)
      for (let c = 0; c < 4; c++) {
        pixels[start + i * step + c] = Math.floor(sum[c] / span);
        sum[c] +=
          line[Math.min(count - 1, i + radius + 1) * 4 + c] - line[Math.max(0, i - radius) * 4 + c];
      }
  }
}
export class StageRenderer {
  dispose() {
    if (this.disposed) return;
    this.disposed = true;
    this.gpu?.close();
    this.effects = new WeakMap();
    if (this.plane) this.plane.width = this.plane.height = this.mask.width = this.mask.height = 0;
    this.surfaces.records.clear();
    this.surfaceTargets.clear();
    this.surfaceDepths.clear();
    this.surfaceFrames.clear();
    this.frameDepth = null;
  }
  constructor(renderer, emote) {
    this.surfaces = new StageSurfaces();
    this.surfaceTargets = new Map();
    this.surfaceDepths = new Map();
    this.surfaceFrames = new Map();
    this.depthFormat = 80;
    this.frameDepth = null;
    this.savedFrameDepth = null;
    this.d3dContext = createD3DContext();
    this.effects = new WeakMap();
    if (renderer) this.attach(renderer, emote);
  }
  attach(renderer, emote) {
    if (this.renderer) throw new Error('Stage renderer already has a presentation target');
    this.renderer = renderer;
    this.emote = emote;
    this.plane = new OffscreenCanvas(renderer.canvas.width, renderer.canvas.height);
    this.mask = new OffscreenCanvas(renderer.canvas.width, renderer.canvas.height);
    this.gpu = new ParticlesGL(renderer.canvas.width, renderer.canvas.height);
  }
  async withPluginTarget(device, callback) {
    if (!this.gpu || device.gpu !== this.gpu)
      throw new Error('Plugin rendering requires the StageRenderer device');
    const target = this.gpu.target,
      depth = target.stageSurface ? this.surfaceDepth(target.stageSurface) : this.screenDepth();
    return device.withStageTarget(target, callback, depth);
  }
  createSurface(width, height, rgba) {
    const id = this.surfaces.create({ width, height, pitch: width * 4, format: 'rgba8' });
    if (rgba) this.surfaces.get(id).bytes.set(rgba);
    return id;
  }
  surfaceTarget(id) {
    if (!this.gpu) throw new Error('Stage surface drawing requires a GPU');
    let target = this.surfaceTargets.get(id);
    if (!target) {
      const surface = this.surfaces.get(id);
      const frame = this.surfaceFrames.get(id);
      if (frame) this.gpu.releaseTextureFrame(frame);
      this.surfaceFrames.delete(id);
      target = this.gpu.createRenderTarget(surface.width, surface.height, surface.bytes);
      target.stageSurface = id;
      this.surfaceTargets.set(id, target);
    }
    return target;
  }
  surfaceDepth(id) {
    let depth = this.surfaceDepths.get(id);
    if (!depth) {
      const surface = this.surfaces.get(id);
      depth = this.gpu.createDepthStencil(
        surface.width,
        surface.height,
        surface.depthStencil?.format ?? this.depthFormat,
      );
      this.surfaceDepths.set(id, depth);
      if (surface.depthStencil) this.gpu.restoreDepthStencil(depth, surface.depthStencil);
      else
        this.gpu.withRenderTarget(this.surfaceTarget(id), () => this.gpu.clear({ flags: 6 }), {
          depthStencil: depth,
        });
    }
    return depth;
  }
  screenDepth() {
    const view = this.gpu.primaryTarget;
    if (
      this.frameDepth &&
      (this.frameDepth.width !== view.width ||
        this.frameDepth.height !== view.height ||
        this.frameDepth.format !== this.depthFormat)
    ) {
      this.gpu.destroyDepthStencil(this.frameDepth);
      this.frameDepth = null;
    }
    if (!this.frameDepth) {
      this.frameDepth = this.gpu.createDepthStencil(view.width, view.height, this.depthFormat);
      if (this.savedFrameDepth) {
        this.gpu.restoreDepthStencil(this.frameDepth, this.savedFrameDepth);
        this.savedFrameDepth = null;
      } else
        this.gpu.withRenderTarget(this.gpu.primaryTarget, () => this.gpu.clear({ flags: 6 }), {
          depthStencil: this.frameDepth,
        });
    }
    return this.frameDepth;
  }
  surfaceFrame(id) {
    const surface = this.surfaces.get(id),
      target = this.surfaceTargets.get(id);
    let frame = this.surfaceFrames.get(id);
    if (frame?.revision === (surface.revision ?? 0)) return frame;
    frame = target
      ? { width: surface.width, height: surface.height, nativeTarget: target }
      : { width: surface.width, height: surface.height, rgba: surface.bytes };
    frame.revision = surface.revision ?? 0;
    this.surfaceFrames.set(id, frame);
    return frame;
  }
  surfacePixels(id) {
    const surface = this.surfaces.get(id),
      target = this.surfaceTargets.get(id);
    if (target) surface.bytes.set(this.gpu.pixels(target));
    return surface.bytes;
  }
  writeSurface(id, bytes) {
    const surface = this.surfaces.get(id);
    if (bytes.length !== surface.bytes.length)
      throw new RangeError('Stage surface write dimensions differ');
    surface.bytes.set(bytes);
    surface.revision = (surface.revision ?? 0) + 1;
    const frame = this.surfaceFrames.get(id);
    if (frame) frame.revision = surface.revision;
    const target = this.surfaceTargets.get(id);
    if (target)
      this.gpu.uploadRenderTarget(target, {
        width: surface.width,
        height: surface.height,
        rgba: surface.bytes,
      });
  }
  releaseSurface(id) {
    const target = this.surfaceTargets.get(id);
    if (target) this.gpu.destroyRenderTarget(target);
    const depth = this.surfaceDepths.get(id);
    if (depth) this.gpu.destroyDepthStencil(depth);
    this.surfaceTargets.delete(id);
    this.surfaceDepths.delete(id);
    const frame = this.surfaceFrames.get(id);
    if (frame) this.gpu?.releaseTextureFrame(frame);
    this.surfaceFrames.delete(id);
    this.surfaces.release(id);
  }
  snapshotSurfaces(ids) {
    for (const id of ids) {
      this.surfacePixels(id);
      const depth = this.surfaceDepths.get(id);
      if (depth) this.surfaces.get(id).depthStencil = this.gpu.snapshotDepthStencil(depth);
    }
    return this.surfaces.snapshot(ids);
  }
  restoreSurfaces(records) {
    for (const [id] of records) {
      const target = this.surfaceTargets.get(id);
      if (target) this.gpu.destroyRenderTarget(target);
      this.surfaceTargets.delete(id);
      const depth = this.surfaceDepths.get(id);
      if (depth) this.gpu.destroyDepthStencil(depth);
      this.surfaceDepths.delete(id);
      const frame = this.surfaceFrames.get(id);
      if (frame) this.gpu?.releaseTextureFrame(frame);
      this.surfaceFrames.delete(id);
    }
    this.surfaces.restore(records);
  }
  effect(frame, picture) {
    if (!picture.mode?.length && !picture.tone?.length && !picture.blur?.length)
      return this.renderer.frameCanvas(frame);
    const key = JSON.stringify([picture.mode, picture.tone, picture.blur]);
    let cache = this.effects.get(frame);
    if (!cache) this.effects.set(frame, (cache = new Map()));
    if (cache.has(key)) return cache.get(key);
    const rgba = new Uint8ClampedArray(frame.rgba),
      tone = (picture.tone || [100, 100, 100]).map(Number),
      blur = (picture.blur || [0, 0]).map(Number);
    for (let pass = 0; pass < 2; pass++) {
      if (blur[0] > 0) boxBlur(rgba, frame.width, frame.height, Math.floor(blur[0] / 2), true);
      if ((blur[1] || blur[0]) > 0)
        boxBlur(rgba, frame.width, frame.height, Math.floor((blur[1] || blur[0]) / 2), false);
    }
    for (let i = 0; i < rgba.length; i += 4) {
      const grey = 0.299 * rgba[i] + 0.587 * rgba[i + 1] + 0.114 * rgba[i + 2];
      for (let c = 0; c < 3; c++)
        rgba[i + c] = Math.round(
          ((picture.mode?.[0] === 'sepia' ? grey * [1.07, 0.89, 0.66][c] : rgba[i + c]) *
            (tone[c] ?? 100)) /
            100,
        );
    }
    const canvas = new OffscreenCanvas(frame.width, frame.height);
    canvas.getContext('2d').putImageData(new ImageData(rgba, frame.width, frame.height), 0, 0);
    if (cache.size > 8) cache.clear();
    cache.set(key, canvas);
    return canvas;
  }
  transform(ctx, plane) {
    ctx.translate(plane.x, plane.y);
    if (plane.rotation) ctx.rotate((plane.rotation * Math.PI) / 180);
    ctx.scale(plane.scaleX / 100, plane.scaleY / 100);
    ctx.translate(-plane.baseX, -plane.baseY);
  }
  async picture(stage, plane, picture, context) {
    const p = stage.place(picture),
      ctx = context;
    ctx.save();
    this.transform(ctx, plane);
    ctx.globalAlpha *= p.alpha / 255;
    ctx.translate(p.x, p.y);
    ctx.scale(((p.flipX ? -1 : 1) * p.scaleX) / 100, ((p.flipY ? -1 : 1) * p.scaleY) / 100);
    if (p.color !== null && p.color !== undefined) {
      ctx.fillStyle = `rgba(${(p.color >>> 16) & 255},${(p.color >>> 8) & 255},${p.color & 255},${(p.color >>> 24) / 255})`;
      ctx.fillRect(0, 0, stage.width, stage.height);
    } else if (p.file) {
      const f = await this.renderer.images.frame(p.file, p.frameID);
      ctx.drawImage(this.effect(f, p), f.offsetX - f.baseX, f.offsetY - f.baseY);
    }
    ctx.restore();
  }
  async render(stage, voice, additionalItems = []) {
    if (this.rendering) throw new Error('Stage rendering cannot be reentered');
    this.rendering = true;
    try {
      const r = this.renderer,
        ctx = r.ctx;
      await stage.nativeGraphics?.prepareRender(this);
      const nativeWorld = stage.nativeGraphics?.world,
        effects = nativeWorld?.screenEffects ?? null;
      if (!effects) r.begin();
      this.gpu.beginFrame(0xff000000, { preserve: Boolean(effects) });
      this.currentD3DContext = stage.nativeGraphics?.d3dContext || this.d3dContext;
      this.gpu.frameContext = this.currentD3DContext;
      const actors = Object.entries(stage.actors || {});
      if (actors.length && !this.emote)
        throw new Error('Stage actors require a model rendering provider');
      if (this.emote) await this.emote.prepare(stage);
      const ordered = [
        ...Object.entries(stage.planes).map(([n, p]) => ({
          type: 'plane',
          n,
          p,
          priority: p.priority,
          order: p.nativeGraph?.renderOrder ?? 0,
        })),
        ...actors.map(([n, p]) => ({
          type: 'actor',
          n,
          p,
          priority: p.priority,
        })),
        ...[...(stage.nativeGraphics?.drawItems() ?? []), ...additionalItems].map((item, index) => {
          if (
            !Number.isFinite(item.priority) ||
            (typeof item.draw !== 'function' && typeof item.drawGPU !== 'function')
          )
            throw new Error('Invalid additional stage draw item');
          return { ...item, order: item.nativeRenderOrder ?? item.order ?? index };
        }),
      ].sort(
        (a, b) =>
          a.priority - b.priority ||
          (a.order ?? 0) - (b.order ?? 0) ||
          Number(a.type === 'actor') - Number(b.type === 'actor') ||
          Number(a.n) - Number(b.n),
      );
      const draw = (item, gpu = this.gpu, options = {}) =>
        this.drawItem(stage, voice, item, gpu, options);
      let presentation = null;
      const overlays = [];
      if (effects) {
        await effects.rendering.render(
          ordered,
          (item, gpu) =>
            draw(item, gpu, { fromHost: Boolean(nativeWorld?.nativeEngine?.process.asyncEnabled) }),
          (request) => {
            presentation = request;
            return this.presentNative(request);
          },
        );
        for (const item of ordered)
          if (!item.p?.nativeGraph && item.type !== 'particle') {
            if (item.draw) overlays.push(item);
            else await draw(item);
          }
      } else for (const item of ordered) await draw(item);
      if (presentation) {
        await nativeWorld?.screenCapture?.afterPresent();
        this.gpu.endNativeFrame();
        for (const item of overlays) await item.draw(ctx);
      } else if (effects) {
        this.gpu.endNativeFrame();
      } else {
        ctx.reset();
        ctx.drawImage(this.gpu.endFrame(), 0, 0);
      }
    } finally {
      this.rendering = false;
    }
  }

  presentNative({ device, source, destination, window, dirty, stageTarget }) {
    if (stageTarget) {
      const ctx = this.renderer.ctx;
      ctx.reset();
      ctx.drawImage(this.gpu.presentTarget(stageTarget), 0, 0);
      return 0;
    }
    const p = device.process,
      ctx = this.renderer.ctx,
      record = device.surfaceData(device.backbuffer),
      target = device.gpuTarget(device.backbuffer),
      rectangle = (pointer, fallback) =>
        pointer ? Array.from({ length: 4 }, (_, i) => p.load(pointer + i * 4) | 0) : fallback;
    if (window && window !== device.presentation[7])
      throw new Error('Native presentation targets an unknown window');
    if (dirty) p.read(dirty, 32);
    const src = rectangle(source, [0, 0, record.width, record.height]),
      dst = rectangle(destination, [0, 0, this.renderer.canvas.width, this.renderer.canvas.height]);
    const canvas = this.gpu.presentTarget(target);
    ctx.reset();
    if (src[2] > src[0] && src[3] > src[1] && dst[2] > dst[0] && dst[3] > dst[1])
      ctx.drawImage(
        canvas,
        src[0],
        src[1],
        src[2] - src[0],
        src[3] - src[1],
        dst[0],
        dst[1],
        dst[2] - dst[0],
        dst[3] - dst[1],
      );
    return 0;
  }
  async drawItem(stage, voice, item, gpu = this.gpu, options = {}) {
    if (item.drawGPU) {
      await item.drawGPU(gpu, options);
      return;
    }
    if (item.draw) {
      const off = this.plane.getContext('2d');
      off.reset();
      await item.draw(off);
      this.drawCanvas(this.plane);
      return;
    }
    if (item.p.nativeGraph) {
      if (!stage.nativeGraphics) throw new Error('Native graph stage has no graphics owner');
      await stage.nativeGraphics
        .get(item.p?.nativeTaskWorldID ?? Number(item.n))
        .drawGPU(gpu, options);
      return;
    }
    const p = stage.place(item.p);
    if (!p.visible || p.alpha < 0.5) return;
    if (item.type === 'actor') {
      const d = this.emote.drawing(stage, item.n, voice);
      if (d) {
        this.drawCanvas(this.emote.gpu.render(d.model, d.list, d.alpha));
      }
      return;
    }
    const off = this.plane.getContext('2d');
    off.reset();
    if (p.color !== undefined) {
      off.fillStyle = `rgb(${(p.color >>> 16) & 255},${(p.color >>> 8) & 255},${p.color & 255})`;
      off.fillRect(0, 0, stage.width, stage.height);
    }
    const pictures = p.pictures.toSorted(
      (a, b) =>
        ['bg', 'cg', 'fg', 'fw', 'eg'].indexOf(a.kind) -
          ['bg', 'cg', 'fg', 'fw', 'eg'].indexOf(b.kind) || a.slot - b.slot,
    );
    for (const picture of pictures.filter((p) => !p.mask))
      await this.picture(stage, p, picture, off);
    const mask = pictures.find((p) => p.mask);
    if (mask) {
      const m = this.mask.getContext('2d');
      m.reset();
      await this.picture(stage, p, mask, m);
      off.save();
      off.globalCompositeOperation = 'destination-in';
      off.drawImage(this.mask, 0, 0);
      off.restore();
    }
    this.drawCanvas(this.plane, { alpha: p.alpha, blendMode: p.blendMode });
  }
  drawCanvas(canvas, { alpha = 255, blendMode = 0 } = {}) {
    const width = this.renderer.canvas.width,
      height = this.renderer.canvas.height,
      color = ((Math.max(0, Math.min(255, alpha)) << 24) | 0xffffff) >>> 0;
    this.gpu.drawGeometry(
      [
        {
          vertices: [
            { x: -0.5, y: -0.5, z: 0, w: 1, color, u: 0, v: 0 },
            { x: width - 0.5, y: -0.5, z: 0, w: 1, color, u: 1, v: 0 },
            { x: -0.5, y: height - 0.5, z: 0, w: 1, color, u: 0, v: 1 },
            { x: width - 0.5, y: height - 0.5, z: 0, w: 1, color, u: 1, v: 1 },
          ],
        },
      ],
      canvas,
      { blendMode, context: this.currentD3DContext, drawType: 0 },
    );
  }
}
