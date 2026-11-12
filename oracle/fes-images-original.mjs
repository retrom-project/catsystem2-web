// SPDX-License-Identifier: MPL-2.0
// Original CPU image objects and frame drivers. FES owns the source wrapper;
// retained renderer entries borrow its decoded pixels through native messages.
import { mapABIMessage } from '../src/native/abi/messages.mjs';
import { nativeABI } from '../src/native/abi/index.mjs';
import { registerNativeFESObjectType } from './fes-objects-original.mjs';
import { runNativeFESObjectMotion } from './fes-controls-original.mjs';
import { nativeRectangleDefinitions } from '../src/native/windows-rectangles.mjs';
import { encodeCP932 } from '../src/kcs/strings.mjs';

const ABI = {
  game: {
    1: { construct: 7638368, apply: 7766048, driver: 6671680 },
    2: { construct: 7643504, apply: 7766416, driver: 6676752 },
    6: { construct: 7650048, apply: 7767856, driver: 6670160 },
    11: { construct: 7719696, apply: 7768352, driver: 6686240 },
    12: { construct: 7742832, apply: 7768368, driver: 6693392 },
    16: { construct: 7746512, apply: 7769040, driver: 6670144 },
    17: { construct: 7747568, apply: 7769168, driver: 6670144 },
    18: { construct: 7748624, apply: 7769232, driver: 6670144 },
    19: { construct: 7749360, apply: 7769360, driver: 6670144 },
    20: { construct: 7750192, apply: 7769424, driver: 6670144 },
    22: { construct: 7751040, apply: 7769920, driver: 6681296 },
    25: { construct: 7668272, apply: 7706192, driver: 6673888 },
    wrapper: 6875632,
    loadCache: 6471600,
    dataCache: 6471072,
    copyWrapper: 6875840,
    compound: 6768288,
    display: 7640752,
    headerCache: 6468624,
    header: 6879248,
  },
  sdk: {
    1: { construct: 6198208, apply: 6308528, driver: 5426336 },
    2: { construct: 6203296, apply: 6308896, driver: 5430528 },
    6: { construct: 6209584, apply: 6310336, driver: 5424832 },
    11: { construct: 6269952, apply: 6310832, driver: 5439536 },
    12: { construct: 6284448, apply: 6310848, driver: 5446656 },
    16: { construct: 6287952, apply: 6311520, driver: 5424816 },
    17: { construct: 6288880, apply: 6311648, driver: 5424816 },
    18: { construct: 6289808, apply: 6311712, driver: 5424816 },
    19: { construct: 6290496, apply: 6311840, driver: 5424816 },
    20: { construct: 6291280, apply: 6311904, driver: 5424816 },
    22: { construct: 6292080, apply: 6312400, driver: 5435072 },
    25: { construct: 6226912, apply: 6256592, driver: 5428544 },
    wrapper: 5657952,
    loadCache: 5255760,
    dataCache: 5256288,
    copyWrapper: 5658144,
    compound: 5552016,
    display: 6200592,
    headerCache: 5253776,
    header: 5661152,
  },
};
const layout = (runtime) => ABI[runtime.sdk ? 'sdk' : 'game'];
const float = (p, at) => new DataView(p.read(at, 4).buffer).getFloat32(0, true);
function pull(runtime, object, pointer) {
  const p = runtime.process;
  object.x = float(p, pointer + 208);
  object.y = float(p, pointer + 212);
  object.baseX = float(p, pointer + 224);
  object.baseY = float(p, pointer + 228);
  object.rotation = (float(p, pointer + 232) * 180) / Math.PI;
  object.scaleX = float(p, pointer + 236);
  object.scaleY = float(p, pointer + 240);
  object.alpha = p.load(pointer + 284);
  object.pri = p.load(pointer + 288) | 0;
  object.nativeRenderID = p.load(pointer + 644) | 0;
  object.width = p.load(pointer + 300) | 0;
  object.height = p.load(pointer + 304) | 0;
  object.motionDelay = p.load(pointer + 40);
  object.enable = !!p.load(pointer + 20);
  object.disp = !!p.load(pointer + 296);
  if (![1, 25].includes(object.nativeType))
    object.idIndex = p.load(pointer + nativeABI(runtime.engine.profile).fes.imageIndexOffset) | 0;
}

export function installNativeFESImageCaches(runtime) {
  if (runtime.imageCachesInstalled) return;
  runtime.imageCachesInstalled = true;
  const { engine, process: p, world } = runtime,
    abi = layout(runtime),
    source = async (name) => {
      const context = runtime.requireContext(),
        owner = world.objects.objects.get(context.instance.runtimeID)?.implementation;
      if (typeof owner?.imageData !== 'function')
        throw new Error('Original FES image cache requires its native FES task');
      return owner.imageData(context.instance.player.expand(name));
    };
  for (const [name, definition] of nativeRectangleDefinitions(p))
    engine.registerWindows('USER32.dll', name, definition);
  engine.patch(
    abi.dataCache,
    'FES cached image-data resource',
    2,
    async ([name, out]) => {
      p.store(out, 0);
      const file = p.string(name);
      if (!file) return 0;
      const pointer = await source(file);
      if (!pointer) return 0;
      runtime.buffers.lendPointer(pointer);
      p.store(out, pointer);
      return 1;
    },
    { calleePops: true },
  );
  engine.patch(
    abi.headerCache,
    'FES cached image geometry',
    2,
    async ([name, out]) => {
      const file = p.string(name);
      if (!file) return 0;
      const data = await source(file);
      return data ? runtime.call(abi.header, [data, out]) : 0;
    },
    { calleePops: true },
  );
  engine.patch(
    abi.loadCache,
    'FES cached image decode resource',
    3,
    async ([wrapper, name, selector]) => {
      const file = p.string(name);
      if (!file) return 0;
      if (file.includes(',')) {
        const platform = await world.getNativeFeature('graphics-platform'),
          resolved = world.game.nativeResources
            ? world.game.nativeResources.resolve(file, 'image')
            : /[\\/]/.test(file)
              ? file
              : `@cat/image/${file}`;
        if (resolved === null) return 0;
        const wide = nativeABI(runtime.engine.profile).text.settingsCharacterBytes === 2,
          path = p.allocate(
            wide ? (resolved.length + 1) * 2 : encodeCP932(resolved + '\0').length,
            true,
          );
        let decoded = 0;
        try {
          engine.kernel.writeString(path, resolved, wide);
          decoded = await runtime.call(abi.compound, [path, 0], platform.refs.manager);
          if (decoded) await runtime.call(abi.copyWrapper, [decoded], wrapper);
          // The original comma branch returns zero even after copying its
          // successful composition into the caller's bitmap wrapper.
          return 0;
        } finally {
          if (decoded) await runtime.buffers.releaseBitmapPointer(decoded);
          p.free(path);
        }
      }
      const data = await source(file);
      if (!data) return 0;
      // 675690/54C870 create the same original bitmap wrapper and choose the
      // format parser from the complete native kcBuffer, including selector.
      const decoded = await runtime.buffers.decodeBitmapPointer(data, selector);
      if (!decoded) return 0;
      try {
        await runtime.call(abi.copyWrapper, [decoded], wrapper);
        return 1;
      } finally {
        await runtime.buffers.releaseBitmapPointer(decoded);
      }
    },
    { calleePops: true },
  );
}

export class NativeFESImages {
  constructor(world) {
    this.world = world;
  }
  supports(object) {
    return Object.hasOwn(ABI.game, object.nativeType);
  }
  runtime() {
    return this.world.getNativeFeature('fes-objects');
  }
  async initialize(instance, object) {
    if (object.deleted) return this.close(object);
    const runtime = await this.runtime(),
      pointer = await runtime.create(instance, object);
    if (object.nativeType === 6) {
      const input = instance.player.nativeInput;
      if (!input) throw new Error('Native FES button initialization requires its input mapping');
      const [, id] = await input.initializeObject(object);
      runtime.process.store(
        pointer + nativeABI(runtime.engine.profile).fes.imageTaskOffset,
        this.world.nativeTaskID(id),
      );
    }
    return pointer;
  }
  async update(instance, object, options) {
    if (object.deleted) return this.close(object);
    const runtime = await this.runtime();
    await runtime.runDriver(instance, object, options);
  }
  async command(instance, object, verb, args, context) {
    const runtime = await this.runtime();
    if (object.nativeType === 25 && verb === 'refex') {
      const owners = await this.world.getNativeFeature('image-owners');
      const handle = args.length ? instance.value(args[0]) : 0;
      if (handle) await owners.materialize(handle);
      context = {
        ...context,
        evaluate: (text, tokenIndex) => {
          const value = instance.value(text);
          return tokenIndex === 2 && value ? owners.pointer(value) : value;
        },
      };
    }
    const value = await runtime.command(instance, object, verb, args, context);
    if (!object.deleted) pull(runtime, object, object.nativeObjectPointer);
    return value;
  }
  motion(instance, object, definition, args) {
    return runNativeFESObjectMotion(this, instance, object, definition, args);
  }
  async advance(instance, object) {
    if (object.deleted) return;
    const runtime = await this.runtime(),
      pointer = await runtime.create(instance, object),
      record = this.world.objects.objects.get(instance.runtimeID),
      frame = ((record.effectiveFrame ?? 0) - (record.pausedFrames ?? 0)) >>> 0;
    if (object.nativeImageMotionFrame !== frame) {
      await runtime.call(
        runtime.process.load(runtime.process.load(pointer) + 8),
        [frame],
        pointer,
        instance.runtimeID,
      );
      object.nativeImageMotionFrame = frame;
      object.nativeMotionBusy = !!(await runtime.call(
        runtime.sdk ? 0x5e8fb0 : 0x748990,
        [],
        pointer,
        instance.runtimeID,
      ));
      pull(runtime, object, pointer);
    }
  }
  async close(object) {
    const runtime = await this.runtime();
    if (object.nativeImageOwner != null && object.nativeRenderID !== -1) {
      const sender = this.world.nativeTaskID(object.nativeImageOwner),
        key = (sender | (object.nativeRenderID << 16)) >>> 0;
      for (const draw of this.world.graphics.drawTasks.values()) await draw.remove(key);
    }
    if (object.nativeObjectPointer != null) {
      await runtime.destroy(object.nativeObjectPointer);
      object.nativeObjectPointer = null;
    }
    if (object.nativeImageWrapper) {
      await runtime.buffers.releaseBitmapPointer(object.nativeImageWrapper);
      object.nativeImageWrapper = null;
    }
  }
}

export function nativeFESImageAdapter(runtime, type) {
  installNativeFESImageCaches(runtime);
  const abi = layout(runtime),
    item = { ...abi[type], ...nativeABI(runtime.engine.profile).fes.images[type] };
  return {
    construct: item.construct,
    size: item.size,
    definitionApply: item.apply,
    definitionIncludesParent: type === 25,
    driver: item.driver,
    verbs: new Set(runtime.table.keys()),
    vramOffset: null,
    constructorArguments:
      type === 12
        ? async (runtime, instance) => {
            const record = runtime.world.objects.objects.get(instance.runtimeID),
              name = record?.context.contextName;
            if (typeof name !== 'string')
              throw new Error('Native SAVEPANEL constructor requires the FES parent context name');
            const bytes =
              nativeABI(runtime.engine.profile).text.settingsCharacterBytes === 1
                ? encodeCP932(name + '\0')
                : new Uint8Array((name.length + 1) * 2);
            if (nativeABI(runtime.engine.profile).text.settingsCharacterBytes === 2) {
              const view = new DataView(bytes.buffer);
              for (let i = 0; i < name.length; i++) view.setUint16(i * 2, name.charCodeAt(i), true);
            }
            const pointer = runtime.process.allocate(bytes.length, true);
            runtime.process.write(pointer, bytes);
            return { args: [0, pointer], release: () => runtime.process.free(pointer) };
          }
        : null,
    canonicalMessage: (message) =>
      mapABIMessage(runtime.engine.profile, 'fesImage', 'canonical', message),
    async initialize(runtime, instance, object, pointer) {
      await runtime.world.getNativeFeature('engine-files');
      if (type === 25) {
        object.nativeImageOwner = instance.runtimeID;
        await runtime.applyDefinition(instance, object, pointer, item.apply);
        pull(runtime, object, pointer);
        return;
      }
      const wrapper = runtime.process.allocate(
        nativeABI(runtime.engine.profile).fes.images.wrapperBytes,
        true,
      );
      try {
        await runtime.call(abi.wrapper, [], wrapper, instance.runtimeID);
      } catch (error) {
        runtime.process.free(wrapper);
        throw error;
      }
      object.nativeImageWrapper = wrapper;
      object.nativeImageOwner = instance.runtimeID;
      // 628D60 assigns this borrowed wrapper through 7497A0. The separately
      // owned alternate wrapper at +652 remains under the original destructor.
      runtime.process.store(pointer + 244, wrapper);
      await runtime.applyDefinition(instance, object, pointer, item.apply);
      pull(runtime, object, pointer);
    },
    afterDefinition(runtime, instance, object, pointer) {
      pull(runtime, object, pointer);
    },
    // Original sleep masks the retained item through task message 287. The
    // object's display setter changes script state and the Plane count delta.
    syncObject() {},
    driverArguments(runtime, instance, object, pointer) {
      return type === 25 ? [pointer] : [object.nativeImageWrapper, pointer];
    },
    async beforeDriver(runtime, instance, object, pointer) {
      await runtime.world.getNativeFeature('engine-files');
      await runtime.world.getNativeFeature('graphics-platform');
      if (type === 25) {
        const platform = await runtime.world.getNativeFeature('graphics-platform');
        runtime.process.store(runtime.driver + 108, platform.refs.view);
        if (runtime.process.load(pointer + 948)) await platform.ensureRenderer();
      }
      if (type === 11 || type === 12) await runtime.world.getNativeFeature('text');
      await runtime.world.imagesFES.advance(instance, object);
      const draw = instance.player.nativeDraw;
      // FES stores a raw Draw target, not a pointer to its lifetime.
      runtime.process.store(runtime.driver + 408, draw?.target ?? 0xffffffff);
      [0, 0, draw?.width ?? 0, draw?.height ?? 0].forEach((word, i) =>
        runtime.process.store(runtime.driver + 392 + i * 4, word),
      );
      if (type === 6) {
        const input = instance.player.nativeInput,
          existing = input?.state.buttons.find(([key]) => key === object.key)?.[1];
        if (existing == null) await input?.sync();
        const id = input?.state.buttons.find(([key]) => key === object.key)?.[1];
        if (id == null) throw new Error('Original FES button driver requires its real input child');
        object.nativeInputTaskID = id;
        runtime.process.store(
          pointer + nativeABI(runtime.engine.profile).fes.imageTaskOffset,
          runtime.world.nativeTaskID(id),
        );
      }
    },
    async afterDriver(runtime, instance, object, pointer) {
      pull(runtime, object, pointer);
      const owner = type === 25 ? runtime.process.load(pointer + 944) : 0,
        wrapper =
          type === 25 ? (owner ? runtime.process.load(owner + 12) : 0) : object.nativeImageWrapper,
        bitmap = wrapper ? runtime.process.load(wrapper) : 0;
      if (bitmap) {
        const sourceHandle = runtime.engine.features
          .get('graphics-platform')
          .imageHandle(bitmap, instance.runtimeID);
        if (object.nativeImageSourceHandle !== sourceHandle) {
          if (object.nativeImageHandle)
            await runtime.world.graphics.images.release(object.nativeImageHandle);
          object.nativeImageSourceHandle = sourceHandle;
          object.nativeImageHandle = runtime.world.graphics.images.alias(
            sourceHandle,
            instance.runtimeID,
          );
        }
        const state = runtime.world.graphics.images.get(sourceHandle).state;
        object.nativeImageMetrics = Object.fromEntries(
          [
            'width',
            'height',
            'canvasWidth',
            'canvasHeight',
            'offsetX',
            'offsetY',
            'baseX',
            'baseY',
          ].map((key) => [key, state[key]]),
        );
      } else {
        if (object.nativeImageHandle)
          await runtime.world.graphics.images.release(object.nativeImageHandle);
        object.nativeImageHandle = 0;
        object.nativeImageSourceHandle = null;
        object.nativeImageMetrics = null;
      }
    },
  };
}

export function installNativeFESImages(world) {
  world.registerNativeFeature('raster-kernels', (engine) => engine.createRasterProjection());
  world.registerNativeFeature('fes-draw-projection', async (engine) => {
    await world.getNativeFeature('graphics-platform');
    return engine.createDrawSourceProjection(world);
  });
  world.registerNativeFeature('retained-draw', (engine) => {
    engine.registerFeature('retained-draw', world.retainedDraw);
    return world.retainedDraw;
  });
  for (const type of [1, 2, 6, 11, 12, 16, 17, 18, 19, 20, 22, 25])
    registerNativeFESObjectType(world, type, (runtime) => nativeFESImageAdapter(runtime, type));
  world.imagesFES = new NativeFESImages(world);
}
