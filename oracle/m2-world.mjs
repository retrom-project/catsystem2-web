// SPDX-License-Identifier: MPL-2.0
// Explicit oracle composition. Product entry points never import this module.
import { NativeWorld } from '../web/transitional-entry.mjs';
import { installNativeM2, NATIVE_M2_IDS } from './m2-original.mjs';
import { NativeRenderer } from './m2-renderer-original.mjs';

export class M2OracleWorld extends NativeWorld {
  constructor(options) {
    super({ ...options, installM2: installM2Oracle });
    this.nativeFeatureFactories.set('renderer', (engine) => NativeRenderer.open(engine, this));
  }
}
export function installM2Oracle(world) {
  // Explicit graphics-oracle fixtures can replace a fresh World's default
  // JS registration. This composition is selected before creating any M2 task.
  world.objects.factories?.delete(54);
  for (const id of NATIVE_M2_IDS) world.runtime.handlers?.delete(`main:${id}`);
  world.nativeFESObjectTypes?.delete(33);
  installNativeM2(world);
  world.m2 = {
    async initialize() {
      if (world.nativeFeatureFactories.has('m2'))
        await (await world.getNativeFeature('m2')).initialize();
    },
    snapshot: () => ({}),
    restore() {},
    close() {},
  };
}
