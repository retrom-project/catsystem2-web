// SPDX-License-Identifier: MPL-2.0
// These five base FES objects create native screen-effect tasks in the original
// allocation phase. Their complete resource-list frame driver owns activation,
// completion, object deletion and the subsequent child-task cleanup pass.
import { mapABIMessage } from './abi/messages.mjs';
import { nativeABI } from './abi/index.mjs';
import { registerNativeFESObjectType } from './fes-objects.mjs';
import { installNativeScreenEffects, NATIVE_SCREEN_EFFECT_KINDS } from './screen-effect.mjs';
import { runNativeFESObjectMotion } from './fes-controls.mjs';
import { installNativeFESImageCaches } from './fes-images.mjs';

export const NATIVE_FES_EFFECT_COMMANDS = new Set(['rdraw', 'rwipe', 'wbreak', 'rwmos', 'rfmos']);
const ABI = {
  game: {
    objects: {
      26: { construct: 7669136 },
      27: { construct: 7669712 },
      30: { construct: 7677600 },
      31: { construct: 7678320 },
      32: { construct: 7678976 },
    },
    commands: { rdraw: 7866416, rwipe: 7866928, wbreak: 7867744, rwmos: 7871328, rfmos: 7871936 },
    apply: 7706192,
  },
  sdk: {
    objects: {
      26: { construct: 6227728 },
      27: { construct: 6228256 },
      30: { construct: 6236304 },
      31: { construct: 6236976 },
      32: { construct: 6237584 },
    },
    commands: { rdraw: 6396608, rwipe: 6397104, wbreak: 6397888, rwmos: 6401344, rfmos: 6401936 },
    apply: 6256592,
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
  async prepareTaskTransport(raw, kind, target) {
    const taskKind = raw === 1 ? kind : this.world.objects.objects.get(target)?.kind;
    if (!NATIVE_SCREEN_EFFECT_KINDS.includes(taskKind)) return;
    (await this.world.getNativeFeature('fes-screen-effect-projection')).importCaptures();
  }
  async initialize(instance, object) {
    if (object.deleted || object.nativeEffectInitialized) return;
    const platform = await this.world.getNativeFeature('graphics-platform');
    await platform.ensureRenderer();
    const projection = await this.world.getNativeFeature('fes-screen-effect-projection');
    projection.pushCaptures();
    const runtime = await this.runtime();
    // RWipe obtains and converts its mask through the same native FES image
    // cache used by the other image objects.
    if (object.nativeType === 27) installNativeFESImageCaches(runtime);
    await runtime.initializeObjectResources(instance, object);
    projection.importCaptures();
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
    const projection = await this.world.getNativeFeature('fes-screen-effect-projection');
    projection.pushCaptures();
    await (await this.runtime()).runResourceDrivers(instance);
    projection.importCaptures();
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
    const platform = await this.world.getNativeFeature('graphics-platform'),
      runtime = await this.runtime(),
      address = ABI[runtime.sdk ? 'sdk' : 'game'].commands[verb];
    if (!address) throw new Error(`Unknown native FES screen-effect command ${verb}`);
    await platform.ensureRenderer();
    const projection = await this.world.getNativeFeature('fes-screen-effect-projection');
    projection.pushCaptures();
    await this.world.getNativeFeature('engine-files');
    const result = await runtime.commonCommand(instance, address, line, {
      nativeViewPointer: platform.refs.view,
    });
    projection.importCaptures();
    return result;
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
  world.registerNativeFeature('fes-screen-effect-projection', (engine) =>
    engine.createScreenEffectProjection(world),
  );
  world.effectsFES = new NativeFESEffects(world);
  for (const type of [26, 27, 30, 31, 32])
    registerNativeFESObjectType(world, type, (runtime) => {
      const abi = ABI[runtime.sdk ? 'sdk' : 'game'],
        object = {
          ...abi.objects[type],
          ...nativeABI(runtime.engine.profile).fes.effects.objects[type],
        };
      return {
        ...object,
        definitionApply: abi.apply,
        definitionIncludesParent: true,
        verbs: new Set(runtime.table.keys()),
        vramOffset: null,
        canonicalMessage: (message) =>
          mapABIMessage(runtime.engine.profile, 'screen', 'canonical', message, 35),
        async initialize(runtime, instance, object, pointer) {
          await runtime.applyDefinition(instance, object, pointer, abi.apply);
        },
        syncObject() {},
      };
    });
}
