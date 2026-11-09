// SPDX-License-Identifier: MPL-2.0
// Native retained image/ANM records execute in the shared mounted PE. Only
// bitmap presentation and the background image-prefetch worker are host APIs.
import { nativeABI } from './abi/index.mjs';
import { floatBits } from '../kcs.mjs';
import { nativeRectangleDefinitions } from './windows-rectangles.mjs';
import { installNativeRasterKernels } from './raster-kernel.mjs';
import { installNativeEngineWorkers } from './engine-workers.mjs';

const ABI = {
  game: {
    construct: 7625008,
    release: 7625824,
    bitmap: 7625904,
    imageOwner: 7626336,
    data: 7626592,
    load: 7629040,
    start: 7628992,
    enable: 7629792,
    setAnimationVariable: 7629904,
    step: 7629392,
    getBitmap: 7627776,
    alpha: 7628704,
    shown: 7628848,
    clip: 7628880,
    refresh: 7629824,
    rendererConstruct: 7612944,
    rendererDestroy: 7613680,
    rendererBitmap: 7613984,
    rendererRetained: 7615088,
    rendererFind: 7621776,
    rendererRemove: 7615376,
    rendererDraw: 7616944,
    rendererClip: 7619056,
    rendererLayer: 7619392,
  },
  sdk: {
    construct: 6187168,
    release: 6187808,
    bitmap: 6187888,
    imageOwner: 6188272,
    data: 6188528,
    load: 6190464,
    start: 6190416,
    enable: 6191056,
    setAnimationVariable: 6191168,
    step: 6190736,
    getBitmap: 6189216,
    alpha: 6190128,
    shown: 6190272,
    clip: 6190304,
    refresh: 6191088,
    rendererConstruct: 6174496,
    rendererDestroy: 6175200,
    rendererBitmap: 6175504,
    rendererRetained: 6176416,
    rendererFind: 6183008,
    rendererRemove: 6176704,
    rendererDraw: 6178272,
    rendererClip: 6180384,
    rendererLayer: 6180720,
  },
};
const readFloat = (p, at) => new DataView(p.read(at, 4).buffer).getFloat32(0, true);
export class NativeRetainedDraw {
  constructor(engine, world) {
    installNativeRasterKernels(engine);
    Object.assign(this, { engine, world, process: engine.process });
    this.sdk = engine.profile.startsWith('sdk-');
    this.abi = ABI[this.sdk ? 'sdk' : 'game'];
    this.items = new Map();
    this.renderers = new Map();
    for (const [name, definition] of nativeRectangleDefinitions(this.process))
      engine.registerWindows('USER32.dll', name, definition);
    if (nativeABI(engine.profile).capabilities.engineWorkers) installNativeEngineWorkers(engine);
    engine.registerFeature('retained-draw', this);
  }
  call(address, args, pointer, task, rasterBudget) {
    const options = { task, rasterBudget };
    return this.process.asyncEnabled
      ? this.engine.callFromHost(address, args, pointer, options)
      : this.engine.call(address, args, pointer, options);
  }
  key(draw, key) {
    return `${draw.record.id}:${key >>> 0}`;
  }
  record(draw, key) {
    return this.items.get(this.key(draw, key));
  }
  async create(draw, key) {
    const id = this.key(draw, key);
    if (this.items.has(id)) return this.items.get(id);
    const p = this.process,
      pointer = p.allocate(nativeABI(this.engine.profile).graphics.retainedBytes, true);
    try {
      await this.call(
        this.abi.construct,
        [key >>> 0, draw.state.renderer.width, draw.state.renderer.height],
        pointer,
        draw.record.id,
      );
    } catch (error) {
      p.free(pointer);
      throw error;
    }
    const record = {
      surface: draw.record.id,
      key: key >>> 0,
      pointer,
      source: null,
      kind: null,
    };
    this.items.set(id, record);
    return record;
  }
  async bindRetained(draw, key, fields) {
    const p = this.process,
      surface = draw.record.id,
      platform = await this.world.getNativeFeature('graphics-platform'),
      renderer = await this.renderer(draw, platform),
      call = (address, args) => this.call(address, args, renderer.pointer, surface),
      existing = await call(this.abi.rendererFind, [key]),
      previous = this.record(draw, key) ?? (existing ? null : await this.ensure(draw, key)),
      temporary = previous && !previous.managerOwned ? previous.pointer : 0,
      oldItem = draw.entry(key),
      scratch = renderer.scratch;
    // A deferred bitmap entry may already exist on the Draw task before its
    // first render. Keep that source when the original command updates its key.
    const source = !existing && previous ? previous.pointer : fields[2];
    [4, 5, 6, 7, 9, 10].forEach((field, i) => p.store(scratch + i * 4, fields[field]));
    await call(this.abi.rendererRetained, [
      key,
      source,
      scratch,
      scratch + 8,
      fields[8],
      scratch + 16,
      fields[11],
      fields[12],
      fields[13],
    ]);
    const pointer = await call(this.abi.rendererFind, [key]);
    if (!pointer) throw new Error('Original Draw manager did not register its retained source');
    const record = previous ?? { surface, key: key >>> 0, kind: 2, source: pointer };
    record.pointer = pointer;
    record.managerOwned = true;
    this.items.set(this.key(draw, key), record);
    if (temporary) await this.call(this.abi.release, [], temporary, surface);
    if (!existing && oldItem) {
      oldItem.clip.forEach((word, i) => p.store(scratch + 24 + i * 4, word));
      await call(this.abi.rendererClip, [key, scratch + 24]);
      await call(this.abi.rendererLayer, [key, oldItem.layer]);
    }
    if (fields[14]) p.store(pointer + 192, fields[14]);
    return this.pull(draw, record);
  }
  async bind(draw, key, fields) {
    const kind = fields.slice(0, 4).findIndex(Boolean);
    if (kind < 0) return false;
    if (kind === 2) return this.bindRetained(draw, key, fields);
    const record = this.record(draw, key) ?? (await this.create(draw, key)),
      p = this.process,
      pointer = record.pointer;
    if (record.source !== fields[kind] || record.kind !== kind) {
      await this.call(
        kind === 0 ? this.abi.bitmap : kind === 1 ? this.abi.data : this.abi.imageOwner,
        [fields[kind]],
        pointer,
        draw.record.id,
      );
      record.source = fields[kind];
      record.kind = kind;
    }
    p.store(pointer, key);
    for (const [offset, value] of [
      [108, fields[4]],
      [112, fields[5]],
      [128, fields[6]],
      [132, fields[7]],
      [116, fields[8]],
      [120, fields[9]],
      [124, fields[10]],
      [28, fields[11]],
      [36, fields[12]],
      [104, fields[13]],
      [192, fields[14]],
    ])
      p.store(pointer + offset, value);
    // The original packet path calls 7466E0 / 5E7370 for its explicit base.
    // Besides the two floats, that setter marks the base for recalculation.
    p.store(pointer + 156, 1);
    p.store(pointer + 136, 1);
    return this.pull(draw, record);
  }
  async ensure(draw, key) {
    let record = this.record(draw, key);
    if (record) return record;
    const item = draw.entry(key);
    if (!item) return null;
    const platform = await this.world.getNativeFeature('graphics-platform');
    await platform.withBitmap(
      this.world.graphics.images.get(item.image),
      (bitmap) =>
        this.bind(draw, key, [
          bitmap,
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
          0,
        ]),
      draw.record.id,
    );
    record = this.record(draw, key);
    return record;
  }
  async load(draw, key, name) {
    const record = await this.ensure(draw, key);
    if (!record) return false;
    const files = await this.world.getNativeFeature('engine-files'),
      bytes = await files.read(name);
    if (!bytes?.length) return false;
    const p = this.process,
      source = p.allocate(bytes.length, true);
    try {
      p.write(source, bytes);
      return Boolean(
        await this.call(this.abi.load, [source, bytes.length], record.pointer, draw.record.id),
      );
    } finally {
      p.free(source);
    }
  }
  async enable(draw, key, value) {
    const record = await this.ensure(draw, key);
    if (!record) return;
    const frame = ((draw.record.effectiveFrame ?? 0) - (draw.record.pausedFrames ?? 0)) >>> 0;
    await this.call(this.abi.start, [frame], record.pointer, draw.record.id);
    await this.call(this.abi.enable, [value, frame], record.pointer, draw.record.id);
    await this.update(draw, frame);
  }
  async setAnimationVariable(draw, key, index, value) {
    const record = this.record(draw, key);
    if (record)
      await this.call(
        this.abi.setAnimationVariable,
        [index, value],
        record.pointer,
        draw.record.id,
      );
  }
  visible(draw, key, value) {
    const record = this.record(draw, key);
    if (!record) return;
    this.process.store(record.pointer + 36, Number(Boolean(value)));
    this.process.store(record.pointer + 136, 1);
  }
  async clip(draw, key, values) {
    const record = this.record(draw, key);
    if (!record) return;
    const pointer = this.process.allocate(16, true);
    try {
      values.forEach((value, i) => this.process.store(pointer + i * 4, value));
      await this.call(this.abi.clip, [pointer], record.pointer, draw.record.id);
    } finally {
      this.process.free(pointer);
    }
  }
  async refresh(draw, key) {
    const record = await this.ensure(draw, key);
    if (!record) return false;
    await this.call(this.abi.refresh, [], record.pointer, draw.record.id);
    await this.pull(draw, record);
    return true;
  }
  async update(draw, frame) {
    for (const record of this.items.values()) {
      if (record.surface !== draw.record.id) continue;
      if (await this.call(this.abi.step, [frame >>> 0], record.pointer, draw.record.id))
        await this.pull(draw, record);
    }
  }
  async pull(draw, record) {
    const p = this.process,
      pointer = record.pointer,
      bitmap = await this.call(this.abi.getBitmap, [], pointer, draw.record.id);
    if (!bitmap) {
      await draw.removeEntry(record.key);
      const oldImage = record.image;
      delete record.image;
      await this.releaseMirror(oldImage);
      return false;
    }
    const image = (await this.world.getNativeFeature('graphics-platform')).imageHandle(
        bitmap,
        record.surface,
      ),
      alpha = await this.call(this.abi.alpha, [], pointer, draw.record.id),
      shown = await this.call(this.abi.shown, [], pointer, draw.record.id);
    const oldImage = record.image,
      newEntry = !draw.entry(record.key);
    const item = await draw.upsert(record.key, {
      image,
      position: [108, 112].map((at) => readFloat(p, pointer + at)),
      base: [128, 132].map((at) => readFloat(p, pointer + at)),
      rotation: readFloat(p, pointer + 116),
      scale: [120, 124].map((at) => readFloat(p, pointer + at)),
      alpha,
      visible: Boolean(shown),
      mode: p.load(pointer + 104),
      aux: p.load(pointer + 192),
      nativeRetained: this.key(draw, record.key),
    });
    if (record.managerOwned && newEntry) item.layer = p.load(pointer + 4) | 0;
    record.image = image;
    if (oldImage !== image) await this.releaseMirror(oldImage);
    return item;
  }
  async releaseMirror(image) {
    if (image === undefined || [...this.items.values()].some((item) => item.image === image))
      return;
    await this.world.graphics.images.release(image);
  }
  async renderer(draw, platform) {
    const renderer = draw.state.renderer,
      p = this.process,
      destination = this.world.graphics.images.get(renderer.bitmap);
    let record = this.renderers.get(draw.record.id);
    if (
      record &&
      (record.width !== renderer.width ||
        record.height !== renderer.height ||
        record.destination !== destination.dataHandle)
    ) {
      await this.releaseRenderer(draw.record.id);
      record = null;
    }
    if (record) return record;
    const pointer = p.allocate(60, true),
      scratch = p.allocate(40, true);
    let constructed = false;
    try {
      await this.call(
        this.abi.rendererConstruct,
        [renderer.width, renderer.height, 4, 0],
        pointer,
        draw.record.id,
      );
      constructed = true;
      const bitmap = p.load(p.load(pointer + 8));
      await platform.writeLogicalBitmap(bitmap, destination);
      record = {
        pointer,
        scratch,
        bitmap,
        width: renderer.width,
        height: renderer.height,
        destination: destination.dataHandle,
        revision: destination.state.revision,
        sources: new Map(),
      };
      this.renderers.set(draw.record.id, record);
      return record;
    } catch (error) {
      if (constructed) await this.call(this.abi.rendererDestroy, [], pointer, draw.record.id);
      p.free(pointer);
      p.free(scratch);
      throw error;
    }
  }
  rasterBudget({ pointer, bitmap, width, height }) {
    const pixels = width * height;
    if (width <= 0 || height <= 0 || width > 1920 || height > 1920 || pixels > 1920 * 1080) return;
    const p = this.process;
    try {
      const owner = p.load(pointer + 8);
      if (
        !owner ||
        p.load(owner) !== bitmap ||
        p.load(bitmap + 4) !== width ||
        p.load(bitmap + 8) !== height ||
        p.load(bitmap + 24) !== 4
      )
        return;
      const destination = p.load(bitmap + 12),
        pitch = p.load(bitmap + 20);
      if (!destination || pitch !== width * 4) return;
      return { destination, width, height, pitch, pixels, credited: 0 };
    } catch {
      // An unrecognized owner is still handled by the original native call.
      return;
    }
  }
  async rasterize(draw, areas, forceOutput) {
    const renderer = draw.state.renderer,
      p = this.process,
      platform = await this.world.getNativeFeature('graphics-platform'),
      record = await this.renderer(draw, platform),
      { pointer, scratch, bitmap, sources } = record,
      destination = this.world.graphics.images.get(renderer.bitmap),
      call = (address, args) => this.call(address, args, pointer, draw.record.id);
    if (record.revision !== destination.state.revision)
      await platform.writeLogicalBitmap(bitmap, destination);
    p.store(pointer + 16, draw.state.offset[0]);
    p.store(pointer + 20, draw.state.offset[1]);
    p.store(pointer + 40, renderer.clearColor);
    const present = new Set(renderer.items.map((item) => item.key));
    for (const key of sources.keys())
      if (!present.has(key) && !this.record(draw, key)?.managerOwned) {
        await call(this.abi.rendererRemove, [key]);
        sources.delete(key);
      }
    for (const item of renderer.items) {
      const source = this.world.graphics.images.get(item.image);
      if (!source.width || !source.height) continue;
      const native = this.record(draw, item.key),
        nativeBitmap = native
          ? await this.call(this.abi.getBitmap, [], native.pointer, draw.record.id)
          : null,
        signature = JSON.stringify([
          native?.pointer,
          nativeBitmap,
          source.dataHandle,
          source.state.revision,
          item.position,
          item.base,
          item.scale,
          item.clip,
          item.rotation,
          item.alpha,
          item.visible,
          item.mode,
          item.layer,
        ]),
        previous = sources.get(item.key);
      if (previous?.signature === signature) continue;
      [...item.position, ...item.base, ...item.scale].forEach((value, i) =>
        p.store(scratch + i * 4, floatBits(value)),
      );
      item.clip.forEach((value, i) => p.store(scratch + 24 + i * 4, value));
      const bind = async (sourcePointer, retained = false) => {
        await call(retained ? this.abi.rendererRetained : this.abi.rendererBitmap, [
          item.key,
          sourcePointer,
          scratch,
          scratch + 8,
          floatBits(item.rotation),
          scratch + 16,
          retained ? p.load(sourcePointer + 28) : item.alpha,
          retained ? p.load(sourcePointer + 36) : Number(item.visible),
          item.mode,
        ]);
      };
      // Native records keep their complete owner/canvas/anchor/ANM state.
      // The original retained-source manager entry holds that same object,
      // rather than reconstructing a different source from its bitmap.
      if (nativeBitmap) {
        const existing = await call(this.abi.rendererFind, [item.key]);
        if (existing !== native.pointer) {
          if (native.managerOwned)
            throw new Error('Original Draw manager lost its retained source identity');
          if (existing) await call(this.abi.rendererRemove, [item.key]);
          await bind(native.pointer, true);
        }
      } else if (
        previous &&
        previous.data === source.dataHandle &&
        previous.revision === source.state.revision
      )
        await bind(previous.pointer);
      else await platform.withBitmap(source, bind, draw.record.id);
      if (
        !native?.managerOwned ||
        item.clip.some((word, i) => word !== (p.load(native.pointer + 40 + i * 4) | 0))
      )
        await call(this.abi.rendererClip, [item.key, scratch + 24]);
      if (!native?.managerOwned || item.layer !== (p.load(native.pointer + 4) | 0))
        await call(this.abi.rendererLayer, [item.key, item.layer]);
      // 744C90 retrieves the manager-owned retained entry. Its wrapper at
      // +8 owns a reference to the input bitmap after withBitmap returns.
      const managerItem = await call(this.abi.rendererFind, [item.key]),
        sourcePointer = await this.call(this.abi.getBitmap, [], managerItem, draw.record.id);
      sources.set(item.key, {
        signature,
        data: source.dataHandle,
        revision: source.state.revision,
        pointer: sourcePointer,
      });
    }
    // Each original dirty-region record contains its fixed tile at +0 and
    // pending rectangle at +16. This unsegmented manager has one full tile.
    const dirty = p.load(p.load(pointer + 12)),
      area = areas.length
        ? [
            Math.min(...areas.map((r) => r[0])),
            Math.min(...areas.map((r) => r[1])),
            Math.max(...areas.map((r) => r[2])),
            Math.max(...areas.map((r) => r[3])),
          ]
        : [0, 0, 0, 0];
    area.forEach((value, i) => p.store(dirty + 16 + i * 4, value));
    await this.call(
      this.abi.rendererDraw,
      [
        draw.state.enabled || forceOutput ? platform.refs.view : 0,
        Number(forceOutput || (draw.state.pending && !areas.length)),
        0,
      ],
      pointer,
      draw.record.id,
      this.rasterBudget(record),
    );
    destination.state.rgba = platform.logicalBitmap(bitmap).state.rgba;
    destination.state.source = null;
    destination.changed();
    record.revision = destination.state.revision;
  }
  async releaseRenderer(surface) {
    const record = this.renderers.get(surface);
    if (!record) return;
    await this.call(this.abi.rendererDestroy, [], record.pointer, surface);
    this.process.free(record.pointer);
    this.process.free(record.scratch);
    this.renderers.delete(surface);
    for (const [id, item] of this.items)
      if (item.surface === surface && item.managerOwned) {
        this.items.delete(id);
        await this.releaseMirror(item.image);
      }
  }
  async remove(draw, key) {
    const id = this.key(draw, key),
      record = this.items.get(id);
    const renderer = this.renderers.get(draw.record.id);
    if (renderer && (record?.managerOwned || renderer.sources.has(key))) {
      await this.call(this.abi.rendererRemove, [key], renderer.pointer, draw.record.id);
      renderer.sources.delete(key);
    }
    if (!record) return;
    // A single-entry native removal destroys the object immediately. A
    // deferred host entry still needs its own release if it never reached
    // the manager or if the manager stored a different record.
    if (!record.managerOwned && this.process.allocations.has(record.pointer))
      await this.call(this.abi.release, [], record.pointer, draw.record.id);
    this.items.delete(id);
    await this.releaseMirror(record.image);
  }
  async removeSurface(draw) {
    // The original manager destructor releases its references. Running the
    // individual remove command for each key would destroy shared records.
    await this.releaseRenderer(draw.record.id);
    for (const record of [...this.items.values()])
      if (record.surface === draw.record.id) await this.remove(draw, record.key);
  }
  snapshot() {
    return structuredClone({
      items: [...this.items],
      renderers: [...this.renderers],
    });
  }
  restore(state) {
    this.items = new Map(state.items);
    this.renderers = new Map(state.renderers);
  }
  async close() {
    for (const surface of [...this.renderers.keys()]) await this.releaseRenderer(surface);
    for (const [id, record] of this.items) {
      await this.call(this.abi.release, [], record.pointer, record.surface);
      this.items.delete(id);
      await this.releaseMirror(record.image);
    }
  }
}
