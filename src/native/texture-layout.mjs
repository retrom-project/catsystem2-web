// SPDX-License-Identifier: MPL-2.0
// Graphics constructor 678B60 and kc2DTextureManager 680280/680980.
import { encodeSparseBytes, decodeSparseBytes } from './sparse-bytes.mjs';
export const NULL_NATIVE_TEXTURE = Object.freeze({
  width: 1,
  height: 1,
  rgba: Uint8Array.of(255, 255, 255, 255),
});

export function negotiateNativeTextureLayout(
  texture,
  { width = 0xffffffff, height = 0xffffffff } = {},
) {
  const size = Uint32Array.from(texture.size),
    grid = Uint32Array.from(texture.grid),
    areas = texture.areas.map((row) => Uint32Array.from(row)),
    bppY = Uint32Array.from(texture.bppY);
  if (!size[0] || !size[1] || width < 1 || height < 1)
    throw new RangeError('Native texture sizes and device limits must be positive');
  while (width < size[0]) {
    size[0] >>>= 1;
    grid[0] *= 2;
  }
  while (height < size[1]) {
    size[1] >>>= 1;
    grid[1] *= 2;
    for (const row of areas) for (let i = 0; i < 4; i++) row[i] *= 2;
    bppY[0] *= 2;
    bppY[1] *= 2;
  }
  const configurationSize = size.slice();
  for (let axis = 0; axis < 2; axis++)
    if ((size[axis] & (size[axis] - 1)) !== 0)
      size[axis] = 2 ** (Math.floor(Math.log2(size[axis])) + 1);
  if (size[0] > width || size[1] > height)
    throw new RangeError('Native power-of-two texture rounding exceeds the device limit');
  return { size, configurationSize, grid, areas, bppY, bpp: texture.bpp };
}

export function nativeTexturePage(layout, index) {
  index >>>= 0;
  const [columns, rows] = layout.grid;
  if (index >= columns * rows) return null;
  const x = index % columns,
    y = Math.floor(index / columns),
    allocated = layout.areas.some((area) => {
      if (area[0] === 0xffffffff) return false;
      const [sx, sy, dx, dy] = Array.from(area, (value) => value | 0);
      return x >= sx && y >= sy && x < sx + dx && y < sy + dy;
    });
  if (!allocated) return null;
  return {
    x: x * layout.size[0],
    y: y * layout.size[1],
    width: layout.size[0],
    height: layout.size[1],
    bpp: y >= layout.bppY[1] ? 16 : layout.bpp,
  };
}

export function convertNativeTexturePixels(rgba, bpp) {
  if (bpp === 32) return rgba;
  if (bpp !== 16) throw new Error(`Unsupported native texture depth ${bpp}`);
  // 688C60 / 5615B0 packs the high nibble of B,G,R,A into A4R4G4B4.
  // Sampling that normalized texture expands each 4-bit channel to n/15.
  for (let i = 0; i < rgba.length; i++) rgba[i] = (rgba[i] >>> 4) * 17;
  return rgba;
}

export class NativeTexturePages {
  constructor(layout, { release = () => {} } = {}) {
    this.layout = structuredClone(layout);
    this.releaseFrame = release;
    this.pages = new Map();
    this.allocateMissing();
  }
  allocateMissing(texture = this.layout) {
    const layout = this.layout;
    layout.areas = texture.areas.map((row) => Uint32Array.from(row));
    layout.bppY = Uint32Array.from(texture.bppY);
    const [width, height] = layout.size,
      [columns, rows] = layout.grid;
    if (!Number.isSafeInteger(columns * rows) || columns * rows > 0x1fffffff)
      throw new RangeError('Native texture page table overflows');
    // 680980 allocates 16-bit rows first, then configured-depth rows. Existing
    // textures retain both their pixels and format when areas/depths change.
    for (const lower of [true, false])
      for (const area of layout.areas) {
        if (area[0] === 0xffffffff) continue;
        const [sx, sy, dx, dy] = Array.from(area, (value) => value | 0),
          right = (sx + dx) | 0,
          bottom = (sy + dy) | 0;
        if (sx >= right || sy >= bottom) continue;
        if (sx < 0 || sy < 0 || right > columns || bottom > rows)
          throw new RangeError('Native texture area exceeds its page table');
        for (let y = sy; y < bottom; y++)
          for (let x = sx; x < right; x++) {
            if (y >= (layout.bppY[1] | 0) !== lower) continue;
            const index = x + y * columns;
            if (this.pages.has(index)) continue;
            if ((this.pages.size + 1) * width * height > 64 * 1024 * 1024)
              throw new RangeError('Native texture allocation exceeds bitmap capacity');
            this.pages.set(index, {
              x: x * width,
              y: y * height,
              bpp: lower ? 16 : layout.bpp,
              frame: {
                width,
                height,
                rgba: new Uint8ClampedArray(width * height * 4),
                revision: 0,
              },
            });
          }
      }
  }
  releaseRectangle(x, y, width, height) {
    const right = (x + width) | 0,
      bottom = (y + height) | 0;
    if (x >= right || y >= bottom) return;
    for (const [index, page] of this.pages)
      if (
        x < page.x + page.frame.width &&
        page.x < right &&
        y < page.y + page.frame.height &&
        page.y < bottom
      ) {
        this.releaseFrame(page.frame);
        this.pages.delete(index);
      }
  }
  async upload(bitmap, rectangle = null) {
    const input = await bitmap.frame(),
      [sx, sy, right, bottom] = rectangle ?? [0, 0, input.width, input.height];
    for (const page of this.pages.values()) {
      const { frame } = page,
        left = Math.max(0, sx, page.x),
        top = Math.max(0, sy, page.y),
        endX = Math.min(input.width, right, page.x + frame.width),
        endY = Math.min(input.height, bottom, page.y + frame.height);
      if (left >= endX || top >= endY) continue;
      for (let y = top; y < endY; y++) {
        const row = input.rgba.subarray((y * input.width + left) * 4, (y * input.width + endX) * 4),
          at = ((y - page.y) * frame.width + left - page.x) * 4;
        if (page.bpp === 32) frame.rgba.set(row, at);
        else if (page.bpp === 16)
          for (let i = 0; i < row.length; i++) frame.rgba[at + i] = (row[i] >>> 4) * 17;
        else throw new Error(`Unsupported native texture depth ${page.bpp}`);
      }
      frame.revision++;
    }
  }
  close() {
    for (const page of this.pages.values()) this.releaseFrame(page.frame);
    this.pages.clear();
  }
  frame(index) {
    return this.pages.get(index >>> 0)?.frame ?? NULL_NATIVE_TEXTURE;
  }
  snapshot() {
    return structuredClone({
      layout: this.layout,
      pages: [...this.pages].map(([index, page]) => [
        index,
        { ...page, frame: { ...page.frame, rgba: encodeSparseBytes(page.frame.rgba) } },
      ]),
    });
  }
  restore(state) {
    for (const page of this.pages.values()) this.releaseFrame(page.frame);
    this.layout = structuredClone(state.layout);
    this.pages = new Map(structuredClone(state.pages));
    for (const [index, page] of this.pages) {
      if (
        !Number.isInteger(index) ||
        index < 0 ||
        index >= this.layout.grid[0] * this.layout.grid[1] ||
        ![16, 32].includes(page.bpp) ||
        page.frame.width !== this.layout.size[0] ||
        page.frame.height !== this.layout.size[1] ||
        page.frame.rgba?.length !== page.frame.width * page.frame.height * 4
      )
        throw new Error('Invalid native texture page checkpoint');
      page.frame.rgba = new Uint8ClampedArray(decodeSparseBytes(page.frame.rgba).buffer);
    }
  }
}
