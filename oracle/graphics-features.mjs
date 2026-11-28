// SPDX-License-Identifier: MPL-2.0
import { NativeRenderer } from './renderer-host.mjs';
import { installNativeEngineWorkers } from './engine-workers.mjs';
import { NativeVMR9 } from './vmr9.mjs';
import { NativeDirectShow } from './directshow.mjs';
import { NativeTextureMovieRenderer } from './movie-texture-renderer.mjs';
import { NativePlaneMovieCommands } from './plane-movie-command.mjs';

export function installOriginalGraphics(world) {
  world.registerNativeFeature('renderer', (engine) => NativeRenderer.open(engine, world));
  world.registerNativeFeature('plane-movie-projection', async (engine) => {
    await world.getNativeFeature('graphics-platform');
    await world.getNativeFeature('directshow');
    await world.getNativeFeature('texture-movie-renderer');
    return engine.createPlaneMovieProjection(world);
  });
  world.registerNativeFeature('vmr9', (engine) => new NativeVMR9(engine));
  world.registerNativeFeature(
    'texture-movie-renderer',
    (engine) => new NativeTextureMovieRenderer(engine),
  );
  world.registerNativeFeature('directshow', async (engine) => {
    await world.getNativeFeature('engine-workers');
    return new NativeDirectShow(engine, world, await world.getNativeFeature('vmr9'));
  });
  world.registerNativeFeature('engine-workers', (engine) => installNativeEngineWorkers(engine));
  world.registerNativeFeature('graphics-platform', async (engine) => {
    await world.getNativeFeature('bitmap-memory');
    return engine.createGraphicsProjection(world);
  });

  world.registerNativeFeature('plane-movie-commands', async (engine) => {
    await world.getNativeFeature('directshow');
    return new NativePlaneMovieCommands(engine, world);
  });
  world.registerNativeFeature('image-commands', (engine) => {
    engine.registerFeature('image-commands', world.imageCommands);
    return world.imageCommands;
  });
}
