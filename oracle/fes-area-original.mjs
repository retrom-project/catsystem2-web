// SPDX-License-Identifier: MPL-2.0
// FES DRAW / WIPE allocation, packet construction and completion remain in
// 628D60/500390 and 62DA50/504E50, with the original CPU-area child tasks.
import { registerNativeFESObjectType } from './fes-objects-original.mjs';
import { installNativeAreaEffects } from '../src/native/area-effect.mjs';
import { installNativeFESImageCaches } from './fes-images-original.mjs';
import { runNativeFESObjectMotion } from './fes-controls-original.mjs';

export class NativeFESArea {
  constructor(world) {
    this.world = world;
  }
  supports(object) {
    return object.nativeType === 7 || object.nativeType === 8;
  }
  runtime() {
    return this.world.getNativeFeature('fes-objects');
  }
  async initialize(instance, object) {
    if (object.deleted || object.nativeAreaInitialized) return;
    const runtime = await this.runtime(),
      surface = instance.player.surface,
      draw = this.world.graphics.drawTasks.get(surface);
    if (!draw?.state.renderer) throw new Error('FES DRAW/WIPE requires its native drawing surface');
    installNativeFESImageCaches(runtime);
    runtime.process.store(runtime.driver + 408, this.world.nativeTaskID(surface));
    await runtime.initializeObjectResources(instance, object);
    object.nativeAreaInitialized = true;
  }
  async advance(instance, object) {
    if (object.deleted) return;
    const runtime = await this.runtime(),
      pointer = await runtime.create(instance, object),
      p = runtime.process,
      owner = this.world.objects.objects.get(instance.runtimeID),
      frame = ((owner.effectiveFrame ?? 0) - (owner.pausedFrames ?? 0)) >>> 0;
    if (object.nativeAreaMotionFrame !== frame) {
      await runtime.call(p.load(p.load(pointer) + 8), [frame], pointer, instance.runtimeID);
      object.nativeAreaMotionFrame = frame;
    }
    object.nativeMotionBusy = !!(await runtime.call(
      runtime.sdk ? 0x5e8fb0 : 0x748990,
      [],
      pointer,
    ));
  }
  async command(instance, object, verb, args, context) {
    const runtime = await this.runtime(),
      value = await runtime.command(instance, object, verb, args, context);
    object.nativeAreaMotionFrame = null;
    return value;
  }
  async motion(instance, object, definition, args) {
    await runNativeFESObjectMotion(this, instance, object, definition, args);
    object.nativeAreaMotionFrame = null;
  }
  async close(instance, object) {
    if (object.nativeObjectPointer == null) return;
    await (await this.runtime()).deleteObject(instance, object.nativeObjectPointer);
  }
  async closeOwner(instance) {
    for (const object of instance.objects)
      if (this.supports(object)) await this.close(instance, object);
  }
}
export function installNativeFESArea(world) {
  installNativeAreaEffects(world);
  world.areaFES = new NativeFESArea(world);
  for (const type of [7, 8])
    registerNativeFESObjectType(world, type, (runtime) => ({
      construct: runtime.sdk
        ? type === 7
          ? 0x5ec580
          : 0x5ec760
        : type === 7
          ? 0x74c070
          : 0x74c280,
      size: type === 7 ? 0x48 : 0x90,
      definitionApply: runtime.sdk ? 0x5f77d0 : 0x759650,
      definitionIncludesParent: true,
      verbs: new Set(runtime.table.keys()),
      vramOffset: null,
      canonicalMessage: (message) =>
        runtime.sdk
          ? message >= 252 && message <= 308
            ? message + 5
            : message >= 37
              ? message + 2
              : message
          : message,
      async initialize(runtime, instance, object, pointer) {
        await runtime.applyDefinition(instance, object, pointer, runtime.sdk ? 0x5f77d0 : 0x759650);
      },
      syncObject() {},
    }));
}
