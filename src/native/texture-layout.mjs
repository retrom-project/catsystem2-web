// SPDX-License-Identifier: MPL-2.0
// Texture page layout and retained pixel storage.
import { encodeSparseBytes, decodeSparseBytes } from './sparse-bytes.mjs';
import { copyBitmapRow } from './raster-kernel.mjs';
import { nativeBitmapFrame, borrowNativePixels } from './image.mjs';
import { nativeStageSurface, registerNativeSurfaceRead } from '../render/surfaces.mjs';
import {
  nativeTextureConsumer,
  nativeTextureReadOwned,
  nativeD3DContextReadOwned,
  registerNativeTextureRead,
  borrowNativeTextureRead,
} from '../render/particles-gl.mjs';
const textureReadBarriers = new WeakMap(),
  textureOwners = new WeakMap(),
  texturePageMaps = new WeakMap(),
  textureFlagArrays = new WeakMap(),
  textureLayouts = new WeakMap(),
  texturePublicLoans = new WeakSet(),
  textureMapForEach = Map.prototype.forEach,
  originalMapGet = Map.prototype.get;

const textureFields = {
  pages: texturePageMaps,
  dirtyFlags: textureFlagArrays,
  layout: textureLayouts,
};
function borrowTextureStorage(pages) {
  try {
    textureReadBarriers.get(pages)?.();
  } finally {
    if (!texturePublicLoans.has(pages)) {
      texturePublicLoans.add(pages);
      const records = texturePageMaps.get(pages);
      if (records)
        Reflect.apply(textureMapForEach, records, [
          (page) => {
            const frame = Object.getOwnPropertyDescriptor(page, 'frame')?.value;
            if (frame) borrowNativeTextureRead(frame);
          },
        ]);
    }
  }
}
function textureStorage(pages, key) {
  const field = textureFields[key],
    descriptor = Object.getOwnPropertyDescriptor(NativeTexturePages.prototype, key);
  const original = Reflect.apply(originalMapGet, textureStoragePorts, [key]);
  if (
    field.has(pages) &&
    Object.getPrototypeOf(pages) === NativeTexturePages.prototype &&
    !Object.hasOwn(pages, key) &&
    descriptor?.get === original.get &&
    descriptor?.set === original.set
  )
    return field.get(pages);
  borrowTextureStorage(pages);
  return pages[key];
}
// Only core consumers use this short owned access. Public fields lend their
// actual storage, including future entries, until this page owner is released.
export function nativeTexturePageStorage(pages) {
  return {
    pages: textureStorage(pages, 'pages'),
    dirtyFlags: textureStorage(pages, 'dirtyFlags'),
    layout: textureStorage(pages, 'layout'),
  };
}

// Copy-only qualification metadata. Observation never returns frame/Map/bytes.
export function nativeTexturePageSummary(pages) {
  textureReadBarriers.get(pages)?.();
  const records = textureStorage(pages, 'pages'),
    checked = new Map();
  let count = 0,
    owned = 0;
  Reflect.apply(textureMapForEach, records, [
    (page) => {
      count++;
      if (!texturePublicLoans.has(pages)) {
        const frame = Object.getOwnPropertyDescriptor(page, 'frame')?.value;
        if (frame && nativeTextureReadOwned(frame, checked)) owned++;
      }
    },
  ]);
  return {
    pages: count,
    owned,
    borrowed: count - owned,
    containerOwned: nativeTexturePagesOwned(pages, textureOwners.get(pages)),
  };
}

export function nativeTexturePagesOwned(pages, owner) {
  return (
    !texturePublicLoans.has(pages) &&
    textureOwners.get(pages) === owner &&
    Object.getPrototypeOf(pages) === NativeTexturePages.prototype &&
    texturePageMethods.every(([key, descriptor]) => {
      const current = Object.getOwnPropertyDescriptor(NativeTexturePages.prototype, key);
      return (
        !Object.hasOwn(pages, key) &&
        current?.value === descriptor.value &&
        current?.get === descriptor.get &&
        current?.set === descriptor.set
      );
    }) &&
    Object.getOwnPropertyDescriptor(pages, 'beforeMutation')?.value ===
      textureReadBarriers.get(pages) &&
    Object.getPrototypeOf(texturePageMaps.get(pages)) === Map.prototype &&
    textureMapMethods.every(
      ([key, descriptor]) =>
        !Object.hasOwn(texturePageMaps.get(pages), key) &&
        Object.getOwnPropertyDescriptor(Map.prototype, key)?.value === descriptor.value &&
        Object.getOwnPropertyDescriptor(Map.prototype, key)?.get === descriptor.get,
    )
  );
}
// One synchronous acquisition of locally computed page indices. Settle before
// inspecting an unknown input/provider, and never retain qualification afterward.
export function nativeTexturePageFrames(pages, indices, gpu, owner, options = null) {
  const barrier = textureReadBarriers.get(pages);
  barrier?.();
  const selected = Uint32Array.from(indices),
    frames = [];
  if (
    !barrier ||
    !options?.pureGeometry ||
    typeof options.blendMode !== 'number' ||
    !nativeD3DContextReadOwned(options.context) ||
    !nativeTexturePagesOwned(pages, owner) ||
    !nativeTextureConsumer(gpu)
  ) {
    for (const index of selected) frames.push(pages.frame(index));
    return frames;
  }
  const records = texturePageMaps.get(pages);
  for (const index of selected) {
    const page = Reflect.apply(originalMapGet, records, [index]),
      frame = page && Object.getOwnPropertyDescriptor(page, 'frame');
    // An unexpected record/getter must run through the ordinary public fence.
    frames.push(!page ? NULL_NATIVE_TEXTURE : (frame?.value ?? pages.frame(index)));
  }
  return frames;
}
// Privileged renderer entry. Public frame() keeps its permanent borrowing rule.
export function nativeTexturePageFrame(pages, index, gpu, owner) {
  const barrier = textureReadBarriers.get(pages);
  if (!barrier || !nativeTexturePagesOwned(pages, owner) || !nativeTextureConsumer(gpu)) {
    barrier?.();
    return pages.frame(index);
  }
  barrier();
  return (
    Reflect.apply(originalMapGet, texturePageMaps.get(pages), [index >>> 0])?.frame ??
    NULL_NATIVE_TEXTURE
  );
}
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
  #observe() {
    const barrier = textureReadBarriers.get(this);
    barrier?.();
    if (this.beforeMutation !== barrier) this.beforeMutation?.();
  }

  constructor(
    layout,
    {
      release = () => {},
      stage = null,
      trackDirty = false,
      beforeMutation = null,
      readBarrier = null,
      owner = null,
    } = {},
  ) {
    textureLayouts.set(this, structuredClone(layout));
    this.releaseFrame = release;
    this.stage = stage;
    this.beforeMutation = beforeMutation;
    if (owner && readBarrier) {
      textureReadBarriers.set(this, readBarrier);
      textureOwners.set(this, owner);
    }
    texturePageMaps.set(this, new Map());
    this.allocateMissing();
    // The flag table covers the entire grid and starts clean after allocation.
    textureFlagArrays.set(
      this,
      trackDirty ? new Uint32Array(layout.grid[0] * layout.grid[1]) : null,
    );
  }
  get pages() {
    borrowTextureStorage(this);
    return textureFields.pages.get(this);
  }
  set pages(value) {
    borrowTextureStorage(this);
    textureFields.pages.set(this, value);
  }
  get dirtyFlags() {
    borrowTextureStorage(this);
    return textureFields.dirtyFlags.get(this);
  }
  set dirtyFlags(value) {
    borrowTextureStorage(this);
    textureFields.dirtyFlags.set(this, value);
  }
  get layout() {
    borrowTextureStorage(this);
    return textureFields.layout.get(this);
  }
  set layout(value) {
    borrowTextureStorage(this);
    textureFields.layout.set(this, value);
  }
  isDirty(index) {
    this.#observe();
    return Boolean(
      textureStorage(this, 'dirtyFlags') &&
        index >= 0 &&
        index < textureStorage(this, 'dirtyFlags').length &&
        textureStorage(this, 'dirtyFlags')[index],
    );
  }
  hasDirtyPages() {
    this.#observe();
    return textureStorage(this, 'dirtyFlags')?.some((flag) => flag !== 0) ?? false;
  }
  clearDirty() {
    this.#observe();
    textureStorage(this, 'dirtyFlags')?.fill(0);
  }
  allocateMissing(texture = textureStorage(this, 'layout')) {
    this.#observe();
    const layout = textureStorage(this, 'layout');
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
            if (textureStorage(this, 'pages').has(index)) continue;
            if ((textureStorage(this, 'pages').size + 1) * width * height > 64 * 1024 * 1024)
              throw new RangeError('Native texture allocation exceeds bitmap capacity');
            const surface = this.stage?.createSurface(width, height) ?? null;
            const page = {
              x: x * width,
              y: y * height,
              bpp: lower ? 16 : layout.bpp,
              surface,
              frame: {
                width,
                height,
                rgba: surface
                  ? new Uint8ClampedArray(
                      nativeStageSurface(this.stage.surfaces, surface).bytes.buffer,
                    )
                  : new Uint8ClampedArray(width * height * 4),
                revision: 0,
              },
            };
            this.#registerRead(page.frame, surface);
            textureStorage(this, 'pages').set(index, page);
          }
      }
  }
  #registerRead(frame, surface = null) {
    const barrier = textureReadBarriers.get(this);
    if (barrier)
      registerNativeTextureRead(frame, barrier, () => borrowNativePixels(frame.rgba), true);
    if (barrier && surface)
      registerNativeSurfaceRead(this.stage.surfaces, surface, barrier, () =>
        borrowNativeTextureRead(frame),
      );
    if (texturePublicLoans.has(this)) borrowNativeTextureRead(frame);
  }
  releaseRectangle(x, y, width, height) {
    this.#observe();
    const right = (x + width) | 0,
      bottom = (y + height) | 0;
    if (x >= right || y >= bottom) return;
    for (const [index, page] of textureStorage(this, 'pages'))
      if (
        x < page.x + page.frame.width &&
        page.x < right &&
        y < page.y + page.frame.height &&
        page.y < bottom
      ) {
        this.releaseFrame(page.frame);
        if (page.surface) this.stage.releaseSurface(page.surface);
        textureStorage(this, 'pages').delete(index);
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
    for (const page of textureStorage(this, 'pages').values()) {
      const { frame } = page;
      if (
        page.x >= right ||
        page.y >= bottom ||
        page.x + frame.width <= left ||
        page.y + frame.height <= top
      )
        continue;
      if (page.bpp !== 32 && (page.bpp !== 16 || textureStorage(this, 'layout').dither))
        return null;
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
    this.#observe();
    const dither = Boolean(textureStorage(this, 'layout').dither);
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
      {
        pages: textureStorage(this, 'pages'),
        dirtyFlags: textureStorage(this, 'dirtyFlags'),
        stage: this.stage,
      },
      input,
      region,
      changed,
      revisionSteps,
      dither,
    );
    if (full || ownsFootprint) return this.#capturePublication(current.rectangle, input);
  }
  clear(x, y, width, height) {
    this.#observe();
    const right = (x + width) | 0,
      bottom = (y + height) | 0;
    if (x >= right || y >= bottom) return;
    for (const [index, page] of textureStorage(this, 'pages')) {
      const { frame } = page,
        left = Math.max(x, page.x),
        top = Math.max(y, page.y),
        endX = Math.min(right, page.x + frame.width),
        endY = Math.min(bottom, page.y + frame.height);
      if (left >= endX || top >= endY) continue;
      if (textureStorage(this, 'dirtyFlags')) textureStorage(this, 'dirtyFlags')[index] = 1;
      for (let row = top; row < endY; row++)
        frame.rgba.fill(
          0,
          ((row - page.y) * frame.width + left - page.x) * 4,
          ((row - page.y) * frame.width + endX - page.x) * 4,
        );
      frame.revision++;
      if (page.surface)
        nativeStageSurface(this.stage.surfaces, page.surface).revision = frame.revision;
    }
  }
  close() {
    this.#observe();
    for (const page of textureStorage(this, 'pages').values()) {
      this.releaseFrame(page.frame);
      if (page.surface) this.stage.releaseSurface(page.surface);
    }
    textureStorage(this, 'pages').clear();
  }
  frame(index) {
    this.#observe();
    const frame = textureStorage(this, 'pages').get(index >>> 0)?.frame ?? NULL_NATIVE_TEXTURE;
    borrowNativeTextureRead(frame);
    borrowNativePixels(frame.rgba);
    return frame;
  }
  snapshot() {
    this.#observe();
    return structuredClone({
      layout: textureStorage(this, 'layout'),
      dirtyFlags: textureStorage(this, 'dirtyFlags'),
      pages: [...textureStorage(this, 'pages')].map(([index, page]) => [
        index,
        { ...page, frame: { ...page.frame, rgba: encodeSparseBytes(page.frame.rgba) } },
      ]),
    });
  }
  restore(state) {
    this.#observe();
    const flags = state.dirtyFlags,
      count = state.layout.grid[0] * state.layout.grid[1];
    if (
      textureStorage(this, 'dirtyFlags') === null
        ? flags !== null
        : !(flags instanceof Uint32Array) ||
          flags.length !== count ||
          flags.some((value) => value !== 0 && value !== 1)
    )
      throw new Error('Invalid native texture page dirty flags checkpoint');
    this.close();
    textureLayouts.set(this, structuredClone(state.layout));
    textureFlagArrays.set(this, flags === null ? null : flags.slice());
    texturePageMaps.set(this, new Map(structuredClone(state.pages)));
    for (const [index, page] of textureStorage(this, 'pages')) {
      if (
        !Number.isInteger(index) ||
        index < 0 ||
        index >= textureStorage(this, 'layout').grid[0] * textureStorage(this, 'layout').grid[1] ||
        ![16, 32].includes(page.bpp) ||
        page.frame.width !== textureStorage(this, 'layout').size[0] ||
        page.frame.height !== textureStorage(this, 'layout').size[1] ||
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
        page.frame.rgba = new Uint8ClampedArray(
          nativeStageSurface(this.stage.surfaces, page.surface).bytes.buffer,
        );
      } else page.frame.rgba = new Uint8ClampedArray(bytes.buffer);
      this.#registerRead(page.frame, page.surface);
    }
  }
}
const texturePageMethods = Reflect.ownKeys(NativeTexturePages.prototype)
  .filter((key) => key !== 'constructor')
  .map((key) => [key, Object.getOwnPropertyDescriptor(NativeTexturePages.prototype, key)]);
const textureMapMethods = Reflect.ownKeys(Map.prototype)
  .filter((key) => key !== 'constructor')
  .map((key) => [key, Object.getOwnPropertyDescriptor(Map.prototype, key)]);

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
      (owned ? page.surfaceObject : nativeStageSurface(stage.surfaces, page.surface)).revision =
        frame.revision;
  }
}

const textureStoragePorts = new Map(
  ['pages', 'dirtyFlags', 'layout'].map((key) => [
    key,
    Object.getOwnPropertyDescriptor(NativeTexturePages.prototype, key),
  ]),
);
