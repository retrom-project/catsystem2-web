// SPDX-License-Identifier: MPL-2.0
import { NativeBitmap } from '../src/native/image.mjs';
const size = (width, height, empty = false) => {
  if (
    !Number.isSafeInteger(width) ||
    !Number.isSafeInteger(height) ||
    width < (empty ? 0 : 1) ||
    height < (empty ? 0 : 1) ||
    width * height > 64 * 1024 * 1024
  )
    throw new Error(`Invalid native bitmap size ${width}×${height}`);
};

class OriginalImages {
  async importNative(wrapper, owner = null, { rowOrder } = {}) {
    if (!['top-down', 'bottom-up'].includes(rowOrder))
      throw new Error('Native bitmap import requires its pixel row order');
    const buffers = await this.world.getNativeFeature('data-buffers'),
      p = buffers.process,
      pointer = p.load(wrapper),
      width = p.load(pointer + 4),
      height = p.load(pointer + 8),
      data = p.load(pointer + 12),
      stride = p.load(pointer + 20),
      bpp = p.load(pointer + 24);
    size(width, height, true);
    if (![3, 4].includes(bpp) || stride < width * bpp)
      throw new Error(
        `Native decoded bitmap layout is unavailable: ${width}x${height}/${bpp}/${stride}`,
      );
    const rgba = new Uint8ClampedArray(width * height * 4);
    for (let y = 0; y < height; y++) {
      const row = p.read(
        data + (rowOrder === 'bottom-up' ? height - y - 1 : y) * stride,
        width * bpp,
      );
      for (let x = 0; x < width; x++) {
        const at = (y * width + x) * 4,
          src = x * bpp;
        rgba[at] = row[src + 2];
        rgba[at + 1] = row[src + 1];
        rgba[at + 2] = row[src];
        rgba[at + 3] = bpp === 4 ? row[src + 3] : 255;
      }
    }
    const handle = this.add(
      new NativeBitmap(this, {
        width,
        height,
        bpp: 4,
        rgba,
        canvasWidth: p.load(pointer + 28),
        canvasHeight: p.load(pointer + 32),
        offsetX: p.load(pointer + 36) | 0,
        offsetY: p.load(pointer + 40) | 0,
        baseX: p.load(pointer + 48) | 0,
        baseY: p.load(pointer + 52) | 0,
        clip: Array.from({ length: 4 }, (_, i) => p.load(pointer + 56 + i * 4) | 0),
        source: null,
        attributes: [],
        owner,
      }),
    );
    try {
      const memory =
        this.nativeMemory ||
        (this.world.nativeFeatureFactories?.has('bitmap-memory')
          ? await this.world.getNativeFeature('bitmap-memory')
          : null);
      if (memory) await memory.adopt(handle, pointer);
      await buffers.releaseBitmapPointer(wrapper);
    } catch (error) {
      await this.release(handle);
      throw error;
    }
    return handle;
  }
}
export function installOriginalImageImport(world) {
  Object.defineProperty(
    world.graphics.images,
    'importNative',
    Object.getOwnPropertyDescriptor(OriginalImages.prototype, 'importNative'),
  );
  world.runtime.services.importNativeBitmap = (...args) =>
    world.graphics.images.importNative(...args);
}
