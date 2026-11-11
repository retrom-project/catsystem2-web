// SPDX-License-Identifier: MPL-2.0
// Explicit test-only composition of the pre-6.6 graphics execution path.
import { NativeAreaGeometryProjection } from '../../oracle/area-geometry-projection.mjs';
import { NativeGraphics } from '../../oracle/graphics-original.mjs';
import { NativeGraphicsPlatform } from '../../oracle/graphics-process-original.mjs';
import { NativeRenderer } from '../../oracle/renderer-original.mjs';
import { NativeScreenEffectRenderer } from '../../oracle/screen-graph-original.mjs';
import { installM2Oracle } from '../../oracle/m2-world.mjs';
export function installGraphicsOracle(world) {
  installM2Oracle(world);
  const register = world.nativeFeatureFactories
    ? (name, factory) => world.nativeFeatureFactories.set(name, factory)
    : world.registerNativeFeature.bind(world);
  register('area-geometry-projection', (engine) => new NativeAreaGeometryProjection(engine, world));
  register('renderer', (engine) => NativeRenderer.open(engine, world));
  register('graphics-platform', async (engine) => {
    await world.getNativeFeature('bitmap-memory');
    return new NativeGraphicsPlatform(engine, world);
  });
  const graphics = world.graphics;
  for (const method of [
    'synchronizeView',
    'initializeTextures',
    'fill',
    'output',
    'attachment',
    'graphHandle',
    'effectModel',
    'create',
    'snapshot',
    'restore',
  ])
    graphics[method] = NativeGraphics.prototype[method].bind(graphics);
  for (const kind of [2, 6])
    world.objects.factories.set(kind, async (record, _objects, options = {}) => {
      const task = graphics.create(record);
      if (!options.restoring && world.nativeEngine?.module) await task.prepareNative(options);
      return task;
    });
  const renderer = world.screenEffects?.rendering;
  for (const method of ['drawRange', 'prepareModels', 'paused'])
    if (renderer) renderer[method] = NativeScreenEffectRenderer.prototype[method].bind(renderer);
  if (!world.initialize) return world;
  const initialize = world.initialize.bind(world);
  world.initialize = async (...args) => {
    const result = await initialize(...args);
    await (await world.getNativeFeature('graphics-platform')).ensureRenderer();
    graphics.initializeTextures();
    return result;
  };
  return world;
}
