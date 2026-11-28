// SPDX-License-Identifier: MPL-2.0
// The complete corresponding zlib source and license accompany this artifact.
let pending;
export async function loadNativeZlib() {
  if (!pending)
    pending = (async () => {
      let module;
      try {
        module = await import(new URL('../../vendor/native_zlib.mjs', import.meta.url));
      } catch (error) {
        if (typeof document !== 'undefined' || error.code !== 'ERR_MODULE_NOT_FOUND') throw error;
        module = await import(new URL('../../.local/vendor/zlib/native_zlib.mjs', import.meta.url));
      }
      return module.default();
    })().catch((error) => {
      pending = null;
      throw error;
    });
  return pending;
}
export async function nativeInflate(source, destination) {
  const zlib = await loadNativeZlib(),
    input = zlib._malloc(Math.max(1, source.length)),
    output = zlib._malloc(Math.max(1, destination.length));
  try {
    zlib.HEAPU8.set(source, input);
    zlib.HEAPU8.set(destination, output);
    const result = zlib._cs2_inflate(output, destination.length, input, source.length);
    return { result, bytes: zlib.HEAPU8.slice(output, output + destination.length) };
  } finally {
    zlib._free(input);
    zlib._free(output);
  }
}
export async function nativeDeflate(source, destination) {
  const zlib = await loadNativeZlib(),
    input = zlib._malloc(Math.max(1, source.length)),
    output = zlib._malloc(Math.max(1, destination.length));
  try {
    zlib.HEAPU8.set(source, input);
    zlib.HEAPU8.set(destination, output);
    const result = zlib._cs2_deflate(output, destination.length, input, source.length);
    return { result, bytes: zlib.HEAPU8.slice(output, output + destination.length) };
  } finally {
    zlib._free(input);
    zlib._free(output);
  }
}
