// SPDX-License-Identifier: MPL-2.0
// Script bitmap state is owned by NativeImages. The explicit EXE host supplies
// projections and views for the remaining renderer/FES consumers.
import { installNativeBitmapOperations } from './bitmap-operations.mjs';
import { installNativeBitmapFactories } from './bitmap-factory.mjs';

export function installNativeBitmapMemory(world) {
  installNativeBitmapOperations(world);
  installNativeBitmapFactories(world);
}
