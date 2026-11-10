// SPDX-License-Identifier: MPL-2.0
// The explicit EXE host provides the temporary image/font projection factory.
export function createNativeDataProjection(engine, options) {
  if (typeof engine.createDataBufferProjection !== 'function')
    throw new Error('Image/font projection requires the injected transitional EXE host');
  return engine.createDataBufferProjection(options);
}
