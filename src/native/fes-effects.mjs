// SPDX-License-Identifier: MPL-2.0
// These five base FES objects create native screen-effect tasks in the original
// allocation phase. Their complete resource-list frame driver owns activation,
// completion, object deletion and the subsequent child-task cleanup pass.
import { registerNativeFESObjectType } from './fes-objects.mjs';
import { installNativeScreenEffects } from './screen-effect.mjs';
import { runNativeFESObjectMotion } from './fes-controls.mjs';
import { installNativeFESImageCaches } from './fes-images.mjs';

export const NATIVE_FES_EFFECT_COMMANDS = new Set(['rdraw', 'rwipe', 'wbreak', 'rwmos', 'rfmos']);
const ABI = {
  game: {
    objects: {
      26: { construct: 0x750590, size: 0x4c },
      27: { construct: 0x7507d0, size: 0x90 },
      30: { construct: 0x7526a0, size: 0x5c },
      31: { construct: 0x752970, size: 0x54 },
      32: { construct: 0x752c00, size: 0x58 },
    },
    commands: {
      rdraw: 0x780830,
      rwipe: 0x780a30,
      wbreak: 0x780d60,
      rwmos: 0x781b60,
      rfmos: 0x781dc0,
    },
    apply: 0x759650,
  },
  sdk: {
    objects: {
      26: { construct: 0x5f0710, size: 0x4c },
      27: { construct: 0x5f0920, size: 0x90 },
      30: { construct: 0x5f2890, size: 0x5c },
      31: { construct: 0x5f2b30, size: 0x54 },
      32: { construct: 0x5f2d90, size: 0x58 },
    },
    commands: {
      rdraw: 0x619ac0,
      rwipe: 0x619cb0,
      wbreak: 0x619fc0,
      rwmos: 0x61ad40,
      rfmos: 0x61af90,
    },
    apply: 0x5f77d0,
  },
};

export class NativeFESEffects {
  constructor(world) {
    this.world = world;
    this.commands = NATIVE_FES_EFFECT_COMMANDS;
  }
  supports(object) {
    return [26, 27, 30, 31, 32].includes(object.nativeType);
  }
  runtime() {
    return this.world.getNativeFeature('fes-objects');
  }
  async initialize(instance, object) {
    if (object.deleted || object.nativeEffectInitialized) return;
    const effects = await this.world.getNativeFeature('screen-effects');
    await effects.platform.ensureRenderer();
    const runtime = await this.runtime();
    // RWipe obtains and converts its mask through the same native FES image
    // cache used by the other image objects.
    if (object.nativeType === 27) installNativeFESImageCaches(runtime);
    await runtime.initializeObjectResources(instance, object);
    object.nativeEffectInitialized = true;
  }
  async advance(instance, object) {
    if (object.deleted) return;
    const runtime = await this.runtime(),
      pointer = await runtime.create(instance, object),
      p = runtime.process,
      record = this.world.objects.objects.get(instance.runtimeID),
      frame = ((record.effectiveFrame ?? 0) - (record.pausedFrames ?? 0)) >>> 0;
    if (object.nativeEffectMotionFrame !== frame) {
      await runtime.call(p.load(p.load(pointer) + 8), [frame], pointer, instance.runtimeID);
      object.nativeEffectMotionFrame = frame;
    }
    object.nativeMotionBusy = Boolean(
      await runtime.call(runtime.sdk ? 0x5e8fb0 : 0x748990, [], pointer, instance.runtimeID),
    );
    object.motionDelay = p.load(pointer + 40);
  }
  async update(instance) {
    for (const object of [...instance.objects])
      if (this.supports(object)) await this.initialize(instance, object);
    await (await this.runtime()).runResourceDrivers(instance);
  }
  async command(instance, object, verb, args, context) {
    const runtime = await this.runtime(),
      result = await runtime.command(instance, object, verb, args, context);
    if (!object.deleted) {
      object.nativeEffectMotionFrame = null;
      await this.advance(instance, object);
    }
    return result;
  }
  async commandLine(verb, line, instance) {
    const effects = await this.world.getNativeFeature('screen-effects'),
      runtime = await this.runtime(),
      address = ABI[runtime.sdk ? 'sdk' : 'game'].commands[verb];
    if (!address) throw new Error(`Unknown native FES screen-effect command ${verb}`);
    await effects.platform.ensureRenderer();
    await this.world.getNativeFeature('engine-files');
    return runtime.commonCommand(instance, address, line, {
      nativeViewPointer: effects.platform.refs.view,
    });
  }
  motion(instance, object, definition, args) {
    return runNativeFESObjectMotion(this, instance, object, definition, args);
  }
  async close(instance, object) {
    const runtime = await this.runtime();
    if (object.nativeObjectPointer != null)
      await runtime.deleteObject(instance, object.nativeObjectPointer);
  }
  async closeOwner(instance, { runDrivers = true } = {}) {
    for (const object of instance.objects)
      if (this.supports(object)) await this.close(instance, object);
    if (runDrivers) await (await this.runtime()).runResourceDrivers(instance);
  }
}

export function installNativeFESEffects(world) {
  installNativeScreenEffects(world);
  world.effectsFES = new NativeFESEffects(world);
  for (const type of [26, 27, 30, 31, 32])
    registerNativeFESObjectType(world, type, (runtime) => {
      const abi = ABI[runtime.sdk ? 'sdk' : 'game'],
        object = abi.objects[type];
      return {
        ...object,
        definitionApply: abi.apply,
        definitionIncludesParent: true,
        verbs: new Set(runtime.table.keys()),
        vramOffset: null,
        canonicalMessage: (message) =>
          runtime.sdk
            ? message >= 490 && message <= 497
              ? message + 26
              : message >= 372 && message <= 390
                ? message + 5
                : message >= 37
                  ? message + 2
                  : message
            : message,
        async initialize(runtime, instance, object, pointer) {
          await runtime.applyDefinition(instance, object, pointer, abi.apply);
        },
        syncObject() {},
      };
    });
}
