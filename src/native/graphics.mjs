// SPDX-License-Identifier: MPL-2.0
import { originalOwner, originalFeature, originalView } from './original-adapter.mjs';
import { nativeABI } from './abi/index.mjs';
import { NativeGraphicsDevice } from './graphics-device.mjs';
import { nativeStageSurface } from '../render/surfaces.mjs';
import { nativeEngineWord } from './engine-message.mjs';
// Native task graphics own graph state; construction alone does not load a
// graph. Message handlers update loaded graphs through the renderer setters.
import { Stage } from '../stage.mjs';
import { MOTION_ABI, initialMotionObject, motionVector, setMotionVector } from '../motion/abi.mjs';
import { applyObjectMotionState } from '../motion/target.mjs';
import { bitsFloat, floatBits, nativeReply } from '../kcs.mjs';
import { quietFloat32Bits } from '../ppi/numeric.mjs';
import { NativeRetainedDraw } from './retained-draw.mjs';
import { NativeDrawTask, NATIVE_DRAW_IDS, nativeDraw } from './draw-task.mjs';
import {
  NativeImages,
  NativeBitmap,
  NATIVE_IMAGE_IDS,
  nativeImage,
  nativePublicationPixels,
  nativeBitmapState,
  nativeBitmapStorageOwned,
  nativePixelsWereBorrowed,
} from './image.mjs';
import { NativeHandles } from './handles.mjs';
import { copyBitmapRow } from './raster-kernel.mjs';
import { identity } from '../motion/matrix.mjs';
import {
  nativeGraphGeometry,
  isNativeColoredModel,
  rectangleTriangles,
} from '../render/native-geometry.mjs';
import {
  isNativeTexturedModel,
  nativeTexturedGeometry,
} from '../render/native-textured-geometry.mjs';
import {
  createD3DContext,
  snapshotD3DContext,
  restoreD3DContext,
  nativeTextureReadOwned,
} from '../render/particles-gl.mjs';
import {
  initializeFESGraphics,
  syncFESGraphics,
  closeFESGraphics,
  setFESBaseImage,
} from './fes-graphics.mjs';
import { NativeView } from './view.mjs';
import { NATIVE_MESH_IDS, nativeMesh, decodeNativeMesh, nativeMeshBounds } from './mesh.mjs';
import {
  NativeTexturePages,
  negotiateNativeTextureLayout,
  virtualD3DTextureCaps,
  virtualD3DGuardBand,
  uploadTextureFrame,
  nativeTexturePagesOwned,
  nativeTexturePageStorage,
  nativeTexturePageFrames,
} from './texture-layout.mjs';
import { NativeCursor } from './cursor.mjs';
import { nativeInputBitmapMask } from './input.mjs';
import { NativeGraphicsPacket } from './graphics-task.mjs';
import { installNativePlaneMovieCommands } from './plane-movie-command.mjs';
import { installNativePlaneModelCommands } from './plane-model-command.mjs';
import { nativePlaneInputGeometry } from './plane-input-geometry.mjs';
import { decodePlaneKX2, NativePlaneTrail } from './plane-models.mjs';
import { readNativeResource } from './resource-file.mjs';
const WHITE = { width: 1, height: 1, rgba: new Uint8Array([255, 255, 255, 255]) };
// One current registration field: boolean is known, null has a verified record
// but an unknown enable value, and this tag has unverified record existence.
const UNVERIFIED_REGISTRATION = 'unverified';
const hasRegistration = (graph) =>
  graph && (typeof graph.registrationEnabled === 'boolean' || graph.registrationEnabled === null);
const hiddenModelRegistration = (graph) => graph.registrationEnabled === false;
function nativeTexturePageOptions(graphics) {
  const settle = () => {
    const text = graphics.world.text;
    if (text?.publications?.size) text.settlePublications();
  };
  return {
    stage: graphics.world.stageRenderer ?? null,
    release: (frame) => graphics.world.getNativeGPU?.()?.releaseTextureFrame(frame),
    trackDirty: graphics.tracksTextureDirty,
    beforeMutation: settle,
    readBarrier: settle,
    owner: graphics,
  };
}
const BASE_PLANE_MESSAGES = new Set([
  3, 4, 5, 6, 7, 8, 19, 47, 48, 50, 52, 53, 54, 89, 90, 92, 93, 94, 95, 96, 97, 98, 99, 100,
]);

export class NativeGraphics {
  synchronizeView() {
    originalView(this.world, 'syncView');
  }
  get cameraNear() {
    return bitsFloat(this.cameraNearWord);
  }
  set cameraNear(value) {
    this.setCameraNearWord(floatBits(value));
  }
  setCameraNearWord(word) {
    this.cameraNearWord = word >>> 0;
    this.synchronizeView();
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
    const texture = world.configuration?.fields.texture,
      abi = world.profile ? nativeABI(world.profile) : null,
      // Only a selected M2 initialization service establishes driver sampler
      // defaults. Other startup paths use their own TEXTURE configuration.
      pluginDeviceDefaults =
        abi && abi.startup.applicationServices.includes('m2') ? abi.plugins.requiredRenderer : null;
    this.particleAttachmentReadsRegistrationWord = abi?.particle?.attachmentReadsRegistrationWord;
    this.d3dContext = createD3DContext({
      depthStencilEnabled: true,
      magFilter: texture && !pluginDeviceDefaults ? texture.mag + 1 : 2,
      minFilter: texture && !pluginDeviceDefaults ? texture.min + 1 : 2,
    });
    this.d3dContext.samplers.set(5, this.d3dContext.magFilter);
    this.d3dContext.samplers.set(6, this.d3dContext.minFilter);
    const screen = world.configuration?.screen;
    this.view = new NativeView({
      virtualWidth: screen?.virtualWidth ?? world.game.width,
      virtualHeight: screen?.virtualHeight ?? world.game.height,
      clientWidth: screen?.currentWidth ?? world.game.width,
      clientHeight: screen?.currentHeight ?? world.game.height,
    });
    this.view.changed = () => this.synchronizeView();
    Object.defineProperty(this.stage, 'nativeGraphics', { value: this });
    this.device = world.stageRenderer?.graphicsDevice ?? new NativeGraphicsDevice();
    world.stageRenderer?.bindGraphicsDevice?.(this.device);
  }
  createLogicalDevice() {
    return this.device.createLogical();
  }
  attachGPU(gpu) {
    if (typeof gpu?.attachGraphicsDevice !== 'function')
      throw new TypeError('Host GPU requires the shared graphics lifecycle operation');
    return gpu.attachGraphicsDevice(this.device);
  }
  get(id) {
    return this.tasks.get(id >>> 0) || null;
  }
  virtualSize() {
    return this.view.virtualSize();
  }
  get cursorAllowed() {
    return this.cursor.state.allowed;
  }
  set cursorAllowed(value) {
    this.cursor.state.allowed = value >>> 0;
  }
  requireTextureCapsPolicy() {
    const policy = this.world.profile && nativeABI(this.world.profile).graphics.textureCapsPolicy;
    if (policy !== 'virtual-d3d9')
      throw new Error('Native texture caps policy is unavailable or unsupported');
  }
  initializeTextures() {
    if (this.texturePages) return;
    const texture = this.world.configuration?.fields.texture;
    if (!texture) throw new Error('Native texture configuration is unavailable');
    this.requireTextureCapsPolicy();
    const gpu = this.world.getNativeGPU?.(),
      gl = gpu?.gl,
      caps = virtualD3DTextureCaps(gpu ? gl.getParameter(gl.MAX_TEXTURE_SIZE) : 4096),
      maximum = caps.maximumTextureSize,
      layout = negotiateNativeTextureLayout(texture, { width: maximum, height: maximum });
    layout.textureCaps = caps;
    texture.size.set(layout.configurationSize);
    for (const field of ['grid', 'bppY']) texture[field].set(layout[field]);
    texture.areas.forEach((row, i) => row.set(layout.areas[i]));
    this.texturePages = new NativeTexturePages(layout, nativeTexturePageOptions(this));
  }
  get tracksTextureDirty() {
    // Internal uploads/clears are tracked independently of the native bounds-query API.
    return true;
  }
  async meshTexture(index) {
    if (this.world.text?.publications?.size || this.world.text?.flushingPublication)
      await this.world.text.flushPublications();
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
  async ensureVRAM(width, height, { textPublication = null } = {}) {
    const text = this.world.text;
    if (
      (text?.publications?.size || text?.flushingPublication) &&
      (!textPublication || textPublication !== text.flushingToken)
    )
      await text.flushPublications();
    let bitmap = this.vramHandle ? this.images.get(this.vramHandle) : null;
    if (bitmap && bitmap.width >= width && bitmap.height >= height) return bitmap;
    const next = this.images.create(
      Math.max(width, bitmap?.width || 0),
      Math.max(height, bitmap?.height || 0),
    );
    if (bitmap) {
      await this.images
        .get(next)
        .blit(bitmap, { copy: true, ...(textPublication ? { textPublication } : {}) });
      await this.images.release(this.vramHandle);
    }
    this.vramHandle = next;
    return this.images.get(next);
  }
  async fill(x, y, width, height, color = 0) {
    if (this.world.text?.publications?.size || this.world.text?.flushingPublication)
      await this.world.text.flushPublications();
    if (color === 0) {
      if (!this.view.active || width <= 0 || height <= 0) return 0;
      this.initializeTextures();
      this.texturePages.clear(x | 0, y | 0, width | 0, height | 0);
      if (this.vramHandle) await this.images.get(this.vramHandle).fill(x, y, width, height, 0);
      return 1;
    }
    const vram = await this.ensureVRAM(
      Math.max(this.world.game.width, x + width),
      Math.max(this.world.game.height, y + height),
    );
    await vram.fill(x, y, width, height, color);
    this.initializeTextures();
    await this.texturePages.upload(vram, [x, y, x + width, y + height]);
  }
  get hasOrdinaryBitmapOutput() {
    return this.output === nativeBitmapOutput && this.ensureVRAM === nativeEnsureVRAM;
  }
  async output(
    bitmap,
    offset,
    region = null,
    { upload = true, flipY = false, retained, textPublication = null, revisionSteps = 1 } = {},
  ) {
    const [x, y] = offset,
      area = region || [0, 0, bitmap.width, bitmap.height];
    const dimensions = [
        Math.max(this.world.game.width, x + bitmap.width),
        Math.max(this.world.game.height, y + bitmap.height),
      ],
      vram = textPublication
        ? await this.ensureVRAM(...dimensions, { textPublication })
        : await this.ensureVRAM(...dimensions);
    await vram.blit(bitmap, {
      dx: x + area[0],
      dy: y + area[1],
      sx: area[0],
      sy: area[1],
      width: area[2] - area[0],
      height: area[3] - area[1],
      copy: true,
      flipY,
      ...(textPublication ? { textPublication, revisionSteps } : {}),
    });
    this.initializeTextures();
    if (upload && this.view.active) {
      const translated = ([left, top, right, bottom]) => [x + left, y + top, x + right, y + bottom],
        publication = retained && {
          previous: retained.previous,
          footprint: [x, y, x + bitmap.width, y + bitmap.height],
          changed: retained.changed && translated(retained.changed),
        };
      return textPublication
        ? this.texturePages.upload(vram, translated(area), publication, {
            textPublication,
            revisionSteps,
          })
        : this.texturePages.upload(vram, translated(area), publication);
    }
  }
  async prepareRender() {
    if (this.world.text?.publications?.size || this.world.text?.flushingPublication)
      await this.world.text.flushPublications();
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
  async setFESSleep(_record, player, value, context = {}) {
    if (player?.root) await player.root.runtime.setSleeping(value, context);
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
    return [
      ...this.cursor.drawItems(),
      ...[...this.tasks.values()].flatMap((task) => task.trail?.drawItems() ?? []),
    ];
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
    if (this.world.stageRenderer?.rendering)
      throw new Error('Cannot checkpoint an in-flight stage render');
    return structuredClone({
      bitmapAssets: this.images.snapshotAssets(),
      retainedDraw: this.world.retainedDraw?.snapshot() ?? null,
      screenEffects: this.world.screenEffects?.snapshot() ?? null,
      screenCapture: this.world.screenCapture?.snapshot() ?? null,
      planeModelCommands: this.world.planeModelCommands?.snapshot() ?? null,
      vramHandle: this.vramHandle,
      d3dContext: snapshotD3DContext(this.d3dContext),
      view: this.view.snapshot(),
      screenMatrix: this.screenMatrix,
      screenShift: this.screenShift,
      cameraNearWord: this.cameraNearWord,
      texturePages: this.texturePages?.snapshot() ?? null,
      cursor: this.cursor.snapshot(),
      renderSequence: this.renderSequence,
      nativeRenderOrder: [...this.nativeRenderOrder],
    });
  }
  restoreD3DContext(state) {
    restoreD3DContext(state, this.d3dContext);
  }
  restore(state, { restoreContext = true } = {}) {
    const {
      bitmapAssets,
      d3dContext,
      view,
      texturePages,
      cursor,
      nativeRenderOrder,
      retainedDraw,
      screenEffects,
      screenCapture,
      planeModelCommands,
      ...values
    } = structuredClone(state);
    if (texturePages) {
      this.requireTextureCapsPolicy();
      const caps = texturePages.layout.textureCaps,
        maximum = caps?.maximumTextureSize;
      if (
        !Number.isSafeInteger(maximum) ||
        maximum < 1 ||
        maximum > 4096 ||
        !Array.isArray(caps.guardBand) ||
        caps.guardBand.length !== 4 ||
        caps.guardBand.some((value, index) => value !== virtualD3DGuardBand(maximum)[index]) ||
        texturePages.layout.size.some((value) => value > maximum) ||
        texturePages.layout.configurationSize.some((value) => value > maximum)
      )
        throw new Error('Invalid owned native texture caps checkpoint');
    }
    this.images.restoreAssets(bitmapAssets);
    if (retainedDraw) this.world.retainedDraw.restore(retainedDraw);
    if (screenEffects) this.world.screenEffects.restore(screenEffects);
    if (screenCapture) this.world.screenCapture.restore(screenCapture);
    this.graphs.clear();
    if (planeModelCommands) this.world.planeModelCommands.restore(planeModelCommands);
    Object.assign(this, values);
    this.nativeRenderOrder = new Map(nativeRenderOrder);
    if (restoreContext) this.restoreD3DContext(d3dContext);
    this.view.restore(view);
    this.texturePages?.close();
    this.texturePages = texturePages
      ? new NativeTexturePages(texturePages.layout, nativeTexturePageOptions(this))
      : null;
    if (texturePages) this.texturePages.restore(texturePages);
    this.cursor.restore(cursor);
    this.fesSurfaces.clear();
  }
  create(record) {
    const task = new NativeGraphicTask(this, record);
    this.tasks.set(record.id, task);
    return task;
  }
  ownsTexturedBounds(task, graph = task.graph) {
    return Boolean(
      task instanceof NativeGraphicTask &&
        task.graphics === this &&
        task.record.kind === 2 &&
        this.tasks.get(task.record.id) === task &&
        this.world.profile &&
        nativeABI(this.world.profile).graphics.texturedBoundsQuery === 'model-and-pages' &&
        isNativeTexturedModel(graph),
    );
  }
  async send(target, sender, id, w = 0, l = 0, payload = null, flags = 0) {
    return this.world.sendEngine(target, sender, id, w, l, {
      ...(payload ? { payload } : {}),
      flags,
    });
  }

  attachment(id) {
    const graph = this.graphs.get(id >>> 0);
    if (!graph) return null;
    const bytes = graph.kx2,
      view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
    return {
      base: motionVector(bytes, MOTION_ABI.base),
      pos: motionVector(bytes, MOTION_ABI.pos),
      baseWords: Array.from({ length: 3 }, (_, i) => view.getUint32(MOTION_ABI.base + i * 4, true)),
      posWords: Array.from({ length: 3 }, (_, i) => view.getUint32(MOTION_ABI.pos + i * 4, true)),
      matrix: Array.from({ length: 16 }, (_, i) =>
        view.getFloat32(MOTION_ABI.matrix + i * 4, true),
      ),
      display:
        graph.style?.shown !== false &&
        !hiddenModelRegistration(graph) &&
        view.getInt32(MOTION_ABI.display, true) !== 0,
      registrationWord: graph.registrationWord,
    };
  }
  graphHandle(taskID) {
    const task = this.tasks.get(taskID >>> 0);
    return task?.graph ? (task.record.nativeID ?? taskID) >>> 0 : -1;
  }

  async effectModel(nativeID) {
    const task = [...this.tasks.values()].find((task) => task.record.nativeID === nativeID);
    if (task?.graph) {
      const graph = task.graph;
      return {
        triangles: () =>
          (graph.triangles ?? rectangleTriangles(graph)).map((triangle) =>
            triangle.map((v) => [v.x, v.y, v.z ?? 0, v.w ?? 1]),
          ),
        bind: (effect) => {
          graph.vertexEffectID = effect.record.id;
        },
        unbind: () => {
          delete graph.vertexEffectID;
        },
      };
    }
    return null;
  }
  effectVertices(graph, vertices, triangle) {
    const id = graph.vertexEffectID;
    if (id === undefined) return vertices;
    const effect = this.world.areaEffects.tasks.get(id);
    if (!effect) throw new Error('Graph lost its area effect owner');
    return effect.vertices(vertices, triangle);
  }
  customGraph(record, { width, height, drawGPU, queryDraw }) {
    if (!Number.isFinite(width) || !Number.isFinite(height) || typeof drawGPU !== 'function')
      throw new TypeError('Native custom graphics require bounds and a GPU callback');
    if (queryDraw !== undefined && typeof queryDraw !== 'function')
      throw new TypeError('Native callback graphics require a synchronous query');
    const plane = this.create(record);
    plane.makeGraph({
      type: 1,
      width,
      height,
      custom: true,
      ...(queryDraw ? { registrationEnabled: false } : {}),
    });
    if (queryDraw) {
      // Callback registration has its own enable word. It is not the model's
      // MOT display field and never projects ordinary plane vertices.
      plane.graph.callback = true;
      Object.defineProperty(plane, 'queryDraw', {
        configurable: true,
        value: () => {
          const graph = plane.graph;
          if (!graph) return 0;
          if (typeof graph.registrationEnabled !== 'boolean')
            throw new Error('Native callback registration is unknown');
          if (!graph.registrationEnabled) return 0;
          const result = queryDraw(plane);
          if (!Number.isInteger(result))
            throw new TypeError('Native callback query must return a word synchronously');
          return result;
        },
      });
    }
    Object.defineProperty(plane, 'drawGPU', {
      configurable: true,
      value: (gpu, options = {}) => {
        if (queryDraw) {
          const { minimum = 0, maximum = Infinity } = options,
            graph = plane.graph,
            priority = graph && motionVector(graph.kx2, MOTION_ABI.base)[2];
          if (!graph || !(maximum > 0 && minimum <= priority && priority < maximum)) return 0;
          if (typeof graph.registrationEnabled !== 'boolean')
            throw new Error('Native callback registration is unknown');
          if (!graph.registrationEnabled) return 0;
        }
        return drawGPU(gpu, plane);
      },
    });
    return plane;
  }
}

const nativeBitmapOutput = NativeGraphics.prototype.output,
  nativeEnsureVRAM = NativeGraphics.prototype.ensureVRAM;
const publicationConsumers = [
  [NativeGraphics.prototype, ['output', 'ensureVRAM', 'initializeTextures']],
  [NativeImages.prototype, ['get', 'create', 'release', 'nativeMemory']],
  [NativeBitmap.prototype, ['state', 'pixels', 'frame', 'blit', 'changed']],
  [NativeTexturePages.prototype, ['upload']],
  [NativeHandles.prototype, ['get']],
].map(([prototype, keys]) => [
  prototype,
  keys.map((key) => [key, Object.getOwnPropertyDescriptor(prototype, key)]),
]);
function ordinaryPublicationConsumer(value, index) {
  const [prototype, methods] = publicationConsumers[index];
  return (
    value &&
    Object.getPrototypeOf(value) === prototype &&
    methods.every(([key, descriptor]) => {
      const current = Object.getOwnPropertyDescriptor(prototype, key);
      return (
        !Object.hasOwn(value, key) &&
        current?.value === descriptor?.value &&
        current?.get === descriptor?.get &&
        current?.set === descriptor?.set
      );
    })
  );
}

export function nativeTextGraphicsPublication(graphics) {
  if (!ordinaryPublicationConsumer(graphics, 0) || !ordinaryPublicationConsumer(graphics.images, 1))
    return false;
  const handles = graphics.images.handles;
  if (!ordinaryPublicationConsumer(handles, 4)) return false;
  const record = handles.records.get(graphics.vramHandle),
    vram = record?.value;
  return (
    record?.type === 'bitmap' &&
    ordinaryPublicationConsumer(vram, 2) &&
    vram.registry === graphics.images &&
    handles.records.get(vram.dataHandle)?.type === 'bitmap-data' &&
    ordinaryPublicationConsumer(graphics.texturePages, 3) &&
    nativeTexturePagesOwned(graphics.texturePages, graphics) &&
    !vram.canvasDirty &&
    nativeBitmapStorageOwned(vram) &&
    nativePublicationPixels(Object.getOwnPropertyDescriptor(nativeBitmapState(vram), 'rgba')?.value)
  );
}

// Bind an already requested ordinary publication to its owned storage. Later
// provider changes apply to later operations, never to this retained request.
export function captureTextPublicationSink(graphics, width, height, offset) {
  if (!nativeTextGraphicsPublication(graphics) || graphics.images.nativeMemory) return null;
  const vram = graphics.images.handles.records.get(graphics.vramHandle).value,
    state = nativeBitmapState(vram),
    rgba = state.rgba,
    [x, y] = offset,
    targetWidth = state.width,
    targetHeight = state.height;
  if (
    !offset.every(Number.isInteger) ||
    x < 0 ||
    y < 0 ||
    targetWidth < Math.max(graphics.world.game.width, x + width) ||
    targetHeight < Math.max(graphics.world.game.height, y + height) ||
    rgba.length !== targetWidth * targetHeight * 4
  )
    return null;
  const texture = graphics.texturePages,
    pages = [],
    upload = graphics.view.active,
    dither = Boolean(nativeTexturePageStorage(texture).layout.dither),
    dirtyFlags = nativeTexturePageStorage(texture).dirtyFlags,
    checkedReaders = new Map();
  if (upload)
    for (const [index, page] of nativeTexturePageStorage(texture).pages) {
      const { frame } = page;
      if (
        page.x >= x + width ||
        page.y >= y + height ||
        page.x + frame.width <= Math.max(0, x) ||
        page.y + frame.height <= Math.max(0, y)
      )
        continue;
      const surfaceObject = page.surface
        ? nativeStageSurface(texture.stage.surfaces, page.surface)
        : null;
      if (
        ![16, 32].includes(page.bpp) ||
        nativePixelsWereBorrowed(frame.rgba) ||
        !nativeTextureReadOwned(frame, checkedReaders) ||
        !nativePublicationPixels(frame.rgba) ||
        frame.rgba.length !== frame.width * frame.height * 4 ||
        (page.surface &&
          (!surfaceObject ||
            !Object.hasOwn(
              Object.getOwnPropertyDescriptor(surfaceObject, 'revision') ?? {},
              'value',
            )))
      )
        return null;
      pages.push([index, { ...page, frame, surfaceObject }]);
    }
  return {
    eligible() {
      const readers = new Map();
      return pages.every(
        ([, page]) =>
          nativeTextureReadOwned(page.frame, readers) && !nativePixelsWereBorrowed(page.frame.rgba),
      );
    },
    current: () =>
      state.width === targetWidth &&
      state.height === targetHeight &&
      Object.getOwnPropertyDescriptor(state, 'rgba')?.value === rgba,
    publish(frame, revisionSteps) {
      // Clipping is the same independent-source/destination clipping as blit.
      const left = Math.max(0, x),
        top = Math.max(0, y),
        columns = Math.min(width, targetWidth - left),
        rows = Math.min(height, targetHeight - top);
      if (columns > 0 && rows > 0) {
        for (let row = 0; row < rows; row++)
          copyBitmapRow(
            rgba,
            ((row + top) * targetWidth + left) * 4,
            frame.rgba,
            row * width * 4,
            columns * 4,
            true,
          );
        state.source = null;
        for (let step = 0; step < revisionSteps; step++) state.revision = (state.revision || 0) + 1;
        vram.cachedFrame = null;
        vram.canvas = null;
      }
      if (upload) {
        const input = (vram.cachedFrame ??= {
          width: targetWidth,
          height: targetHeight,
          rgba,
          revision: state.revision,
        });
        uploadTextureFrame(
          { pages, dirtyFlags },
          input,
          [x, y, x + width, y + height],
          null,
          revisionSteps,
          dither,
          true,
        );
      }
    },
  };
}

export class NativeGraphicTask {
  constructor(graphics, record) {
    this.graphics = graphics;
    this.world = graphics.world;
    this.record = record;
    this.base = this.world.base(record);
    const profile = this.world.profile && nativeABI(this.world.profile),
      abi = profile?.graphics;
    this.coordinateModeRequiresGraph = Boolean(abi?.coordinateModeRequiresGraph);
    this.planePoseQueriesRequireReply = Boolean(abi?.planePoseQueriesRequireReply);
    this.planePoseUsesRawWords = abi?.planePoseUsesRawWords;
    this.planePoseRequiresDevice =
      Boolean(abi?.planePoseRequiresDevice) || this.planePoseUsesRawWords === 'unchanged';
    this.planeInheritanceUsesRenderer = Boolean(abi?.planeInheritanceUsesRenderer);
    this.planeResetReleasesTrackedInput = Boolean(abi?.planeResetReleasesTrackedInput);
    this.planeUsesLegacyButtonStates = Boolean(abi?.planeUsesLegacyButtonStates);
    this.planeButtonUsesTexturePose = Boolean(abi?.planeButtonUsesTexturePose);
    this.planeGraphInputEnablesButton = Boolean(abi?.planeGraphInputEnablesButton);
    this.planeInputRequiresRootReply = Boolean(abi?.planeInputRequiresRootReply);
    this.planeClearInputClearsButtonRows = Boolean(abi?.planeClearInputClearsButtonRows);
    this.planeVisibilityUpdatesInput =
      record.kind === 2 && Boolean(abi?.planeVisibilityUpdatesInput);
    this.planeEmptyGraphRequiresMode1 = Boolean(abi?.planeEmptyGraphRequiresMode1);
    this.planeAlphaRequiresGraph = Boolean(abi?.planeAlphaRequiresGraph);
    this.planeUsesLegacyTexturedKX2 = Boolean(abi?.planeUsesLegacyTexturedKX2);
    this.planeUsesLegacyColoredKX2 = Boolean(abi?.planeUsesLegacyColoredKX2);
    this.planeKx3UsesLegacyReceiver = Boolean(abi?.planeKx3UsesLegacyReceiver);
    this.tilePlaneRequiresEmptyOwner = Boolean(abi?.tilePlaneRequiresEmptyOwner);
    this.legacyPlaneRegistration = Boolean(profile?.input?.legacyPlaneRegistration);
    this.planeSourceViaInput = Boolean(
      profile?.input?.planeSourceViaInput || profile?.input?.planeSourceUsesRawWord,
    );
    // Initial BasePlane and SimplePlane state.
    this.state = {
      receiver: -1,
      changed: 0,
      inheritPosition: false,
      parentOffset: [0, 0, 0],
      inheritDisplay: true,
      bindFlags: 0,
      bindArea: [0, 0, 0, 0],
      bindExtra: 0,
      inputTracksGraph: false,
      rect: [0, 0, 0, 0],
      modelFilename: '',
      imageIndex: -1,
      shown: true,
      renderPaused: true,
      blocked: false,
      phase: 0,
      ...(this.planeUsesLegacyButtonStates || this.planeButtonUsesTexturePose
        ? { frameStep: 1 }
        : {}),
      ...(this.planeClearInputClearsButtonRows
        ? { button: new Array(12).fill(0), buttonEnabled: false }
        : {}),
      renderType: 1,
      drawType: 0,
      shapeWords: [],
      blendMode: 0,
      colorOverride: 0,
      coordMode: 0,
      vramType: 1,
      after: null,
    };
    this.bindState(this.state);
    this.pointer = 0;
    this.trail = new NativePlaneTrail(this, abi);
  }
  get graphKey() {
    return [2, 6].includes(this.record.kind)
      ? (this.record.nativeID ?? this.record.id) >>> 0
      : null;
  }
  get stageKey() {
    return this.graphKey !== null && this.record.nativeID !== undefined
      ? '@' + this.graphKey
      : this.record.id;
  }
  get graph() {
    return this.graphKey === null
      ? (this.localGraph ?? null)
      : (this.graphics.graphs.get(this.graphKey) ?? null);
  }
  set graph(value) {
    if (this.graphKey === null) this.localGraph = value;
    else if (value) this.graphics.graphs.set(this.graphKey, value);
    else this.graphics.graphs.delete(this.graphKey);
  }
  bindState(state) {
    const local = { ...state };
    for (const key of [
      'shown',
      'imageIndex',
      'drawType',
      'shapeWords',
      'blendMode',
      'colorOverride',
      'coordMode',
      'vramType',
    ])
      Object.defineProperty(state, key, {
        configurable: true,
        enumerable: true,
        get: () => this.graph?.style?.[key] ?? local[key],
        set: (value) => {
          local[key] = value;
          if (this.graph?.style) this.graph.style[key] = value;
        },
      });
    this.state = state;
  }
  get input() {
    return this.world.inputFor?.(this.record.id);
  }
  planeBounds() {
    if (this.tilePlaneRequiresEmptyOwner && this.graph?.type === 5 && this.state.drawType === 8)
      throw new Error('Native tiled parent geometry bounds are undefined');
    return this.state.rect;
  }
  ownsTexturedBounds(graph = this.graph) {
    return this.graphics.ownsTexturedBounds(this, graph);
  }
  markBoundsDirty(source = false) {
    const graph = this.graph;
    if (isNativeColoredModel(graph)) graph.boundsDirty = true;
    else if (this.ownsTexturedBounds(graph))
      graph[source ? 'sourceBoundsDirty' : 'boundsDirty'] = true;
  }
  unregisterGraph() {
    const graph = this.graph;
    if (
      (graph?.callback || isNativeColoredModel(graph) || this.ownsTexturedBounds(graph)) &&
      typeof graph.registrationEnabled === 'boolean'
    )
      this.setRegistrationEnabled(false);
  }
  setRegistrationEnabled(enabled, word = enabled === null ? null : Number(enabled)) {
    const graph = this.graph;
    if (
      (graph.callback || isNativeColoredModel(graph) || this.ownsTexturedBounds(graph)) &&
      typeof graph.registrationEnabled === 'boolean' &&
      typeof enabled === 'boolean' &&
      graph.registrationEnabled !== enabled
    ) {
      this.markBoundsDirty();
      this.world.screenEffects.rendering.collectDirty();
    }
    if (
      this.graphics.particleAttachmentReadsRegistrationWord &&
      this.graphics.device.attachment &&
      Object.hasOwn(graph, 'registrationWord')
    ) {
      // The original renderer only stores a requested word when enablement changes.
      if (word === null || word === 0 || graph.registrationWord === 0)
        graph.registrationWord = word;
    }
    graph.registrationEnabled = enabled;
  }
  beforeChildren() {
    this.state.changed = 0;
  }
  drawTick() {
    this.trail.tick();
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
      delete this.graphics.stage.planes[this.stageKey];
      return;
    }
    const plane = this.graphics.stage.plane(this.stageKey);
    applyObjectMotionState(plane, this.graph.kx2, { scaleUnit: 100, visible: 'visible' });
    Object.assign(plane, {
      width: this.graph.width,
      height: this.graph.height,
      priority: motionVector(this.graph.kx2, MOTION_ABI.base)[2],
      blendMode: this.state.blendMode,
      nativeGraph: this.graph,
      nativeTaskWorldID: this.record.id,
      visible: plane.visible && this.state.shown && !hiddenModelRegistration(this.graph),
    });
    if (this.graph.colors?.length === 1) plane.color = this.graph.colors[0];
  }
  unload() {
    this.trail?.close();
    this.graph = null;
    // Model release does not overwrite the separate Plane metadata words.
    this.sync();
  }
  async unregisterInput() {
    if (this.state.receiver !== -1) {
      if (!this.input?.unregister) throw new Error('Native plane input removal is unavailable');
      await this.input.unregister(this.record.id);
      this.state.receiver = -1;
      this.state.changed = 1;
    }
    this.state.inputTracksGraph = false;
  }
  makeGraph(shape) {
    const style = Object.fromEntries(
      [
        'shown',
        'rect',
        'imageIndex',
        'drawType',
        'shapeWords',
        'blendMode',
        'colorOverride',
        'coordMode',
        'vramType',
      ].map((key) => [key, structuredClone(this.state[key])]),
    );
    if (this.coordinateModeRequiresGraph) style.coordMode = 0;
    this.graph = {
      registrationEnabled: UNVERIFIED_REGISTRATION,
      ...shape,
      style,
      renderOrder: this.graphics.allocateRenderOrder(),
      kx2: initialMotionObject(),
      textureTransform: initialMotionObject(),
      matrixExplicit: false,
      textureMatrixExplicit: false,
    };
    if (
      this.graphics.particleAttachmentReadsRegistrationWord &&
      this.graphics.device.attachment &&
      this.graph.registrationEnabled === false
    )
      this.graph.registrationWord = 0;
    if (isNativeColoredModel(this.graph) || this.ownsTexturedBounds()) {
      this.graph.boundsDirty = false;
      this.graph.cachedBounds = [0, 0, 0, 0];
      if (this.ownsTexturedBounds()) this.graph.sourceBoundsDirty = false;
    }
    setMotionVector(this.graph.kx2, MOTION_ABI.base, [0, 0, 5000]);
    // A solid rectangle has one native model. Both selector values resolve
    // to that model, while textured rectangles have separate UV transforms.
    if (shape.type === 2 || shape.type === 7) this.graph.textureTransform = this.graph.kx2;
    this.state.rect = [0, 0, Math.abs(shape.width), Math.abs(shape.height)];
    this.state.colorOverride = 0;
    this.state.drawType = shape.type;
    this.sync();
  }
  async message(words, context = {}) {
    const [sender, id, w, l] = words;
    if (
      id === 46 &&
      this.tilePlaneRequiresEmptyOwner &&
      (this.state.vramType !== 1 || !this.graphics.device.attachment || this.graph)
    )
      return 0;
    const preservesModel = this.planeUsesLegacyTexturedKX2 && (id === 69 || id === 70);
    if (!preservesModel && [3, 41, 42, 45, 46, 68, 69, 70, 83].includes(id)) {
      await originalView(this.world, 'movieRelease', this);
      await this.world.planeMovies.release(this);
    }
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
        ? context.payload.bytes
          ? context.payload.bytes(address, size)
          : context.payload.read(address, size)
        : this.machine(context.nativeSenderWorldID ?? sender).bytes(address, size);
    const floats = (address, count) =>
      Array.from({ length: count }, (_, i) => {
        const word = load(address + i * 4);
        if (word === undefined) throw new Error('Native graphic float word is unwritten');
        return bitsFloat(word);
      });
    const put = (address, values) => values.forEach((v, i) => store(address + i * 4, floatBits(v)));
    const textureSelected = () => Boolean(w && this.graph?.textureTransform !== this.graph?.kx2);
    const transformState = () =>
      textureSelected() ? this.graph?.textureTransform : this.graph?.kx2;
    const vector = (offset) => (this.graph ? motionVector(transformState(), offset) : [0, 0, 0]);
    const setVector = (offset, values) => {
      if (this.graph) {
        setMotionVector(transformState(), offset, values);
        this.markBoundsDirty(textureSelected());
      }
    };
    switch (id) {
      case 3:
        this.unregisterGraph();
        this.closeGraph();
        return this.base.message(words, context);
      case 19:
        return 0;
      case 4:
      case 5:
      case 6: {
        if (
          id === 4 &&
          (this.planeUsesLegacyButtonStates || this.planeButtonUsesTexturePose) &&
          (this.state.buttonEnabled || this.state.blocked) &&
          !(await this.acceptButtonKey(l))
        ) {
          // The original Input caller's reply word still holds its nonzero
          // owner pointer if the Plane returns before its base task writes.
          return this.world.objects.objects.get(context.nativeSenderWorldID)?.kind === 11
            ? 1
            : undefined;
        }
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
      case 8: {
        const nativeButton =
          (this.planeUsesLegacyButtonStates || this.planeButtonUsesTexturePose) &&
          (this.state.buttonEnabled || this.state.blocked);
        if (nativeButton) {
          if (this.state.phase === 3 || this.state.blocked) return undefined;
          await this.selectButton(id === 7 ? 1 : 0);
        }
        await this.forwardInput(64, this.record.nativeID, id === 7 ? 1 : 0, context);
        return nativeButton ? undefined : 0;
      }
      case 41: {
        this.unregisterGraph();
        const mode = this.state.vramType;
        if (mode !== 1) {
          this.graph = null;
          this.sync();
        }
        const numbers = floats(l, 5);
        if (mode !== 1) return 0;
        this.state.shapeWords = Array.from({ length: 8 }, (_, i) => load(l + i * 4));
        this.makeGraph({
          type: 1,
          registrationEnabled: false,
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
        this.unregisterGraph();
        const mode = this.state.vramType;
        if (mode !== 1) {
          this.graph = null;
          this.sync();
        }
        const numbers = floats(l, 5),
          color = load(l + 28);
        if (mode !== 1) return 0;
        this.state.shapeWords = Array.from({ length: 8 }, (_, i) => load(l + i * 4));
        this.makeGraph({
          type: 2,
          registrationEnabled: false,
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
      case 43:
      case 44: {
        const name = [];
        for (let at = 0; ; at++) {
          const byte = bytes(l + 12 + at, 1)[0];
          if (!byte) break;
          if (at >= 2048) throw new RangeError('Plane movie filename is too long');
          name.push(byte);
        }
        const projection = originalOwner(this.world)
            ? {
                load: (...args) =>
                  originalFeature(this.world, 'plane-movie-projection', 'load', ...args),
              }
            : this.world.planeMovies,
          source = await projection.load(
            this,
            id - 43,
            Array.from({ length: 3 }, (_, i) => load(l + i * 4)),
            new TextDecoder('shift_jis').decode(Uint8Array.from(name)),
          );
        if (!this.world.planeMovies.legacy || source) this.unload();
        if (source)
          this.makeGraph({
            type: id - 40,
            x: bitsFloat(load(l)),
            y: bitsFloat(load(l + 4)),
            z: bitsFloat(load(l + 8)),
            width: source.width,
            height: source.height,
            movie: source,
            vram: false,
          });
        return 0;
      }
      case 87:
      case 88:
        store(
          l,
          this.graph?.movie?.mode === id - 87
            ? (this.graph.movie.handle ?? this.graph.movie.pointer)
            : 0,
        );
        return 0;
      case 45:
        if (this.planeEmptyGraphRequiresMode1) {
          if (!this.graphics.device.attachment) return 0;
          this.unregisterGraph();
          if (this.state.vramType !== 1) {
            this.graph = null;
            this.sync();
            return 0;
          }
        }
        this.makeGraph({
          type: 5,
          registrationEnabled: false,
          width: 0,
          height: 0,
          triangles: [],
          vram: false,
        });
        return 0;
      case 46: {
        if (this.state.vramType !== 1)
          throw new Error('Tiled planes require the reviewed ordinary mode1 backend');
        const a = Array.from({ length: 10 }, (_, i) =>
            this.tilePlaneRequiresEmptyOwner && i >= 5 && i <= 7 ? undefined : load(l + i * 4),
          ),
          geometry = floats(l, 5),
          columns = nativeEngineWord(a[8], 'Tile column count') | 0,
          rows = nativeEngineWord(a[9], 'Tile row count') | 0;
        if (!geometry.every(Number.isFinite))
          throw new Error('Tiled planes require finite ordinary geometry');
        this.unregisterGraph();
        this.state.shapeWords = a;
        this.makeGraph({
          type: 5,
          registrationEnabled: false,
          width: 0,
          height: 0,
          triangles: [],
          vram: false,
        });
        for (let row = 0; row < rows; row++)
          for (let column = 0; column < columns; column++) {
            const id = await this.world.objects.create({
                kind: 2,
                parent: this.record.id,
                name: this.tilePlaneRequiresEmptyOwner ? 'ptn plane' : 'TilePlane',
              }),
              child = this.graphics.get(id);
            await child.message([this.record.nativeID, 41, 0, 0], {
              payload: new NativeGraphicsPacket([0, 0, 0, ...a.slice(3, 8)], {
                unwritten: [5, 6, 7].filter((index) => a[index] === undefined),
              }),
            });
            await child.message([this.record.nativeID, 53, 0, 0], {
              payload: new NativeGraphicsPacket([
                floatBits(Math.fround(geometry[0] + Math.fround(column * geometry[3]))),
                floatBits(Math.fround(geometry[1] + Math.fround(row * geometry[4]))),
                a[2],
              ]),
            });
          }
        this.state.drawType = this.tilePlaneRequiresEmptyOwner ? 8 : 9;
        return 0;
      }
      case 69:
      case 70: {
        const textured = id === 69,
          legacy = textured ? this.planeUsesLegacyTexturedKX2 : this.planeUsesLegacyColoredKX2;
        if (legacy && (!this.graphics.device.ready || this.state.vramType !== 1)) return 0;
        const name = [];
        for (let at = 0; ; at++) {
          const byte = bytes(l + at, 1)[0];
          if (!byte) break;
          if (at >= 2048) throw new RangeError('Plane model filename is too long');
          name.push(byte);
        }
        const filename = new TextDecoder('shift_jis').decode(Uint8Array.from(name));
        // Modern receivers remove the old registry key before the file reader.
        // Legacy receivers read first and reject an occupied key at registration.
        if (!legacy) this.unload();
        const data = await readNativeResource(this.world, filename);
        if (!data || !data.length) return 0;
        const graph = decodePlaneKX2(data, { allowUnknownSignature: true });
        if (!graph || this.graph) return 0;
        if (legacy) {
          if (this.graph || !this.graphics.device.ready || this.state.vramType !== 1) return 0;
          if (
            ![...graph.rect, graph.width, graph.height].every(Number.isFinite) ||
            graph.triangles.some((triangle) =>
              triangle.some(({ x, y, z }) => ![x, y, z].every(Number.isFinite)),
            )
          )
            throw new Error('Native KX2 requires finite model coordinates');
        }
        this.makeGraph({
          ...graph,
          type: textured ? 6 : 7,
          vram: textured,
          filename,
          // All five original KX2 loaders register a new model with display word zero.
          registrationEnabled: false,
          registrationWord: 0,
        });
        if (legacy) {
          this.graph.registrationWord = Number(this.graph.registrationEnabled);
          this.state.drawType = textured ? 5 : 6;
        }
        this.state.modelFilename = filename;
        this.state.rect = [graph.rect[0], graph.rect[1], graph.width, graph.height];
        return 0;
      }
      case 79:
        this.trail.configure(w ? Array.from({ length: 13 }, (_, i) => load(l + i * 4)) : null);
        return 0;
      case 80:
        this.trail.pushSample(bytes(l, 128));
        return 0;
      case 47: {
        let inputDisplay;
        this.state.renderPaused = !l;
        this.state.shown = Boolean(l);
        const registered = hasRegistration(this.graph),
          parent =
            this.state.inheritPosition && (registered || this.planeVisibilityUpdatesInput)
              ? this.graphics.get(this.record.parent)?.graph
              : null;
        if (registered) {
          if (!this.state.inheritPosition) this.setRegistrationEnabled(this.state.shown, l >>> 0);
          else if (parent) {
            // A known miss retains the old word. A parent with unverified
            // registration makes the result indeterminate.
            if (!hasRegistration(parent)) this.setRegistrationEnabled(null);
            else if (!this.state.shown) this.setRegistrationEnabled(false);
            else
              this.setRegistrationEnabled(
                parent.registrationEnabled,
                parent.registrationWord ?? null,
              );
          }
        }
        if (
          this.planeVisibilityUpdatesInput &&
          this.state.buttonEnabled &&
          this.state.receiver !== -1 &&
          hasRegistration(parent)
        )
          inputDisplay = this.state.shown
            ? nativeEngineWord(parent.registrationWord, 'Native parent renderer display')
            : 0;
        if (!this.planeVisibilityUpdatesInput) this.setInputDisplay();
        this.sync();
        if (this.planeVisibilityUpdatesInput)
          await this.updateVisibleInput(l, inputDisplay, context);
        // Every native Plane show broadcasts the child visibility notification.
        await this.broadcast(48, w, l, context);
        return 0;
      }
      case 48:
        this.state.renderPaused = !l;
        if (hasRegistration(this.graph))
          this.setRegistrationEnabled(
            this.state.shown && Boolean(l),
            this.state.shown ? l >>> 0 : 0,
          );
        if (this.graph)
          new DataView(this.graph.kx2.buffer).setInt32(
            MOTION_ABI.display,
            Number(Boolean(l)),
            true,
          );
        this.sync();
        if (this.planeVisibilityUpdatesInput)
          await this.updateVisibleInput(l, this.state.shown ? l >>> 0 : 0, context);
        else this.setInputDisplay();
        await this.broadcast(48, w, l, context);
        return 0;
      case 49:
        if (this.state.inheritPosition && !w) this.inheritTransform();
        else if (this.graph) setVector(MOTION_ABI.base, floats(l, 3));
        this.sync();
        this.updateGraphInputArea();
        await this.broadcast(50, w, l, context);
        return 0;
      case 50:
      case 52:
        if (this.state.inheritPosition && !w) this.inheritTransform();
        this.sync();
        if (id === 50 || bitsFloat(w) === 0) this.updateGraphInputArea();
        await this.broadcast(id, w, l, context);
        return 0;
      case 54:
        this.state.inheritPosition = false;
        return 0;
      case 51:
        if (this.state.inheritPosition && !w) this.inheritTransform();
        else setVector(MOTION_ABI.pos, floats(l, 3));
        this.sync();
        this.updateGraphInputArea();
        await this.broadcast(52, w, l, context);
        return 0;
      case 53: {
        const offset = floats(l, 3);
        if (this.planeInheritanceUsesRenderer && !offset.every(Number.isFinite))
          throw new Error('Plane inheritance requires finite offsets');
        this.inheritTransform(offset);
        this.state.inheritPosition = true;
        this.state.parentOffset = offset;
        this.sync();
        return 0;
      }
      case 55:
        setVector(MOTION_ABI.rotation, floats(l, 3));
        if (this.graph)
          this.graph[textureSelected() ? 'textureMatrixExplicit' : 'matrixExplicit'] = false;
        this.sync();
        this.updateGraphInputArea();
        await this.broadcast(56, w, l, context);
        return 0;
      case 56:
      case 58:
      case 67:
        if (this.state.inheritPosition && this.graph) {
          if (id === 56) {
            setVector(MOTION_ABI.rotation, floats(l, 3));
            this.graph[textureSelected() ? 'textureMatrixExplicit' : 'matrixExplicit'] = false;
          } else if (id === 58) {
            transformState().set(bytes(l, 64), MOTION_ABI.matrix);
            this.graph[textureSelected() ? 'textureMatrixExplicit' : 'matrixExplicit'] = true;
          } else setMotionVector(this.graph.kx2, MOTION_ABI.scale, floats(l, 3));
          this.markBoundsDirty(id !== 67 && textureSelected());
          this.sync();
        }
        this.updateGraphInputArea();
        await this.broadcast(id, w, l, context);
        return 0;
      case 57:
        if (this.graph) {
          transformState().set(bytes(l, 64), MOTION_ABI.matrix);
          this.graph[textureSelected() ? 'textureMatrixExplicit' : 'matrixExplicit'] = true;
          this.markBoundsDirty(textureSelected());
        }
        this.sync();
        this.updateGraphInputArea();
        await this.broadcast(58, w, l, context);
        return 0;
      case 59:
        if (this.graph) {
          const view = new DataView(this.graph.kx2.buffer);
          if (
            this.ownsTexturedBounds() ||
            view.getUint32(MOTION_ABI.color, true) !== l >>> 0 ||
            Boolean(this.state.colorOverride) !== Boolean(w)
          )
            this.markBoundsDirty();
          view.setUint32(MOTION_ABI.color, l, true);
          this.state.colorOverride = w >>> 0;
        }
        this.sync();
        return 0;
      case 60:
      case 85:
      case 86:
        return 0; // Explicit original simple-plane empty branches.
      case 71:
        return this.planeKx3UsesLegacyReceiver ? undefined : 0;
      case 72: {
        const legacy = this.planeUsesLegacyButtonStates,
          texturePose = this.planeButtonUsesTexturePose,
          button =
            legacy || texturePose
              ? Array.from({ length: 12 }, (_, index) =>
                  nativeEngineWord(load(w + index * 4), 'Native Plane button state record'),
                )
              : null;
        if (legacy || texturePose) {
          if (this.state.receiver === -1) {
            if (!this.graphics.device.ready || !this.graph?.kx2)
              throw new Error('Native Plane button registration requires live model geometry');
            const dimensions = texturePose ? this.graphics.virtualSize() : undefined;
            await this.registerInputArea(sender, this.graphInputFields(l), true, { dimensions });
          }
          if (texturePose) this.state.inputTracksGraph = true;
        } else {
          const rect = this.planeBounds(),
            position = vector(MOTION_ABI.pos),
            base = vector(MOTION_ABI.base),
            left = Math.fround(position[0] - base[0]),
            top = Math.fround(position[1] - base[1]);
          await this.message([sender, 89, 0, 0], {
            ...context,
            payload: new NativeGraphicsPacket([
              Math.trunc(left),
              Math.trunc(top),
              Math.trunc(Math.fround(rect[2] + left)),
              Math.trunc(Math.fround(rect[3] + top)),
              Math.trunc(base[2]),
              l,
            ]),
          });
        }
        this.state.button = button ?? Array.from({ length: 12 }, (_, index) => load(w + index * 4));
        this.state.buttonEnabled = true;
        this.state.buttonFlags = l;
        if (this.state.button[0]) await this.selectButton(0);
        return 0;
      }
      case 73:
        await this.selectButton(l & 65535);
        this.state.blocked = Boolean(l >>> 31);
        return 0;
      case 61:
      case 62: {
        if (this.planePoseRequiresDevice && !this.graphics.device.attachment) return 0;
        const offset = id === 61 ? MOTION_ABI.base : MOTION_ABI.pos;
        if (this.graph && this.planePoseUsesRawWords) {
          const source = transformState(),
            view = new DataView(source.buffer, source.byteOffset, source.byteLength);
          for (let at = 0; at < 12; at += 4) {
            const word = view.getUint32(offset + at, true);
            store(
              l + at,
              this.planePoseUsesRawWords === 'unchanged' ? word : quietFloat32Bits(word),
            );
          }
        } else if (this.graph || (id === 62 && !this.planePoseQueriesRequireReply))
          put(l, vector(offset));
        return 0;
      }
      case 63:
        if (this.planeAlphaRequiresGraph && (!this.graph || !this.graphics.device.attachment))
          return 0;
        if (this.graph) {
          const view = new DataView(this.graph.kx2.buffer),
            previous = view.getUint32(MOTION_ABI.color, true),
            next = (((l & 255) << 24) | (previous & 0xffffff)) >>> 0;
          if (this.ownsTexturedBounds() || previous !== next || !this.state.colorOverride)
            this.markBoundsDirty();
          view.setUint32(MOTION_ABI.color, next, true);
        }
        this.state.colorOverride = 1;
        this.sync();
        return 0;
      case 66:
        // BasePlane message 66 loads the scale vector with selector zero.
        if (this.graph) {
          setMotionVector(this.graph.kx2, MOTION_ABI.scale, floats(l, 3));
          this.markBoundsDirty();
        }
        this.sync();
        this.updateGraphInputArea();
        await this.broadcast(67, w, l, context);
        return 0;
      case 68: {
        const [left, top] = this.state.rect,
          drawType = this.state.drawType;
        this.unregisterGraph();
        this.unload();
        // Original reset clears the size words, retaining origin, type and filename.
        this.state.rect = [left, top, 0, 0];
        this.state.drawType = drawType;
        if (this.planeResetReleasesTrackedInput && this.state.inputTracksGraph)
          await this.unregisterInput();
        return 0;
      }
      case 74:
        return ((this.state.blocked ? 0x80000000 : 0) | this.state.phase) >>> 0;
      case 75: {
        const [, , width, height] = this.planeBounds();
        put(w, [width]);
        put(l, [height]);
        return 0;
      }
      case 76: {
        const [left, top, width, height] = this.planeBounds();
        put(w, [left, top, 0]);
        put(l, [left + width, top + height, 0]);
        return 0;
      }
      case 77:
        if (this.planeVisibilityUpdatesInput) {
          const target = this.world.resolveTaskID(l, this.record.id);
          for (let owner = this.record; owner; owner = this.world.objects.objects.get(owner.parent))
            if (owner.id === target && owner.kind === 2)
              throw new Error('Native Plane hint cannot form an ancestor visibility cycle');
        }
        this.state.imageIndex = l | 0;
        if (
          this.world.profile &&
          nativeABI(this.world.profile).graphics.planeImageSelectorHidesTarget
        )
          await this.world.sendNativeEngine(l, this.record.id, 47, 0, 0);
        return 0;
      case 78:
        this.state.frameStep = l;
        return 0;
      case 81:
        this.state.blendMode = l >= 1 && l <= 5 ? l : 0;
        this.sync();
        return 0;
      case 82:
        if (!this.coordinateModeRequiresGraph) this.state.coordMode = l;
        else if (this.graph) this.graph.style.coordMode = l;
        return 0;
      case 83: {
        const rect = this.state.rect,
          drawType = this.state.drawType,
          policy = this.world.profile && nativeABI(this.world.profile).graphics.dividedMesh;
        if (!policy?.rejectOccupiedModel) this.unload();
        const mesh = decodeNativeMesh(bytes(l, (w >>> 0) * 80)),
          bounds = nativeMeshBounds(mesh),
          candidate = {
            type: 3,
            registrationEnabled: false,
            mesh,
            bounds,
            width: bounds.maximum[0] - bounds.minimum[0],
            height: bounds.maximum[1] - bounds.minimum[1],
            vram: true,
          };
        // Build the private candidate before registration. SDK23 rejects an
        // occupied key and discards that candidate without publishing it or
        // releasing the old model. Main83 explicitly removes the old key.
        if (policy?.rejectOccupiedModel && this.graph) return undefined;
        if (policy?.rejectOccupiedModel) this.unload();
        // Only the new model registration starts hidden. The Plane's own
        // visibility survives loading and still gates later child notifications.
        this.makeGraph(candidate);
        this.state.rect = rect;
        this.state.drawType = drawType;
        this.state.colorOverride = 1;
        return policy ? undefined : 0;
      }
      case 84:
        this.state.vramType = l;
        return 0;
      case 89: {
        const tracksGraph =
          this.record.kind === 2 || (context.graphInputRegistration && this.record.kind !== 6);
        if (this.record.kind === 2 && !this.graph?.kx2)
          throw new Error('Native plane input geometry is unreviewed');
        if (this.state.receiver !== -1) {
          if (this.planeGraphInputEnablesButton) {
            this.state.buttonEnabled = true;
            this.state.buttonFlags = l;
          }
          if (tracksGraph) {
            this.state.inputTracksGraph = true;
            if (this.legacyPlaneRegistration) this.state.bindExtra = l >>> 0;
          }
          return tracksGraph ? undefined : 0;
        }
        const fields = tracksGraph
          ? this.graphInputFields(l)
          : Array.from({ length: 6 }, (_, i) => load(l + i * 4));
        await this.registerInputArea(sender, fields, tracksGraph, { bindExtra: l });
        if (this.planeGraphInputEnablesButton) {
          this.state.buttonEnabled = true;
          this.state.buttonFlags = l;
        }
        return tracksGraph ? undefined : 1;
      }
      case 90:
        if (this.planeClearInputClearsButtonRows) this.state.button = new Array(12).fill(0);
        await this.unregisterInput();
        return 0;
      case 94:
        this.state.changed = l;
        return 0;
      case 92: {
        if (this.state.receiver !== -1) {
          if (!this.input?.message)
            throw new Error('Native plane input enable service is unavailable');
          const inputContext = { flags: context.flags ?? 0 };
          await this.input.message(134, this.record.id, l, inputContext);
          if (!l) await this.input.message(132, this.record.id, 0, inputContext);
        }
        return 0;
      }
      case 93: {
        if (this.state.receiver !== -1) {
          if (!this.input?.message)
            throw new Error('Native plane input active service is unavailable');
          await this.input.message(132, this.record.id, l, { flags: context.flags ?? 0 });
        }
        return 0;
      }
      case 95:
        if (this.planeSourceViaInput) {
          const world = this.world,
            root = world.objects.objects.get(world.resolveTaskID(0, this.record.id));
          if (root?.kind !== 1) return;
          const input = await world.sendNativeEngine(
            0,
            this.record.id,
            world.engineMessages.layout.rootStart + 2,
          );
          const owner =
            typeof input === 'number' &&
            world.objects.objects.get(world.resolveTaskID(input, this.record.id));
          if (owner?.kind !== 11) return;
          return world.sendNativeEngine(input, this.record.id, 136, this.record.nativeID, 0);
        }
        return this.input?.source === 16 ? 2 : (this.input?.source ?? 0);
      case 98: {
        if (this.state.receiver !== -1) {
          if (!this.input?.message)
            throw new Error('Native plane input hover service is unavailable');
          await this.input.message(135, this.record.id, l, { flags: context.flags ?? 0 });
        }
        return 0;
      }
      case 99: {
        if (this.state.receiver !== -1) {
          if (!this.input?.message)
            throw new Error('Native plane input drag service is unavailable');
          await this.input.message(153, this.record.id, l, { flags: context.flags ?? 0 });
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
        const nativeRows = nativeABI(this.world.profile).input?.bitmapMaskNativeRows;
        region.alpha = context.nativePointer
          ? await this.input.services.alphaMask(l, context)
          : await nativeInputBitmapMask(this.graphics.images.get(l), nativeRows);
        if (!nativeRows) this.input.changed = true;
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
        return this.base.message(words, context);
    }
  }
  async registerInputArea(sender, fields, tracksGraph, { bindExtra = 0, dimensions } = {}) {
    if (
      this.planeInputRequiresRootReply &&
      this.world.engineMessages.closestTop(this.record.id)?.nativeID !== 0
    )
      throw new Error('Native Plane input registration requires a routable zero-ID Top reply');
    const input = this.input;
    if (!input?.register) throw new Error('Native plane input registration is unavailable');
    const bounds = fields.slice(0, 4).map((value) => value | 0),
      [width, height] =
        dimensions ??
        (this.legacyPlaneRegistration
          ? this.graphics.virtualSize()
          : [this.world.game.width, this.world.game.height]),
      full = bounds[0] <= 0 && bounds[1] <= 0 && bounds[2] >= width && bounds[3] >= height,
      retainedBounds = full ? [-100000, -100000, 100000, 100000] : bounds;
    await input.register({
      owner: this.record.id,
      receiver: sender,
      bounds: retainedBounds,
      priority: fields[4] | 0,
      flags: fields[5],
      mask: 7,
      extra: 0,
    });
    this.state.bindArea = retainedBounds;
    this.state.bindFlags = fields[5];
    if (tracksGraph) {
      this.state.inputTracksGraph = true;
      if (this.legacyPlaneRegistration) this.state.bindExtra = bindExtra >>> 0;
    }
    this.state.receiver = sender;
    this.state.changed = 1;
  }
  graphInputFields(flags) {
    const motion = this.graph?.kx2,
      vector = (offset) => (motion ? motionVector(motion, offset) : [0, 0, 0]),
      { bounds, priority } = nativePlaneInputGeometry(
        vector(MOTION_ABI.base),
        vector(MOTION_ABI.pos),
        this.planeBounds().slice(2, 4),
      );
    return [...bounds, priority, flags];
  }
  async acceptButtonKey(down) {
    if (this.state.phase === 3) return false;
    const input = this.input;
    if (!input) throw new Error('Native Plane button event requires its Input owner');
    const source = this.planeButtonUsesTexturePose
      ? await input.message(136, this.record.nativeID, 0)
      : input.source;
    if (!(source & 2)) return true;
    if (this.state.blocked) return false;
    if (down) await this.selectButton(2);
    else {
      const region = input.get(this.record.id);
      if (!region) throw new Error('Native Plane button release requires its Input registration');
      await this.selectButton(region.active && this.state.button?.[3] ? 1 : 0);
    }
    return true;
  }
  async selectButton(selector) {
    const row = selector * 3,
      button = this.state.button;
    if (!button || selector > 3 || !button[row]) return;
    const legacy = this.planeUsesLegacyButtonStates,
      texturePose = this.planeButtonUsesTexturePose,
      nativeHint = legacy || texturePose,
      hint = this.state.imageIndex,
      hintEnabled = this.state.frameStep ?? Number(nativeHint),
      checkedHint =
        nativeHint && hint !== -1 && selector === 1 && hintEnabled
          ? await this.buttonHintPosition()
          : null,
      transform =
        nativeHint && !this.graphics.device.ready
          ? null
          : legacy
            ? this.graph?.kx2
            : this.graph?.textureTransform;
    if (transform) {
      const position = motionVector(transform, MOTION_ABI.pos);
      setMotionVector(transform, MOTION_ABI.pos, [
        button[row + 1] | 0,
        button[row + 2] | 0,
        position[2],
      ]);
      if (nativeHint) this.markBoundsDirty(transform !== this.graph.kx2);
    }
    this.state.phase = selector;
    this.sync();
    if (hint !== -1) {
      if (selector === 1) {
        if (!hintEnabled) return;
        const position = checkedHint ?? (await this.buttonHintPosition());
        await this.world.sendNativeEngine(hint, this.record.id, 51, 0, 0, {
          payload: new NativeGraphicsPacket(position.map(floatBits)),
        });
        await this.world.sendNativeEngine(hint, this.record.id, 47, 0, 1);
      } else {
        await this.world.sendNativeEngine(hint, this.record.id, 47, 0, 0);
        if (nativeHint && selector === 3)
          await this.world.sendNativeEngine(hint, this.record.id, 47, 0, 0);
      }
    }
  }
  async buttonHintPosition() {
    const nativeHint = this.planeUsesLegacyButtonStates || this.planeButtonUsesTexturePose,
      dimensions = new NativeGraphicsPacket([], { unwritten: nativeHint ? [0, 1] : [] }),
      bounds = this.input?.get(this.record.id)?.bounds,
      view = this.graphics.view;
    if (!bounds) throw new Error('Plane hint positioning requires its input rectangle');
    if (nativeHint) {
      const target = this.world.resolveTaskID(this.state.imageIndex, this.record.id);
      if (this.world.objects.objects.get(target)?.kind !== 2)
        throw new Error('Native Plane hint dimensions require a Plane receiver');
    }
    await this.world.sendNativeEngine(this.state.imageIndex, this.record.id, 75, 0, 4, {
      payload: dimensions,
    });
    const dimension = (offset) => {
        const word = dimensions.load(offset);
        return Math.trunc(
          bitsFloat(nativeHint ? nativeEngineWord(word, 'Native Plane hint size') : word),
        );
      },
      width = dimension(0),
      height = dimension(4),
      centered = (bounds[0] - (((bounds[0] - bounds[2] + width) >>> 0) >>> 1)) | 0,
      x = Math.max(
        0,
        (centered + width) >>> 0 < view.clientWidth >>> 0
          ? centered
          : (view.clientWidth - width) | 0,
      ),
      y = (bounds[1] - height) | 0;
    return [x, y >= 0 ? y : bounds[3], 0];
  }
  updateGraphInputArea() {
    if (!this.state.inputTracksGraph) return;
    const input = this.input,
      region = input?.get(this.record.id);
    if (!region) return;
    const bounds = this.graphInputFields(0).slice(0, 4);
    region.bounds = bounds;
    this.state.bindArea = bounds.slice();
    input.changed = true;
  }
  async forwardInput(message, w, l, context = {}) {
    if (this.state.receiver === -1) return;
    return this.world.sendNativeEngine(this.state.receiver, this.record.id, message, w, l, {
      ...context,
    });
  }
  async updateVisibleInput(display, inputDisplay, context) {
    const input = this.input;
    // Direct visibility without inheritance has no Input message. Inherited
    // raw43 supplies the parent's renderer word; child raw44 supplies its own
    // incoming word. Neither is replaced by the direct raw43 argument.
    if (this.state.buttonEnabled && this.state.receiver !== -1 && inputDisplay !== undefined) {
      if (!input?.message) throw new Error('Native Plane visibility requires its Input owner');
      const flags = { flags: context.flags ?? 0 };
      await input.message(134, this.record.id, inputDisplay, flags);
      if (!inputDisplay) await input.message(132, this.record.id, 0, flags);
    }
    const region = input?.get(this.record.id);
    if (this.state.phase !== 3) {
      if (region?.active && this.state.button?.[3]) await this.selectButton(1);
      else if (this.state.button?.[0]) await this.selectButton(0);
    }
    if (!display && this.state.imageIndex !== -1)
      await this.world.sendNativeEngine(this.state.imageIndex, this.record.id, 47, 0, 0);
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
  inheritTransform(offset = this.state.parentOffset) {
    if (this.planeInheritanceUsesRenderer && (!this.graph || !this.graphics.device.attachment))
      return;
    const parent = this.graphics.get(this.record.parent);
    if (this.planeInheritanceUsesRenderer && parent && !parent.graph)
      throw new Error('Plane inheritance requires a live parent model');
    const base = parent?.graph ? motionVector(parent.graph.kx2, MOTION_ABI.base) : [0, 0, 0],
      pos = parent?.graph ? motionVector(parent.graph.kx2, MOTION_ABI.pos) : [0, 0, 0];
    if (
      this.planeInheritanceUsesRenderer &&
      (!base.every(Number.isFinite) || !pos.every(Number.isFinite))
    )
      throw new Error('Plane inheritance requires finite parent coordinates');
    if (this.graph) {
      const inheritedBase = [
        Math.fround(base[0] - offset[0]),
        Math.fround(base[1] - offset[1]),
        Math.fround(base[2] + offset[2]),
      ];
      const bytes = this.graph.kx2;
      for (const [channel, values] of [
        [MOTION_ABI.base, inheritedBase],
        [MOTION_ABI.pos, pos],
      ]) {
        if (
          !this.planeInheritanceUsesRenderer ||
          motionVector(bytes, channel).some((value, i) => value !== values[i])
        )
          setMotionVector(bytes, channel, values);
      }
      this.markBoundsDirty();
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
    const text = this.world.text;
    text?.settlePublications();
    if (text?.flushingPublication) await text.flushingPublication;
    return this.drawGraph(gpu, this.graph, this.state);
  }
  async drawGraph(gpu, inputGraph, state) {
    // Drawing observes current pixels before any foreign GPU/geometry getter.
    const text = this.world.text;
    text?.settlePublications();
    if (text?.flushingPublication) await text.flushingPublication;
    if (
      !inputGraph ||
      !state.shown ||
      hiddenModelRegistration(inputGraph) ||
      inputGraph.renderEnabled === false ||
      !new DataView(inputGraph.kx2.buffer).getInt32(MOTION_ABI.display, true)
    )
      return;
    // The ordinary native manager's complete frame window is [0, 1000000).
    // Trail samples share that submission gate with their primary model.
    const priority = motionVector(inputGraph.kx2, MOTION_ABI.base)[2];
    if (!(priority >= 0 && priority < 1000000)) return;
    if (inputGraph.movie) {
      const frame = inputGraph.movie.handle
        ? await this.world.planeMovies.frame(inputGraph.movie)
        : originalView(this.world, 'movieFrame', inputGraph.movie);
      if (!frame) return;
      gpu.drawGeometry(
        nativeGraphGeometry(inputGraph, state, this.graphics.projection(), frame),
        frame,
        {
          blendMode: state.blendMode,
          context: this.graphics.d3dContext,
          drawType: 0,
        },
      );
      return;
    }
    if (inputGraph.mesh || inputGraph.vram) {
      this.graphics.initializeTextures();
      const pages = nativeTexturePageStorage(this.graphics.texturePages);
      if (
        inputGraph.mesh &&
        nativeABI(this.world.profile).graphics.dividedMesh?.requiresTexturePages &&
        inputGraph.mesh.some(({ textureID }) => textureID < 0 || !pages.pages.has(textureID))
      )
        throw new Error('Divided mesh draw requires reviewed allocated texture pages');
      const triangles = nativeTexturedGeometry(
        inputGraph,
        state,
        this.graphics.projection(),
        pages.layout,
        (graph, vertices, triangle) => this.graphics.effectVertices(graph, vertices, triangle),
      );
      const options = {
        blendMode: state.blendMode,
        context: this.graphics.d3dContext,
        drawType: 0,
      };
      const draws = typeof gpu.drawTexturePages === 'function' ? [] : null;
      const pageIndices = [],
        pageDraws = [];
      for (let first = 0; first < triangles.length; ) {
        const { textureID } = triangles[first];
        let end = first + 1;
        // Each page is sampled with the same state within this graph draw.
        // Keep adjacent triangles in order when they share that page.
        while (end < triangles.length && triangles[end].textureID === textureID) end++;
        const batch = triangles.slice(first, end);
        if (draws) {
          const draw = { triangles: batch, frame: WHITE };
          draws.push(draw);
          if (textureID !== -1) {
            pageIndices.push(textureID);
            pageDraws.push(draw);
          }
        } else {
          const frame = textureID === -1 ? WHITE : await this.graphics.meshTexture(textureID);
          gpu.drawGeometry(batch, frame, options);
        }
        first = end;
      }
      if (draws) {
        const fields = Object.getOwnPropertyDescriptors(inputGraph);
        const pureGeometry =
          ordinaryPublicationConsumer(this.graphics, 0) &&
          ['mesh', 'triangles', 'custom', 'callback', 'vertexEffectID'].every(
            (key) =>
              !fields[key] ||
              (Object.hasOwn(fields[key], 'value') &&
                (key === 'vertexEffectID' ? fields[key].value === undefined : !fields[key].value)),
          ) &&
          triangles.every(
            (triangle) =>
              Array.isArray(triangle.vertices) &&
              triangle.vertices.every(
                (vertex) =>
                  ['x', 'y', 'z', 'w', 'u', 'v', 'color'].every(
                    (key) =>
                      typeof Object.getOwnPropertyDescriptor(vertex, key)?.value === 'number',
                  ) && Object.getOwnPropertyDescriptor(vertex, 'diffuse') === undefined,
              ),
          );
        const frames = nativeTexturePageFrames(
          this.graphics.texturePages,
          pageIndices,
          gpu,
          this.graphics,
          { ...options, pureGeometry },
        );
        for (let i = 0; i < frames.length; i++) pageDraws[i].frame = frames[i];
        gpu.drawTexturePages(draws, options);
      }
      return;
    }
    gpu.drawGeometry(
      nativeGraphGeometry(
        inputGraph,
        state,
        this.graphics.projection(),
        null,
        (vertices, triangle) => this.graphics.effectVertices(inputGraph, vertices, triangle),
      ),
      WHITE,
      { blendMode: state.blendMode, context: this.graphics.d3dContext, drawType: 0 },
    );
  }
  snapshot() {
    return structuredClone({ state: this.state, graph: this.graph });
  }
  restore(data) {
    if (
      this.planeClearInputClearsButtonRows &&
      (!Array.isArray(data.state.button) ||
        data.state.button.length !== 12 ||
        data.state.button.some((n) => !Number.isInteger(n) || n < 0 || n > 0xffffffff) ||
        typeof data.state.buttonEnabled !== 'boolean')
    )
      throw new Error('Invalid ordinary Plane button checkpoint');
    if (
      (isNativeColoredModel(data.graph) || this.ownsTexturedBounds(data.graph)) &&
      ((this.ownsTexturedBounds(data.graph) && typeof data.graph.sourceBoundsDirty !== 'boolean') ||
        typeof data.graph.boundsDirty !== 'boolean' ||
        !Array.isArray(data.graph.cachedBounds) ||
        data.graph.cachedBounds.length !== 4 ||
        !Array.from(data.graph.cachedBounds).every(
          (n) => Number.isInteger(n) && n >= -0x80000000 && n <= 0x7fffffff,
        ))
    )
      throw new Error('Invalid ordinary plane dirty bounds checkpoint');
    this.bindState(structuredClone(data.state));
    this.graph = structuredClone(data.graph);
    for (const graph of this.state.trail?.graphs ?? [])
      this.graphics.graphs.set(graph.nativeID, graph);
    this.sync();
  }
  closeGraph() {
    this.input?.unregister(this.record.id);
    this.unload();
    this.graphics.tasks.delete(this.record.id);
  }
  async close() {
    if (this.nativeClosed) return;
    await originalView(this.world, 'movieRelease', this);
    await this.world.planeMovies.release(this);
    this.closeGraph();
    this.nativeClosed = true;
  }
}

export function installNativeGraphics(world) {
  installNativePlaneMovieCommands(world);
  installNativePlaneModelCommands(world);
  const graphics = new NativeGraphics(world);
  world.graphics = graphics;
  world.retainedDraw = new NativeRetainedDraw(world);
  // Kind 2 is the native simple plane; kind 6 is its base image-plane task.
  for (const kind of [2, 6]) world.objects.register(kind, (record) => graphics.create(record));
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
  0x4e, 0x4f, 0x50, 0x53, 0x54, 0x55, 0x56, 0x57, 0x58, 0x59, 0x5a, 0x5b, 0x5c, 0x5d, 0x5e, 0x60,
  0x61, 0x62, 0x63, 0x64, 0x65, 0x66, 0x67, 0x68, 0x69, 0x6a, 0x6c, 0x6d, 0x6e, 0x350, 0x351, 0x157,
  0x158, 0x159, 0x192, 0x21d, 0x21e,
]);

export async function nativeGraphics(id, args, machine, task, world) {
  if (!NATIVE_GRAPHICS_IDS.includes(id)) return undefined;
  const abi = world.profile && nativeABI(world.profile),
    requirePose = abi?.graphics.planePoseQueriesRequireReply,
    nativeButton =
      abi?.graphics.planeUsesLegacyButtonStates || abi?.graphics.planeButtonUsesTexturePose,
    ownArity =
      (requirePose && [0x53, 0x56, 0x57, 0x59, 0x5a, 0x5b].includes(id)) ||
      (nativeButton && [0x60, 0x61, 0x62].includes(id)) ||
      (abi?.graphics.planeImageSelectorHidesTarget && [0x66, 0x67].includes(id)),
    planeSourceViaInput =
      id === 0x6d && (abi?.input?.planeSourceViaInput || abi?.input?.planeSourceUsesRawWord);
  const count = ownArity
    ? abi.tables.main.entries[id].signature.argumentWords
    : id === 0x21d
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
    if (id === 0x21d && abi?.graphics.textureReleaseUsesExistingOwner) {
      if (!graphics.device.attachment || !graphics.view.active || !graphics.texturePages)
        return done();
    } else graphics.initializeTextures();
    if (id === 0x21d) await graphics.texturePages.releaseRectangle(...args.map((n) => n | 0));
    else await graphics.texturePages.allocateMissing(world.configuration.fields.texture);
    return done();
  }
  if (
    !args[0] &&
    id !== 0x68 &&
    id !== 0x69 &&
    id !== 0x6a &&
    id !== 0x6c &&
    !planeSourceViaInput &&
    id !== 0x350 &&
    id !== 0x351
  )
    return [0x59, 0x62].includes(id) ? value(0) : done();
  if (id >= 89 && id <= 91 && abi?.graphics.planeInheritanceReceiverKinds) {
    const target = world.objects.objects.get(world.resolveTaskID(args[0], task.id));
    if (!abi.graphics.planeInheritanceReceiverKinds.includes(target?.kind))
      throw new Error('Plane inheritance requires a reviewed Plane receiver');
  }
  if (abi?.graphics.planeButtonReceiverKinds && [96, 97, 98, 99, 102, 103, 110].includes(id)) {
    const target = world.objects.objects.get(world.resolveTaskID(args[0], task.id));
    if (!abi.graphics.planeButtonReceiverKinds.includes(target?.kind))
      throw new Error('Plane button state requires a reviewed Plane receiver');
  }
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
      const output = new NativeGraphicsPacket([], {
        unwritten: abi?.graphics.graphQueriesTrackResponse ? [0, 1] : [],
      });
      await send(75, 0, 4, output);
      const width = output.load(0),
        height = output.load(4);
      if (width !== undefined) machine.store(args[1], width);
      if (height !== undefined) machine.store(args[2], height);
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
      const output = new NativeGraphicsPacket([], {
        unwritten: abi?.graphics.graphQueriesTrackResponse ? [0, 1, 4, 5] : [],
      });
      await send(76, 0, 16, output);
      const corners = [0, 4, 16, 20].map((at) => output.load(at));
      if (corners.includes(undefined)) throw new Error('Native graph bounds reply was unwritten');
      corners.forEach((value, index) => machine.store(args[index + 1], value));
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
      await send(51, args[4], 0, packet(args.slice(1, 4)), 1);
      return done();
    case 0x55: {
      const p = new NativeGraphicsPacket([], { unwritten: [0, 1, 2] });
      await send(61, args[3], 0, p, 1);
      // Unloaded or missing targets leave Z unwritten. A graph reads it only when applying the setter.
      p.store(0, args[1]);
      p.store(4, args[2]);
      await send(49, args[3], 0, p, 1);
      return done();
    }
    case 0x56:
    case 0x57: {
      const base = id === 0x56,
        coordinates = base ? 2 : 3,
        indices = Array.from({ length: coordinates }, (_, index) => index),
        p = requirePose ? new NativeGraphicsPacket([], { unwritten: indices }) : packet();
      await send(base ? 61 : 62, args[coordinates + 1], 0, p, Number(Boolean(requirePose)));
      if (requirePose) {
        for (const index of indices) {
          nativeEngineWord(p.load(index * 4), 'Native Plane pose query');
          machine.bytes(args[index + 1], 4);
        }
      }
      for (const index of indices) machine.store(args[index + 1], p.load(index * 4));
      return done();
    }
    case 0x58: {
      const p = packet();
      await send(61, 0, 0, p, 1);
      p.store(8, args[1]);
      await send(49, 0, 0, p, 1);
      return done();
    }
    case 0x59: {
      const p = requirePose ? new NativeGraphicsPacket([], { unwritten: [0, 1, 2] }) : packet();
      if (!requirePose || graphics.device.attachment)
        await send(61, 0, 0, p, Number(Boolean(requirePose)));
      const priority = p.load(8);
      return value(requirePose ? nativeEngineWord(priority, 'Native Plane priority') : priority);
    }
    case 0x5a:
      await send(53, 0, 0, packet(args.slice(1, 4)));
      return done();
    case 0x5b:
      await send(54);
      return done();
    case 0x5c:
      await send(47, 0, args[1], null, 1);
      return done();
    case 0x5d:
      await send(55, args[4], 0, packet(args.slice(1, 4)), 1);
      return done();
    case 0x5e:
      await send(
        63,
        0,
        Math.max(0, Math.min(255, args[1] | 0)),
        null,
        nativeABI(world.profile).graphics.planeAlphaFlags ?? 0,
      );
      return done();
    case 0x60: {
      const source = machine.bytes(args[2], 48),
        view = new DataView(source.buffer, source.byteOffset, source.byteLength);
      const button = Array.from({ length: 12 }, (_, index) => view.getUint32(index * 4, true));
      await send(72, 0, args[1], packet(button));
      return done();
    }
    case 0x61:
      await send(73, 0, args[1]);
      return done();
    case 0x62: {
      const result = await send(74);
      return value(nativeButton ? nativeEngineWord(result, 'Native Plane button state') : result);
    }
    case 0x63:
      await send(90);
      return done();
    case 0x64:
      await send(59, args[2], args[1]);
      return done();
    case 0x65:
      await send(66, args[4], 0, packet([...args.slice(1, 4), floatBits(1)]));
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
      if (planeSourceViaInput) {
        const target = world.objects.objects.get(world.resolveTaskID(args[0], task.id));
        if (target && ![2, 6].includes(target.kind))
          throw new Error('Native Plane input source requires a verified receiver');
        const context = { flags: 0 },
          result = await world.sendNativeEngine(args[0], task.id, 95, 0, 0, context);
        return value(context.nativeRouted ? nativeEngineWord(result, 'Plane input source') : 0);
      }
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
