// SPDX-License-Identifier: MPL-2.0
// Remaining original FES/M2 consumers request their registered PE adapter.
export function installNativeRasterKernels(engine) {
  if (typeof engine.createRasterProjection !== 'function')
    throw new Error('Original FES/DLL raster consumer requires the injected EXE host');
  return engine.createRasterProjection();
}
