// SPDX-License-Identifier: MPL-2.0
// Native retained image/ANM records execute in the shared mounted PE. Only
// bitmap presentation and the background image-prefetch worker are host APIs.
import { floatBits } from '../kcs.mjs';
import { nativeRectangleDefinitions } from './windows-rectangles.mjs';
import { installNativeRasterKernels } from './raster-kernel.mjs';

const ABI = {
  game: {
    construct: 0x745930,
    release: 0x745c60,
    retain: 0x745c50,
    bytes: 0xd4,
    bitmap: 0x745cb0,
    imageOwner: 0x745e60,
    data: 0x745f60,
    load: 0x7468f0,
    start: 0x7468c0,
    enable: 0x746be0,
    step: 0x746a50,
    getBitmap: 0x746400,
    alpha: 0x7467a0,
    shown: 0x746830,
    clip: 0x746850,
    refresh: 0x746c00,
    rendererConstruct: 0x742a10,
    rendererDestroy: 0x742cf0,
    rendererBitmap: 0x742e20,
    rendererRetained: 0x743270,
    rendererRemove: 0x743390,
    rendererDraw: 0x7439b0,
    rendererClip: 0x7441f0,
    rendererLayer: 0x744340,
  },
  sdk: {
    construct: 0x5e68a0,
    release: 0x5e6b20,
    retain: 0x5e6b10,
    bytes: 0xc4,
    bitmap: 0x5e6b70,
    imageOwner: 0x5e6cf0,
    data: 0x5e6df0,
    load: 0x5e7580,
    start: 0x5e7550,
    enable: 0x5e77d0,
    step: 0x5e7690,
    getBitmap: 0x5e70a0,
    alpha: 0x5e7430,
    shown: 0x5e74c0,
    clip: 0x5e74e0,
    refresh: 0x5e77f0,
    rendererConstruct: 0x5e3720,
    rendererDestroy: 0x5e39e0,
    rendererBitmap: 0x5e3b10,
    rendererRetained: 0x5e3ea0,
    rendererRemove: 0x5e3fc0,
    rendererDraw: 0x5e45e0,
    rendererClip: 0x5e4e20,
    rendererLayer: 0x5e4f70,
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
    this.threads = new Map();
    this.nextThread = 0x51000000;
    for (const [name, definition] of nativeRectangleDefinitions(this.process))
      engine.registerWindows('USER32.dll', name, definition);
    if (!this.sdk) this.installPrefetch();
    engine.registerFeature('retained-draw', this);
  }
  call(address, args, pointer, task) {
    return this.process.asyncEnabled
      ? this.engine.callFromHost(address, args, pointer, { task })
      : this.engine.call(address, args, pointer, { task });
  }
  key(draw, key) {
    return `${draw.record.id}:${key >>> 0}`;
  }
  record(draw, key) {
    return this.items.get(this.key(draw, key));
  }
  installPrefetch() {
    const { engine, process: p } = this,
      previousClose = engine.kernel.overrides.get('kernel32.dll!CloseHandle');
    // 5DB720 only stores its two arguments and calls _beginthreadex. The
    // reviewed image worker has no interaction with scripts. Browser loading
    // completes that worker before the first presented image frame.
    engine.patch(
      0x5db720,
      'retained image prefetch worker platform',
      2,
      async ([owner, callback]) => {
        if (callback !== 0x747d40)
          throw new Error(`Unrecovered native worker callback 0x${callback.toString(16)}`);
        const thread = p.cpu.reg_read_i32(p.uc.X86_REG_ECX) >>> 0,
          handle = this.nextThread++;
        p.store(thread + 16, callback);
        p.store(thread + 20, owner);
        p.store(thread, handle);
        p.store(thread + 4, handle);
        this.threads.set(handle, { completed: false });
        await engine.callFromHost(callback, [thread, owner]);
        this.threads.get(handle).completed = true;
        return 1;
      },
      { calleePops: true },
    );
    engine.registerWindows('KERNEL32.dll', 'Sleep', {
      count: 1,
      fn: ([duration]) => {
        if (duration > 1)
          throw new Error('Native image worker requested an unrecovered timed sleep');
        return 0;
      },
    });
    engine.registerWindows('KERNEL32.dll', 'GetExitCodeThread', {
      count: 2,
      fn: ([handle, output]) => {
        const thread = this.threads.get(handle);
        if (!thread) throw new Error('Native image worker queried an unknown thread handle');
        p.store(output, thread.completed ? 0 : 259);
        return 1;
      },
    });
    engine.registerWindows('KERNEL32.dll', 'CloseHandle', {
      count: 1,
      fn: (args) => {
        if (this.threads.delete(args[0])) return 1;
        return previousClose.fn(args);
      },
    });
  }
  async create(draw, key, pointer = null) {
    const id = this.key(draw, key);
    if (this.items.has(id)) return this.items.get(id);
    const p = this.process,
      borrowed = pointer !== null;
    pointer ??= p.allocate(this.abi.bytes, true);
    try {
      if (borrowed) await this.call(this.abi.retain, [], pointer, draw.record.id);
      else
        await this.call(
          this.abi.construct,
          [key >>> 0, draw.state.renderer.width, draw.state.renderer.height],
          pointer,
          draw.record.id,
        );
    } catch (error) {
      if (!borrowed) p.free(pointer);
      throw error;
    }
    const record = {
      surface: draw.record.id,
      key: key >>> 0,
      pointer,
      source: null,
      kind: null,
      borrowed,
    };
    this.items.set(id, record);
    return record;
  }
  async bind(draw, key, fields) {
    const kind = fields.slice(0, 4).findIndex(Boolean);
    if (kind < 0) return false;
    let record = this.record(draw, key);
    if (
      record &&
      (record.borrowed !== (kind === 2) || (kind === 2 && record.pointer !== fields[2]))
    ) {
      await this.remove(draw, key);
      record = null;
    }
    record ??= await this.create(draw, key, kind === 2 ? fields[2] : null);
    const p = this.process,
      pointer = record.pointer;
    if (kind !== 2 && (record.source !== fields[kind] || record.kind !== kind)) {
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
    const oldImage = record.image;
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
      if (!present.has(key)) {
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
        const existing = await this.call(
          this.sdk ? 0x5e5860 : 0x744c90,
          [item.key],
          pointer,
          draw.record.id,
        );
        if (existing !== native.pointer) {
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
      await call(this.abi.rendererClip, [item.key, scratch + 24]);
      await call(this.abi.rendererLayer, [item.key, item.layer]);
      // 744C90 retrieves the manager-owned retained entry. Its wrapper at
      // +8 owns a reference to the input bitmap after withBitmap returns.
      const managerItem = await this.call(
          this.sdk ? 0x5e5860 : 0x744c90,
          [item.key],
          pointer,
          draw.record.id,
        ),
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
    await call(this.abi.rendererDraw, [
      draw.state.enabled || forceOutput ? platform.refs.view : 0,
      Number(forceOutput || (draw.state.pending && !areas.length)),
      0,
    ]);
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
  }
  async remove(draw, key) {
    const id = this.key(draw, key),
      record = this.items.get(id);
    const renderer = this.renderers.get(draw.record.id);
    if (renderer?.sources.has(key)) {
      await this.call(this.abi.rendererRemove, [key], renderer.pointer, draw.record.id);
      renderer.sources.delete(key);
    }
    if (!record) return;
    await this.call(this.abi.release, [], record.pointer, draw.record.id);
    this.items.delete(id);
    await this.releaseMirror(record.image);
  }
  async removeSurface(draw) {
    for (const record of [...this.items.values()])
      if (record.surface === draw.record.id) await this.remove(draw, record.key);
    await this.releaseRenderer(draw.record.id);
  }
  snapshot() {
    return structuredClone({
      items: [...this.items],
      renderers: [...this.renderers],
      threads: [...this.threads],
      nextThread: this.nextThread,
    });
  }
  restore(state) {
    this.items = new Map(state.items);
    this.renderers = new Map(state.renderers);
    this.threads = new Map(state.threads);
    this.nextThread = state.nextThread;
  }
  async close() {
    for (const surface of [...this.renderers.keys()]) await this.releaseRenderer(surface);
    for (const [id, record] of this.items) {
      await this.call(this.abi.release, [], record.pointer, record.surface);
      this.items.delete(id);
      await this.releaseMirror(record.image);
    }
    this.threads.clear();
  }
}
