// SPDX-License-Identifier: MPL-2.0
// TextureManager owns allocations and the D3D textures own their only pixels.
// Browser sampling frames are derived from those same live texture records.
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
      [left, top, right, bottom] = rectangle ?? [0, 0, frame.width, frame.height];
    if (left >= right || top >= bottom) return;
    await this.platform.withBitmap(bitmap, async (pointer) => {
      // A VRAM sampling frame already uses ascending texture rows. Preserve
      // that order when crossing the physical-bitmap upload boundary.
      const p = this.process,
        stride = p.load(pointer + 20),
        data = p.load(pointer + 12),
        bytes = p.read(data, stride * frame.height);
      for (let y = 0; y < frame.height; y++)
        for (let x = 0; x < frame.width; x++) {
          const source = (y * frame.width + x) * 4,
            target = y * stride + x * 4;
          bytes[target] = frame.rgba[source + 2];
          bytes[target + 1] = frame.rgba[source + 1];
          bytes[target + 2] = frame.rgba[source];
          bytes[target + 3] = frame.rgba[source + 3];
        }
      p.write(data, bytes);
      await this.platform.rawBitmapUpload(
        pointer,
        left,
        top,
        right - left,
        bottom - top,
        left,
        top,
      );
    });
  }
  snapshot() {
    return { native: true };
  }
  close() {}
}
