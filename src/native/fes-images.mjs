// SPDX-License-Identifier: MPL-2.0
// Original CPU image objects and frame drivers. FES owns the source wrapper;
// retained renderer entries borrow its decoded pixels through native messages.
import { registerNativeFESObjectType } from './fes-objects.mjs';
import { runNativeFESObjectMotion } from './fes-controls.mjs';
import { nativeRectangleDefinitions } from './windows-rectangles.mjs';
import { NativeRetainedDraw } from './retained-draw.mjs';
import { encodeCP932 } from '../kcs/strings.mjs';

const ABI = {
  game: {
    wrapper: 0x68e9f0,
    wrapperBytes: 0x218,
    loadCache: 0x62bfb0,
    dataCache: 0x62bda0,
    copyWrapper: 0x68eac0,
    compound: 0x6746a0,
    display: 0x7496b0,
    headerCache: 0x62b410,
    header: 0x68f810,
    1: { construct: 0x748d60, apply: 0x768020, driver: 0x65cd40, size: 0x2a8 },
    2: { construct: 0x74a170, apply: 0x768190, driver: 0x65e110, size: 0x6e8 },
    6: { construct: 0x74bb00, apply: 0x768730, driver: 0x65c750, size: 0x7fc },
    11: { construct: 0x75cb10, apply: 0x768920, driver: 0x660620, size: 0x6f4 },
    12: { construct: 0x762570, apply: 0x768930, driver: 0x662210, size: 0xb1c },
    16: { construct: 0x7633d0, apply: 0x768bd0, driver: 0x65c740, size: 0x6f0 },
    17: { construct: 0x7637f0, apply: 0x768c50, driver: 0x65c740, size: 0x6f0 },
    18: { construct: 0x763c10, apply: 0x768c90, driver: 0x65c740, size: 0x6ec },
    19: { construct: 0x763ef0, apply: 0x768d10, driver: 0x65c740, size: 0x6ec },
    20: { construct: 0x764230, apply: 0x768d50, driver: 0x65c740, size: 0x6ec },
    22: { construct: 0x764580, apply: 0x768f40, driver: 0x65f2d0, size: 0x6e8 },
    25: { construct: 0x750230, apply: 0x759650, driver: 0x65d5e0, size: 0x3c0 },
  },
  sdk: {
    wrapper: 0x565560,
    wrapperBytes: 0x114,
    loadCache: 0x503250,
    dataCache: 0x503460,
    copyWrapper: 0x565620,
    compound: 0x54b790,
    display: 0x5e9d10,
    headerCache: 0x502a90,
    header: 0x5661e0,
    1: { construct: 0x5e93c0, apply: 0x6042b0, driver: 0x52cca0, size: 0x2a8 },
    2: { construct: 0x5ea7a0, apply: 0x604420, driver: 0x52dd00, size: 0x5e8 },
    6: { construct: 0x5ec030, apply: 0x6049c0, driver: 0x52c6c0, size: 0x6fc },
    11: { construct: 0x5fac00, apply: 0x604bb0, driver: 0x530030, size: 0x5f4 },
    12: { construct: 0x5fe4a0, apply: 0x604bc0, driver: 0x531c00, size: 0x81c },
    16: { construct: 0x5ff250, apply: 0x604e60, driver: 0x52c6b0, size: 0x5f0 },
    17: { construct: 0x5ff5f0, apply: 0x604ee0, driver: 0x52c6b0, size: 0x5f0 },
    18: { construct: 0x5ff990, apply: 0x604f20, driver: 0x52c6b0, size: 0x5ec },
    19: { construct: 0x5ffc40, apply: 0x604fa0, driver: 0x52c6b0, size: 0x5ec },
    20: { construct: 0x5fff50, apply: 0x604fe0, driver: 0x52c6b0, size: 0x5ec },
    22: { construct: 0x600270, apply: 0x6051d0, driver: 0x52eec0, size: 0x5e8 },
    25: { construct: 0x5f03e0, apply: 0x5f77d0, driver: 0x52d540, size: 0x3c0 },
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
    object.idIndex = p.load(pointer + (runtime.sdk ? 1064 : 1320)) | 0;
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
      runtime.buffers.retainPointer(pointer);
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
        const wide = !runtime.sdk,
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
      runtime.process.store(pointer + (runtime.sdk ? 1512 : 1768), this.world.nativeTaskID(id));
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
    item = abi[type];
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
            const bytes = runtime.sdk
              ? encodeCP932(name + '\0')
              : new Uint8Array((name.length + 1) * 2);
            if (!runtime.sdk) {
              const view = new DataView(bytes.buffer);
              for (let i = 0; i < name.length; i++) view.setUint16(i * 2, name.charCodeAt(i), true);
            }
            const pointer = runtime.process.allocate(bytes.length, true);
            runtime.process.write(pointer, bytes);
            return { args: [0, pointer], release: () => runtime.process.free(pointer) };
          }
        : null,
    canonicalMessage: (message) =>
      runtime.sdk
        ? (new Map([
            [275, 280],
            [276, 281],
            [284, 289],
            [288, 293],
            [290, 295],
            [294, 299],
          ]).get(message) ?? (message >= 37 ? message + 2 : message))
        : message,
    async initialize(runtime, instance, object, pointer) {
      await runtime.world.getNativeFeature('engine-files');
      if (type === 25) {
        object.nativeImageOwner = instance.runtimeID;
        await runtime.applyDefinition(instance, object, pointer, item.apply);
        pull(runtime, object, pointer);
        return;
      }
      const wrapper = runtime.process.allocate(abi.wrapperBytes, true);
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
          pointer + (runtime.sdk ? 1512 : 1768),
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
  world.registerNativeFeature('retained-draw', (engine) => new NativeRetainedDraw(engine, world));
  for (const type of [1, 2, 6, 11, 12, 16, 17, 18, 19, 20, 22, 25])
    registerNativeFESObjectType(world, type, (runtime) => nativeFESImageAdapter(runtime, type));
  world.imagesFES = new NativeFESImages(world);
}
