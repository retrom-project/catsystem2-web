// SPDX-License-Identifier: MPL-2.0
// Native task graphics own graph state; construction alone does not load a
// graph. Message contracts come from 5DF010/5E0920 and renderer graph setters.
import { Stage } from '../stage.mjs';
import { NativeGraphicsPlatform } from './graphics-process.mjs';
import { NativeRenderer } from './renderer.mjs';
import { MOTION_ABI, initialMotionObject, motionVector, setMotionVector } from '../motion/abi.mjs';
import { applyObjectMotionState } from '../motion/target.mjs';
import { bitsFloat, floatBits, nativeReply } from '../kcs.mjs';
import { NativeDrawTask, NATIVE_DRAW_IDS, nativeDraw } from './draw-task.mjs';
import { NativeImages, NATIVE_IMAGE_IDS, nativeImage } from './image.mjs';
import { identity } from '../motion/matrix.mjs';
import {
  nativeGraphGeometry,
  rectangleTriangles,
  transformNativeTriangles,
} from '../render/native-geometry.mjs';
import {
  createD3DContext,
  snapshotD3DContext,
  restoreD3DContext,
} from '../render/particles-gl.mjs';
import {
  initializeFESGraphics,
  syncFESGraphics,
  closeFESGraphics,
  setFESBaseImage,
} from './fes-graphics.mjs';
import { NativeView } from './view.mjs';
import {
  NATIVE_MESH_IDS,
  nativeMesh,
  decodeNativeMesh,
  nativeMeshBounds,
  nativeMeshGeometry,
} from './mesh.mjs';
import { NativeTexturePages, negotiateNativeTextureLayout } from './texture-layout.mjs';
import { divideNativeTriangles, nativeDivisionLayout } from './divided-model.mjs';
import { NativeCursor } from './cursor.mjs';
import { nativeInputBitmapMask } from './input.mjs';
import { installNativeRasterKernels } from './raster-kernel.mjs';
import { encodeCP932 } from '../kcs/strings.mjs';
import { NativeTexturePageView } from './texture-memory.mjs';
import { NativeGraphicsPacket, NativePlaneReceiver } from './graphics-task.mjs';
import { installNativeEngineWorkers } from './engine-workers.mjs';
import { NativeVMR9 } from './vmr9.mjs';
import { NativeDirectShow } from './directshow.mjs';
import { installNativePlaneMovieCommands } from './plane-movie-command.mjs';
import { installNativePlaneModelCommands } from './plane-model-command.mjs';
import { NativeTextureMovieRenderer } from './movie-texture-renderer.mjs';
const WHITE = { width: 1, height: 1, rgba: new Uint8Array([255, 255, 255, 255]) };
const BASE_PLANE_MESSAGES = new Set([
  3, 4, 5, 6, 7, 8, 19, 47, 48, 50, 52, 53, 54, 89, 90, 92, 93, 94, 95, 96, 97, 98, 99, 100,
]);
const GRAPHIC_TASK_LAYOUTS = {
  'nekopara-vol3-engine-2.6.1.76': {
    2: { construct: 0x5df7a0, size: 0x2ac },
    6: { construct: 0x5decc0, size: 0xa4 },
  },
  'sdk-4.01-engine-2.6.1.74': {
    2: { construct: 0x4bbb50, size: 0x2ac },
    6: { construct: 0x4bb080, size: 0xa4 },
  },
};

export class NativeGraphics {
  nativeCameraMemory() {
    const engine = this.world.nativeEngine,
      platform = engine?.features.get('graphics-platform');
    return engine?.features.get('renderer')?.initialized && platform?.refs.manager
      ? { process: engine.process, address: platform.refs.manager + 224 }
      : null;
  }
  get cameraNear() {
    const memory = this.nativeCameraMemory();
    return memory ? bitsFloat(memory.process.load(memory.address)) : this.cameraNearValue;
  }
  set cameraNear(value) {
    this.cameraNearValue = Math.fround(value);
    const memory = this.nativeCameraMemory();
    if (memory) memory.process.store(memory.address, floatBits(value));
  }
  constructor(world) {
    this.world = world;
    this.tasks = new Map();
    this.graphs = new Map();
    this.renderSequence = 0;
    this.nativeRenderOrder = new Map();
    this.stage = new Stage(world.game.width, world.game.height, Number);
    this.stage.motionLibrary = world.motionLibrary;
    this.images = new NativeImages(world);
    this.cursor = new NativeCursor(this);
    this.drawTasks = new Map();
    this.fesSurfaces = new Map();
    this.vramHandle = 0;
    this.screenMatrix = identity();
    this.screenShift = [0, 0];
    this.cameraNear = 1000;
    this.d3dContext = createD3DContext();
    const screen = world.configuration?.screen;
    this.view = new NativeView({
      virtualWidth: screen?.virtualWidth ?? world.game.width,
      virtualHeight: screen?.virtualHeight ?? world.game.height,
      clientWidth: screen?.currentWidth ?? world.game.width,
      clientHeight: screen?.currentHeight ?? world.game.height,
    });
    Object.defineProperty(this.stage, 'nativeGraphics', { value: this });
  }
  get(id) {
    return this.tasks.get(id >>> 0) || null;
  }
  virtualSize() {
    const engine = this.world.nativeEngine;
    if (!engine?.features.get('renderer')?.initialized) return this.view.virtualSize();
    const view = engine.features.get('graphics-platform').refs.view;
    return [engine.process.load(view + 24), engine.process.load(view + 28)];
  }
  get cursorAllowed() {
    return this.cursor.state.allowed;
  }
  set cursorAllowed(value) {
    this.cursor.state.allowed = value >>> 0;
  }
  initializeTextures() {
    const engine = this.world.nativeEngine;
    if (engine?.features.get('renderer')?.initialized) {
      if (!(this.texturePages instanceof NativeTexturePageView)) {
        this.texturePages?.close();
        this.texturePages = new NativeTexturePageView(engine.features.get('graphics-platform'));
      }
      return;
    }
    if (this.texturePages) return;
    const texture = this.world.configuration?.fields.texture;
    if (!texture) throw new Error('Native texture configuration is unavailable');
    const gpu = this.world.getNativeGPU?.(),
      gl = gpu?.gl,
      maximum = gl?.getParameter(gl.MAX_TEXTURE_SIZE),
      layout = negotiateNativeTextureLayout(
        texture,
        maximum ? { width: maximum, height: maximum } : undefined,
      );
    texture.size.set(layout.configurationSize);
    for (const field of ['grid', 'bppY']) texture[field].set(layout[field]);
    texture.areas.forEach((row, i) => row.set(layout.areas[i]));
    this.texturePages = new NativeTexturePages(layout, {
      release: (frame) => this.world.getNativeGPU?.()?.releaseTextureFrame(frame),
    });
  }
  async meshTexture(index) {
    this.initializeTextures();
    return this.texturePages.frame(index);
  }

  surface(id) {
    const draw = this.drawTasks.get(id >>> 0);
    if (!draw?.state.renderer) throw new Error(`Native drawing surface ${id} is not initialized`);
    const handle = draw.state.renderer.bitmap,
      bitmap = this.images.get(handle);
    return {
      task: id,
      handle,
      bitmap,
      width: bitmap.width,
      height: bitmap.height,
      offset: draw.state.offset && [...draw.state.offset],
      context: () => bitmap.context(),
    };
  }
  bindFES(id, player, owner = player?.root?.runtimeID ?? player?.nativeOwner) {
    this.surface(id);
    if (!player) return;
    if (!Number.isSafeInteger(owner))
      throw new Error('FES surface binding requires its native owner task');
    this.rememberFESSurface(id, player);
    for (const players of this.fesSurfaces.values()) players.delete(owner);
    if (!this.fesSurfaces.has(id)) this.fesSurfaces.set(id, new Map());
    this.fesSurfaces.get(id).set(owner, player);
    player.nativeGraphics = this;
  }
  rememberFESSurface(id, player) {
    const draw = this.drawTasks.get(id),
      renderer = draw?.state.renderer;
    if (!renderer) return false;
    player.nativeDraw = {
      target: this.world.objects.objects.get(id)?.nativeID ?? id,
      width: renderer.width,
      height: renderer.height,
      offset: [...(draw.state.offset ?? [0, 0])],
    };
    return true;
  }
  async ensureVRAM(width, height) {
    let bitmap = this.vramHandle ? this.images.get(this.vramHandle) : null;
    if (bitmap && bitmap.width >= width && bitmap.height >= height) return bitmap;
    const next = this.images.create(
      Math.max(width, bitmap?.width || 0),
      Math.max(height, bitmap?.height || 0),
    );
    if (bitmap) {
      await this.images.get(next).blit(bitmap, { copy: true });
      await this.images.release(this.vramHandle);
    }
    this.vramHandle = next;
    return this.images.get(next);
  }
  async fill(x, y, width, height, color = 0) {
    const engine = this.world.nativeEngine;
    if (color === 0 && engine?.features.get('renderer')?.initialized)
      return engine.features.get('graphics-platform').clearBitmap(x, y, width, height);
    const vram = await this.ensureVRAM(
      Math.max(this.world.game.width, x + width),
      Math.max(this.world.game.height, y + height),
    );
    await vram.fill(x, y, width, height, color);
    this.initializeTextures();
    await this.texturePages.upload(vram, [x, y, x + width, y + height]);
  }
  async output(bitmap, offset, region = null, { upload = true } = {}) {
    const [x, y] = offset,
      area = region || [0, 0, bitmap.width, bitmap.height];
    const vram = await this.ensureVRAM(
      Math.max(this.world.game.width, x + bitmap.width),
      Math.max(this.world.game.height, y + bitmap.height),
    );
    await vram.blit(bitmap, {
      dx: x + area[0],
      dy: y + area[1],
      sx: area[0],
      sy: area[1],
      width: area[2] - area[0],
      height: area[3] - area[1],
      copy: true,
    });
    this.initializeTextures();
    if (upload)
      await this.texturePages.upload(vram, [x + area[0], y + area[1], x + area[2], y + area[3]]);
  }
  async prepareRender() {
    for (const [id, players] of this.fesSurfaces) {
      const draw = this.drawTasks.get(id);
      if (!draw?.state.renderer) continue;
      for (const owner of players.keys())
        if (!this.world.objects.objects.has(owner)) players.delete(owner);
    }
    for (const draw of this.drawTasks.values()) await draw.render();
  }
  syncFES(record, player, options) {
    return syncFESGraphics(this, record, player, options);
  }
  initializeFES(record, player) {
    return initializeFESGraphics(this, record, player);
  }
  closeFES(record, player) {
    return closeFESGraphics(this, record, player);
  }
  async setFESSleep(record, player, value) {
    if (!player?.root) return;
    const input = player.nativeInput || record.implementation?.input;
    if (!input?.state || typeof input.sync !== 'function')
      throw new Error(`FES ${player.root.name} sleep requires its native input mapping`);
    player.nativeInput = input;
    await player.notify(value ? '_FES_SLEEP_' : '_FES_WAKE_');
    await this.syncFES(record, player);
    input.state.sleeping = Boolean(value);
    // The temporary mask does not modify script-owned disp/enable values.
    await input.sync();
    await this.syncFES(record, player);
    const owner = record.id,
      surfaceID =
        record.implementation?.surface ??
        [...this.fesSurfaces].find(([, players]) => players.get(owner) === player)?.[0],
      draw = surfaceID == null ? null : this.drawTasks.get(surfaceID);
    const retained = new Set([
      'CIMAGE',
      'IMAGE',
      'BUTTON',
      'PANEL',
      'SAVEPANEL',
      'BGTABLE',
      'BGTABLE2',
      'CHTABLE',
      'CHTABLE2',
      'CHTABLE3',
      'IMGWND',
      'DIFIMAGE',
    ]);
    for (const object of player.root.objects) {
      if (object.deleted) continue;
      if (retained.has(object.type) && draw?.state.renderer)
        await draw.message([
          owner,
          287,
          (owner | (object.handle << 16)) >>> 0,
          Number(!value && object.disp),
        ]);
      if (object.nativeTaskID == null) continue;
      const taskID = object.nativeTaskID,
        display = Number(!value && object.disp),
        enable = Number(!value && object.enable);
      if (
        [
          'PLANE',
          'CPLANE',
          'M2PLANE',
          'EFKPLANE',
          'STRING',
          'STRING8',
          'NVSTRING',
          'DRAW',
        ].includes(object.type)
      )
        await this.send(taskID, owner, 47, 0, display);
      else if (object.type === 'WIPE') {
        if (value) await this.send(taskID, owner, 258, 0, 0);
      } else if (['SCROLL', 'SCROLL2', 'SLIDER'].includes(object.type)) {
        const [enabledMessage, shownMessage] =
          object.type === 'SCROLL'
            ? [355, 354]
            : object.type === 'SCROLL2'
              ? [369, 373]
              : [361, 360];
        await this.send(taskID, owner, enabledMessage, 0, enable);
        await this.send(taskID, owner, shownMessage, 0, display);
      }
    }
    if (!value && draw?.state.renderer) await draw.message([owner, 292, 0, 0]);
  }
  baseImage(instance, object) {
    return setFESBaseImage(this, instance, object);
  }
  async flushFESRedraw(instance) {
    if (!instance.forceRedrawPending) return;
    const surfaceID = [...this.fesSurfaces].find(
      ([, players]) => players.get(instance.runtimeID) === instance.player,
    )?.[0];
    const draw = surfaceID == null ? null : this.drawTasks.get(surfaceID);
    if (!draw?.state.renderer)
      throw new Error(`FES ${instance.name} force_redraw requires its native drawing surface`);
    await draw.message([instance.runtimeID, 292, 0, 0]);
    instance.forceRedrawPending = false;
  }
  drawItems() {
    return this.cursor.drawItems();
  }
  projection() {
    return {
      width: this.world.game.width,
      height: this.world.game.height,
      screenMatrix: this.screenMatrix,
      screenShift: this.screenShift,
      cameraNear: this.cameraNear,
    };
  }
  allocateRenderOrder() {
    return ++this.renderSequence;
  }
  snapshot() {
    return structuredClone({
      vramHandle: this.vramHandle,
      d3dContext: snapshotD3DContext(this.d3dContext),
      view: this.view.snapshot(),
      screenMatrix: this.screenMatrix,
      screenShift: this.screenShift,
      cameraNear: this.cameraNear,
      texturePages: this.texturePages?.snapshot() ?? null,
      cursor: this.cursor.snapshot(),
      renderSequence: this.renderSequence,
      nativeRenderOrder: [...this.nativeRenderOrder],
    });
  }
  restore(state) {
    const { d3dContext, view, texturePages, cursor, nativeRenderOrder, ...values } =
      structuredClone(state);
    Object.assign(this, values);
    this.nativeRenderOrder = new Map(nativeRenderOrder);
    this.d3dContext = restoreD3DContext(d3dContext);
    this.view.restore(view);
    this.texturePages =
      texturePages && !texturePages.native
        ? new NativeTexturePages(texturePages.layout, {
            release: (frame) => this.world.getNativeGPU?.()?.releaseTextureFrame(frame),
          })
        : null;
    if (texturePages && !texturePages.native) this.texturePages.restore(texturePages);
    this.cursor.restore(cursor);
    this.fesSurfaces.clear();
  }
  create(record) {
    const task = new NativeGraphicTask(this, record);
    this.tasks.set(record.id, task);
    return task;
  }
  async send(target, sender, id, w = 0, l = 0, payload = null, flags = 0) {
    return this.world.sendEngine(target, sender, id, w, l, {
      ...(payload ? { payload } : {}),
      flags,
    });
  }

  attachment(id) {
    const platform = this.world.nativeEngine?.features.get('graphics-platform'),
      native = platform?.attachment(id);
    if (native) return native;
    const graph = this.graphs.get(id >>> 0);
    if (!graph) return null;
    const bytes = graph.kx2,
      view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
    return {
      base: motionVector(bytes, MOTION_ABI.base),
      pos: motionVector(bytes, MOTION_ABI.pos),
      matrix: Array.from({ length: 16 }, (_, i) =>
        view.getFloat32(MOTION_ABI.matrix + i * 4, true),
      ),
      display: view.getInt32(MOTION_ABI.display, true) !== 0,
    };
  }
  graphHandle(taskID) {
    const task = this.tasks.get(taskID >>> 0);
    if (task?.receiver)
      return task.nativePlatform.descriptor(task.record.nativeID) ? task.record.nativeID : -1;
    return task?.graph ? taskID >>> 0 : -1;
  }
  customGraph(record, { width, height, drawGPU }) {
    if (!Number.isFinite(width) || !Number.isFinite(height) || typeof drawGPU !== 'function')
      throw new TypeError('Native custom graphics require bounds and a GPU callback');
    const plane = this.create(record);
    plane.makeGraph({ type: 1, width, height, custom: true });
    Object.defineProperty(plane, 'drawGPU', {
      configurable: true,
      value: (gpu) => drawGPU(gpu, plane),
    });
    return plane;
  }
}

export class NativeGraphicTask {
  constructor(graphics, record) {
    this.graphics = graphics;
    this.world = graphics.world;
    this.record = record;
    this.base = this.world.base(record);
    // Base plane 5DECC0 and simple plane 5DF7A0 constructor values.
    this.state = {
      receiver: -1,
      changed: 0,
      inheritPosition: false,
      parentOffset: [0, 0, 0],
      inheritDisplay: true,
      bindFlags: 0,
      bindArea: [0, 0, 0, 0],
      bindExtra: 0,
      rect: [0, 0, 0, 0],
      imageIndex: -1,
      shown: true,
      blocked: false,
      phase: 0,
      renderType: 1,
      drawType: 0,
      shapeWords: [],
      blendMode: 0,
      colorOverride: false,
      coordMode: 0,
      vramType: 1,
      after: null,
    };
    this.graph = null;
    this.pointer = 0;
  }
  async prepareNative({ fromHost = false } = {}) {
    if (this.nativeLayout) return this.pointer;
    const engine = this.world.nativeEngine,
      layout = GRAPHIC_TASK_LAYOUTS[engine?.profile]?.[this.record.kind];
    if (!layout) throw new Error('Native graph preparation requires a reviewed plane task');
    this.nativePlatform = await this.world.getNativeFeature('graphics-platform');
    this.taskMemory = await this.world.getNativeFeature('task-memory');
    const p = engine.process,
      name = encodeCP932(this.record.name + '\0'),
      source = p.allocate(name.length, true);
    this.pointer = p.allocate(layout.size, true);
    this.taskMemory.bind(this.record, this.pointer, { ready: false });
    p.write(source, name);
    let constructed = false;
    try {
      await engine[fromHost || p.asyncEnabled ? 'callFromHost' : 'call'](
        layout.construct,
        [
          this.record.nativeID ?? this.record.id,
          source,
          this.record.frameRate,
          this.nativePlatform.refs.view,
        ],
        this.pointer,
        { task: this.record.id },
      );
      constructed = true;
      this.nativeLayout = layout;
      await this.taskMemory.ready(this.record);
      this.bindOriginalReceiver();
      return this.pointer;
    } catch (error) {
      if (constructed) await this.close({ fromHost });
      else {
        this.taskMemory.unbind(this.record.id);
        p.free(this.pointer);
        this.pointer = 0;
      }
      throw error;
    } finally {
      p.free(source);
    }
  }
  get input() {
    return this.world.inputFor?.(this.record.id);
  }
  bindOriginalReceiver() {
    this.receiver = new NativePlaneReceiver(this);
    this.state = null;
  }
  beforeChildren() {
    this.receiver?.beforeChildren();
  }
  drawTick(frame) {
    return this.receiver?.drawTick(frame);
  }
  machine(sender) {
    const machine = this.world.objects.machine(sender);
    if (!machine)
      throw new Error(
        `Native graphic task ${this.record.id} requires sender ${sender}'s VM memory`,
      );
    return machine;
  }
  sync() {
    if (!this.graph) {
      delete this.graphics.stage.planes[this.record.id];
      return;
    }
    const plane = this.graphics.stage.plane(this.record.id);
    applyObjectMotionState(plane, this.graph.kx2, { scaleUnit: 100, visible: 'visible' });
    Object.assign(plane, {
      width: this.graph.width,
      height: this.graph.height,
      priority: motionVector(this.graph.kx2, MOTION_ABI.base)[2],
      blendMode: this.state.blendMode,
      nativeGraph: this.graph,
      visible: plane.visible && this.state.shown,
    });
    if (this.graph.colors?.length === 1) plane.color = this.graph.colors[0];
  }
  unload() {
    this.graphics.graphs.delete(this.record.id);
    this.graph = null;
    this.state.rect = [0, 0, 0, 0];
    this.state.drawType = 0;
    this.sync();
  }
  makeGraph(shape) {
    if (this.receiver)
      throw new Error('Mounted planes create models through their original receiver');
    this.graph = {
      ...shape,
      renderOrder: this.graphics.allocateRenderOrder(),
      kx2: initialMotionObject(),
      textureTransform: initialMotionObject(),
      matrixExplicit: false,
      textureMatrixExplicit: false,
    };
    this.graphics.graphs.set(this.record.id, this.graph);
    this.state.rect = [0, 0, Math.abs(shape.width), Math.abs(shape.height)];
    this.state.colorOverride = false;
    this.state.drawType = shape.type;
    this.sync();
  }
  async message(words, context = {}) {
    if (this.receiver) return this.receiver.message(words, context);
    const [sender, id, w, l] = words;
    if (this.record.kind === 6 && !BASE_PLANE_MESSAGES.has(id))
      return this.base.message(words, context);
    const load = (address) =>
      context.payload
        ? context.payload.load(address)
        : this.machine(context.nativeSenderWorldID ?? sender).load(address);
    const store = (address, value) =>
      context.payload
        ? context.payload.store(address, value)
        : this.machine(context.nativeSenderWorldID ?? sender).store(address, value);
    const bytes = (address, size) =>
      context.payload
        ? context.payload.bytes(address, size)
        : this.machine(context.nativeSenderWorldID ?? sender).bytes(address, size);
    const floats = (address, count) =>
      Array.from({ length: count }, (_, i) => bitsFloat(load(address + i * 4)));
    const put = (address, values) => values.forEach((v, i) => store(address + i * 4, floatBits(v)));
    const transformState = () => (w ? this.graph?.textureTransform : this.graph?.kx2);
    const vector = (offset) => (this.graph ? motionVector(transformState(), offset) : [0, 0, 0]);
    const setVector = (offset, values) => {
      if (this.graph) setMotionVector(transformState(), offset, values);
    };
    switch (id) {
      case 3:
        this.closeGraph();
        return this.base.message(words, context);
      case 19:
        return 0;
      case 4:
      case 5:
      case 6: {
        await this.forwardInput(
          id === 4 ? (l ? 9 : 10) : id === 5 ? 65 : 6,
          id === 6 ? w : this.record.nativeID,
          id === 6 ? l : w,
          context,
        );
        const changed = this.state.changed;
        this.state.changed = 0;
        return changed;
      }
      case 7:
      case 8:
        await this.forwardInput(64, this.record.nativeID, id === 7 ? 1 : 0, context);
        return 0;
      case 41: {
        const numbers = floats(l, 7);
        this.state.shapeWords = Array.from({ length: 8 }, (_, i) => load(l + i * 4));
        this.makeGraph({
          type: 1,
          x: numbers[0],
          y: numbers[1],
          z: numbers[2],
          width: numbers[3],
          height: numbers[4],
          vram: true,
        });
        return 0;
      }
      case 42: {
        const numbers = floats(l, 5),
          color = load(l + 28);
        this.state.shapeWords = Array.from({ length: 8 }, (_, i) => load(l + i * 4));
        this.makeGraph({
          type: 2,
          x: numbers[0],
          y: numbers[1],
          z: numbers[2],
          width: numbers[3],
          height: numbers[4],
          colors: [color],
          vram: false,
        });
        return 0;
      }
      case 47:
        this.state.shown = Boolean(l);
        this.setInputDisplay();
        this.sync();
        return 0;
      case 48:
        if (this.graph)
          new DataView(this.graph.kx2.buffer).setInt32(
            MOTION_ABI.display,
            Number(Boolean(l)),
            true,
          );
        this.sync();
        this.setInputDisplay();
        await this.broadcast(48, w, l, context);
        return 0;
      case 49:
        if (this.state.inheritPosition && !w) this.inheritTransform();
        else setVector(MOTION_ABI.base, floats(l, 3));
        this.sync();
        await this.broadcast(50, w, l, context);
        return 0;
      case 50:
      case 52:
        if (this.state.inheritPosition && !w) this.inheritTransform();
        this.sync();
        await this.broadcast(id, w, l, context);
        return 0;
      case 54:
        this.state.inheritPosition = false;
        return 0;
      case 51:
        if (this.state.inheritPosition && !w) this.inheritTransform();
        else setVector(MOTION_ABI.pos, floats(l, 3));
        this.sync();
        await this.broadcast(52, w, l, context);
        return 0;
      case 53:
        this.state.inheritPosition = true;
        this.state.parentOffset = floats(l, 3);
        this.inheritTransform();
        this.sync();
        return 0;
      case 55:
        setVector(MOTION_ABI.rotation, floats(l, 3));
        if (this.graph) this.graph[w ? 'textureMatrixExplicit' : 'matrixExplicit'] = false;
        this.sync();
        await this.broadcast(56, w, l, context);
        return 0;
      case 56:
      case 58:
      case 67:
        if (this.state.inheritPosition && this.graph) {
          if (id === 56) {
            setVector(MOTION_ABI.rotation, floats(l, 3));
            this.graph[w ? 'textureMatrixExplicit' : 'matrixExplicit'] = false;
          } else if (id === 58) {
            transformState().set(bytes(l, 64), MOTION_ABI.matrix);
            this.graph[w ? 'textureMatrixExplicit' : 'matrixExplicit'] = true;
          } else setMotionVector(this.graph.kx2, MOTION_ABI.scale, floats(l, 3));
          this.sync();
        }
        await this.broadcast(id, w, l, context);
        return 0;
      case 57:
        if (this.graph) {
          transformState().set(bytes(l, 64), MOTION_ABI.matrix);
          this.graph[w ? 'textureMatrixExplicit' : 'matrixExplicit'] = true;
        }
        this.sync();
        await this.broadcast(58, w, l, context);
        return 0;
      case 59:
        if (this.graph) new DataView(this.graph.kx2.buffer).setUint32(MOTION_ABI.color, l, true);
        this.state.colorOverride = Boolean(w);
        this.sync();
        return 0;
      case 60:
      case 71:
      case 85:
      case 86:
        return 0; // Explicit original simple-plane empty branches.
      case 61:
        put(l, vector(MOTION_ABI.base));
        return 0;
      case 62:
        put(l, vector(MOTION_ABI.pos));
        return 0;
      case 63:
        if (this.graph) {
          const view = new DataView(this.graph.kx2.buffer);
          view.setUint32(
            MOTION_ABI.color,
            ((l & 255) << 24) | (view.getUint32(MOTION_ABI.color, true) & 0xffffff),
            true,
          );
        }
        this.state.colorOverride = true;
        this.sync();
        return 0;
      case 66:
        // 6774E0 always selects the geometry graph, ignoring message wParam.
        if (this.graph) setMotionVector(this.graph.kx2, MOTION_ABI.scale, floats(l, 3));
        this.sync();
        await this.broadcast(67, w, l, context);
        return 0;
      case 68:
        this.unload();
        return 0;
      case 74:
        return ((this.state.blocked ? 0x80000000 : 0) | this.state.phase) >>> 0;
      case 75:
        put(w, [this.state.rect[2]]);
        put(l, [this.state.rect[3]]);
        return 0;
      case 76:
        put(w, [this.state.rect[0], this.state.rect[1], 0]);
        put(l, [
          this.state.rect[0] + this.state.rect[2],
          this.state.rect[1] + this.state.rect[3],
          0,
        ]);
        return 0;
      case 77:
        this.state.imageIndex = l | 0;
        return 0;
      case 78:
        this.state.frameStep = l;
        return 0;
      case 81:
        this.state.blendMode = l >= 1 && l <= 5 ? l : 0;
        this.sync();
        return 0;
      case 82:
        this.state.coordMode = l;
        return 0;
      case 83: {
        const rect = this.state.rect,
          drawType = this.state.drawType;
        this.unload();
        const mesh = decodeNativeMesh(bytes(l, (w >>> 0) * 80)),
          bounds = nativeMeshBounds(mesh);
        this.makeGraph({
          type: 3,
          mesh,
          bounds,
          width: bounds.maximum[0] - bounds.minimum[0],
          height: bounds.maximum[1] - bounds.minimum[1],
          vram: true,
        });
        this.state.rect = rect;
        this.state.drawType = drawType;
        this.state.colorOverride = true;
        return 0;
      }
      case 84:
        this.state.vramType = l;
        return 0;
      case 89: {
        if (this.state.receiver !== -1) return 0;
        if (!this.input?.register)
          throw new Error('Native plane input registration is unavailable');
        const fields = Array.from({ length: 6 }, (_, i) => load(l + i * 4));
        const bounds = fields.slice(0, 4).map((v) => v | 0);
        const full =
          bounds[0] <= 0 &&
          bounds[1] <= 0 &&
          bounds[2] >= this.world.game.width &&
          bounds[3] >= this.world.game.height;
        await this.input.register({
          owner: this.record.id,
          receiver: sender,
          bounds: full ? [-100000, -100000, 100000, 100000] : bounds,
          priority: fields[4] | 0,
          flags: fields[5],
          mask: 7,
          extra: 0,
        });
        this.state.bindArea = bounds;
        this.state.bindFlags = fields[5];
        this.state.receiver = sender;
        this.state.changed = 1;
        return 1;
      }
      case 90:
        if (this.state.receiver !== -1) {
          if (!this.input?.unregister) throw new Error('Native plane input removal is unavailable');
          await this.input.unregister(this.record.id);
          this.state.receiver = -1;
          this.state.changed = 1;
        }
        return 0;
      case 94:
        this.state.changed = l;
        return 0;
      case 92: {
        const region = this.input?.get(this.record.id);
        if (this.state.receiver !== -1 && region) {
          region.enabled = Boolean(l);
          if (!l) region.active = false;
          this.input.changed = true;
        }
        return 0;
      }
      case 93: {
        const region = this.input?.get(this.record.id);
        if (this.state.receiver !== -1 && region) {
          if (l) for (const other of this.input.regions) other.active = false;
          region.active = Boolean(l);
        }
        return 0;
      }
      case 95:
        return this.input?.source === 16 ? 2 : (this.input?.source ?? 0);
      case 98:
      case 99: {
        const region = this.input?.get(this.record.id);
        if (this.state.receiver !== -1 && region) {
          region[id === 98 ? 'hoverEnabled' : 'dragEnabled'] = Boolean(l);
          this.input.changed = true;
        }
        return 0;
      }
      case 96:
        this.state.receiver = l | 0;
        return 0;
      case 97: {
        const region = this.input?.get(this.record.id);
        if (!region) return 0;
        if (!l) {
          region.alpha = null;
          return 0;
        }
        region.alpha = context.nativePointer
          ? await this.input.services.alphaMask(l, context)
          : await nativeInputBitmapMask(this.graphics.images.get(l));
        this.input.changed = true;
        return 0;
      }
      case 100: {
        const region = this.input?.get(this.record.id),
          bounds = Array.from({ length: 4 }, (_, i) => load(l + i * 4) | 0);
        this.state.bindArea = bounds;
        if (region) {
          region.bounds =
            bounds[0] <= 0 &&
            bounds[1] <= 0 &&
            bounds[2] >= this.world.game.width &&
            bounds[3] >= this.world.game.height
              ? [-100000, -100000, 100000, 100000]
              : bounds;
          this.input.changed = true;
        }
        return 0;
      }
      default:
        if ([43, 44, 45, 46, 69, 70, 72, 73, 79, 80, 87, 88].includes(id))
          throw new Error(`Native graphic message ${id} requires its complete plane adapter`);
        return this.base.message(words, context);
    }
  }
  async forwardInput(message, w, l, context = {}) {
    if (this.state.receiver === -1) return;
    return this.world.sendNativeEngine(this.state.receiver, this.record.id, message, w, l, {
      ...context,
    });
  }
  setInputDisplay() {
    const region = this.input?.get(this.record.id);
    if (!region) return;
    const parent = this.graphics.get(this.record.parent),
      display =
        !this.state.inheritPosition ||
        !parent?.graph ||
        Boolean(new DataView(parent.graph.kx2.buffer).getInt32(MOTION_ABI.display, true));
    region.enabled = this.state.shown && display;
    if (!region.enabled) region.active = false;
    this.input.changed = true;
  }
  inheritTransform() {
    const parent = this.graphics.get(this.record.parent),
      base = parent?.graph ? motionVector(parent.graph.kx2, MOTION_ABI.base) : [0, 0, 0],
      pos = parent?.graph ? motionVector(parent.graph.kx2, MOTION_ABI.pos) : [0, 0, 0],
      offset = this.state.parentOffset;
    if (this.graph) {
      setMotionVector(this.graph.kx2, MOTION_ABI.base, [
        Math.fround(base[0] - offset[0]),
        Math.fround(base[1] - offset[1]),
        Math.fround(base[2] + offset[2]),
      ]);
      setMotionVector(this.graph.kx2, MOTION_ABI.pos, pos);
    } else {
      const region = this.input?.get(this.record.id);
      if (region) {
        const width = region.bounds[2] - region.bounds[0],
          height = region.bounds[3] - region.bounds[1],
          x = Math.trunc(Math.fround(Math.fround(base[0] + pos[0]) + offset[0])),
          y = Math.trunc(Math.fround(Math.fround(base[1] + pos[1]) + offset[1]));
        region.bounds = [x, y, x + width, y + height];
        this.input.changed = true;
      }
    }
  }
  async broadcast(message, w, l, context) {
    for (const task of this.graphics.tasks.values())
      if (task.record.parent === this.record.id)
        await this.world.sendEngine(task.record.id, this.record.id, message, w, l, context);
  }
  async drawGPU(gpu) {
    if (
      !this.graph ||
      !this.state.shown ||
      this.graph.renderEnabled === false ||
      !new DataView(this.graph.kx2.buffer).getInt32(MOTION_ABI.display, true)
    )
      return;
    if (this.graph.mesh || this.graph.vram) {
      this.graphics.initializeTextures();
      let graph = this.graph;
      if (!graph.mesh) {
        const source = graph.textureTransform.slice(),
          offset = motionVector(graph.kx2, MOTION_ABI.vram),
          position = motionVector(source, MOTION_ABI.pos).map((v, i) => Math.fround(v + offset[i]));
        setMotionVector(source, MOTION_ABI.pos, position);
        const layout = this.graphics.texturePages.layout,
          division = nativeDivisionLayout(layout.configurationSize, layout.grid),
          triangles = transformNativeTriangles(
            graph.triangles || rectangleTriangles(graph),
            source,
            { useEuler: !graph.textureMatrixExplicit },
          );
        graph = { ...graph, mesh: divideNativeTriangles(triangles, division, position) };
      }
      for (const item of nativeMeshGeometry(graph, this.state, this.graphics.projection())) {
        const frame =
          item.textureID === -1 ? WHITE : await this.graphics.meshTexture(item.textureID);
        gpu.drawGeometry([item], frame, {
          blendMode: this.state.blendMode,
          context: this.graphics.d3dContext,
          drawType: 0,
        });
      }
      return;
    }
    gpu.drawGeometry(
      nativeGraphGeometry(this.graph, this.state, this.graphics.projection()),
      WHITE,
      { blendMode: this.state.blendMode, context: this.graphics.d3dContext, drawType: 0 },
    );
  }
  snapshot() {
    if (this.receiver) return { pointer: this.pointer };
    return structuredClone({ state: this.state, graph: this.graph, pointer: this.pointer });
  }
  restore(data) {
    this.pointer = data.pointer ?? 0;
    if (this.pointer && [2, 6].includes(this.record.kind)) {
      const engine = this.world.nativeEngine;
      this.nativeLayout = GRAPHIC_TASK_LAYOUTS[engine.profile][this.record.kind];
      this.nativePlatform = engine.features.get('graphics-platform');
      this.taskMemory = engine.features.get('task-memory');
      if (engine.process.load(this.pointer + 4) !== (this.record.nativeID ?? this.record.id))
        throw new Error('Native graphic checkpoint task identity differs');
      this.bindOriginalReceiver();
      return;
    }
    this.state = structuredClone(data.state);
    this.graph = structuredClone(data.graph);
    if (this.graph) this.graphics.graphs.set(this.record.id, this.graph);
    this.sync();
  }
  closeGraph() {
    if (this.receiver) this.receiver.close();
    else {
      this.input?.unregister(this.record.id);
      this.unload();
    }
    this.graphics.tasks.delete(this.record.id);
  }
  async close({ fromHost = false } = {}) {
    if (this.nativeClosed) return;
    try {
      if (this.nativeLayout && this.pointer) {
        const engine = this.world.nativeEngine,
          p = engine.process;
        await engine[fromHost || p.asyncEnabled ? 'callFromHost' : 'call'](
          p.load(p.load(this.pointer)),
          [1],
          this.pointer,
          { task: this.record.id },
        );
      }
    } finally {
      if (this.nativeLayout) this.taskMemory.unbind(this.record.id);
      this.closeGraph();
      this.nativeClosed = true;
    }
  }
}

export function installNativeGraphics(world) {
  if (world.registerNativeFeature) {
    world.registerNativeFeature('renderer', (engine) => NativeRenderer.open(engine, world));
    world.registerNativeFeature('vmr9', (engine) => new NativeVMR9(engine));
    world.registerNativeFeature(
      'texture-movie-renderer',
      (engine) => new NativeTextureMovieRenderer(engine),
    );
    world.registerNativeFeature('directshow', async (engine) => {
      await world.getNativeFeature('engine-workers');
      return new NativeDirectShow(engine, world, await world.getNativeFeature('vmr9'));
    });
    installNativePlaneMovieCommands(world);
    installNativePlaneModelCommands(world);
    world.registerNativeFeature('engine-workers', (engine) => installNativeEngineWorkers(engine));
    world.registerNativeFeature('raster-kernels', (engine) => installNativeRasterKernels(engine));
    world.registerNativeFeature('graphics-platform', async (engine) => {
      await world.getNativeFeature('bitmap-memory');
      return new NativeGraphicsPlatform(engine, world);
    });
  }
  const graphics = new NativeGraphics(world);
  world.graphics = graphics;
  // Kind 2 is the native simple plane; kind 6 is its base image-plane task.
  for (const kind of [2, 6])
    world.objects.register(kind, async (record, _objects, options = {}) => {
      const task = graphics.create(record);
      if (!options.restoring && world.nativeEngine?.module) await task.prepareNative(options);
      return task;
    });
  world.objects.register(15, (record) => {
    const task = new NativeDrawTask(graphics, record);
    graphics.drawTasks.set(record.id, task);
    return task;
  });
  for (const id of NATIVE_IMAGE_IDS)
    world.runtime.register('main', id, (args, machine, task) =>
      nativeImage(id, args, machine, task, world),
    );
  for (const id of NATIVE_DRAW_IDS)
    world.runtime.register('main', id, (args, machine, task) =>
      nativeDraw(id, args, machine, task, world),
    );
  for (const id of NATIVE_GRAPHICS_IDS)
    world.runtime.register('main', id, (args, machine, task) =>
      nativeGraphics(id, args, machine, task, world),
    );
  for (const id of NATIVE_MESH_IDS)
    world.runtime.register('main', id, (args, machine, task) =>
      nativeMesh(id, args, machine, task, world),
    );
  return graphics;
}

export const NATIVE_GRAPHICS_IDS = Object.freeze([
  0x4e, 0x4f, 0x50, 0x53, 0x54, 0x55, 0x56, 0x57, 0x58, 0x59, 0x5a, 0x5b, 0x5c, 0x5d, 0x5e, 0x62,
  0x63, 0x64, 0x65, 0x66, 0x67, 0x68, 0x69, 0x6a, 0x6c, 0x6d, 0x6e, 0x350, 0x351, 0x157, 0x158,
  0x159, 0x192, 0x21d, 0x21e,
]);

export async function nativeGraphics(id, args, machine, task, world) {
  if (!NATIVE_GRAPHICS_IDS.includes(id)) return undefined;
  const count =
    id === 0x21d
      ? 4
      : id === 0x21e
        ? 0
        : id === 0x159
          ? 5
          : id === 0x157 || id === 0x158
            ? 3
            : id === 0x192
              ? 2
              : null;
  if (count !== null && args.length !== count)
    throw new Error(`Native graphics 0x${id.toString(16)} expects ${count} arguments`);
  const graphics = world.graphics,
    done = () => nativeReply(2),
    value = (v) => nativeReply(1, v >>> 0);
  if (id === 0x21d || id === 0x21e) {
    graphics.initializeTextures();
    if (id === 0x21d) await graphics.texturePages.releaseRectangle(...args.map((n) => n | 0));
    else await graphics.texturePages.allocateMissing(world.configuration.fields.texture);
    return done();
  }
  if (!args[0]) return [0x59, 0x62].includes(id) ? value(0) : done();
  const packet = (words) => new NativeGraphicsPacket(words),
    send = (message, w = 0, l = 0, payload = null, flags = 0) =>
      world.sendNativeEngine(args[0], task.id, message, w, l, {
        ...(payload ? { payload } : {}),
        flags,
      });
  switch (id) {
    case 0x192:
      await send(81, 0, args[1]);
      return done();
    case 0x157: {
      const p = packet();
      await send(75, 0, 4, p);
      machine.store(args[1], p.load(0));
      machine.store(args[2], p.load(4));
      return done();
    }
    case 0x158:
      await send(
        57,
        args[2],
        0,
        packet(Array.from({ length: 16 }, (_, i) => machine.load(args[1] + i * 4))),
        1,
      );
      return done();
    case 0x159: {
      const p = packet();
      await send(76, 0, 16, p);
      for (const [i, at] of [0, 4, 16, 20].entries()) machine.store(args[i + 1], p.load(at));
      return done();
    }
    case 0x4e:
      await send(41, 0, 0, packet([0, 0, 0, args[1], args[2], 32, 1, 0xffffffff]));
      return done();
    case 0x4f:
      await send(42, 0, 0, packet([0, 0, 0, args[1], args[2], 0, 0, args[3]]));
      return done();
    case 0x50:
      await send(45);
      return done();
    case 0x53:
      await send(68);
      return done();
    case 0x54:
      await send(51, args[4], 0, packet(args.slice(1, 4)));
      return done();
    case 0x55: {
      const p = packet();
      await send(61, args[3], 0, p);
      p.store(0, args[1]);
      p.store(4, args[2]);
      await send(49, args[3], 0, p);
      return done();
    }
    case 0x56: {
      const p = packet();
      await send(61, args[3], 0, p);
      machine.store(args[1], p.load(0));
      machine.store(args[2], p.load(4));
      return done();
    }
    case 0x57: {
      const p = packet();
      await send(62, args[4], 0, p);
      for (let i = 0; i < 3; i++) machine.store(args[1 + i], p.load(i * 4));
      return done();
    }
    case 0x58: {
      const p = packet();
      await send(61, 0, 0, p);
      p.store(8, args[1]);
      await send(49, 0, 0, p);
      return done();
    }
    case 0x59: {
      const p = packet();
      await send(61, 0, 0, p);
      return value(p.load(8));
    }
    case 0x5a:
      await send(53, 0, 0, packet(args.slice(1, 4)));
      return done();
    case 0x5b:
      await send(54);
      return done();
    case 0x5c:
      await send(47, 0, args[1]);
      return done();
    case 0x5d:
      await send(55, args[4], 0, packet(args.slice(1, 4)));
      return done();
    case 0x5e:
      await send(63, 0, Math.max(0, Math.min(255, args[1] | 0)));
      return done();
    case 0x62:
      return value(await send(74));
    case 0x63:
      await send(90);
      return done();
    case 0x64:
      await send(59, args[2], args[1]);
      return done();
    case 0x65:
      await send(66, args[4], 0, packet(args.slice(1, 4)));
      return done();
    case 0x66:
      await send(77, 0, args[1]);
      return done();
    case 0x67:
      await send(78, 0, args[1]);
      return done();
    case 0x68:
      await send(
        89,
        0,
        0,
        packet([
          args[1],
          args[2],
          (args[1] + args[3]) >>> 0,
          (args[2] + args[4]) >>> 0,
          args[5],
          args[6],
        ]),
      );
      return done();
    case 0x6c:
      await send(94, 0, args[1]);
      return done();
    case 0x69:
      await send(92, 0, args[1]);
      return done();
    case 0x6a:
      await send(93, 0, args[1]);
      return done();
    case 0x6d:
      return value(await send(95));
    case 0x6e:
      await send(96, 0, args[1]);
      return done();
    case 0x350:
    case 0x351:
      await send(id === 0x350 ? 98 : 99, 0, args[1]);
      return done();
    default:
      throw new Error(`Missing native graphics wrapper ${id.toString(16)}`);
  }
}
