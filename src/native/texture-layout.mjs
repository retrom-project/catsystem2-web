// SPDX-License-Identifier: MPL-2.0
// Texture page layout and retained pixel storage.
import { encodeSparseBytes, decodeSparseBytes } from './sparse-bytes.mjs';
import { copyBitmapRow } from './raster-kernel.mjs';
import { nativeBitmapFrame, borrowNativePixels } from './image.mjs';
// The shared virtual D3D9 platform exposes this guard band for its captured limit.
export function virtualD3DGuardBand(maximum) {
  return [-maximum, -maximum, maximum, maximum];
}
export function virtualD3DTextureCaps(maximum) {
  const maximumTextureSize = Math.min(4096, maximum);
  return { maximumTextureSize, guardBand: virtualD3DGuardBand(maximumTextureSize) };
}

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
  return {
    size,
    configurationSize,
    grid,
    areas,
    bppY,
    bpp: texture.bpp,
    dither: texture.dither ?? 0,
  };
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
  // Pack the high nibbles from B, G, R and A into A4R4G4B4.
  // Sampling that normalized texture expands each 4-bit channel to n/15.
  for (let i = 0; i < rgba.length; i++) rgba[i] = (rgba[i] >>> 4) * 17;
  return rgba;
}

export function textureDitherThreshold(x, y) {
  return [5, 13, 12, 4, 6, 14, 11, 3, 7, 15, 10, 2, 8, 16, 9, 1][
    ((((x & 2) * 2) | (x & 1) | (y & 2)) * 2) | (y & 1)
  ];
}
export class NativeTexturePages {
  #pageIdentities = new WeakMap();

  constructor(
    layout,
    { release = () => {}, stage = null, trackDirty = false, beforeMutation = null } = {},
  ) {
    this.layout = structuredClone(layout);
    this.releaseFrame = release;
    this.stage = stage;
    this.beforeMutation = beforeMutation;
    this.pages = new Map();
    this.allocateMissing();
    // The flag table covers the entire grid and starts clean after allocation.
    this.dirtyFlags = trackDirty ? new Uint32Array(layout.grid[0] * layout.grid[1]) : null;
  }
  isDirty(index) {
    this.beforeMutation?.();
    return Boolean(
      this.dirtyFlags && index >= 0 && index < this.dirtyFlags.length && this.dirtyFlags[index],
    );
  }
  hasDirtyPages() {
    this.beforeMutation?.();
    return this.dirtyFlags?.some((flag) => flag !== 0) ?? false;
  }
  clearDirty() {
    this.beforeMutation?.();
    this.dirtyFlags?.fill(0);
  }
  allocateMissing(texture = this.layout) {
    this.beforeMutation?.();
    const layout = this.layout;
    layout.areas = texture.areas.map((row) => Uint32Array.from(row));
    layout.bppY = Uint32Array.from(texture.bppY);
    const [width, height] = layout.size,
      [columns, rows] = layout.grid;
    if (!Number.isSafeInteger(columns * rows) || columns * rows > 0x1fffffff)
      throw new RangeError('Native texture page table overflows');
    // Allocate 16-bit rows before configured-depth rows. Existing
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
            const surface = this.stage?.createSurface(width, height) ?? null;
            this.pages.set(index, {
              x: x * width,
              y: y * height,
              bpp: lower ? 16 : layout.bpp,
              surface,
              frame: {
                width,
                height,
                rgba: surface
                  ? new Uint8ClampedArray(this.stage.surfaces.get(surface).bytes.buffer)
                  : new Uint8ClampedArray(width * height * 4),
                revision: 0,
              },
            });
          }
      }
  }
  releaseRectangle(x, y, width, height) {
    this.beforeMutation?.();
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
        if (page.surface) this.stage.releaseSurface(page.surface);
        this.pages.delete(index);
      }
  }
  #capturePublication(rectangle, input) {
    const [left, top, right, bottom] = rectangle;
    if (
      !rectangle.every(Number.isInteger) ||
      left < 0 ||
      top < 0 ||
      right > input.width ||
      bottom > input.height ||
      left >= right ||
      top >= bottom
    )
      return null;
    const pages = [];
    for (const page of this.pages.values()) {
      const { frame } = page;
      if (
        page.x >= right ||
        page.y >= bottom ||
        page.x + frame.width <= left ||
        page.y + frame.height <= top
      )
        continue;
      if (page.bpp !== 32 && (page.bpp !== 16 || this.layout.dither)) return null;
      let identity = this.#pageIdentities.get(page);
      if (!identity) {
        identity = Symbol();
        this.#pageIdentities.set(page, identity);
      }
      pages.push({ identity, revision: frame.revision });
    }
    return pages.length ? { rectangle, pages } : null;
  }
  async upload(
    bitmap,
    rectangle = null,
    retained = null,
    { textPublication = null, revisionSteps = 1 } = {},
  ) {
    this.beforeMutation?.();
    const dither = Boolean(this.layout.dither);
    const input = await nativeBitmapFrame(
        bitmap,
        textPublication ? { textPublication } : undefined,
      ),
      region = rectangle ?? [0, 0, input.width, input.height],
      previous = retained?.previous,
      current = retained && this.#capturePublication(retained.footprint, input),
      ownsFootprint =
        current &&
        previous?.rectangle.every((value, i) => value === current.rectangle[i]) &&
        previous.pages.length === current.pages.length &&
        previous.pages.every(({ identity, revision }, i) => {
          const page = current.pages[i];
          return identity === page.identity && revision === page.revision;
        }),
      full = current && region.every((value, i) => value === current.rectangle[i]),
      changed = ownsFootprint && full && retained.changed;
    uploadTextureFrame(
      { pages: this.pages, dirtyFlags: this.dirtyFlags, stage: this.stage },
      input,
      region,
      changed,
      revisionSteps,
      dither,
    );
    if (full || ownsFootprint) return this.#capturePublication(current.rectangle, input);
  }
  clear(x, y, width, height) {
    this.beforeMutation?.();
    const right = (x + width) | 0,
      bottom = (y + height) | 0;
    if (x >= right || y >= bottom) return;
    for (const [index, page] of this.pages) {
      const { frame } = page,
        left = Math.max(x, page.x),
        top = Math.max(y, page.y),
        endX = Math.min(right, page.x + frame.width),
        endY = Math.min(bottom, page.y + frame.height);
      if (left >= endX || top >= endY) continue;
      if (this.dirtyFlags) this.dirtyFlags[index] = 1;
      for (let row = top; row < endY; row++)
        frame.rgba.fill(
          0,
          ((row - page.y) * frame.width + left - page.x) * 4,
          ((row - page.y) * frame.width + endX - page.x) * 4,
        );
      frame.revision++;
      if (page.surface) this.stage.surfaces.get(page.surface).revision = frame.revision;
    }
  }
  close() {
    this.beforeMutation?.();
    for (const page of this.pages.values()) {
      this.releaseFrame(page.frame);
      if (page.surface) this.stage.releaseSurface(page.surface);
    }
    this.pages.clear();
  }
  frame(index) {
    this.beforeMutation?.();
    const frame = this.pages.get(index >>> 0)?.frame ?? NULL_NATIVE_TEXTURE;
    borrowNativePixels(frame.rgba);
    return frame;
  }
  snapshot() {
    this.beforeMutation?.();
    return structuredClone({
      layout: this.layout,
      dirtyFlags: this.dirtyFlags,
      pages: [...this.pages].map(([index, page]) => [
        index,
        { ...page, frame: { ...page.frame, rgba: encodeSparseBytes(page.frame.rgba) } },
      ]),
    });
  }
  restore(state) {
    this.beforeMutation?.();
    const flags = state.dirtyFlags,
      count = state.layout.grid[0] * state.layout.grid[1];
    if (
      this.dirtyFlags === null
        ? flags !== null
        : !(flags instanceof Uint32Array) ||
          flags.length !== count ||
          flags.some((value) => value !== 0 && value !== 1)
    )
      throw new Error('Invalid native texture page dirty flags checkpoint');
    this.close();
    this.layout = structuredClone(state.layout);
    this.dirtyFlags = flags === null ? null : flags.slice();
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
      const bytes = decodeSparseBytes(page.frame.rgba);
      if (page.surface) {
        if (!this.stage) throw new Error('Texture page checkpoint needs its StageRenderer owner');
        this.stage.restoreSurfaces([
          [
            page.surface,
            {
              width: page.frame.width,
              height: page.frame.height,
              pitch: page.frame.width * 4,
              format: 'rgba8',
              bytes: page.frame.rgba,
              revision: page.frame.revision,
            },
          ],
        ]);
        page.frame.rgba = new Uint8ClampedArray(this.stage.surfaces.get(page.surface).bytes.buffer);
      } else page.frame.rgba = new Uint8ClampedArray(bytes.buffer);
    }
  }
}

// Shared synchronous page write; owned sinks contain only captured data records.
export function uploadTextureFrame(
  { pages, dirtyFlags, stage },
  input,
  region,
  changed,
  revisionSteps,
  dither,
  owned = false,
) {
  const [sx, sy, right, bottom] = region;
  for (const [index, page] of pages) {
    const { frame } = page,
      fullLeft = Math.max(0, sx, page.x),
      fullTop = Math.max(0, sy, page.y),
      fullRight = Math.min(input.width, right, page.x + frame.width),
      fullBottom = Math.min(input.height, bottom, page.y + frame.height);
    if (fullLeft >= fullRight || fullTop >= fullBottom) continue;
    // The original force call marks the full texture footprint dirty even
    // when the existing page bytes need no further write.
    if (dirtyFlags) dirtyFlags[index] = 1;
    const left = changed ? Math.max(fullLeft, changed[0]) : fullLeft,
      top = changed ? Math.max(fullTop, changed[1]) : fullTop,
      endX = changed ? Math.min(fullRight, changed[2]) : fullRight,
      endY = changed ? Math.min(fullBottom, changed[3]) : fullBottom;
    if (left >= endX || top >= endY) continue;
    for (let y = top; y < endY; y++) {
      const start = (y * input.width + left) * 4,
        bytes = (endX - left) * 4,
        row = owned ? null : input.rgba.subarray(start, start + bytes),
        at = ((y - page.y) * frame.width + left - page.x) * 4;
      if (page.bpp === 32) {
        if (owned) copyBitmapRow(frame.rgba, at, input.rgba, start, bytes, true);
        else frame.rgba.set(row, at);
      } else if (page.bpp === 16)
        for (let i = 0; i < (owned ? bytes : row.length); i++) {
          const x = i >>> 2,
            phaseY = y - top,
            threshold = textureDitherThreshold(x, phaseY),
            value = owned ? input.rgba[start + i] : row[i],
            increment = dither && i % 4 !== 3 && (value & 15) >= threshold;
          frame.rgba[at + i] = Math.min(15, (value >>> 4) + Number(increment)) * 17;
        }
      else throw new Error(`Unsupported native texture depth ${page.bpp}`);
    }
    for (let step = 0; step < revisionSteps; step++) frame.revision++;
    if (page.surface)
      (owned ? page.surfaceObject : stage.surfaces.get(page.surface)).revision = frame.revision;
  }
}
