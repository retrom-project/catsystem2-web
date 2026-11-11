// SPDX-License-Identifier: MPL-2.0
// Remaining producers borrow bitmap records and upload into JS-owned pages.
import { NativeBitmap } from './image.mjs';
export class NativeGraphicsPlatform {
  constructor(engine, world) {
    Object.assign(this, { engine, world, process: engine.process });
  }
  bitmap(pointer) {
    const p = this.process,
      width = p.load(pointer + 4),
      height = p.load(pointer + 8),
      data = p.load(pointer + 12),
      stride = p.load(pointer + 20),
      bpp = p.load(pointer + 24);
    if (
      ![3, 4].includes(bpp) ||
      !width ||
      !height ||
      width * height > 64 * 1024 * 1024 ||
      stride < width * bpp
    )
      throw new Error(
        `Native graph bitmap ${width}x${height}/${bpp} has an unrecovered pixel layout`,
      );
    const rgba = new Uint8ClampedArray(width * height * 4),
      pixels = p.read(data, (height - 1) * stride + width * bpp);
    for (let y = 0; y < height; y++) {
      for (let x = 0; x < width; x++) {
        const source = y * stride + x * bpp,
          at = (y * width + x) * 4;
        rgba[at] = pixels[source + 2];
        rgba[at + 1] = pixels[source + 1];
        rgba[at + 2] = pixels[source];
        rgba[at + 3] = bpp === 4 ? pixels[source + 3] : 255;
      }
    }
    return new NativeBitmap(this.world.graphics.images, {
      width,
      height,
      rgba,
      bpp: 4,
      canvasWidth: width,
      canvasHeight: height,
      offsetX: 0,
      offsetY: 0,
      baseX: 0,
      baseY: 0,
      clip: [0, 0, width, height],
      source: null,
      attributes: [],
    });
  }
  logicalBitmap(pointer) {
    const p = this.process,
      source = this.bitmap(pointer),
      state = source.state,
      rgba = state.rgba.slice(),
      rowBytes = state.width * 4;
    for (let y = 0; y < state.height; y++)
      rgba.set(
        state.rgba.subarray((state.height - y - 1) * rowBytes, (state.height - y) * rowBytes),
        y * rowBytes,
      );
    Object.assign(state, {
      rgba,
      canvasWidth: p.load(pointer + 28),
      canvasHeight: p.load(pointer + 32),
      offsetX: p.load(pointer + 36) | 0,
      offsetY: p.load(pointer + 40) | 0,
      baseX: p.load(pointer + 48) | 0,
      baseY: p.load(pointer + 52) | 0,
      clip: Array.from({ length: 4 }, (_, i) => p.load(pointer + 56 + i * 4) | 0),
      mask: p.load(pointer + 76),
      blendType: p.load(pointer + 84),
    });
    return source;
  }
  async copyBitmap(pointer, sx, sy, width, height, dx, dy) {
    if (!pointer || (width | 0) <= 0 || (height | 0) <= 0) return 0;
    const bitmap = this.bitmap(pointer),
      ox = this.process.load(pointer + 36) | 0,
      oy = this.process.load(pointer + 40) | 0,
      left = Math.max(sx | 0, ox),
      top = Math.max(sy | 0, oy),
      right = Math.min(((sx | 0) + (width | 0)) | 0, (ox + bitmap.width) | 0),
      bottom = Math.min(((sy | 0) + (height | 0)) | 0, (oy + bitmap.height) | 0);
    if (left >= right || top >= bottom) return 0;
    const area = [left - ox, top - oy, right - ox, bottom - oy],
      x = ((dx | 0) + ox) | 0,
      y = ((dy | 0) + oy) | 0;
    if (x < 0) area[0] = Math.min(area[2], area[0] - x);
    if (y < 0) area[1] = Math.min(area[3], area[1] - y);
    if (area[0] < area[2] && area[1] < area[3])
      await this.world.graphics.output(
        bitmap,
        [Math.max(x, 0) - area[0], Math.max(y, 0) - area[1]],
        area,
        { upload: true },
      );
    return 1;
  }
  async clearBitmap(x, y, width, height) {
    if ((width | 0) <= 0 || (height | 0) <= 0) return 0;
    await this.world.graphics.fill(x | 0, y | 0, width | 0, height | 0, 0);
    return 1;
  }
}
