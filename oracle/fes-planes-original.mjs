// SPDX-License-Identifier: MPL-2.0
// CPLANE / PLANE use the original FES records and complete frame drivers.
// Their child SimplePlane task is allocated by the original first-frame path.
import { mapABIMessage } from '../src/native/abi/messages.mjs';
import { nativeABI } from '../src/native/abi/index.mjs';
import { registerNativeFESObjectType } from './fes-objects-original.mjs';
import { runNativeFESObjectMotion } from './fes-controls-original.mjs';
import { installNativeFESImageCaches } from './fes-images-original.mjs';

const ABI = {
  game: {
    3: { construct: 7645264, driver: 6672848 },
    4: { construct: 7649600, driver: 6691136 },
    5: { construct: 7636128 },
    apply: 7706192,
  },
  sdk: {
    3: { construct: 6204896, driver: 5427504 },
    4: { construct: 6209184, driver: 5444400 },
    5: { construct: 6195904 },
    apply: 6256592,
  },
};
function pull(runtime, object, pointer) {
  const p = runtime.process,
    value = (at) => new DataView(p.read(pointer + at, 4).buffer).getFloat32(0, true);
  [object.x, object.y, object.z] = [48, 52, 56].map(value);
  [object.baseX, object.baseY, object.baseZ] = [64, 68, 72].map(value);
  [object.scaleX, object.scaleY, object.scaleZ] = [96, 100, 104].map(value);
  object.motionMatrix = Array.from({ length: 16 }, (_, i) => value(112 + i * 4));
  object.width = p.load(pointer + 176) | 0;
  object.height = p.load(pointer + 180) | 0;
  object.pri = p.load(pointer + 184) | 0;
  object.disp = !!p.load(pointer + 188);
  object.color = p.load(pointer + 192);
  object.alpha = object.color >>> 24;
  object.enable = !!p.load(pointer + 20);
  object.motionDelay = p.load(pointer + 40);
  if (object.nativeType === 4)
    [object.vramX, object.vramY, object.vramZ] = [740, 744, 748].map(value);
}
export class NativeFESPlanes {
  constructor(world) {
    this.world = world;
  }
  supports(object) {
    return [3, 4, 5].includes(object.nativeType);
  }
  allocates(type) {
    // Both original factories register NUMIMG's group count but their
    // allocation switches have no case 28. VIEW creates a Base/type-0 object.
    return type !== 'NUMIMG';
  }
  runtime() {
    return this.world.getNativeFeature('fes-objects');
  }
  async initialize(instance, object) {
    if (object.deleted) return this.close(object);
    return (await this.runtime()).create(instance, object);
  }
  async update(instance, object, options) {
    if (object.deleted) return this.close(object);
    if (object.nativeType === 5) return this.initialize(instance, object);
    await (await this.runtime()).runDriver(instance, object, options);
  }
  async advance(instance, object) {
    if (object.deleted) return;
    const runtime = await this.runtime(),
      pointer = await runtime.create(instance, object),
      p = runtime.process,
      record = this.world.objects.objects.get(instance.runtimeID),
      frame = ((record.effectiveFrame ?? 0) - (record.pausedFrames ?? 0)) >>> 0;
    if (object.nativePlaneMotionFrame !== frame) {
      await runtime.call(p.load(p.load(pointer) + 8), [frame], pointer, instance.runtimeID);
      object.nativePlaneMotionFrame = frame;
    }
    object.nativeMotionBusy = !!(await runtime.call(
      runtime.sdk ? 0x5e8fb0 : 0x748990,
      [],
      pointer,
      instance.runtimeID,
    ));
    if (object.nativeType !== 5) pull(runtime, object, pointer);
  }
  async command(instance, object, verb, args, context) {
    await this.world.getNativeFeature('engine-files');
    const runtime = await this.runtime(),
      result = await runtime.command(instance, object, verb, args, context);
    object.nativePlaneMotionFrame = null;
    if (!object.deleted) await this.advance(instance, object);
    return result;
  }
  async motion(instance, object, definition, args) {
    await runNativeFESObjectMotion(this, instance, object, definition, args);
    object.nativePlaneMotionFrame = null;
  }
  async close(object) {
    if (object.nativeTaskID != null) {
      if (this.world.objects.objects.has(object.nativeTaskID))
        await this.world.objects.destroy(object.nativeTaskID);
      object.nativeTaskID = null;
    }
    if (object.nativeObjectPointer == null) return;
    await (await this.runtime()).destroy(object.nativeObjectPointer);
    object.nativeObjectPointer = null;
  }
}
export function installNativeFESPlanes(world) {
  world.planesFES = new NativeFESPlanes(world);
  for (const type of [3, 4, 5])
    registerNativeFESObjectType(world, type, (runtime) => {
      const abi = ABI[runtime.sdk ? 'sdk' : 'game'];
      return {
        ...abi[type],
        ...nativeABI(runtime.engine.profile).fes.planes[type],
        definitionApply: abi.apply,
        definitionIncludesParent: true,
        vramOffset: null,
        verbs: new Set(runtime.table.keys()),
        canonicalMessage: (message) =>
          mapABIMessage(runtime.engine.profile, 'base', 'canonical', message),
        async initialize(runtime, instance, object, pointer) {
          await world.getNativeFeature('engine-files');
          installNativeFESImageCaches(runtime);
          await runtime.applyDefinition(instance, object, pointer, abi.apply);
          if (type !== 5) pull(runtime, object, pointer);
        },
        afterDefinition: (runtime, _instance, object, pointer) => {
          if (type !== 5) pull(runtime, object, pointer);
        },
        syncObject() {},
        driverArguments: (runtime, _instance, _object, pointer) => [
          runtime.process.load(pointer + 44),
          pointer,
        ],
        async beforeDriver(runtime, instance, object, pointer) {
          await world.planesFES.advance(instance, object);
          const offset = instance.player.nativeDraw?.offset ?? [0, 0];
          offset.forEach((word, i) =>
            runtime.process.store(
              runtime.driver + nativeABI(runtime.engine.profile).fes.planes.offset + i * 4,
              word,
            ),
          );
          if (instance.player.nativeInput?.state.sleeping) {
            object.nativePlaneDriverDisplay = runtime.process.load(pointer + 188);
            runtime.process.store(pointer + 188, 0);
            runtime.process.store(pointer + 16, 1);
          }
        },
        afterDriver(runtime, _instance, object, pointer) {
          if (object.nativePlaneDriverDisplay !== undefined) {
            runtime.process.store(pointer + 188, object.nativePlaneDriverDisplay);
            delete object.nativePlaneDriverDisplay;
          }
          pull(runtime, object, pointer);
        },
      };
    });
}
