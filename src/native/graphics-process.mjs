// SPDX-License-Identifier: MPL-2.0
// The original task regions share one view/renderer record set and cross this
// boundary for graph state and CPU-bitmap uploads. Their parsers and animation
// code continue in the mounted executable.
import { nativeABI } from './abi/index.mjs';
import { mapABIMessage } from './abi/messages.mjs';
import { NativeBitmap } from './image.mjs';
import { MOTION_ABI, setMotionVector } from '../motion/abi.mjs';
import { bitsFloat } from '../kcs.mjs';
import { NATIVE_UNWRITTEN_WORD, nativeTaskKeyOrder } from './engine-message.mjs';
import { conditionalNativeGraphicsBoundary } from './graphics-task.mjs';
import { NativeGraphRendering } from './graphics-render.mjs';

const ABI = {
  'nekopara-vol3-engine-2.6.1.76': {
    baseMessage: 6162720,
    planeBroadcast: 6159312,
    taskSend: 6150240,
    graphDestroy: 6774432,
    graphShown: 6777104,
    graphDisplay: 6780656,
    bitmapCopy: 6780560,
    bitmapClear: 6768048,
    graphBase: 6779136,
    rendererGlobal: 12126072,
    bitmapConstruct: 6861792,
    bitmapConfigure: 6864384,
    bitmapRelease: 6868768,
  },
  'sdk-4.01-engine-2.6.1.74': {
    baseMessage: 4967536,
    planeBroadcast: 4964208,
    taskSend: 4954784,
    graphDestroy: 5558192,
    graphShown: 5560880,
    graphDisplay: 5564400,
    bitmapCopy: 5564304,
    bitmapClear: 5551776,
    bitmapConstruct: 5644096,
    bitmapConfigure: 5646704,
    bitmapRelease: 5651088,
  },
};

function findUnsignedTreeWord(p, map, key) {
  if (!map) return 0;
  const end = p.load(map);
  for (let node = p.load(end + 4); node !== end; ) {
    const word = p.load(node + 16);
    if (word === key) return p.load(node + 20);
    node = p.load(node + (key < word ? 0 : 8));
  }
  return 0;
}

export class NativeGraphicsPlatform {
  constructor(engine, world) {
    Object.assign(this, { engine, world, process: engine.process });
    this.abi = ABI[engine.profile];
    if (!this.abi) throw new Error(`Native graphics platform is unavailable for ${engine.profile}`);
    if (engine.refs.graphics)
      throw new Error('Native graphics platform records already have an owner');
    const p = this.process;
    this.refs = engine.refs.graphics = {
      view: p.allocate(0x118, true),
      renderer: p.allocate(0x670, true),
      manager: p.allocate(0x220, true),
      view3D: 0,
    };
    this.owned = new Set([this.refs.view, this.refs.renderer, this.refs.manager]);
    p.store(this.refs.view + 8, this.refs.manager);
    p.store(this.refs.view + 20, 1);
    const [width, height] = world.graphics.view.virtualSize();
    p.store(this.refs.view + 24, width);
    p.store(this.refs.view + 28, height);
    p.store(this.refs.renderer + 4, 1);
    if (this.abi.rendererGlobal) p.store(this.abi.rendererGlobal, this.refs.renderer);
    this.destroyListeners = new Set();
    this.originalTasks = new Set();
    this.boundaryDetachers = [];
    this.nativeBoundaries = [];
    this.nativeUploadDepth = 0;
    this.nativeClearDepth = 0;
    this.bitmapHandles = new Map();
    this.pendingBitmaps = 0;
    this.memory = {
      load: (address) => p.load(address),
      store: (address, value) => p.store(address, value),
      bytes: (address, size) => p.read(address, size),
      write: (address, bytes) => p.write(address, bytes),
      string: (address, wide = false) => p.string(address, wide),
    };
    const patch = (address, name, count, fn) => {
      if (
        [
          this.abi.baseMessage,
          this.abi.planeBroadcast,
          this.abi.taskSend,
          this.abi.graphDestroy,
          this.abi.graphShown,
          this.abi.graphDisplay,
          this.abi.graphBase,
          this.abi.bitmapCopy,
          this.abi.bitmapClear,
        ].includes(address)
      ) {
        const boundary = conditionalNativeGraphicsBoundary(
          engine,
          address,
          name,
          count,
          (args) => {
            if (address === this.abi.bitmapCopy) return !this.nativeUploadDepth;
            if (address === this.abi.bitmapClear) return !this.nativeClearDepth;
            if (address === this.abi.planeBroadcast || address === this.abi.taskSend) {
              const pointer = p.cpu.reg_read_i32(p.uc.X86_REG_ECX) >>> 0;
              return (
                this.world.engineMessages &&
                this.originalTasks.has(engine.features.get('task-memory')?.worldID(pointer))
              );
            }
            if (address === this.abi.baseMessage)
              return !this.originalTasks.has(
                this.task(p.cpu.reg_read_i32(p.uc.X86_REG_ECX) >>> 0).record.id,
              );
            return (
              !this.originalTasks.has(engine.currentTaskID) &&
              !this.descriptor(args[0]) &&
              !this.originalTasks.has(this.graphTask(args[0])?.record.id)
            );
          },
          fn,
        );
        this.boundaryDetachers.push(boundary.detach);
        this.nativeBoundaries.push(boundary);
        return boundary.trap;
      }
      return engine.patch(address, name, count, fn, { calleePops: true });
    };
    patch(this.abi.baseMessage, 'shared graph task platform messages', 6, (args) =>
      this.baseMessage(args),
    );
    patch(this.abi.planeBroadcast, 'native plane descendant packets', 5, (args) =>
      this.broadcastPlane(args),
    );
    patch(this.abi.taskSend, 'native plane task message router', 7, (args) => this.routeTask(args));
    patch(this.abi.graphDestroy, 'shared graph destroy', 1, ([id]) => this.destroyGraph(id));
    patch(this.abi.graphShown, 'shared graph query visibility', 2, ([id, out]) => {
      const task = this.graphTask(id);
      if (!task?.graph) return 0;
      p.store(
        out,
        Number(
          task.state.shown &&
            new DataView(task.graph.kx2.buffer).getInt32(MOTION_ABI.display, true),
        ),
      );
      return 1;
    });
    patch(this.abi.graphDisplay, 'shared graph rendering gate', 2, ([id, visible]) => {
      const task = this.graphTask(id);
      if (!task?.graph || task.graph.type !== 1) return 0;
      task.graph.renderEnabled = Boolean(visible);
      return 1;
    });
    patch(
      this.abi.bitmapCopy,
      'shared graph upload native bitmap',
      7,
      ([bitmap, sx, sy, width, height, dx, dy]) =>
        this.copyBitmap(bitmap, sx, sy, width, height, dx, dy),
    );
    patch(this.abi.bitmapClear, 'shared graph clear VRAM', 4, (args) => this.clearBitmap(...args));
    if (this.abi.graphBase)
      patch(
        this.abi.graphBase,
        'shared graph set base position',
        5,
        ([id, x, y, z, coordinate]) => {
          if (coordinate)
            throw new Error('Native graph base coordinate conversion is not recovered');
          const task = this.graphTask(id);
          if (!task?.graph) return 0;
          setMotionVector(task.graph.kx2, MOTION_ABI.base, [
            bitsFloat(x),
            bitsFloat(y),
            bitsFloat(z),
          ]);
          (task.plane || task).sync();
          return 1;
        },
      );
    this.graphRendering = new NativeGraphRendering(this);
    this.sync();
    engine.registerFeature('graphics-platform', this);
  }
  task(pointer) {
    const task = [...this.world.graphics.tasks.values()].find((task) => task.pointer === pointer);
    if (!task) throw new Error(`Native graph task at 0x${pointer.toString(16)} is not registered`);
    return task;
  }
  graphTask(nativeID) {
    const worldID = this.world.resolveTaskID
      ? this.world.resolveTaskID(nativeID, this.engine.currentTaskID)
      : nativeID;
    return worldID == null ? null : this.world.graphics.get(worldID);
  }
  descriptor(nativeID) {
    if (!this.engine.features.get('renderer')?.initialized) return 0;
    return findUnsignedTreeWord(this.process, this.process.load(this.refs.manager), nativeID >>> 0);
  }
  attachment(nativeID) {
    const p = this.process,
      descriptor = this.descriptor(nativeID);
    if (
      !descriptor ||
      findUnsignedTreeWord(
        p,
        p.load(this.refs.view + nativeABI(this.engine.profile).graphics.graphTypes),
        nativeID >>> 0,
      ) !== 1
    )
      return null;
    const model = [16, 20, 24, 12, 8].map((at) => p.load(descriptor + at)).find(Boolean);
    if (!model) return null;
    const vector = (at, count) =>
      Array.from({ length: count }, (_, i) => bitsFloat(p.load(model + at + i * 4)));
    return {
      base: vector(8, 3),
      pos: vector(56, 3),
      matrix: vector(104, 16),
      display: Boolean(p.load(descriptor + 4)),
    };
  }
  async routeTask([sender, target, raw, w, l, flags, out]) {
    const p = this.process,
      origin = this.task(p.cpu.reg_read_i32(p.uc.X86_REG_ECX) >>> 0).record.id,
      targetID = raw !== 1 ? this.world.resolveTaskID(target, origin) : null,
      record = this.world.objects.objects.get(targetID);
    if (raw !== 1 && (!record || record.state !== 'active')) return 0;
    const message = mapABIMessage(this.engine.profile, 'base', 'canonical', raw, record?.kind),
      context = {
        payload: this.memory,
        nativePointer: true,
        nativeResult: out,
        nativeSender: sender,
        flags,
        fromHost: true,
      },
      value = await this.world.sendNativeEngine(target, origin, message, w, l, context);
    if (raw !== 1 && out && Number.isInteger(value)) this.process.store(out, value);
    return Number(Boolean(context.nativeRouted));
  }
  enableOriginalTask(task) {
    this.originalTasks.add(task.record.id);
  }
  async baseMessage([sender, rawMessage, w, l, flags, out]) {
    const p = this.process,
      pointer = p.cpu.reg_read_i32(p.uc.X86_REG_ECX) >>> 0,
      task = this.task(pointer),
      message = mapABIMessage(this.engine.profile, 'base', 'canonical', rawMessage),
      senderWorldID = this.world.resolveTaskID
        ? this.world.resolveTaskID(sender, task.record.id)
        : sender,
      context = {
        payload: this.memory,
        nativePointer: true,
        nativeResult: out,
        flags,
        fromHost: true,
        nativeSenderWorldID: senderWorldID,
        // The legacy text task enters the original Graph message dispatcher.
        // Its registration word is a flag, even if it came through a raw send.
        graphInputRegistration: task.record.kind === 8 && message === 89,
      },
      value = await (task.plane || task).message([sender, message, w, l], context);
    if (out && Number.isInteger(value)) p.store(out, value);
    return Number(Boolean(context.nativeUnhandled));
  }
  async broadcastPlane([rawMessage, w, l, flags, out]) {
    const p = this.process,
      pointer = p.cpu.reg_read_i32(p.uc.X86_REG_ECX) >>> 0,
      owner = this.task(pointer).record,
      protocol = this.world.engineMessages,
      sender = p.load(pointer + 4);
    // The plane helper visits every route key, including descendants through
    // an intermediate branch, and calls the packet receiver directly.
    let previous = -Infinity;
    for (;;) {
      const nativeID = [...protocol.registry(owner).keys()]
        .filter((id) => (id | 0) > previous)
        .sort(nativeTaskKeyOrder)[0];
      if (nativeID === undefined) return;
      previous = nativeID | 0;
      const target = protocol.lookupPointer(owner, nativeID);
      if (!target) continue;
      const message = mapABIMessage(
          this.engine.profile,
          'base',
          'canonical',
          rawMessage,
          target.kind,
        ),
        packet = [nativeID, sender, message, w, l, flags],
        output = { value: NATIVE_UNWRITTEN_WORD };
      packet.senderWorldID = owner.id;
      await protocol.invoke(
        target,
        packet,
        { payload: this.memory, nativePointer: true, nativeResult: out, fromHost: true },
        output,
      );
      if (out && Number.isInteger(output.value)) p.store(out, output.value);
    }
  }
  attachDevice(device) {
    const field = nativeABI(this.engine.profile).graphics.deviceField;
    if (field === null)
      throw new Error('This graphics profile has no recovered native device record');
    this.process.store(this.refs.renderer + field, device);
  }
  async ensureRenderer() {
    const renderer = await this.world.getNativeFeature('renderer');
    return renderer.initialize();
  }
  onDestroy(callback) {
    this.destroyListeners.add(callback);
    return () => this.destroyListeners.delete(callback);
  }
  destroyGraph(id) {
    const task = this.graphTask(id);
    if (!task?.graph) return 0;
    (task.plane || task).unload();
    for (const callback of this.destroyListeners) callback(task.record.id);
    return 1;
  }
  bitmap(pointer) {
    const p = this.process,
      width = p.load(pointer + 4),
      height = p.load(pointer + 8),
      data = p.load(pointer + 12),
      stride = p.load(pointer + 20),
      bpp = p.load(pointer + 24);
    if (
      ![3, 4].includes(bpp) ||
      !width ||
      !height ||
      width * height > 64 * 1024 * 1024 ||
      stride < width * bpp
    )
      throw new Error(
        `Native graph bitmap ${width}x${height}/${bpp} has an unrecovered pixel layout`,
      );
    const rgba = new Uint8ClampedArray(width * height * 4),
      pixels = p.read(data, (height - 1) * stride + width * bpp);
    for (let y = 0; y < height; y++) {
      for (let x = 0; x < width; x++) {
        const source = y * stride + x * bpp,
          at = (y * width + x) * 4;
        rgba[at] = pixels[source + 2];
        rgba[at + 1] = pixels[source + 1];
        rgba[at + 2] = pixels[source];
        rgba[at + 3] = bpp === 4 ? pixels[source + 3] : 255;
      }
    }
    return new NativeBitmap(this.world.graphics.images, {
      width,
      height,
      rgba,
      bpp: 4,
      canvasWidth: width,
      canvasHeight: height,
      offsetX: 0,
      offsetY: 0,
      baseX: 0,
      baseY: 0,
      clip: [0, 0, width, height],
      source: null,
      attributes: [],
    });
  }
  logicalBitmap(pointer) {
    const p = this.process,
      source = this.bitmap(pointer),
      state = source.state,
      rgba = state.rgba.slice(),
      rowBytes = state.width * 4;
    for (let y = 0; y < state.height; y++)
      rgba.set(
        state.rgba.subarray((state.height - y - 1) * rowBytes, (state.height - y) * rowBytes),
        y * rowBytes,
      );
    Object.assign(state, {
      rgba,
      canvasWidth: p.load(pointer + 28),
      canvasHeight: p.load(pointer + 32),
      offsetX: p.load(pointer + 36) | 0,
      offsetY: p.load(pointer + 40) | 0,
      baseX: p.load(pointer + 48) | 0,
      baseY: p.load(pointer + 52) | 0,
      clip: Array.from({ length: 4 }, (_, i) => p.load(pointer + 56 + i * 4) | 0),
      mask: p.load(pointer + 76),
      blendType: p.load(pointer + 84),
    });
    return source;
  }
  imageHandle(pointer, owner) {
    // Drawing descriptors borrow their bitmap; unlike the image-loader return
    // wrapper this is not an ownership transfer. Its original rows are bottom-up.
    const key = `${owner}:${pointer}`,
      memory = this.world.nativeEngine?.features.get('bitmap-memory'),
      p = this.process,
      state = memory
        ? {
            width: p.load(pointer + 4),
            height: p.load(pointer + 8),
            bpp: p.load(pointer + 24),
            canvasWidth: p.load(pointer + 28),
            canvasHeight: p.load(pointer + 32),
            offsetX: p.load(pointer + 36) | 0,
            offsetY: p.load(pointer + 40) | 0,
            baseX: p.load(pointer + 48) | 0,
            baseY: p.load(pointer + 52) | 0,
            clip: Array.from({ length: 4 }, (_, i) => p.load(pointer + 56 + i * 4) | 0),
            attributes: [],
            rgba: null,
            source: null,
          }
        : this.logicalBitmap(pointer).state;
    let handle = this.bitmapHandles.get(key);
    if (handle === undefined) {
      handle = this.world.graphics.images.add(
        new NativeBitmap(this.world.graphics.images, state, { owner }),
      );
      this.bitmapHandles.set(key, handle);
      memory?.borrow(handle, pointer);
    } else {
      const bitmap = this.world.graphics.images.get(handle);
      if (memory) {
        memory.borrow(handle, pointer);
        return handle;
      }
      state.revision = bitmap.state.revision;
      bitmap.state = state;
      bitmap.changed();
    }
    return handle;
  }
  forgetImageHandle(handle) {
    for (const [key, value] of this.bitmapHandles)
      if (value === handle) this.bitmapHandles.delete(key);
  }
  async releaseOwnerImages(owner) {
    for (const [key, handle] of this.bitmapHandles)
      if (key.startsWith(`${owner}:`)) {
        await this.world.graphics.images.release(handle);
        this.bitmapHandles.delete(key);
      }
  }
  async withBitmap(bitmap, callback, task = this.engine.currentTaskID) {
    const p = this.process,
      frame = await bitmap.frame(),
      pointer = p.allocate(92, true),
      call = (address, args = []) =>
        p.asyncEnabled
          ? this.engine.callFromHost(address, args, pointer, { task })
          : this.engine.call(address, args, pointer, { task });
    let constructed = false;
    this.pendingBitmaps++;
    try {
      await call(this.abi.bitmapConstruct);
      constructed = true;
      if (!(await call(this.abi.bitmapConfigure, [frame.width, frame.height, 4])))
        throw new Error('Original native bitmap allocation failed');
      await this.writeLogicalBitmap(pointer, bitmap, frame);
      return await callback(pointer);
    } finally {
      try {
        if (constructed) await call(this.abi.bitmapRelease);
        else p.free(pointer);
      } finally {
        this.pendingBitmaps--;
      }
    }
  }
  async writeLogicalBitmap(pointer, bitmap, frame = null) {
    frame ??= await bitmap.frame();
    const p = this.process,
      state = bitmap.state,
      data = p.load(pointer + 12),
      stride = p.load(pointer + 20);
    if (
      p.load(pointer + 4) !== frame.width ||
      p.load(pointer + 8) !== frame.height ||
      p.load(pointer + 24) !== 4 ||
      stride < frame.width * 4
    )
      throw new Error('Native logical bitmap transfer requires matching RGBA32 dimensions');
    const pixels = p.read(data, (frame.height - 1) * stride + frame.width * 4);
    for (let y = 0; y < frame.height; y++) {
      for (let x = 0; x < frame.width; x++) {
        const source = (y * frame.width + x) * 4,
          destination = (frame.height - 1 - y) * stride + x * 4;
        pixels[destination] = frame.rgba[source + 2];
        pixels[destination + 1] = frame.rgba[source + 1];
        pixels[destination + 2] = frame.rgba[source];
        pixels[destination + 3] = frame.rgba[source + 3];
      }
    }
    p.write(data, pixels);
    // Both reviewed bitmap classes expose the same logical canvas and
    // cropped-frame offsets. The font setter deep-copies these pixels.
    for (const [offset, value] of [
      [28, state.canvasWidth],
      [32, state.canvasHeight],
      [36, state.offsetX],
      [40, state.offsetY],
      [48, state.baseX],
      [52, state.baseY],
      [76, state.mask],
      [84, state.blendType],
    ])
      p.store(pointer + offset, value ?? 0);
    (state.clip ?? [0, 0, frame.width, frame.height]).forEach((value, i) =>
      p.store(pointer + 56 + i * 4, value),
    );
  }
  async copyBitmap(pointer, sx, sy, width, height, dx, dy) {
    if (!pointer || (width | 0) <= 0 || (height | 0) <= 0) return 0;
    const original = this.engine?.features?.get('renderer')?.initialized,
      result = original ? await this.rawBitmapUpload(pointer, sx, sy, width, height, dx, dy) : 1;
    if (!result) return result;
    const bitmap = this.bitmap(pointer),
      ox = this.process.load(pointer + 36) | 0,
      oy = this.process.load(pointer + 40) | 0,
      left = Math.max(sx | 0, ox),
      top = Math.max(sy | 0, oy),
      right = Math.min(((sx | 0) + (width | 0)) | 0, (ox + bitmap.width) | 0),
      bottom = Math.min(((sy | 0) + (height | 0)) | 0, (oy + bitmap.height) | 0);
    if (left >= right || top >= bottom) return 0;
    const area = [left - ox, top - oy, right - ox, bottom - oy],
      x = ((dx | 0) + ox) | 0,
      y = ((dy | 0) + oy) | 0;
    if (x < 0) area[0] = Math.min(area[2], area[0] - x);
    if (y < 0) area[1] = Math.min(area[3], area[1] - y);
    if (area[0] < area[2] && area[1] < area[3])
      await this.world.graphics.output(
        bitmap,
        [Math.max(x, 0) - area[0], Math.max(y, 0) - area[1]],
        area,
        { upload: !original },
      );
    return result;
  }
  async rawBitmapUpload(...args) {
    if (!this.engine.features.get('renderer')?.initialized)
      throw new Error('Original texture upload requires its initialized renderer');
    this.nativeUploadDepth++;
    try {
      return await (this.process.asyncEnabled
        ? this.engine.callFromHost(this.abi.bitmapCopy, args, this.refs.view)
        : this.engine.call(this.abi.bitmapCopy, args, this.refs.view));
    } finally {
      this.nativeUploadDepth--;
    }
  }
  async clearBitmap(x, y, width, height) {
    if (!this.engine.features.get('renderer')?.initialized) {
      if ((width | 0) <= 0 || (height | 0) <= 0) return 0;
      await this.world.graphics.fill(x | 0, y | 0, width | 0, height | 0, 0);
      return 1;
    }
    this.nativeClearDepth++;
    let result;
    try {
      const args = [x, y, width, height];
      result = await (this.process.asyncEnabled
        ? this.engine.callFromHost(this.abi.bitmapClear, args, this.refs.view)
        : this.engine.call(this.abi.bitmapClear, args, this.refs.view));
    } finally {
      this.nativeClearDepth--;
    }
    // 6803E0/557000 intersects existing texture pages and clears their actual
    // locked bytes. Its virtual rectangle never becomes a temporary bitmap.
    const graphics = this.world.graphics;
    if (result && graphics.vramHandle)
      await graphics.images.get(graphics.vramHandle).fill(x, y, width, height, 0);
    return result;
  }
  sync() {
    const p = this.process,
      graphics = this.world.graphics,
      projection = graphics.projection();
    const layout = nativeABI(this.engine.profile).graphics.synchronization;
    if (layout) {
      p.write(
        this.refs.manager + layout.managerMatrix,
        new Uint8Array(Float32Array.from(projection.screenMatrix).buffer),
      );
      p.write(
        this.refs.manager + layout.managerShift,
        new Uint8Array(Float32Array.from(projection.screenShift).buffer),
      );
      p.store(this.refs.manager + layout.managerScale, 0x3f800000);
      p.store(
        this.refs.renderer + layout.lastDrawType,
        graphics.d3dContext.lastDrawType ?? 0xffffffff,
      );
      p.store(this.refs.renderer + layout.lastBlend, graphics.d3dContext.lastBlend ?? 0xffffffff);
      p.store(
        this.refs.renderer + layout.depthStencil,
        Number(graphics.d3dContext.depthStencilEnabled),
      );
    }
  }
  pull() {
    const layout = nativeABI(this.engine.profile).graphics.synchronization;
    if (!layout) return;
    const p = this.process,
      context = this.world.graphics.d3dContext;
    context.lastDrawType = p.load(this.refs.renderer + layout.lastDrawType);
    context.lastBlend = p.load(this.refs.renderer + layout.lastBlend);
  }
  snapshot() {
    if (this.pendingBitmaps)
      throw new Error('Cannot checkpoint an in-flight native bitmap transfer');
    return structuredClone({
      refs: this.refs,
      owned: [...this.owned],
      bitmapHandles: [...this.bitmapHandles],
      boundaries: this.nativeBoundaries.map((entry) => entry.trap),
      rendering: this.graphRendering.snapshot(),
    });
  }
  restore(state) {
    this.refs = structuredClone(state.refs);
    this.engine.refs.graphics = this.refs;
    this.owned = new Set(state.owned);
    this.bitmapHandles = new Map(state.bitmapHandles);
    this.graphRendering.restore(state.rendering);
    if (state.boundaries.length !== this.nativeBoundaries.length)
      throw new Error('Native graphics instruction boundary count differs');
    state.boundaries.forEach((trap, index) => (this.nativeBoundaries[index].trap = trap));
  }
  recoverTrap(trap) {
    return this.graphRendering.recoverTrap(trap);
  }
  async close() {
    this.graphRendering.close();
    for (const detach of this.boundaryDetachers) detach();
    this.boundaryDetachers = [];
    for (const handle of this.bitmapHandles.values())
      await this.world.graphics.images.release(handle);
    this.bitmapHandles.clear();
    for (const pointer of this.owned) this.process.free(pointer);
    this.owned.clear();
    this.destroyListeners.clear();
  }
}
