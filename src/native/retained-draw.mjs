// SPDX-License-Identifier: MPL-2.0
// Retained sources, ANM clocks and Draw composition share the JS resource graph.
import { nativeABI } from './abi/index.mjs';
import { truncateFloat32 } from '../ppi/numeric.mjs';
import { bitsFloat, floatBits } from '../kcs.mjs';
import { NativeBitmap } from './image.mjs';
import { RetainedAnimation } from './retained-animation.mjs';
import { rasterizeRetainedBitmap, flipBitmapRows } from './raster-kernel.mjs';

const MAX_FORCE_SOURCE_BYTES = 2 * 1024 * 1024;

function readyRasterSources(graphics, bitmap, pixels, items) {
  const { images, vramHandle } = graphics;
  if (vramHandle) {
    const record = images.handles.records.get(vramHandle),
      vram = record?.type === 'bitmap' ? record.value : null,
      state = vram && images.handles.records.get(vram.dataHandle);
    if (state?.type !== 'bitmap-data') return null;
    const rgba = Object.getOwnPropertyDescriptor(state.value, 'rgba');
    if (
      vram.dataHandle === bitmap.dataHandle ||
      vram.blit !== NativeBitmap.prototype.blit ||
      rgba?.get ||
      rgba?.value?.buffer === pixels.buffer
    )
      return null;
  }
  const layers = [];
  for (const item of items) {
    const source = images.get(item.image);
    if (
      source.dataHandle === bitmap.dataHandle ||
      source.canvasDirty ||
      source.pixels !== NativeBitmap.prototype.pixels ||
      source.commitCanvas !== NativeBitmap.prototype.commitCanvas
    )
      return null;
    const state = source.state,
      rgba = Object.getOwnPropertyDescriptor(state, 'rgba')?.value;
    if (
      !(rgba instanceof Uint8ClampedArray) ||
      rgba.buffer === pixels.buffer ||
      !item.clip.every(Number.isInteger) ||
      (state.clip && !state.clip.every(Number.isInteger))
    )
      return null;
    layers.push({ item, state, rgba });
  }
  return layers;
}

function forceRasterSources(layers, height) {
  const sources = new Map();
  let bytes = 0;
  for (const { item, state, rgba } of layers) {
    if (!item.visible || !item.alpha || !state.width || !state.height) continue;
    const { width, height: sourceHeight } = state,
      clip = state.clip ?? [0, 0, width, sourceHeight];
    if (
      item.mode !== 0 ||
      state.bpp !== 4 ||
      state.mask ||
      state.blendType ||
      !Number.isSafeInteger(width) ||
      !Number.isSafeInteger(sourceHeight) ||
      clip[0] < 0 ||
      clip[1] < 0 ||
      clip[2] > width ||
      clip[3] > sourceHeight ||
      rgba.byteLength !== width * sourceHeight * 4 ||
      rgba.byteOffset % 4 ||
      !(rgba.buffer instanceof ArrayBuffer)
    )
      return null;
    const x =
        ((state.offsetX | 0) + truncateFloat32(item.position[0]) - truncateFloat32(item.base[0])) |
        0,
      y =
        ((state.offsetY | 0) + truncateFloat32(item.position[1]) - truncateFloat32(item.base[1])) |
        0,
      top = Math.max(0, item.clip[1], y + clip[1]),
      bottom = Math.min(height, item.clip[3], y + clip[3]);
    if (top >= bottom) continue;
    bytes += rgba.byteLength;
    if (bytes > MAX_FORCE_SOURCE_BYTES) return null;
    sources.set(item.key, {
      top,
      bottom,
      shape: [
        item.layer,
        item.alpha,
        state.alphaHint,
        width,
        sourceHeight,
        x,
        y,
        ...item.clip,
        ...clip,
      ],
      pixels: new Uint32Array(rgba.buffer, rgba.byteOffset, rgba.byteLength / 4),
    });
  }
  return sources;
}

function sameForceSource(before, after) {
  if (!after || before.shape.some((value, i) => value !== after.shape[i])) return false;
  const a = before.pixels,
    b = after.pixels;
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) return false;
  return true;
}

function forceRasterBand(before, current, renderer) {
  let [top, bottom] = before.touched;
  const include = (y0, y1) => {
    top = Math.min(top, y0);
    bottom = Math.max(bottom, y1);
  };
  for (const [, y0, , y1] of renderer.dirtyRects) include(y0, y1);
  const covered = (source) => top <= source.top && bottom >= source.bottom;
  for (const [key, source] of before.sources) {
    const next = current.get(key);
    if (next && covered(source) && covered(next)) continue;
    if (sameForceSource(source, next)) {
      next.snapshot = source.pixels;
      continue;
    }
    include(source.top, source.bottom);
    if (next) include(next.top, next.bottom);
  }
  for (const [key, source] of current)
    if (!before.sources.has(key)) include(source.top, source.bottom);
  top = Math.max(top, 0);
  bottom = Math.min(bottom, renderer.height);
  // A full-width band keeps the same left and right transparent RGB borders
  // as a complete paint. Unrelated partial renders may have changed any row
  // they intersected, so their rows are also recomposited here.
  return Number.isInteger(top) &&
    Number.isInteger(bottom) &&
    top < bottom &&
    (bottom - top) * 2 < renderer.height
    ? [0, top, renderer.width, bottom]
    : null;
}

function outputState(state, pixels) {
  const frame = {};
  for (const field of Object.keys(state)) if (field !== 'rgba') frame[field] = state[field];
  frame.rgba = pixels;
  return frame;
}

export class NativeRetainedDraw {
  #lastForce = null;

  constructor(world) {
    this.world = world;
    this.items = new Map();
  }
  get sources() {
    return this.world.renderSources;
  }
  key(draw, key) {
    return `${draw.record.id}:${key >>> 0}`;
  }
  record(draw, key) {
    return this.items.get(this.key(draw, key));
  }
  async fromBitmap(handle) {
    return this.sources.create({ bitmap: this.world.graphics.images.alias(handle) });
  }
  fromLayer(layer) {
    const images = this.world.graphics.images;
    const handle = this.sources.create({
        bitmap: layer.bitmap ? images.alias(layer.bitmap) : 0,
        frames: (layer.animation?.frames ?? []).map((f) => ({
          ...f,
          bitmap: f.bitmap ? images.alias(f.bitmap) : 0,
        })),
        bounds: layer.animation?.bounds ?? null,
        program: layer.program,
      }),
      state = layer.animation?.bounds ?? (layer.bitmap ? images.get(layer.bitmap).state : {});
    Object.assign(this.sources.get(handle), {
      animatedLayer: Boolean(layer.animation),
      baseShown: 1,
      base: [state.baseX ?? 0, state.baseY ?? 0],
    });
    return handle;
  }
  fromOwner(handle) {
    const owner = this.world.imageOwners.get(handle),
      source = this.sources.create({
        bitmap: owner.bitmap ? this.world.graphics.images.alias(owner.bitmap) : 0,
        children: (owner.layers ?? []).map((layer) => this.fromLayer(layer)),
      });
    Object.assign(this.sources.get(source), {
      ownerHandle: handle,
      ownerRevision: owner.rebuild ?? 0,
    });
    return source;
  }
  async fromData(handle) {
    const buffers = this.world.runtime.imageDataBuffers;
    return this.sources.decode(buffers.data(buffers.pointer(handle)));
  }
  async bind(draw, key, fields) {
    const kind = fields.slice(0, 4).findIndex(Boolean);
    if (kind < 0) return false;
    const inputToken = fields[kind];
    let record = this.record(draw, key);
    if (
      record &&
      kind === 1 &&
      nativeABI(this.world.profile).graphics.drawEncodedBindingRebuildsFrames
    ) {
      if (![0, 1, 2].includes(record.kind))
        throw new Error('The encoded Draw rebind source class has no reviewed ABI binding');
      const replacement = await this.fromData(inputToken);
      if (!replacement) return false;
      await this.sources.replaceDecoded(record.source, replacement);
      if (record.kind === 1) record.input = record.inputToken = inputToken;
    } else if (
      !record ||
      (kind !== 2 && (record.kind !== kind || record.inputToken !== inputToken))
    ) {
      let source;
      if (kind === 0) source = await this.fromBitmap(fields[0]);
      else if (kind === 1) source = await this.fromData(fields[1]);
      else if (kind === 2) source = this.sources.retain(fields[2]);
      else source = this.fromOwner(fields[3]);
      if (!source) return false;
      if (record) await this.sources.release(record.source);
      record = {
        surface: draw.record.id,
        key: key >>> 0,
        kind,
        input: fields[kind],
        inputToken,
        source,
      };
      this.items.set(this.key(draw, key), record);
    }
    const source = this.sources.get(record.source);
    Object.assign(source, {
      position: fields.slice(4, 6).map(bitsFloat),
      base: fields.slice(6, 8).map(bitsFloat),
      rotation: bitsFloat(fields[8]),
      scale: fields.slice(9, 11).map(bitsFloat),
      baseAlpha: fields[11] >>> 0,
      baseShown: fields[12] >>> 0,
      mode: fields[13] >>> 0,
    });
    if (fields[14]) source.aux = fields[14];
    source.revision++;
    return this.pull(draw, record);
  }
  async ensure(draw, key) {
    const existing = this.record(draw, key);
    if (existing) return existing;
    const item = draw.entry(key);
    if (!item) return null;
    await this.bind(draw, key, [
      item.image,
      0,
      0,
      0,
      ...item.position.map(floatBits),
      ...item.base.map(floatBits),
      floatBits(item.rotation),
      ...item.scale.map(floatBits),
      item.alpha,
      Number(item.visible),
      item.mode,
      item.aux,
    ]);
    return this.record(draw, key);
  }
  async load(draw, key, name) {
    const record = await this.ensure(draw, key);
    if (!record) return false;
    const bytes = await this.world.imageFiles.readResolved(name);
    if (!bytes?.length) return false;
    try {
      const source = this.sources.get(record.source);
      source.animation = new RetainedAnimation(bytes, this.world.random);
      source.animation.maxFrameKey = Math.max(0, ...source.frames.map((f) => f.key));
      source.outputCache = Object.values(source.animation.output).map((word) => word >>> 0);
      source.hasProgram = true;
      return true;
    } catch (error) {
      this.world.host?.nativeDiagnostic?.({ type: 'invalid-anm', error: error.message });
      return false;
    }
  }
  async enable(draw, key, value) {
    const record = await this.ensure(draw, key);
    if (!record) return;
    const frame = ((draw.record.effectiveFrame ?? 0) - (draw.record.pausedFrames ?? 0)) >>> 0;
    this.sources.get(record.source).animation?.start(frame);
    const enable = (handle) => {
      const source = this.sources.get(handle);
      source.enabled = value >>> 0;
      let changed = false;
      for (const child of source.children)
        if (this.sources.get(child).hasProgram) {
          if (enable(child)) changed = true;
          for (const sibling of source.children) if (this.advance(sibling, frame)) changed = true;
        }
      if (changed) {
        source.groupDirty = true;
        source.revision++;
      }
      return changed;
    };
    enable(record.source);
    await this.update(draw, frame);
  }
  async setAnimationVariable(draw, key, index, value) {
    const record = this.record(draw, key);
    if (!record) return;
    const visit = (handle) => {
      const source = this.sources.get(handle);
      source.animation?.setVariable(index, value);
      for (const child of source.children) visit(child);
    };
    visit(record.source);
  }
  visible(draw, key, value) {
    const record = this.record(draw, key);
    if (record) {
      const source = this.sources.get(record.source);
      source.baseShown = value >>> 0;
      source.revision++;
    }
  }
  clip(draw, key, clip) {
    const record = this.record(draw, key);
    if (record) {
      const source = this.sources.get(record.source);
      source.clip = [...clip];
      source.revision++;
    }
  }
  async refresh(draw, key) {
    const record = await this.ensure(draw, key);
    if (!record) return false;
    const visit = (handle) => {
      const source = this.sources.get(handle),
        enabled = source.enabled;
      source.animation?.reset();
      source.enabled = 1;
      this.advance(handle, -1);
      source.enabled = enabled;
    };
    visit(record.source);
    await this.pull(draw, record);
    return true;
  }
  advance(handle, frame) {
    const source = this.sources.get(handle);
    let changed = Boolean(source.dirty);
    source.dirty = false;
    if (frame !== undefined && source.enabled && source.animation) {
      if (source.startPending) {
        source.animation.start(frame);
        source.startPending = false;
      }
      source.animation.step(frame);
      const output = Object.values(source.animation.output).map((word) => word >>> 0),
        outputChanged = output.some((word, i) => word !== source.outputCache?.[i]);
      source.outputCache = output;
      changed = changed || outputChanged;
      if (outputChanged) {
        const key =
          frame === -1 && source.prefetchFrames && source.frames.some((f) => f.key === 10000)
            ? 10000
            : source.animation.output.frame;
        if (source.frames.some((f) => f.key === key && f.bitmap)) source.selected = key;
      }
    }
    for (const child of source.children)
      if (this.advance(child, frame)) {
        changed = true;
        source.groupDirty = true;
      }
    const bitmap = this.sources.bitmap(handle),
      bitmapRevision = bitmap ? this.world.graphics.images.get(bitmap).state.revision : -1;
    changed = changed || bitmap !== source.sourceBitmap || bitmapRevision !== source.bitmapRevision;
    source.sourceBitmap = bitmap;
    source.bitmapRevision = bitmapRevision;
    if (changed) source.revision++;
    return changed;
  }
  needsPull(record) {
    const source = this.sources.get(record.source),
      model = this.world.runtime.handles.records.get(source.ownerHandle);
    return (
      record.revision !== source.revision ||
      (model?.type === 'image-owner' && source.ownerRevision !== (model.value.rebuild ?? 0))
    );
  }
  async update(draw, frame) {
    for (const record of this.items.values())
      if (record.surface === draw.record.id) {
        this.advance(record.source, frame);
        if (this.needsPull(record)) await this.pull(draw, record);
      }
  }
  attributes(source) {
    const output = source.animation?.output;
    return {
      position: output
        ? source.position.map((v, i) =>
            Math.fround((truncateFloat32(v) + output[i ? 'y' : 'x']) | 0),
          )
        : source.position,
      base: source.base,
      rotation: source.rotation,
      scale: source.scale,
      alpha: output
        ? Math.min(255, Math.floor((Math.imul(output.alpha, source.baseAlpha) >>> 0) / 255))
        : source.baseAlpha,
      visible: Boolean(source.baseShown && (output?.display ?? 1)),
      mode: source.mode,
      aux: source.aux,
    };
  }
  async composite(source) {
    const images = this.world.graphics.images,
      model = this.world.runtime.handles.records.get(source.ownerHandle);
    if (model?.type === 'image-owner' && source.ownerRevision !== (model.value.rebuild ?? 0)) {
      const children = (model.value.layers ?? []).map((layer) => this.fromLayer(layer)),
        bitmap = model.value.bitmap ? images.alias(model.value.bitmap) : 0;
      for (const child of source.children) await this.sources.release(child);
      if (source.bitmap) await images.release(source.bitmap);
      source.children = children;
      source.bitmap = bitmap;
      source.ownerRevision = model.value.rebuild ?? 0;
      source.groupDirty = false;
    }
    if (!source.children.length || !source.bitmap || !source.groupDirty) return;
    const output = images.get(source.bitmap);
    output.commitCanvas();
    const pixels = flipBitmapRows(await output.pixels(), output.width, output.height);
    pixels.fill(0);
    for (const child of source.children) {
      const input = this.sources.get(child),
        bitmap = this.sources.bitmap(child);
      if (!bitmap) continue;
      await this.composite(input);
      const image = images.get(bitmap);
      image.commitCanvas();
      const state = image.state,
        attrs = this.attributes(input);
      attrs.position = attrs.position.map((value, i) =>
        Math.fround(
          value +
            (input.animatedLayer
              ? Math.fround(
                  Math.fround(input.base[i]) -
                    Math.fround((i ? output.state.offsetY : output.state.offsetX) >>> 0),
                )
              : Math.fround(
                  (input.base[i] - (i ? output.state.offsetY : output.state.offsetX)) >>> 0,
                )),
        ),
      );
      attrs.base = [...input.base];
      rasterizeRetainedBitmap(
        pixels,
        output.width,
        output.height,
        await image.pixels(),
        state,
        { ...attrs, clip: input.clip ?? [0, 0, output.width, output.height] },
        [0, 0, output.width, output.height],
        { preserveTransparentRGB: !nativeABI(this.world.profile).graphics.retainedScalarRows },
      );
    }
    output.state.rgba = flipBitmapRows(pixels, output.width, output.height);
    output.state.source = null;
    await output.changed();
    source.groupDirty = false;
    source.sourceBitmap = source.bitmap;
    source.bitmapRevision = output.state.revision;
  }
  async pull(draw, record) {
    const source = this.sources.get(record.source);
    await this.composite(source);
    const bitmap = this.sources.bitmap(record.source);
    if (!bitmap) {
      await draw.removeEntry(record.key);
      return false;
    }
    const item = await draw.upsert(record.key, {
      image: bitmap,
      ...this.attributes(source),
      retained: record.source,
    });
    if (source.clip) item.clip = [...source.clip];
    record.revision = source.revision;
    return item;
  }
  async rasterize(draw, areas, forceOutput) {
    for (const record of this.items.values())
      if (record.surface === draw.record.id) {
        this.advance(record.source);
        if (this.needsPull(record)) await this.pull(draw, record);
      }
    for (const item of draw.state.renderer.items) {
      const bitmap = this.world.graphics.images.get(item.image);
      bitmap.commitCanvas();
      if (item.imageRevision !== bitmap.state.revision) {
        draw.mark(item, true);
        draw.mark(item);
        item.imageRevision = bitmap.state.revision;
      }
    }
    const renderer = draw.state.renderer,
      graphics = this.world.graphics,
      images = graphics.images,
      bitmap = images.get(renderer.bitmap);
    bitmap.commitCanvas();
    const ordinary =
        !this.world.transitionalExe &&
        bitmap.pixels === NativeBitmap.prototype.pixels &&
        bitmap.commitCanvas === NativeBitmap.prototype.commitCanvas &&
        !bitmap.registry?.nativeMemory &&
        graphics.hasOrdinaryBitmapOutput,
      previous = ordinary ? bitmap.retainedBacking() : null,
      bitmapPixels = await (previous?.pixels ?? bitmap.pixels());
    if (!areas.length && !forceOutput && (!draw.state.enabled || !draw.state.pending)) return;
    let area = areas.length
      ? [
          Math.min(...areas.map((a) => a[0])),
          Math.min(...areas.map((a) => a[1])),
          Math.max(...areas.map((a) => a[2])),
          Math.max(...areas.map((a) => a[3])),
        ]
      : [0, 0, 0, 0];
    area[0] = Math.max(0, area[0]);
    area[1] = Math.max(0, area[1]);
    area[2] = Math.min(renderer.width, area[2]);
    area[3] = Math.min(renderer.height, area[3]);
    const hasArea = area[0] < area[2] && area[1] < area[3],
      items = hasArea ? renderer.items.toSorted((a, b) => a.layer - b.layer || a.key - b.key) : [],
      plainBacking =
        ordinary &&
        !renderer.externalPaint &&
        bitmap.width === renderer.width &&
        bitmap.height === renderer.height &&
        bitmapPixels.length === renderer.width * renderer.height * 4,
      remembered = this.#lastForce,
      clearColor = renderer.clearColor,
      prior =
        remembered?.renderer === renderer &&
        previous &&
        remembered.backing === previous &&
        remembered.revision === bitmap.state.revision &&
        remembered.clearColor === clearColor,
      forceLayers =
        hasArea &&
        forceOutput &&
        plainBacking &&
        items.length <= 32 &&
        bitmapPixels.byteLength >= 1024 * 1024 &&
        area[0] === 0 &&
        area[1] === 0 &&
        area[2] === renderer.width &&
        area[3] === renderer.height &&
        readyRasterSources(graphics, bitmap, bitmapPixels, items),
      forceSources = forceLayers && forceRasterSources(forceLayers, renderer.height),
      band =
        forceSources &&
        prior &&
        bitmap.retainedBacking() === previous &&
        forceRasterBand(remembered, forceSources, renderer);
    if (band) area = band;
    const ready = band
        ? forceLayers
        : hasArea &&
          plainBacking &&
          !forceOutput &&
          !draw.state.pending &&
          (area[3] - area[1]) * 2 < renderer.height &&
          area.every(Number.isInteger) &&
          readyRasterSources(graphics, bitmap, bitmapPixels, items),
      reuse = ready && previous && bitmap.retainedBacking() === previous,
      firstRow = reuse ? renderer.height - area[3] : 0,
      rowBytes = renderer.width * 4,
      start = firstRow * rowBytes,
      replaceRows =
        !reuse &&
        hasArea &&
        plainBacking &&
        area[0] === 0 &&
        area[2] === renderer.width &&
        area.every(Number.isInteger) &&
        bitmapPixels instanceof Uint8ClampedArray &&
        bitmapPixels.buffer instanceof ArrayBuffer,
      rows = band
        ? new Uint8ClampedArray((area[3] - area[1]) * rowBytes)
        : reuse
          ? bitmapPixels.slice(start, start + (area[3] - area[1]) * rowBytes)
          : new Uint8ClampedArray(replaceRows ? bitmapPixels.length : bitmapPixels),
      clearSources =
        replaceRows && renderer.clearColor === 0 && draw.state.pending && items.length <= 32
          ? readyRasterSources(graphics, bitmap, bitmapPixels, items)
          : null,
      cleared =
        clearSources &&
        clearSources.every(
          ({ item, state }) =>
            !item.visible ||
            (item.mode === 0 &&
              item.alpha === 255 &&
              state.bpp === 4 &&
              !state.mask &&
              !state.blendType),
        ),
      options = {
        flipDestinationY: true,
        firstDestinationRow: firstRow,
        written: cleared ? [] : null,
        preserveTransparentRGB: !nativeABI(this.world.profile).graphics.retainedScalarRows,
      };
    if (replaceRows) {
      // Cleared rows need no copy. Preserve both outside ranges in the new
      // backing so any already borrowed bitmap still sees its old pixels.
      const first = (renderer.height - area[3]) * rowBytes,
        end = (renderer.height - area[1]) * rowBytes;
      rows.set(bitmapPixels.subarray(0, first));
      rows.set(bitmapPixels.subarray(end), end);
    }
    let publication = null,
      revision,
      texturePublication;
    try {
      if (hasArea) {
        if (!renderer.externalPaint && (!(replaceRows || band) || renderer.clearColor !== 0)) {
          const color = renderer.clearColor,
            rgba = Uint8Array.of(
              (color >>> 16) & 255,
              (color >>> 8) & 255,
              color & 255,
              color >>> 24,
            ),
            clearWord = new Uint32Array(rgba.buffer)[0],
            words = new Uint32Array(rows.buffer);
          for (let y = area[1]; y < area[3]; y++) {
            const row = (renderer.height - 1 - y - firstRow) * renderer.width;
            words.fill(clearWord, row + area[0], row + area[2]);
          }
        }
        // A cleared region can use its ready normal sources in one
        // synchronous pass. The rasterizer records each clipped write area.
        if (reuse || cleared || forceSources) {
          for (const { item, state, rgba } of reuse ? ready : cleared ? clearSources : forceLayers)
            rasterizeRetainedBitmap(
              rows,
              renderer.width,
              renderer.height,
              rgba,
              state,
              item,
              area,
              options,
            );
        } else {
          for (const item of items) {
            const source = images.get(item.image);
            source.commitCanvas();
            rasterizeRetainedBitmap(
              rows,
              renderer.width,
              renderer.height,
              await source.pixels(),
              source.state,
              item,
              area,
              options,
            );
          }
        }
        if (forceSources)
          for (const source of forceSources.values())
            source.pixels = source.snapshot ?? source.pixels.slice();
        if (reuse) {
          // The copied rows include the adjacent pixels that receive zero-alpha RGB.
          bitmapPixels.set(rows, start);
          publication = previous;
        } else if (ready || replaceRows) {
          // A full-width replacement also gives Draw its own new allocation.
          publication = bitmap.publishRetainedBacking(rows);
        } else bitmap.state.rgba = rows;
        // Native output reads this exact allocation asynchronously. Until it
        // returns, a nested Draw must take the full-copy path.
        if (publication) publication.publishing = true;
        bitmap.state.source = null;
        const changed = bitmap.changed();
        revision = bitmap.state.revision;
        await changed;
      }
      if ((draw.state.enabled && (areas.length || draw.state.pending)) || forceOutput) {
        const pixels = reuse ? bitmapPixels : rows;
        if (publication && !graphics.hasOrdinaryBitmapOutput) publication.borrowed = true;
        const frame = publication
          ? outputState(bitmap.state, pixels)
          : { ...bitmap.state, rgba: pixels };
        const tracksTexture =
          forceSources || (prior && reuse && !forceOutput && remembered.texturePublication);
        texturePublication = await graphics.output(
          {
            state: frame,
            width: frame.width,
            height: frame.height,
            pixels: async () => pixels,
            frame: async () => frame,
          },
          draw.state.offset,
          forceOutput || (!areas.length && draw.state.pending) ? null : area,
          {
            flipY: true,
            retained: tracksTexture
              ? { previous: prior ? remembered.texturePublication : null, changed: band }
              : null,
          },
        );
      }
    } finally {
      if (publication) publication.publishing = false;
    }
    if (
      hasArea &&
      this.#lastForce === remembered &&
      (forceSources || remembered?.renderer === renderer)
    ) {
      if (
        publication &&
        bitmap.retainedBacking() === publication &&
        bitmap.state.revision === revision
      ) {
        if (forceSources) {
          this.#lastForce = {
            renderer,
            backing: publication,
            revision,
            clearColor,
            sources: forceSources,
            touched: [renderer.height, 0],
            texturePublication,
          };
          return;
        }
        if (prior && reuse && !forceOutput) {
          remembered.revision = revision;
          remembered.touched[0] = Math.min(remembered.touched[0], area[1]);
          remembered.touched[1] = Math.max(remembered.touched[1], area[3]);
          remembered.texturePublication = texturePublication;
          return;
        }
      }
      this.#lastForce = null;
    }
  }
  async remove(draw, key) {
    const id = this.key(draw, key),
      record = this.items.get(id);
    if (!record) return;
    this.items.delete(id);
    await this.sources.release(record.source);
  }
  async removeSurface(draw) {
    if (this.#lastForce?.renderer === draw.state.renderer) this.#lastForce = null;
    for (const [id, record] of [...this.items])
      if (record.surface === draw.record.id) {
        this.items.delete(id);
        await this.sources.release(record.source);
      }
  }
  snapshot() {
    return structuredClone({ items: [...this.items] });
  }
  restore(state) {
    this.#lastForce = null;
    this.items = new Map(structuredClone(state.items));
  }
  async close() {
    this.#lastForce = null;
    for (const record of this.items.values()) await this.sources.release(record.source);
    this.items.clear();
  }
}
