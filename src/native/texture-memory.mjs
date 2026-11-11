// SPDX-License-Identifier: MPL-2.0
// The transitional manager holds texture identities. Packed pixels belong to
// StageRenderer.surfaces, and browser sampling frames derive from those bytes.
import { NULL_NATIVE_TEXTURE } from './texture-layout.mjs';

const ABI = {
  'nekopara-vol3-engine-2.6.1.76': { allocate: 0x680bc0, release: 0x680bd0 },
  'sdk-4.01-engine-2.6.1.74': { allocate: 0x557790, release: 0x5577a0 },
};
export class NativeTexturePageView {
  constructor(platform) {
    this.platform = platform;
    this.engine = platform.engine;
    this.process = platform.process;
    this.abi = ABI[this.engine.profile];
    this.renderer = this.engine.features.get('renderer');
    if (!this.abi || !this.renderer?.initialized)
      throw new Error('Native texture pages require the original initialized renderer');
  }
  get pointer() {
    return this.process.load(this.platform.refs.manager + 8);
  }
  get layout() {
    const p = this.process,
      pointer = this.pointer,
      texture = this.platform.world.configuration.fields.texture;
    return {
      size: Uint32Array.of(p.load(pointer), p.load(pointer + 4)),
      configurationSize: Uint32Array.from(texture.size),
      grid: Uint32Array.of(p.load(pointer + 8), p.load(pointer + 12)),
      areas: texture.areas.map((row) => Uint32Array.from(row)),
      bppY: Uint32Array.from(texture.bppY),
      bpp: texture.bpp,
    };
  }
  texture(index) {
    index >>>= 0;
    const p = this.process,
      pointer = this.pointer;
    if (index >= p.load(pointer + 24)) return 0;
    const table = p.load(pointer + 20),
      wrapper = table ? p.load(table + index * 4) : 0,
      record = wrapper ? p.load(wrapper) : 0;
    return record ? p.load(record + 20) : 0;
  }
  frame(index) {
    const pointer = this.texture(index);
    return pointer ? this.renderer.d3d.frame(pointer) : NULL_NATIVE_TEXTURE;
  }
  async call(address, args) {
    return this.process.asyncEnabled
      ? this.engine.callFromHost(address, args, this.pointer)
      : this.engine.call(address, args, this.pointer);
  }
  async allocateMissing() {
    await this.call(this.abi.allocate, []);
  }
  async releaseRectangle(x, y, width, height) {
    await this.call(this.abi.release, [x, y, width, height]);
  }
  async upload(bitmap, rectangle = null) {
    const frame = await bitmap.frame(),
      [left, top, right, bottom] = rectangle ?? [0, 0, frame.width, frame.height],
      ox = bitmap.state.offsetX ?? 0,
      oy = bitmap.state.offsetY ?? 0,
      sourceLeft = Math.max(left, ox) - ox,
      sourceTop = Math.max(top, oy) - oy,
      width = Math.min(right, ox + frame.width) - ox - sourceLeft,
      height = Math.min(bottom, oy + frame.height) - oy - sourceTop;
    if (left >= right || top >= bottom) return;
    if (width <= 0 || height <= 0) return;
    const p = this.process,
      manager = this.pointer,
      pageWidth = p.load(manager),
      pageHeight = p.load(manager + 4),
      columns = p.load(manager + 8),
      rows = p.load(manager + 12),
      dx = (left + ox) | 0,
      dy = (top + oy) | 0,
      endColumn = Math.min(columns, Math.ceil((dx + width) / pageWidth)),
      endRow = Math.min(rows, Math.ceil((dy + height) / pageHeight));
    for (let row = Math.max(0, Math.floor(dy / pageHeight)); row < endRow; row++)
      for (let column = Math.max(0, Math.floor(dx / pageWidth)); column < endColumn; column++) {
        if (!this.texture(column + row * columns)) continue;
        const x = Math.max(dx, column * pageWidth),
          y = Math.max(dy, row * pageHeight),
          w = Math.min(dx + width, (column + 1) * pageWidth) - x,
          h = Math.min(dy + height, (row + 1) * pageHeight) - y,
          transfer = await bitmap.crop(sourceLeft + x - dx, sourceTop + y - dy, w, h),
          input = await transfer.frame();
        await this.platform.withBitmap(transfer, async (pointer) => {
          // 6805F0/557210 resets conversion at each page intersection. Keep
          // those exact rectangles and ascending physical source rows while
          // materializing only their pixels, rather than the virtual canvas.
          const stride = p.load(pointer + 20),
            data = p.load(pointer + 12),
            bytes = p.read(data, stride * h);
          for (let sy = 0; sy < h; sy++)
            for (let sx = 0; sx < w; sx++) {
              const source = (sy * w + sx) * 4,
                target = sy * stride + sx * 4;
              bytes[target] = input.rgba[source + 2];
              bytes[target + 1] = input.rgba[source + 1];
              bytes[target + 2] = input.rgba[source];
              bytes[target + 3] = input.rgba[source + 3];
            }
          p.write(data, bytes);
          await this.platform.rawBitmapUpload(pointer, 0, 0, w, h, x, y);
        });
      }
  }
  snapshot() {
    return { native: true };
  }
  close() {}
}
