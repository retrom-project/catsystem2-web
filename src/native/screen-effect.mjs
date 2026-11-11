// SPDX-License-Identifier: MPL-2.0
import { mapABIMessage } from './abi/messages.mjs';
import { nativeABI } from './abi/index.mjs';
import { bitsFloat, floatBits } from '../kcs.mjs';
import { identity } from '../motion/matrix.mjs';
import { encodeCP932 } from '../kcs/strings.mjs';
import { NATIVE_UNWRITTEN_WORD } from './engine-message.mjs';
import { NativeScreenEffectRenderer, screenQuad } from './screen-effect-render.mjs';
import {
  breakShards,
  breakFrame,
  makePage,
  pageFrame,
  makeCube,
  cubeFrame,
  screenTextureSize,
} from './screen-effect-geometry.mjs';
import {
  shadeGeometry,
  mosaicCache,
  appendMosaicHalf,
  expandMosaic,
  selectMosaic,
} from './screen-effect-pixels.mjs';
import { transformNativeVector } from '../ppi/native-projection-math.mjs';
import { roundX87Single } from '../ppi/x87.mjs';
import { resampleBitmap } from './image.mjs';
import { flipBitmapRows } from './raster-kernel.mjs';
const f = Math.fround;
const initializers = new Map([
    [35, 378],
    [36, 380],
    [37, 382],
    [38, 384],
    [39, 387],
    [50, 516],
    [51, 519],
    [52, 521],
    [57, 390],
    [58, 394],
  ]),
  starts = new Map([
    [35, 379],
    [36, 381],
    [37, 383],
    [38, 385],
    [39, 388],
    [50, 518],
    [51, 520],
    [52, 522],
    [57, 391],
    [58, 395],
  ]),
  payloadWords = new Map([
    [378, 22],
    [380, 9],
    [382, 3],
    [384, 3],
    [387, 5],
    [516, 5],
    [519, 6],
    [521, 7],
    [390, 6],
    [394, 9],
  ]),
  targetCount = new Map([
    [35, 2],
    [36, 2],
    [37, 1],
    [38, 1],
    [39, 1],
    [50, 2],
    [51, 1],
    [52, 1],
    [57, 1],
    [58, 2],
  ]);
export const NATIVE_SCREEN_EFFECT_KINDS = Object.freeze([...initializers.keys()]);
export function screenEffectRawMessage(profile, message) {
  return mapABIMessage(profile, 'screen', 'raw', message);
}
function defaultParameters(kind, width, height) {
  const maximum = floatBits(1000000),
    one = floatBits(1);
  const rows = {
    35: [...identity().map(floatBits), 0, 0, 0, 0, 0, maximum],
    36: [0, 0, 0, 0, one, one, 0, maximum, 0],
    37: [0, 0, maximum],
    38: [0, maximum, 0],
    39: [0, maximum, 0, 0, 0],
    50: [0, maximum, 0, 0, 0],
    51: [0, maximum, 0, 0, 0, 0],
    52: [0, maximum, 0, width, height, floatBits(2), 0],
    57: [0, maximum, 0, 0, 0, 0],
    58: [0, maximum, 0, 0, 0, 0, 0, 0, 0],
  };
  return rows[kind];
}
export class NativeScreenEffects {
  constructor(world) {
    this.world = world;
    this.tasks = new Map();
    this.callback = 0;
    this.importMask = null;
    this.projectCaptures = null;
    this.releaseProducerCaptures = null;
    this.rendering = new NativeScreenEffectRenderer(this);
  }
  async create(record, { restoring = false } = {}) {
    const task = new NativeScreenEffectTask(this, record);
    this.tasks.set(record.id, task);
    try {
      if (!restoring) await task.construct();
      return task;
    } catch (error) {
      await task.close();
      throw error;
    }
  }
  snapshot() {
    return { callback: this.callback, rendering: this.rendering.snapshot() };
  }
  restore(state) {
    this.callback = state.callback;
    this.rendering.restore(state.rendering);
  }
  async close() {
    for (const task of [...this.tasks.values()]) await task.close();
    this.rendering.close();
  }
}
export class NativeScreenEffectTask {
  constructor(owner, record) {
    this.owner = owner;
    this.world = owner.world;
    this.record = record;
    this.base = this.world.base(record);
    this.state = {
      capability: false,
      registered: false,
      active: 0,
      initialized: false,
      params: [],
      minimum: 0,
      maximum: 0,
      duration: 0,
      start: 0,
      end: 0,
      finishFlag: 0,
      lastElapsed: 0,
      firstFrame: true,
      index: 0,
      geometry: null,
      current: null,
      resources: [],
      work: [],
      cache: [],
      mask: 0,
      maskSource: 0,
      lastKey: 0xffffffff,
      lastTargetSlot: 0,
    };
  }
  get stage() {
    return this.world.stageRenderer;
  }
  get rendering() {
    return this.owner.rendering;
  }
  clock() {
    return ((this.record.effectiveFrame ?? 0) - (this.record.pausedFrames ?? 0)) >>> 0;
  }
  register() {
    this.owner.callback = this.record.id;
    this.state.registered = true;
  }
  surface(width, height, pixels) {
    const id = this.stage.createSurface(width, height, pixels);
    this.state.resources.push(id);
    return id;
  }
  releaseSurface(id) {
    if (!id) return;
    this.stage.releaseSurface(id);
    this.state.resources.splice(this.state.resources.indexOf(id), 1);
  }
  async construct() {
    if (encodeCP932(this.record.name + '\0').length > 32)
      throw new RangeError('Screen-effect task name exceeds its Base record');
    this.record.flags = this.record.kind;
    const kind = this.record.kind,
      [width, height] = this.rendering.size();
    this.state.params = defaultParameters(kind, width, height);
    this.state.maximum = 1000000;
    if (kind === 50) {
      this.state.capability = Boolean(width && height && this.world.graphics.view.active);
      return;
    }
    this.state.capability = this.rendering.prepare(targetCount.get(kind));
    if (!this.state.capability) return;
    if (kind === 39 || kind === 51) this.copyWorking(0, 1);
    if (kind === 35) await this.initialize(this.state.params, {});
    if (kind === 37) {
      this.state.radius = 0;
      this.state.geometry = shadeGeometry(width, height, width, height);
      this.state.initialized = true;
    }
    if (kind === 52) this.state.current = [];
    if (kind === 57) await this.initialize(this.state.params, {});
    if (kind === 58) this.state.current = { old: [], next: [] };
    this.register();
  }
  copyWorking(slot, count, releaseShared = true) {
    if (!this.rendering.prepare(count)) {
      this.state.capability = false;
      return false;
    }
    const source = this.rendering.captures[slot],
      surface = this.stage.surfaces.get(source),
      id = this.surface(surface.width, surface.height, this.stage.surfacePixels(source));
    this.releaseSurface(this.state.work[slot]);
    this.state.work[slot] = id;
    if (releaseShared) this.rendering.releaseCaptures();
    return true;
  }
  geometryOptions() {
    const screen = this.world.configuration.screen,
      capture = this.rendering.captures[0],
      texture = capture && this.stage.surfaces.get(capture);
    return {
      currentWidth: screen.currentWidth,
      windowedWidth: screen.width,
      drawingRectangle: [...this.world.graphics.view.drawingRectangle],
      textureWidth: texture?.width ?? screen.currentWidth,
      textureHeight: texture?.height ?? screen.currentHeight,
    };
  }
  async message(words, context = {}) {
    const [sender, message, , l] = words,
      kind = this.record.kind,
      state = this.state;
    if (message === 3) {
      await this.close();
      return this.base.message(words, context);
    }
    if (message === 377) {
      context.nativeUnhandled = false;
      return !state.capability && [38, 52, 57].includes(kind) ? 0 : state.active;
    }
    const initialize = initializers.get(kind) === message,
      start = starts.get(kind) === message,
      finish =
        (kind === 38 && message === 386) ||
        (kind === 52 && message === 523) ||
        (kind === 57 && message === 392),
      prepare = kind === 50 && message === 517;
    if (!initialize && !start && !finish && !prepare && !(kind === 58 && message === 393))
      return this.base.message(words, context);
    context.nativeUnhandled = false;
    if (!state.capability) return NATIVE_UNWRITTEN_WORD;
    if (initialize) {
      const memory =
          context.payload ??
          context.machine ??
          this.world.objects.machine(context.nativeSenderWorldID ?? sender),
        size = payloadWords.get(message) * 4,
        bytes = memory.bytes ? memory.bytes(l, size) : memory.read(l, size),
        view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength),
        params = Array.from({ length: size / 4 }, (_, i) => view.getUint32(i * 4, true));
      await this.initialize(params, context);
    } else if (start) {
      state.active = l >>> 0;
      state.start = this.clock();
      state.end = (state.start + state.duration) >>> 0;
      state.lastElapsed = 0;
      state.firstFrame = true;
      state.lastKey = 0xffffffff;
    } else if (finish) state.finishFlag = 1;
    else if (prepare && this.copyWorking(1, 2)) {
      const rows = this.cacheRows(this.state.work[1], state.duration >>> 1, state.params[3]);
      state.cache = appendMosaicHalf(state.cache, rows, state.duration >>> 1);
    }
    return NATIVE_UNWRITTEN_WORD;
  }
  clearCache() {
    for (const row of this.state.cache) this.releaseSurface(row.surface);
    this.state.cache = [];
  }
  cacheRows(id, count, maximum, fade = false) {
    const surface = this.stage.surfaces.get(id);
    return mosaicCache(
      this.stage.surfacePixels(id),
      surface.width,
      surface.height,
      count,
      maximum,
      fade,
    ).map(({ pixels, ...row }) => ({
      ...row,
      slot: 0,
      surface: this.surface(row.width, row.height, pixels),
    }));
  }
  async initialize(params, context) {
    const state = this.state,
      kind = this.record.kind,
      [width, height] = this.rendering.size();
    state.params = [...params];
    if (kind === 35) {
      state.minimum = bitsFloat(params[20]);
      state.maximum = bitsFloat(params[21]);
    } else if (kind === 36) {
      const screen = this.world.configuration.screen,
        scaled = params
          .slice(0, 4)
          .map((word, i) =>
            f(
              bitsFloat(word) *
                f(
                  i % 2 ? screen.currentHeight / screen.height : screen.currentWidth / screen.width,
                ),
            ),
          );
      state.minimum = bitsFloat(params[6]);
      state.maximum = bitsFloat(params[7]);
      if (!state.geometry) {
        const [x, y, w, h] = scaled,
          tw = screenTextureSize(width),
          th = screenTextureSize(height),
          color = params[8],
          vertices = screenQuad(w, h, tw, th, color)[0].vertices;
        vertices.forEach((v, i) => {
          v.x = f(v.x + x);
          v.y = f(v.y + y);
          v.u = i % 2 ? f(f(x + w) / tw) : 0;
          v.v = i > 1 ? f(f(y + h) / th) : 0;
        });
        state.geometry = [{ vertices }];
      }
    } else if (kind === 37) {
      state.radius = Math.min(4, params[0] | 0);
      state.minimum = bitsFloat(params[1]);
      state.maximum = bitsFloat(params[2]);
      state.geometry = shadeGeometry(width, height, width, height, state.radius);
    } else {
      state.minimum = bitsFloat(params[0]);
      state.maximum = bitsFloat(params[1]);
      state.duration = params[2];
      if (kind === 39) {
        let handle = params[3],
          imported = 0;
        if (context.nativePointer) {
          if (!this.owner.importMask)
            throw new Error('FES screen mask requires its registered producer projection');
          imported = handle = await this.owner.importMask(handle);
        }
        const images = this.world.graphics.images,
          bitmap = images.get(handle);
        try {
          bitmap.commitCanvas();
          const pixels = resampleBitmap(
            flipBitmapRows(await bitmap.pixels(), bitmap.width, bitmap.height),
            bitmap.width,
            bitmap.height,
            width,
            height,
          );
          const previousMask = state.mask,
            previousSource = state.maskSource,
            source = images.alias(handle, this.record.id);
          try {
            state.mask = this.surface(width, height, pixels);
          } catch (error) {
            await images.release(source);
            throw error;
          }
          state.maskSource = source;
          this.releaseSurface(previousMask);
          if (previousSource) await images.release(previousSource);
        } finally {
          if (imported) await images.release(imported);
        }
        if (!state.duration) throw new RangeError('Screen wipe duration divides by zero');
      } else if (kind === 50) {
        if (state.duration < 2) {
          state.capability = false;
          return;
        }
        this.clearCache();
        if (!this.copyWorking(0, 2, false)) return;
        state.cache = this.cacheRows(state.work[0], state.duration >>> 1, params[3]);
        this.register();
      } else if (kind === 51) {
        this.clearCache();
        state.cache = this.cacheRows(state.work[0], state.duration, params[3], true);
      } else if (kind === 52) {
        state.geometry = {
          shards: breakShards(
            width,
            height,
            params[3],
            params[4],
            bitsFloat(params[5]),
            bitsFloat(params[6]),
            this.world.random,
            this.geometryOptions(),
          ),
        };
        state.current = state.geometry.shards.map((shard) => ({
          vertices: shard.source.map((v) => ({ ...v, z: 0.5, w: 1 })),
        }));
      } else if (kind === 57) {
        state.geometry = makePage(width, height, {
          ...this.geometryOptions(),
          axisAngle: bitsFloat(params[3]),
          radius: bitsFloat(params[4]),
          curlAngle: bitsFloat(params[5]),
        });
        state.current = Array.from({ length: state.geometry.source.length / 3 }, (_, i) => ({
          vertices: state.geometry.source
            .slice(i * 3, i * 3 + 3)
            .map((v) => ({ ...v, z: 0, w: 1 })),
        }));
      } else if (kind === 58) {
        state.geometry = makeCube(width, height, {
          ...this.geometryOptions(),
          maximum: state.maximum,
          gridWidth: params[3],
          gridHeight: params[4],
          gridHeightProduct: nativeABI(this.world.profile).capabilities.cubeFlipGridHeightProduct,
          sweep: bitsFloat(params[5]),
          band: bitsFloat(params[6]),
          axis: bitsFloat(params[7]),
        });
        const collect = (key) =>
          state.geometry.cells.flatMap((cell) => [
            { vertices: cell[key].slice(0, 3) },
            { vertices: cell[key].slice(3, 6) },
          ]);
        state.current = { old: collect('old'), next: collect('next') };
      }
    }
    state.initialized = true;
  }
  async tick() {
    const state = this.state;
    if (!state.active || !state.initialized) return;
    const elapsed = (Math.min(this.clock(), state.end) - state.start) >>> 0;
    if (this.record.kind === 57)
      state.current = pageFrame(state.geometry, elapsed, state.duration, state.maximum);
    if (this.record.kind === 58) state.current = cubeFrame(state.geometry, elapsed, state.duration);
  }
  updateMosaic() {
    const state = this.state,
      row = selectMosaic(state.cache, (this.clock() - state.start) >>> 0, state.lastKey);
    if (!row) return this.record.kind === 51 ? 0 : state.lastTargetSlot;
    if (row.time !== state.lastKey) {
      const [width, height] = this.rendering.size(),
        source = this.stage.surfaces.get(row.surface),
        pixels = expandMosaic(
          source.bytes,
          source.width,
          source.height,
          width,
          height,
          row.q,
          state.params[4],
        );
      this.stage.writeSurface(state.work[row.slot], pixels);
      state.lastKey = row.time;
      state.lastTargetSlot = row.slot;
    }
    return this.record.kind === 51 ? row.alpha : row.slot;
  }
  drawSurface(id, alpha = 255, geometry = null) {
    this.rendering.drawSurface(id, geometry, { color: (((alpha & 255) << 24) | 0xffffff) >>> 0 });
  }
  async renderCapture() {
    const r = this.rendering,
      state = this.state,
      kind = this.record.kind,
      stage = this.stage,
      gpu = r.gpu,
      [width, height] = r.size(),
      current = r.captures[state.index],
      color = kind === 37 ? 0xff000000 : 0;
    await r.drawRange(0, state.minimum);
    const capture = kind === 35 ? current : r.captures[0];
    await r.captureInto(capture, state.minimum, state.maximum, color);
    if (kind === 35 && !state.firstFrame) {
      const target = stage.surfaceTarget(current),
        source = r.captures[1 - state.index],
        matrix = state.params.slice(0, 16).map(bitsFloat),
        offset = state.params.slice(16, 19).map(bitsFloat),
        center = [width >>> 1, height >>> 1],
        geometry = screenQuad(width, height, width, height, state.params[19]);
      for (const v of geometry[0].vertices) {
        const p = transformNativeVector(
          [f(v.x - center[0]), f(v.y - center[1]), v.z, v.w],
          matrix,
          roundX87Single,
        );
        v.x = f(f(offset[0] + p[0]) + center[0]);
        v.y = f(f(offset[1] + p[1]) + center[1]);
        v.z = f(p[2] + offset[2]);
        v.w = p[3];
      }
      await gpu.withRenderTargetAsync(
        target,
        async () => {
          r.clear(0, true);
          r.drawSurface(source, geometry);
        },
        { depthStencil: stage.surfaceDepth(current) },
      );
    }
    if (kind === 36) {
      const first = r.captures[0],
        second = r.captures[1],
        ratio = state.params.slice(4, 6).map(bitsFloat),
        small = structuredClone(state.geometry ?? []),
        large = structuredClone(state.geometry ?? []),
        tw = screenTextureSize(width),
        th = screenTextureSize(height);
      (small[0]?.vertices ?? []).forEach((v) => {
        v.x = f(v.x / ratio[0]);
        v.y = f(v.y / ratio[1]);
        v.color = 0xffffffff;
      });
      (large[0]?.vertices ?? []).forEach((v, i) => {
        v.u = f(small[0].vertices[i].x / tw);
        v.v = f(small[0].vertices[i].y / th);
        v.color = state.params[8];
      });
      await gpu.withRenderTargetAsync(
        stage.surfaceTarget(second),
        async () => {
          r.clear(0);
          r.drawSurface(first, small);
        },
        { depthStencil: stage.surfaceDepth(second) },
      );
      r.clear(0, true);
      r.drawSurface(second, large);
    } else {
      r.clear(0, true);
      r.drawSurface(capture, kind === 37 ? state.geometry : null);
    }
    r.clear(0, true);
    await r.drawRange(state.maximum, 1000000);
    if (kind === 35) {
      state.index = 1 - state.index;
      state.firstFrame = false;
    }
  }
  async renderTransition() {
    const state = this.state,
      kind = this.record.kind,
      r = this.rendering,
      [width, height] = r.size();
    r.clear(0xff000000);
    await r.drawRange(0, state.maximum);
    await r.drawRange(-1, -1);
    r.clear(0, true);
    if (kind === 38) {
      if (state.active)
        state.alpha =
          255 -
          Math.min(
            255,
            Math.floor(
              ((255 * ((this.clock() - state.start) >>> 0)) >>> 0) / Math.max(state.duration, 1),
            ),
          );
      this.drawSurface(r.captures[0], state.alpha ?? 255);
    } else if (kind === 39) {
      const working = state.work[0];
      if (state.active && state.mask) {
        if (!state.duration) throw new RangeError('Screen wipe duration divides by zero');
        const pixels = this.stage.surfacePixels(working).slice(),
          mask = this.stage.surfaces.get(state.mask).bytes,
          elapsed = (this.clock() - state.start) >>> 0;
        for (let at = 0; at < pixels.length; at += 4) {
          if (state.params[4]) {
            pixels[at + 3] =
              mask[at + 2] >= 256 - Math.floor((256 * elapsed) / state.duration) ? 0 : 255;
          } else
            pixels[at + 3] =
              255 -
              Math.max(
                0,
                Math.min(255, Math.floor((512 * elapsed) / state.duration) - 256 + mask[at + 2]),
              );
        }
        this.stage.writeSurface(working, pixels);
      }
      this.drawSurface(working);
    } else if (kind === 50 || kind === 51) {
      const selection = state.active ? this.updateMosaic() : kind === 50 ? 0 : 255;
      this.drawSurface(state.work[kind === 50 ? selection : 0], kind === 51 ? selection : 255);
    } else if (kind === 52) {
      if (state.active && state.initialized)
        state.current = breakFrame(state, this.clock(), width, height);
      r.drawSurface(r.captures[0], state.current, { drawType: 1 });
    } else if (kind === 57) this.drawSurface(r.captures[0], 255, state.current);
    else if (kind === 58 && state.current) {
      r.clear(0, true);
      const background = screenQuad(width, height, width, height, state.params[8]);
      for (const vertex of background[0].vertices) {
        vertex.x = state.initialized ? f(vertex.x + 0.5) : 0;
        vertex.y = state.initialized ? f(vertex.y + 0.5) : 0;
        vertex.z = state.initialized ? 0.5 : 0;
        vertex.w = state.initialized ? 1 : 0;
        vertex.u = vertex.v = 0;
      }
      r.drawFrame({ width: 1, height: 1, rgba: Uint8Array.of(255, 255, 255, 255) }, background, {
        drawType: 1,
      });
      r.clear(0, true);
      this.drawSurface(r.captures[0], 255, state.current.old);
      r.clear(0, true);
      this.drawSurface(r.captures[1], 255, state.current.next);
    }
    r.clear(0, true);
    await r.drawRange(state.maximum, 1000000);
    if (state.active && this.clock() >= state.end) state.active = 0;
  }
  async render() {
    if ([35, 36, 37].includes(this.record.kind)) {
      await this.renderCapture();
    } else await this.renderTransition();
  }
  snapshot() {
    return {
      state: structuredClone(this.state),
      surfaces: this.stage.snapshotSurfaces(this.state.resources),
    };
  }
  restore(snapshot) {
    this.state = structuredClone(snapshot.state);
    this.stage.restoreSurfaces(snapshot.surfaces);
  }
  async close() {
    if (this.closed) return;
    if (this.state.capability) {
      this.owner.callback = 0;
      this.rendering.releaseCaptures();
    }
    for (const id of [...this.state.resources]) this.releaseSurface(id);
    if (this.state.maskSource) await this.world.graphics.images.release(this.state.maskSource);
    this.state.active = 0;
    this.state.capability = false;
    this.owner.tasks.delete(this.record.id);
    this.closed = true;
  }
}
export function installNativeScreenEffects(world) {
  if (world.screenEffects) return;
  const effects = (world.screenEffects = new NativeScreenEffects(world));
  for (const kind of initializers.keys())
    world.objects.register(kind, (record, _objects, options) => effects.create(record, options));
}
