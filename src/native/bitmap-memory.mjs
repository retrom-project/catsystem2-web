// SPDX-License-Identifier: MPL-2.0
// Script bitmap state is owned by NativeImages. The explicit EXE host supplies
// projections and views for the remaining renderer/FES consumers.
import { installNativeBitmapOperations } from './bitmap-operations.mjs';
import { installNativeBitmapFactories } from './bitmap-factory.mjs';

export function sameNativeBitmap(process, first, second) {
  const data = first && process.load(first);
  return Boolean(data && second && process.load(second) === data);
}

export function installNativeBitmapMemory(world) {
  world.registerNativeFeature('bitmap-memory', async (engine) => {
    await world.getNativeFeature('data-buffers');
    if (typeof engine.createBitmapProjection !== 'function')
      throw new Error('Bitmap projection requires the injected transitional EXE host');
    return engine.createBitmapProjection(world);
  });
  installNativeBitmapOperations(world);
  installNativeBitmapFactories(world);
}
