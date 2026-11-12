// SPDX-License-Identifier: MPL-2.0
// Retained sources, ANM clocks and Draw composition share the JS resource graph.
import { truncateFloat32 } from '../ppi/numeric.mjs';
import { bitsFloat, floatBits } from '../kcs.mjs';
import { RetainedAnimation } from './retained-animation.mjs';
import { rasterizeRetainedBitmap, flipBitmapRows } from './raster-kernel.mjs';

export class NativeRetainedDraw {
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
  async bind(draw, key, fields, context = {}) {
    const kind = fields.slice(0, 4).findIndex(Boolean);
    if (kind < 0) return false;
    const projection = context.nativePointer
        ? await this.world.getNativeFeature('fes-draw-projection')
        : null,
      inputToken = projection ? projection.identity(fields) : fields[kind];
    let record = this.record(draw, key);
    if (!record || (kind !== 2 && (record.kind !== kind || record.inputToken !== inputToken))) {
      let source;
      if (context.nativePointer) {
        source = await projection.importSource(fields);
      } else if (kind === 0) source = await this.fromBitmap(fields[0]);
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
    if (projection && kind === 0) await projection.refreshBitmap(fields[0]);
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
      for (const child of source.children)
        if (this.sources.get(child).hasProgram) {
          enable(child);
          for (const sibling of source.children) this.advance(sibling, frame);
        }
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
    this.world.nativeEngine?.features.get('fes-draw-projection')?.publish();
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
      images = this.world.graphics.images,
      bitmap = images.get(renderer.bitmap);
    bitmap.commitCanvas();
    const pixels = flipBitmapRows(await bitmap.pixels(), renderer.width, renderer.height),
      area = areas.length
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
    if (area[0] < area[2] && area[1] < area[3]) {
      if (!renderer.externalPaint) {
        const color = renderer.clearColor;
        for (let y = area[1]; y < area[3]; y++)
          for (let x = area[0]; x < area[2]; x++)
            pixels.set(
              [(color >>> 16) & 255, (color >>> 8) & 255, color & 255, color >>> 24],
              (y * renderer.width + x) * 4,
            );
      }
      for (const item of renderer.items.toSorted((a, b) => a.layer - b.layer || a.key - b.key)) {
        const source = images.get(item.image);
        source.commitCanvas();
        rasterizeRetainedBitmap(
          pixels,
          renderer.width,
          renderer.height,
          await source.pixels(),
          source.state,
          item,
          area,
        );
      }
      bitmap.state.rgba = flipBitmapRows(pixels, renderer.width, renderer.height);
      bitmap.state.source = null;
      await bitmap.changed();
    }
    if ((draw.state.enabled && (areas.length || draw.state.pending)) || forceOutput) {
      const frame = { ...bitmap.state, rgba: pixels };
      await this.world.graphics.output(
        {
          state: frame,
          width: frame.width,
          height: frame.height,
          pixels: async () => pixels,
          frame: async () => frame,
        },
        draw.state.offset,
        forceOutput || (!areas.length && draw.state.pending) ? null : area,
      );
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
    this.items = new Map(structuredClone(state.items));
  }
  async close() {
    for (const record of this.items.values()) await this.sources.release(record.source);
    this.items.clear();
  }
}
