// SPDX-License-Identifier: MPL-2.0
import { registerNativeFESObjectType } from './fes-objects.mjs';

class NativeFESParticles {
  constructor(world) {
    this.world = world;
  }
  supports(object) {
    return object.nativeType === 23;
  }
  runtime() {
    return this.world.getNativeFeature('fes-objects');
  }
  async initialize(instance, object) {
    if (object.deleted) return this.close(instance, object);
    const runtime = await this.runtime();
    if (!object.nativeParticleInitialized) {
      await this.world.getNativeFeature('engine-files');
      await runtime.initializeObjectResources(instance, object);
      object.nativeParticleInitialized = true;
    } else await runtime.create(instance, object);
  }
  async command(instance, object, verb, args, context) {
    return (await this.runtime()).command(instance, object, verb, args, context);
  }
  async close(instance, object) {
    if (object.nativeObjectPointer != null)
      await (await this.runtime()).deleteObject(instance, object.nativeObjectPointer);
  }
}

export function installNativeFESParticles(world) {
  world.particlesFES = new NativeFESParticles(world);
  registerNativeFESObjectType(world, 23, (runtime) => {
    const apply = runtime.sdk ? 0x5f77d0 : 0x759650;
    return {
      construct: runtime.sdk ? 0x5effd0 : 0x74fdf0,
      size: 0x15c,
      definitionApply: apply,
      definitionIncludesParent: true,
      categoryFilenameCapacity: 128,
      verbs: new Set(runtime.table.keys()),
      canonicalMessage: (message) =>
        runtime.sdk && message >= 309 && message <= 316 ? message + 5 : message,
      initialize: (runtime, instance, object, pointer) =>
        runtime.applyDefinition(instance, object, pointer, apply),
      syncObject() {},
    };
  });
}
