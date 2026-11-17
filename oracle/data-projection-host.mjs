// SPDX-License-Identifier: MPL-2.0
// Only explicit D8 consumers request independent PE byte descriptors.
export function createNativeDataProjection(engine, options) {
  if (typeof engine.createDataBufferProjection !== 'function')
    throw new Error('D8 byte projection requires the injected transitional EXE host');
  return engine.createDataBufferProjection(options);
}
