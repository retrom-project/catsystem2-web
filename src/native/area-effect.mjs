// SPDX-License-Identifier: MPL-2.0
import { mapABIMessage } from './abi/messages.mjs';
import { installNativeAreaEffectCommands } from './area-effect-commands.mjs';
import { NATIVE_UNWRITTEN_WORD } from './engine-message.mjs';
import { NativeBitmap } from './image.mjs';
import { flipBitmapRows } from './raster-kernel.mjs';
import { blendAreaPixels, physicalPixel, prepareAreaWipeSource } from './area-effect-pixels.mjs';
import { truncateFloat32 } from '../ppi/numeric.mjs';
import { bitsFloat } from '../kcs.mjs';
import { MOTION_ABI, setMotionVector } from '../motion/abi.mjs';
import {
  rasterParameters,
  rasterVertices,
  glassShards,
  advanceGlass,
  glassVertices,
  rainDrop,
  advanceRain,
  rainGeometry,
} from './area-effect-geometry.mjs';
const f = Math.fround,
  initializers = new Map(
    [265, 263, 266, 267, 268, 269, 270, 271, 272, 274, 275, 276, 274, 277, 278].map(
      (message, i) => [i + 17, message],
    ),
  ),
  sizes = new Map([
    [260, 20],
    [263, 20],
    [264, 20],
    [266, 40],
    [267, 12],
    [274, 56],
    [275, 44],
    [276, 48],
    [277, 60],
    [278, 52],
  ]),
  emptyReceivers = new Set([17, 22, 23, 24]),
  logicStubs = new Set([17, 21, 22, 23, 24, 25]),
  cpuKinds = new Set([26, 27, 28, 29, 30, 31]),
  speeds = [1, 1.5, 2, 3, 4];
export const NATIVE_AREA_EFFECT_KINDS = Object.freeze([...initializers.keys()]);
export function areaEffectRawMessage(profile, message) {
  return mapABIMessage(profile, 'area', 'raw', message);
}
export class NativeAreaEffects {
  constructor(world) {
    this.world = world;
    this.tasks = new Map();
  }
  async create(record, { restoring = false } = {}) {
    const task = new NativeAreaEffectTask(this, record);
    this.tasks.set(record.id, task);
    if (!restoring) record.flags = record.kind;
    return task;
  }
}
export class NativeAreaEffectTask {
  constructor(owner, record) {
    this.owner = owner;
    this.world = owner.world;
    this.record = record;
    this.base = this.world.base(record);
    this.state = {
      initialized: false,
      active: 0,
      params: record.kind === 20 ? [0, 0, 0] : [],
      work: 0,
      imports: [],
      start: 0,
      duration: 1,
      blendDuration: 1,
      width: 0,
      height: 0,
      source: 0,
      destination: 0,
      mask: 0,
      sourceOrigin: [0, 0],
      destinationOrigin: [0, 0],
      maskOrigin: [0, 0],
      output: [0, 0],
      fadeIn: false,
      capability: this.world.graphics.view.active,
      geometry: record.kind === 18 ? rasterParameters([0, 0, 0, 0, 0], record.frameRate) : null,
      shards: [],
      drops: [],
      lastClock: 0,
    };
  }
  get runsBaseLogic() {
    return !logicStubs.has(this.record.kind);
  }
  clock() {
    return ((this.record.effectiveFrame ?? 0) - (this.record.pausedFrames ?? 0)) >>> 0;
  }
  async releaseWork() {
    if (this.state.work) await this.world.graphics.images.release(this.state.work);
    this.state.work = 0;
    for (const { handle } of this.state.imports) await this.world.graphics.images.release(handle);
    this.state.imports = [];
  }
  async readPacket(message, l, context) {
    const size =
        message === 260
          ? this.record.kind === 30
            ? 24
            : this.record.kind === 31
              ? 12
              : 20
          : sizes.get(message),
      memory =
        context.payload ??
        context.machine ??
        this.world.objects.machine(context.nativeSenderWorldID);
    if (context.nativeNullPayload || (context.nativePointer && !l)) return null;
    const bytes = memory.bytes ? memory.bytes(l, size) : memory.read(l, size),
      view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
    return Array.from({ length: size / 4 }, (_, i) => view.getUint32(i * 4, true));
  }
  async bitmap(handle, context) {
    if (!handle) return 0;
    if (!context.nativePointer) return handle;
    const projection = await this.world.getNativeFeature('fes-draw-projection'),
      imported = projection.wrapper(handle);
    this.state.imports.push({ wrapper: handle, handle: imported });
    return imported;
  }
  async message(words, context = {}) {
    const [, message, , l] = words,
      kind = this.record.kind,
      state = this.state;
    if (emptyReceivers.has(kind)) {
      context.nativeUnhandled = false;
      return NATIVE_UNWRITTEN_WORD;
    }
    if (!cpuKinds.has(kind)) {
      if ([18, 19, 20].includes(kind)) return this.geometryMessage(words, context);
      return this.base.message(words, context);
    }
    if (message === 259) {
      context.nativeUnhandled = false;
      return state.active;
    }
    if (message === initializers.get(kind)) {
      context.nativeUnhandled = false;
      await this.initialize(await this.readPacket(message, l, context), context);
      return NATIVE_UNWRITTEN_WORD;
    }
    if (message === 260) {
      context.nativeUnhandled = false;
      const params = await this.readPacket(message, l, context);
      if (params) {
        const extended = kind === 30 || kind === 31,
          offset = extended ? 2 : 1;
        const before = state.imports.length;
        let source, destination;
        try {
          source = await this.bitmap(params[offset], context);
          destination =
            kind === 28 || kind === 31
              ? state.destination
              : await this.bitmap(params[offset + 3], context);
        } catch (error) {
          for (const { handle } of state.imports.splice(before))
            await this.world.graphics.images.release(handle);
          throw error;
        }
        state.source = state.params[offset] = source;
        state.destination = destination;
        if (kind !== 28 && kind !== 31) state.params[offset + 3] = destination;
        const live = new Set([state.source, state.destination, state.mask]);
        for (const imported of state.imports.filter(({ handle }) => !live.has(handle)))
          await this.world.graphics.images.release(imported.handle);
        state.imports = state.imports.filter(({ handle }) => live.has(handle));
        if (kind === 27 && source && destination) {
          const input = this.world.graphics.images.get(source),
            target = this.world.graphics.images.get(destination);
          if (
            input.width !== target.width ||
            input.height !== target.height ||
            input.state.bpp !== 4 ||
            target.state.bpp !== 4
          )
            this.world.host.nativeDiagnostic?.({
              type: 'area-effect-format',
              kind,
              operation: 'replace',
            });
        }
      }
      return NATIVE_UNWRITTEN_WORD;
    }
    if (message === 257 || message === 258 || message === 261) {
      context.nativeUnhandled = false;
      if (message === 257) {
        if (state.initialized) {
          state.active = 1;
          state.start = this.clock();
          state.speed = this.effectSpeed();
        }
      } else if (state.initialized && (message === 258 || state.active)) await this.finish();
      return NATIVE_UNWRITTEN_WORD;
    }
    return this.base.message(words, context);
  }
  async geometryMessage(words, context) {
    const [, message, , l] = words,
      state = this.state,
      kind = this.record.kind;
    const accepted =
      kind === 18
        ? [257, 258, 259, 263, 264]
        : kind === 19
          ? [257, 258, 259, 266]
          : [257, 258, 259, 267];
    if (!accepted.includes(message)) return this.base.message(words, context);
    if (!state.capability) return this.base.message(words, context);
    context.nativeUnhandled = false;
    if (message === 259) return state.active;
    if (message === initializers.get(kind) || (kind === 18 && message === 264)) {
      const params = await this.readPacket(message, l, context);
      if (!params) throw new RangeError('Area geometry initializer has no translated packet');
      if (kind === 18) {
        if (message === 263) {
          state.params = params;
          state.geometry = rasterParameters(params, this.record.frameRate);
        } else {
          state.params.splice(2, 3, ...params.slice(2, 5));
          state.geometry = rasterParameters(state.params, this.record.frameRate);
        }
      } else if (kind === 20) state.params = params;
      else await this.initializeRain(params);
      return NATIVE_UNWRITTEN_WORD;
    }
    if (message === 257) await this.startGeometry();
    if (message === 258) await this.stopGeometry();
    // CB and foreign area controls have no geometry receiver branch.
    return NATIVE_UNWRITTEN_WORD;
  }
  async initializeRain(params) {
    const state = this.state,
      values = params.map(bitsFloat);
    state.params = params;
    state.rain = {
      width: values[0],
      depth: values[1],
      height: values[2],
      priority: params[3],
      minLength: values[5],
      maxLength: values[4],
      speed: values[6],
      count: params[7],
      capacity: params[8],
      color: params[9],
    };
    if (state.initialized) return;
    if (await this.world.graphics.effectModel(this.record.nativeID)) {
      state.capability = false;
      return;
    }
    if (state.rain.count > state.rain.capacity || state.rain.capacity > 262144)
      throw new RangeError('Rain drop count exceeds its owned vertex capacity');
    state.drops = Array.from({ length: state.rain.capacity }, (_, i) =>
      i < state.rain.count
        ? rainDrop(state.rain, this.world.random, true)
        : Array.from({ length: 2 }, () => ({ x: 0, y: 0, z: 0, w: 0, color: 0 })),
    );
    state.rainProjection = {
      center: [f(state.rain.width * 0.5), f(state.rain.height * 0.5), 0],
      priority: state.rain.priority,
    };
    state.initialized = true;
    this.createRainGraph();
  }
  createRainGraph() {
    const state = this.state,
      plane = this.world.graphics.customGraph(this.record, {
        width: state.rain.width,
        height: state.rain.height,
        drawGPU: (gpu) => {
          if (!state.active || !state.rainBound) return;
          gpu.drawGeometry(
            rainGeometry(state, this.world.graphics.projection()),
            { width: 1, height: 1, rgba: Uint8Array.of(255, 255, 255, 255) },
            {
              context: this.world.graphics.d3dContext,
              drawType: 0,
              lineViewport: [0, 0, this.world.game.width, this.world.game.height],
            },
          );
        },
      });
    this.rainGraph = plane;
    this.showRain();
  }
  showRain() {
    const plane = this.rainGraph;
    if (!plane) return;
    plane.state.shown = Boolean(this.state.active);
    setMotionVector(plane.graph.kx2, MOTION_ABI.base, [0, 0, this.state.rainProjection.priority]);
    plane.sync();
  }
  async startGeometry() {
    const state = this.state,
      kind = this.record.kind;
    if (kind === 19) {
      state.rainBound = Boolean(this.rainGraph);
      state.active = 1;
      state.start = state.lastClock = this.clock();
      this.showRain();
      return;
    }
    const nativeID = kind === 18 ? state.geometry?.graph : state.params[0];
    if (nativeID === undefined) return;
    const model = await this.world.graphics.effectModel(nativeID);
    if (kind === 20) {
      const triangles = model?.triangles() ?? [];
      if (!triangles.length) {
        state.capability = false;
        state.active = 0;
        return;
      }
      const points = triangles.flat(),
        bounds = [
          Math.min(...points.map((p) => p[0])),
          Math.min(...points.map((p) => p[1])),
          Math.max(...points.map((p) => p[0])),
          Math.max(...points.map((p) => p[1])),
        ];
      state.shards = glassShards(triangles, bounds, bitsFloat(state.params[1]), this.world.random);
    }
    model?.bind(this);
    state.active = 1;
    state.start = state.lastClock = this.clock();
  }
  async stopGeometry() {
    const state = this.state;
    state.active = 0;
    if (this.record.kind === 19) {
      state.rainBound = false;
      this.showRain();
    } else {
      const nativeID = this.record.kind === 18 ? state.geometry?.graph : state.params[0];
      if (nativeID !== undefined) (await this.world.graphics.effectModel(nativeID))?.unbind();
    }
  }
  vertices(vertices, triangle) {
    const state = this.state;
    return this.record.kind === 18
      ? rasterVertices(state.geometry, (this.clock() - state.start) >>> 0, 1, vertices)
      : glassVertices(state.shards[triangle], vertices);
  }
  async tick() {
    const state = this.state;
    if (!state.active || ![19, 20].includes(this.record.kind)) return;
    const clock = this.clock(),
      delta = f((clock - state.lastClock) >>> 0);
    if (this.record.kind === 19) {
      if (state.initialized) advanceRain(state, delta, this.world.random);
    } else {
      advanceGlass(state.shards, delta);
      if ((clock - state.start) >>> 0 >= state.params[2]) await this.stopGeometry();
    }
    state.lastClock = clock;
  }
  async initialize(params, context = {}) {
    const state = this.state,
      kind = this.record.kind,
      images = this.world.graphics.images;
    await this.releaseWork();
    state.initialized = false;
    state.params = params ?? [];
    if (!params) return;
    const alpha = kind === 28 || kind === 31,
      extended = kind === 30 || kind === 31,
      offset = extended ? 2 : 1,
      source = await this.bitmap(params[offset], context),
      destination = alpha ? 0 : await this.bitmap(params[offset + 3], context),
      mask = kind === 27 ? 0 : await this.bitmap(params[alpha ? offset + 3 : offset + 6], context);
    const outputIndex = kind === 27 ? 7 : alpha ? offset + 4 : offset + 7;
    Object.assign(state, {
      source,
      destination,
      mask,
      sourceOrigin: params.slice(offset + 1, offset + 3).map((x) => x | 0),
      destinationOrigin: alpha ? [0, 0] : params.slice(offset + 4, offset + 6).map((x) => x | 0),
      output: params.slice(outputIndex, outputIndex + 2).map((x) => x | 0),
      maskOrigin: params
        .slice(alpha ? offset + 9 : offset + 11, alpha ? offset + 11 : offset + 13)
        .map((x) => x | 0),
      duration: Math.max(1, params[0] | 0),
      blendDuration: extended ? Math.max(1, params[1] | 0) : 1,
      fadeIn: alpha && Boolean(params[offset + 8]),
    });
    if (!source || (!alpha && !destination) || (kind !== 27 && !mask)) return;
    const input = images.get(source),
      target = destination && images.get(destination),
      stencil = mask && images.get(mask);
    if (
      (alpha || kind === 27) &&
      (input.state.bpp !== 4 ||
        (target && target.state.bpp !== 4) ||
        (stencil && stencil.state.bpp !== 4))
    )
      return;
    if (
      [26, 29, 30].includes(kind) &&
      [input, target, stencil].some((image) => image.state.bpp !== 4)
    )
      throw new RangeError('Area wipe DWORD scanlines exceed RGB24 borrowed storage');
    for (const image of [input, target, stencil].filter(Boolean)) image.commitCanvas();
    const [sx, sy] = state.sourceOrigin,
      [dx, dy] = state.destinationOrigin,
      [mx, my] = state.maskOrigin,
      requestedWidth = params[outputIndex + 2] | 0,
      requestedHeight = params[outputIndex + 3] | 0;
    state.width = alpha
      ? requestedWidth
      : kind === 27 && requestedWidth > 0
        ? requestedWidth
        : input.width;
    state.height = alpha
      ? requestedHeight
      : kind === 27 && requestedHeight > 0
        ? requestedHeight
        : input.height;
    state.blendWidth = alpha ? Math.min(stencil.width, state.width - mx) : state.width;
    state.blendHeight = alpha ? Math.min(stencil.height, state.height - my) : state.height;
    if (
      sx < 0 ||
      sy < 0 ||
      dx < 0 ||
      dy < 0 ||
      mx < 0 ||
      my < 0 ||
      state.width <= 0 ||
      state.height <= 0 ||
      state.blendWidth <= 0 ||
      state.blendHeight <= 0 ||
      sx + (alpha ? mx + state.blendWidth : state.width) > input.width ||
      sy + (alpha ? my + state.blendHeight : state.height) > input.height ||
      (target && (dx + state.width > target.width || dy + state.height > target.height)) ||
      (!alpha &&
        stencil &&
        (mx + state.width > stencil.width || my + state.height > stencil.height))
    )
      throw new RangeError('Area effect bitmap rectangle exceeds its borrowed storage');
    if (kind === 30)
      await prepareAreaWipeSource(input, target, state.sourceOrigin, state.destinationOrigin);
    const work = images.create(state.width, state.height, this.record.id),
      bitmap = images.get(work),
      pixels = await bitmap.pixels(),
      sourcePixels = await input.pixels();
    state.work = work;
    for (let y = 0; y < state.height; y++)
      for (let x = 0; x < state.width; x++) {
        const at = physicalPixel(input, sx + x, sy + y),
          out = physicalPixel(bitmap, x, y);
        pixels.set(sourcePixels.subarray(at, at + 4), out);
        if (input.state.bpp === 3) pixels[out + 3] = 255;
        if (alpha && state.fadeIn) pixels[out + 3] = 0;
      }
    await bitmap.changed();
    state.initialized = true;
  }
  effectSpeed() {
    const index = new DataView(
        this.world.configuration.blocks[2].buffer,
        this.world.configuration.blocks[2].byteOffset,
        4,
      ).getUint32(0, true),
      speed = speeds[index];
    if (speed === undefined) throw new RangeError('Area effect speed is outside the engine table');
    return speed;
  }
  elapsed() {
    return truncateFloat32(f(f((this.clock() - this.state.start) >>> 0) * this.state.speed)) >>> 0;
  }
  async refreshImports() {
    if (!this.state.imports.length) return;
    const projection = await this.world.getNativeFeature('fes-draw-projection');
    for (const { wrapper } of this.state.imports)
      await projection.refreshBitmap(projection.process.load(wrapper));
  }
  async calculate(elapsed) {
    const state = this.state,
      images = this.world.graphics.images;
    await this.refreshImports();
    const read = async (handle) => (handle ? images.get(handle).frame() : null),
      source = await read(state.source),
      destination = await read(state.destination),
      mask = await read(state.mask),
      work = images.get(state.work);
    blendAreaPixels(
      { ...state, kind: this.record.kind, source, destination, mask, elapsed },
      await work.pixels(),
    );
    await work.changed();
  }
  async upload(handle, origin = [0, 0], offset = null) {
    const state = this.state,
      bitmap = this.world.graphics.images.get(handle),
      frame = await bitmap.frame(),
      rgba = flipBitmapRows(frame.rgba, frame.width, frame.height);
    if (bitmap.state.bpp === 3) for (let at = 3; at < rgba.length; at += 4) rgba[at] = 255;
    const physical = new NativeBitmap(this.world.graphics.images, {
      ...bitmap.state,
      rgba,
    });
    await this.world.graphics.output(
      physical,
      offset ?? [state.output[0] - origin[0], state.output[1] - origin[1]],
      [
        origin[0],
        origin[1],
        Math.min(frame.width, origin[0] + state.width),
        Math.min(frame.height, origin[1] + state.height),
      ],
    );
  }
  async finish() {
    const state = this.state,
      alpha = this.record.kind === 28 || this.record.kind === 31;
    if (alpha)
      await this.calculate(
        state.duration + ([30, 31].includes(this.record.kind) ? state.blendDuration : 0),
      );
    await this.upload(
      alpha ? state.work : state.destination,
      alpha ? [0, 0] : state.destinationOrigin,
      alpha ? state.output.map((n, i) => n + state.maskOrigin[i]) : null,
    );
    state.active = 0;
  }
  async drawTick() {
    const state = this.state;
    if (!cpuKinds.has(this.record.kind)) return;
    if (!state.active || !state.initialized) return;
    const elapsed = this.elapsed(),
      end = state.duration + ([30, 31].includes(this.record.kind) ? state.blendDuration : 0);
    if (elapsed >= end) {
      if (this.record.kind === 28 || this.record.kind === 31) {
        state.maskOrigin = [0, 0];
        await this.upload(state.work);
      } else await this.upload(state.destination, state.destinationOrigin);
      state.active = 0;
      return;
    }
    await this.calculate(elapsed);
    await this.upload(
      state.work,
      this.record.kind === 28 || this.record.kind === 31 ? state.maskOrigin : [0, 0],
      this.record.kind === 28 || this.record.kind === 31 ? state.output : null,
    );
  }
  snapshot() {
    return { state: structuredClone(this.state), rainGraph: this.rainGraph?.snapshot() ?? null };
  }
  restore(saved) {
    this.state = structuredClone(saved.state);
    if (saved.rainGraph) {
      const sequence = this.world.graphics.renderSequence;
      this.createRainGraph();
      this.rainGraph.restore(saved.rainGraph);
      this.world.graphics.renderSequence = sequence;
    }
  }
  async close() {
    if (this.closed) return;
    if ([18, 19, 20].includes(this.record.kind) && this.state.capability) await this.stopGeometry();
    this.rainGraph?.closeGraph();
    await this.releaseWork();
    this.owner.tasks.delete(this.record.id);
    this.closed = true;
  }
}
export function installNativeAreaEffects(world) {
  const area = (world.areaEffects = new NativeAreaEffects(world));
  for (const kind of NATIVE_AREA_EFFECT_KINDS)
    world.objects.register(kind, (record, _objects, options) => area.create(record, options));
  installNativeAreaEffectCommands(world);
}
